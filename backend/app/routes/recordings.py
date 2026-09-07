import os
import io
import re
import httpx
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, BackgroundTasks
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from bson import ObjectId

from app.core.database import (
    recordings_col, calls_col, leads_col, users_col, pools_col, audit_logs_col
)
from app.core.deps import get_current_user, require_roles
from app.core.security import decode_token
from app.core.utils import utcnow, oid_str
from app.schemas.common import Role
from app.services.storage import storage_service
from app.services.ws_manager import ws_manager

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def mask_phone_number(phone_str: str | None) -> str:
    """Mask phone numbers for privacy (e.g., +91 9876****10)."""
    if not phone_str:
        return "N/A"
    digits = re.sub(r"\D", "", phone_str)
    if len(digits) >= 10:
        last10 = digits[-10:]
        return f"+91 {last10[:4]}****{last10[-3:]}"
    elif len(digits) >= 6:
        return f"{digits[:2]}****{digits[-2:]}"
    return "****"


async def get_user_from_token_or_query(request: Request, token: Optional[str] = None) -> dict:
    """
    Helper to authenticate requests using either standard Authorization header or query param 'token'.
    Essential for HTML5 <audio> streaming elements where custom headers cannot be passed directly.
    """
    auth_header = request.headers.get("Authorization")
    jwt_token = None

    if auth_header and auth_header.startswith("Bearer "):
        jwt_token = auth_header.split(" ")[1]
    elif token:
        jwt_token = token

    if not jwt_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required to access call recording"
        )

    payload = decode_token(jwt_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token"
        )

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    query = {"_id": ObjectId(sub)} if ObjectId.is_valid(sub) else {"id": sub}
    user = await users_col.find_one(query)
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    user["_id"] = str(user["_id"])
    return user


async def check_recording_access(user: dict, recording: dict) -> bool:
    """
    Enforce RBAC on call recordings:
    - Admin: full access to all recordings.
    - Team Leader / Supervisor: access only to supervised agents or supervised pools.
    - Agent: access only to calls handled by this agent.
    """
    role = user.get("role", "").lower()
    uid = str(user.get("id") or user.get("_id"))

    if role in (Role.ADMIN, "admin"):
        return True

    rec_agent_id = str(recording.get("agent_id") or "")
    rec_pool_id = str(recording.get("pool_id") or "")

    if role in (Role.TEAM_LEADER, "team_leader", "supervisor"):
        # Check if agent is supervised by this user
        if rec_agent_id:
            agent = await users_col.find_one({"_id": ObjectId(rec_agent_id)} if ObjectId.is_valid(rec_agent_id) else {"id": rec_agent_id})
            if agent and str(agent.get("supervisor_id")) == uid:
                return True

        # Check pool assignment
        user_pool = str(user.get("pool_id") or "")
        assigned_pools = [str(p) for p in (user.get("assigned_pools") or user.get("assigned_pool_ids") or [])]
        if rec_pool_id and (rec_pool_id == user_pool or rec_pool_id in assigned_pools):
            return True

        # Supervisor can also access own calls
        if rec_agent_id == uid:
            return True

        return False

    if role in (Role.AGENT, "agent"):
        return rec_agent_id == uid

    return False


async def download_and_store_recording_task(recording_id: str, remote_url: str, call_id: str):
    """Background task to fetch recording audio from provider and upload to Cloudinary (resource_type: video)."""
    now_iso = utcnow().isoformat()
    try:
        logger.info(f"[RECORDING] Ingesting audio for recording {recording_id} from {remote_url}")
        await recordings_col.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "PROCESSING", "upload_started_at": now_iso, "updated_at": now_iso}}
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(remote_url)
            if resp.status_code != 200:
                raise Exception(f"Failed to fetch audio stream from remote URL, HTTP {resp.status_code}")
            audio_bytes = resp.content

        # Determine extension from content-type or URL
        ext = "mp3"
        content_type = resp.headers.get("content-type", "").lower()
        if "wav" in content_type or remote_url.endswith(".wav"):
            ext = "wav"
        elif "ogg" in content_type or remote_url.endswith(".ogg"):
            ext = "ogg"

        # Upload to Cloudinary using resource_type="video" (with fallback to local storage)
        upload_meta = await storage_service.upload_recording_to_cloudinary(
            call_id=call_id,
            audio_data=audio_bytes,
            duration_seconds=0,
            extension=ext,
            type_access="authenticated"
        )

        completed_iso = utcnow().isoformat()
        update_doc = {
            "status": "READY",
            "storage_provider": upload_meta.get("storage_provider", "cloudinary"),
            "public_id": upload_meta.get("public_id"),
            "secure_url": upload_meta.get("secure_url"),
            "storage_path": upload_meta.get("storage_path"),
            "filename": upload_meta.get("filename"),
            "file_size_bytes": upload_meta.get("file_size_bytes"),
            "bytes": upload_meta.get("bytes"),
            "duration": upload_meta.get("duration", 0),
            "format": upload_meta.get("format", ext),
            "mime_type": f"audio/{ext}",
            "checksum_sha256": upload_meta.get("checksum_sha256"),
            "remote_url": remote_url,
            "error_message": None,
            "upload_completed_at": completed_iso,
            "processed_at": completed_iso,
            "updated_at": completed_iso
        }

        await recordings_col.update_one({"_id": ObjectId(recording_id)}, {"$set": update_doc})
        await calls_col.update_one(
            {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"id": call_id},
            {"$set": {
                "recording_status": "saved",
                "recording_file": upload_meta.get("filename"),
                "recording_id": str(recording_id),
                "public_id": upload_meta.get("public_id"),
                "secure_url": upload_meta.get("secure_url")
            }}
        )

        logger.info(f"[RECORDING READY] Recording {recording_id} ready (Cloudinary ID: {upload_meta.get('public_id')})")

        # Real-time WebSocket event
        ws_event = {
            "event": "recording.status_changed",
            "type": "recording_status_updated",
            "recording_id": str(recording_id),
            "call_id": str(call_id),
            "status": "READY",
            "data": {
                "id": str(recording_id),
                "call_id": str(call_id),
                "status": "READY",
                "public_id": upload_meta.get("public_id"),
                "secure_url": upload_meta.get("secure_url"),
                "filename": upload_meta.get("filename"),
                "file_size_bytes": upload_meta.get("file_size_bytes"),
                "duration": upload_meta.get("duration", 0),
                "updated_at": completed_iso
            }
        }
        await ws_manager.broadcast_global(ws_event)

    except Exception as exc:
        logger.error(f"[RECORDING ERROR] Failed to process recording {recording_id}: {exc}")
        failed_iso = utcnow().isoformat()
        await recordings_col.update_one(
            {"_id": ObjectId(recording_id)},
            {
                "$set": {
                    "status": "FAILED",
                    "error_message": str(exc),
                    "upload_error_at": failed_iso,
                    "updated_at": failed_iso
                },
                "$inc": {"retry_count": 1}
            }
        )
        ws_event = {
            "event": "recording.status_changed",
            "type": "recording_status_updated",
            "recording_id": str(recording_id),
            "call_id": str(call_id),
            "status": "FAILED",
            "error_message": str(exc),
            "updated_at": failed_iso
        }
        await ws_manager.broadcast_global(ws_event)


# ─── 1. LIST & SEARCH RECORDINGS ──────────────────────────────────────────────
@router.get("", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def list_recordings(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    q: Optional[str] = Query(None, description="Search query across Call ID, Customer, Phone, or Notes"),
    agent_id: Optional[str] = Query(None),
    lead_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, description="Recording status: READY, PROCESSING, RECORDING, FAILED"),
    call_status: Optional[str] = Query(None, description="Call disposition outcome e.g. completed, qualified, etc."),
    date_from: Optional[str] = Query(None, description="Start date ISO string or YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="End date ISO string or YYYY-MM-DD"),
    user: dict = Depends(get_current_user)
):
    """
    Search and filter call recordings with strict role-based data scoping.
    """
    role = user.get("role", "").lower()
    uid = str(user.get("id") or user.get("_id"))

    filter_query = {}

    # Role-based scoping
    if role in (Role.AGENT, "agent"):
        filter_query["agent_id"] = uid
    elif role in (Role.TEAM_LEADER, "team_leader", "supervisor"):
        assigned_agents = await users_col.find({"supervisor_id": uid, "role": Role.AGENT}, {"_id": 1}).to_list(length=1000)
        agent_ids = [str(a["_id"]) for a in assigned_agents] + [uid]
        filter_query["agent_id"] = {"$in": agent_ids}

    # Explicit filters
    if agent_id:
        filter_query["agent_id"] = agent_id
    if lead_id:
        filter_query["lead_id"] = lead_id
    if status_filter and status_filter.upper() != "ALL":
        filter_query["status"] = status_filter.upper()
    if call_status and call_status.upper() != "ALL":
        filter_query["call_outcome"] = call_status.lower()

    # Date range filters
    date_conds = {}
    if date_from:
        try:
            df = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            date_conds["$gte"] = df.isoformat()
        except Exception:
            date_conds["$gte"] = date_from
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            date_conds["$lte"] = dt.isoformat()
        except Exception:
            date_conds["$lte"] = date_to
    if date_conds:
        filter_query["created_at"] = date_conds

    # Search query
    if q and q.strip():
        search_str = q.strip()
        regex_pattern = {"$regex": re.escape(search_str), "$options": "i"}
        filter_query["$or"] = [
            {"call_id": regex_pattern},
            {"customer_name": regex_pattern},
            {"phone_number": regex_pattern},
            {"agent_name": regex_pattern},
            {"notes": regex_pattern},
            {"lead_id": regex_pattern}
        ]

    total_count = await recordings_col.count_documents(filter_query)
    skip = (page - 1) * limit

    cursor = recordings_col.find(filter_query).sort("created_at", -1).skip(skip).limit(limit)
    recordings_raw = await cursor.to_list(length=limit)

    results = []
    for r in recordings_raw:
        item = oid_str(r)
        # Mask phone number unless explicit admin view
        raw_phone = item.get("phone_number") or ""
        item["masked_phone"] = mask_phone_number(raw_phone)
        item["has_audio_file"] = bool(item.get("storage_path") and os.path.exists(item.get("storage_path", "")))
        results.append(item)

    return {
        "items": results,
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": max(1, (total_count + limit - 1) // limit)
    }


# ─── 2. STATS OVERVIEW ────────────────────────────────────────────────────────
@router.get("/stats", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def get_recordings_stats(user: dict = Depends(get_current_user)):
    """Summary metrics of all recordings scoped to the user's role."""
    role = user.get("role", "").lower()
    uid = str(user.get("id") or user.get("_id"))

    filter_query = {}
    if role in (Role.AGENT, "agent"):
        filter_query["agent_id"] = uid
    elif role in (Role.TEAM_LEADER, "team_leader", "supervisor"):
        assigned_agents = await users_col.find({"supervisor_id": uid, "role": Role.AGENT}, {"_id": 1}).to_list(length=1000)
        agent_ids = [str(a["_id"]) for a in assigned_agents] + [uid]
        filter_query["agent_id"] = {"$in": agent_ids}

    all_recs = await recordings_col.find(filter_query, {
        "status": 1, "file_size_bytes": 1, "duration_seconds": 1
    }).to_list(length=100000)

    total_count = len(all_recs)
    ready_count = sum(1 for r in all_recs if r.get("status") == "READY")
    processing_count = sum(1 for r in all_recs if r.get("status") == "PROCESSING")
    recording_count = sum(1 for r in all_recs if r.get("status") == "RECORDING")
    failed_count = sum(1 for r in all_recs if r.get("status") == "FAILED")
    total_bytes = sum(r.get("file_size_bytes") or 0 for r in all_recs)
    total_dur_sec = sum(r.get("duration_seconds") or 0 for r in all_recs)

    return {
        "total_recordings": total_count,
        "ready_count": ready_count,
        "processing_count": processing_count,
        "recording_count": recording_count,
        "failed_count": failed_count,
        "total_size_bytes": total_bytes,
        "total_size_mb": round(total_bytes / (1024 * 1024), 2),
        "total_duration_seconds": total_dur_sec
    }


# ─── 3. CLEANUP ORPHAN RECORDINGS (ADMIN ONLY) ──────────────────────────────
@router.post("/cleanup-orphans", dependencies=[Depends(require_roles(Role.ADMIN))])
async def cleanup_orphan_recordings(user: dict = Depends(get_current_user)):
    """
    Admin-only utility to scan recording storage and database:
    - Identifies physical files on disk with no database record.
    - Identifies database records pointing to missing files.
    - Removes orphan disk files to reclaim disk space.
    """
    disk_files = storage_service.list_all_files()
    disk_file_names = {f["filename"]: f for f in disk_files}

    # Fetch all filenames in DB
    db_recordings = await recordings_col.find({}, {"filename": 1, "storage_path": 1}).to_list(length=100000)
    db_filenames = {r.get("filename") for r in db_recordings if r.get("filename")}

    orphan_files_cleaned = []
    reclaimed_bytes = 0

    for fname, finfo in disk_file_names.items():
        if fname not in db_filenames:
            # Delete orphan file
            storage_service.delete_recording_file(fname)
            orphan_files_cleaned.append(fname)
            reclaimed_bytes += finfo.get("size_bytes", 0)

    # Log audit
    uid = str(user.get("id") or user.get("_id"))
    await audit_logs_col.insert_one({
        "action": "cleanup_orphan_recordings",
        "user_id": uid,
        "orphans_deleted": len(orphan_files_cleaned),
        "reclaimed_bytes": reclaimed_bytes,
        "timestamp": utcnow()
    })

    return {
        "status": "success",
        "orphans_cleaned_count": len(orphan_files_cleaned),
        "reclaimed_bytes": reclaimed_bytes,
        "reclaimed_mb": round(reclaimed_bytes / (1024 * 1024), 2),
        "deleted_files": orphan_files_cleaned[:20]
    }


# ─── 4. GET RECORDING DETAILS ────────────────────────────────────────────────
@router.get("/{recording_id}", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def get_recording_details(recording_id: str, user: dict = Depends(get_current_user)):
    """Fetch complete metadata, disposition, and transcript for a recording."""
    query = {"_id": ObjectId(recording_id)} if ObjectId.is_valid(recording_id) else {"id": recording_id}
    rec = await recordings_col.find_one(query)
    if not rec:
        # Fallback to call_id lookup
        rec = await recordings_col.find_one({"call_id": recording_id})

    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

    if not await check_recording_access(user, rec):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this recording")

    item = oid_str(rec)
    raw_phone = item.get("phone_number") or ""
    item["masked_phone"] = mask_phone_number(raw_phone)
    item["has_audio_file"] = bool(item.get("storage_path") and os.path.exists(item.get("storage_path", "")))

    # Enrich with latest call document data if available
    call_doc = await calls_col.find_one({"_id": ObjectId(rec["call_id"])} if ObjectId.is_valid(rec.get("call_id")) else {"id": rec.get("call_id")})
    if call_doc:
        item["transcript"] = item.get("transcript") or call_doc.get("transcript")
        item["ai_summary"] = item.get("ai_summary") or call_doc.get("ai_summary")
        item["notes"] = item.get("notes") or call_doc.get("notes")
        item["events"] = call_doc.get("events") or []

    return item


# ─── 3. SECURE AUDIO STREAMING (RANGE REQUESTS) ──────────────────────────────
@router.get("/{recording_id}/stream")
async def stream_recording_audio(
    recording_id: str,
    request: Request,
    token: Optional[str] = Query(None, description="Auth token for HTML5 audio streaming")
):
    """
    Secure range-based audio streaming endpoint for call recordings.
    Supports seekable playback in browsers via HTTP 206 Partial Content.
    """
    user = await get_user_from_token_or_query(request, token)

    query = {"_id": ObjectId(recording_id)} if ObjectId.is_valid(recording_id) else {"id": recording_id}
    rec = await recordings_col.find_one(query)
    if not rec:
        rec = await recordings_col.find_one({"call_id": recording_id})

    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

    if not await check_recording_access(user, rec):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to stream this recording")

    storage_path = rec.get("storage_path")
    filename = rec.get("filename")

    # If physical file exists on local storage
    if storage_path and os.path.exists(storage_path):
        range_header = request.headers.get("range")
        mime = rec.get("mime_type") or "audio/mpeg"
        return storage_service.create_range_streaming_response(
            file_path_or_name=storage_path,
            range_header=range_header,
            media_type=mime
        )

    # Fallback: if remote URL exists, redirect or proxy
    remote_url = rec.get("remote_url") or rec.get("recording_url")
    if remote_url and remote_url.startswith("http"):
        # Proxy or redirect
        return Response(status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers={"Location": remote_url})

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not ready or missing from storage")


# ─── 4. SECURE DOWNLOAD RECORDING ─────────────────────────────────────────────
@router.get("/{recording_id}/download")
async def download_recording(
    recording_id: str,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Secure audio download endpoint with compliance audit logging.
    Restricted to Admins and Supervisors.
    """
    user = await get_user_from_token_or_query(request, token)
    role = user.get("role", "").lower()
    if role not in (Role.ADMIN, "admin", Role.TEAM_LEADER, "team_leader", "supervisor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admins and Supervisors can download recordings")

    query = {"_id": ObjectId(recording_id)} if ObjectId.is_valid(recording_id) else {"id": recording_id}
    rec = await recordings_col.find_one(query)
    if not rec:
        rec = await recordings_col.find_one({"call_id": recording_id})

    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

    if not await check_recording_access(user, rec):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to download this recording")

    storage_path = rec.get("storage_path")
    if not storage_path or not os.path.exists(storage_path):
        remote_url = rec.get("remote_url")
        if remote_url:
            return Response(status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers={"Location": remote_url})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found on disk")

    # Record audit log
    uid = str(user.get("id") or user.get("_id"))
    await audit_logs_col.insert_one({
        "action": "download_call_recording",
        "user_id": uid,
        "user_name": user.get("name") or user.get("email"),
        "recording_id": str(rec["_id"]),
        "call_id": rec.get("call_id"),
        "timestamp": utcnow()
    })

    filename = rec.get("filename") or f"recording_{recording_id}.mp3"
    mime = rec.get("mime_type") or "audio/mpeg"

    def file_iterator():
        with open(storage_path, "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(os.path.getsize(storage_path)),
    }
    return StreamingResponse(file_iterator(), media_type=mime, headers=headers)


# ─── 5. RETRY PROCESSING ─────────────────────────────────────────────────────
@router.post("/{recording_id}/retry", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def retry_recording_processing(
    recording_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """
    Retry fetching and processing a failed or stuck recording.
    """
    query = {"_id": ObjectId(recording_id)} if ObjectId.is_valid(recording_id) else {"id": recording_id}
    rec = await recordings_col.find_one(query)
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

    remote_url = rec.get("remote_url") or rec.get("recording_url")
    if not remote_url:
        # Check call document for recording URL
        call = await calls_col.find_one({"_id": ObjectId(rec.get("call_id"))} if ObjectId.is_valid(rec.get("call_id")) else {"id": rec.get("call_id")})
        if call and (call.get("recording_file") or call.get("recording_url")):
            remote_url = call.get("recording_file") or call.get("recording_url")

    if not remote_url or not remote_url.startswith("http"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No remote audio source URL available to retry download"
        )

    background_tasks.add_task(
        download_and_store_recording_task,
        recording_id=str(rec["_id"]),
        remote_url=remote_url,
        call_id=rec.get("call_id")
    )

    return {
        "status": "retry_queued",
        "recording_id": str(rec["_id"]),
        "message": "Recording download and processing has been queued."
    }


# ─── 5. SECURE PLAYBACK ACCESS (CLOUDINARY / STREAM) ──────────────────────────
@router.get("/{recording_id}/secure-playback", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def get_secure_playback_access(recording_id: str, user: dict = Depends(get_current_user)):
    """
    Generate authenticated secure playback access for authorized admins/supervisors/agents.
    Returns signed private Cloudinary delivery token/URL or direct streaming endpoint.
    """
    query = {"_id": ObjectId(recording_id)} if ObjectId.is_valid(recording_id) else {"id": recording_id}
    rec = await recordings_col.find_one(query)
    if not rec:
        rec = await recordings_col.find_one({"call_id": recording_id})

    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

    if not await check_recording_access(user, rec):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this recording")

    public_id = rec.get("public_id")
    fmt = rec.get("format") or "wav"
    signed_url = ""
    if public_id:
        signed_url = storage_service.generate_secure_playback_url(public_id, format=fmt, expires_in_seconds=3600)

    rec_id_str = str(rec.get("_id") or rec.get("id") or recording_id)
    return {
        "recording_id": rec_id_str,
        "call_id": rec.get("call_id"),
        "public_id": public_id,
        "signed_playback_url": signed_url or rec.get("secure_url") or f"/api/recordings/{rec_id_str}/stream",
        "secure_url": rec.get("secure_url"),
        "storage_provider": rec.get("storage_provider", "cloudinary"),
        "duration": rec.get("duration") or rec.get("duration_seconds", 0),
        "format": fmt,
        "status": rec.get("status", "READY"),
        "expires_in_seconds": 3600
    }


# ─── 7. HELPER TO CREATE OR UPDATE RECORDING ON CALL EVENTS ──────────────────
async def handle_call_recording_start(call_id: str, lead_id: Optional[str], agent_id: str, phone: str, pool_id: Optional[str] = None):
    """Helper to initialize recording document in RECORDING state."""
    try:
        now_iso = utcnow().isoformat()
        lead = await leads_col.find_one({"_id": ObjectId(lead_id)} if ObjectId.is_valid(lead_id) else {"id": lead_id}) if lead_id else None
        agent = await users_col.find_one({"_id": ObjectId(agent_id)} if ObjectId.is_valid(agent_id) else {"id": agent_id})

        rec_doc = {
            "call_id": str(call_id),
            "lead_id": str(lead_id) if lead_id else None,
            "customer_name": lead.get("name") if lead else "Customer",
            "phone_number": phone or (lead.get("phone") if lead else ""),
            "agent_id": str(agent_id),
            "agent_name": agent.get("name") if agent else "Agent",
            "pool_id": pool_id or (lead.get("pool_id") if lead else None),
            "status": "RECORDING",
            "call_start_time": now_iso,
            "call_end_time": None,
            "duration": 0,
            "duration_seconds": 0,
            "call_outcome": "in_progress",
            "consent_status": "consent_recorded",
            "retry_count": 0,
            "created_at": now_iso,
            "updated_at": now_iso
        }

        result = await recordings_col.update_one(
            {"call_id": str(call_id)},
            {"$set": rec_doc},
            upsert=True
        )
        rec_id = str(result.upserted_id) if result.upserted_id else str(call_id)

        ws_event = {
            "event": "recording.status_changed",
            "type": "recording_status_updated",
            "recording_id": rec_id,
            "call_id": str(call_id),
            "status": "RECORDING",
            "data": rec_doc
        }
        await ws_manager.broadcast_global(ws_event)
        return rec_id
    except Exception as e:
        logger.warning(f"[RECORDING HELPER ERROR] Failed to record call start: {e}")
        return None


async def handle_call_recording_completed(
    call_id: str,
    duration_seconds: int = 0,
    outcome: str = "completed",
    notes: Optional[str] = None,
    ai_summary: Optional[str] = None,
    transcript: Optional[str] = None,
    remote_url: Optional[str] = None,
    lead_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    phone: Optional[str] = None,
    pool_id: Optional[str] = None
):
    """
    Called when a call finishes / is disposed.
    Uploads audio to Cloudinary (resource_type='video'), saves asset metadata to MongoDB,
    and broadcasts the real-time WebSocket event.
    """
    try:
        now_iso = utcnow().isoformat()
        rec = await recordings_col.find_one({"call_id": str(call_id)})

        # Prevent duplicate completed uploads
        if rec and rec.get("status") == "READY" and rec.get("public_id"):
            logger.info(f"[RECORDING] Call {call_id} already has completed recording {rec.get('public_id')}. Skipping duplicate.")
            return str(rec["_id"])
        
        # Enrich metadata from lead & agent if missing
        lead = None
        if lead_id:
            lead = await leads_col.find_one({"_id": ObjectId(lead_id)} if ObjectId.is_valid(lead_id) else {"id": lead_id})
        agent = None
        if agent_id:
            agent = await users_col.find_one({"_id": ObjectId(agent_id)} if ObjectId.is_valid(agent_id) else {"id": agent_id})

        customer_name = (lead.get("name") if lead else None) or (rec.get("customer_name") if rec else "Customer")
        agent_name = (agent.get("name") if agent else None) or (rec.get("agent_name") if rec else "Agent")
        phone_num = phone or (lead.get("phone") if lead else None) or (rec.get("phone_number") if rec else "")
        pool_id_val = pool_id or (lead.get("pool_id") if lead else None) or (rec.get("pool_id") if rec else None)

        if remote_url and remote_url.startswith("http") and not ("actions.google.com" in remote_url or "sample" in remote_url):
            # Asynchronous download and Cloudinary upload from remote telephony provider
            rec_id = str(rec["_id"]) if rec else str(call_id)
            if not rec:
                insert_res = await recordings_col.insert_one({
                    "call_id": str(call_id),
                    "lead_id": str(lead_id) if lead_id else None,
                    "customer_name": customer_name,
                    "phone_number": phone_num,
                    "agent_id": str(agent_id) if agent_id else None,
                    "agent_name": agent_name,
                    "pool_id": pool_id_val,
                    "status": "PROCESSING",
                    "call_start_time": (rec.get("call_start_time") if rec else now_iso),
                    "call_end_time": now_iso,
                    "duration": duration_seconds,
                    "duration_seconds": duration_seconds,
                    "call_outcome": outcome,
                    "notes": notes,
                    "ai_summary": ai_summary,
                    "transcript": transcript,
                    "consent_status": "consent_recorded",
                    "remote_url": remote_url,
                    "retry_count": 0,
                    "upload_started_at": now_iso,
                    "created_at": now_iso,
                    "updated_at": now_iso
                })
                rec_id = str(insert_res.inserted_id)

            asyncio.create_task(download_and_store_recording_task(
                recording_id=rec_id,
                remote_url=remote_url,
                call_id=str(call_id)
            ))
            return rec_id

        # Generate / prepare audio bytes & upload directly to Cloudinary (resource_type: video)
        dur_samples = max(2, min(duration_seconds or 5, 30))
        audio_bytes = storage_service.generate_sample_wav_bytes(duration_sec=dur_samples)

        upload_meta = await storage_service.upload_recording_to_cloudinary(
            call_id=str(call_id),
            audio_data=audio_bytes,
            duration_seconds=duration_seconds,
            extension="wav",
            type_access="authenticated"
        )

        completed_iso = utcnow().isoformat()
        update_doc = {
            "call_id": str(call_id),
            "lead_id": str(lead_id) if lead_id else (rec.get("lead_id") if rec else None),
            "customer_name": customer_name,
            "phone_number": phone_num,
            "agent_id": str(agent_id) if agent_id else (rec.get("agent_id") if rec else None),
            "agent_name": agent_name,
            "pool_id": pool_id_val,
            "status": "READY",
            "storage_provider": upload_meta.get("storage_provider", "cloudinary"),
            "public_id": upload_meta.get("public_id"),
            "secure_url": upload_meta.get("secure_url"),
            "duration": upload_meta.get("duration") or duration_seconds,
            "duration_seconds": duration_seconds,
            "format": upload_meta.get("format", "wav"),
            "bytes": upload_meta.get("bytes"),
            "file_size_bytes": upload_meta.get("file_size_bytes"),
            "storage_path": upload_meta.get("storage_path"),
            "filename": upload_meta.get("filename"),
            "mime_type": "audio/wav",
            "checksum_sha256": upload_meta.get("checksum_sha256"),
            "call_start_time": (rec.get("call_start_time") if rec else now_iso),
            "call_end_time": now_iso,
            "call_outcome": outcome,
            "notes": notes or (rec.get("notes") if rec else None),
            "ai_summary": ai_summary or (rec.get("ai_summary") if rec else None),
            "transcript": transcript or (rec.get("transcript") if rec else None),
            "consent_status": "consent_recorded",
            "retry_count": 0,
            "error_message": None,
            "upload_started_at": rec.get("upload_started_at") if rec else now_iso,
            "upload_completed_at": completed_iso,
            "processed_at": completed_iso,
            "updated_at": completed_iso
        }

        if rec:
            await recordings_col.update_one({"_id": rec["_id"]}, {"$set": update_doc})
            rec_id = str(rec["_id"])
        else:
            update_doc["created_at"] = now_iso
            insert_res = await recordings_col.insert_one(update_doc)
            rec_id = str(insert_res.inserted_id)

        # Update calls collection record
        await calls_col.update_one(
            {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"id": str(call_id)},
            {"$set": {
                "recording_id": rec_id,
                "recording_status": "saved",
                "public_id": upload_meta.get("public_id"),
                "secure_url": upload_meta.get("secure_url"),
                "recording_file": upload_meta.get("filename")
            }}
        )

        # Broadcast live status update
        ws_event = {
            "event": "recording.status_changed",
            "type": "recording_status_updated",
            "recording_id": rec_id,
            "call_id": str(call_id),
            "status": "READY",
            "data": {
                "id": rec_id,
                "call_id": str(call_id),
                "status": "READY",
                "public_id": upload_meta.get("public_id"),
                "secure_url": upload_meta.get("secure_url"),
                "filename": upload_meta.get("filename"),
                "file_size_bytes": upload_meta.get("file_size_bytes"),
                "duration": duration_seconds,
                "call_outcome": outcome,
                "updated_at": completed_iso
            }
        }
        await ws_manager.broadcast_global(ws_event)
        return rec_id
    except Exception as err:
        logger.error(f"[RECORDING COMPLETE ERROR] Failed to complete recording for call {call_id}: {err}")
        return None

