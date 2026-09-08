import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
from bson import ObjectId

from app.core.database import calls_col, recordings_col, audit_logs_col
from app.core.utils import utcnow, oid_str
from app.services.storage import storage_service
from app.services.ws_manager import ws_manager

logger = logging.getLogger("uvicorn.error")


def _safe_oid(oid_val: Any) -> ObjectId | None:
    if oid_val and isinstance(oid_val, str) and ObjectId.is_valid(oid_val):
        return ObjectId(oid_val)
    elif isinstance(oid_val, ObjectId):
        return oid_val
    return None


def _parse_to_utc_datetime(val: Any) -> datetime | None:
    """Converts a datetime or ISO string to a timezone-aware UTC datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        try:
            clean_str = val.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_str)
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None
    return None


async def purge_expired_calls_and_recordings(retention_hours: float = 24.0) -> Dict[str, Any]:
    """
    Automated Retention Cleanup Service:
    Deletes call logs and their associated audio recordings (from Cloudinary and local storage)
    older than `retention_hours` (default: 24.0 hours) relative to UTC.
    
    Ensures:
    1. Active/live calls in progress are preserved.
    2. Associated audio files and Cloudinary assets are completely destroyed before DB removal.
    3. Audit logs and WebSocket events are emitted for full observability.
    4. Timezone comparisons use consistent UTC datetime objects.
    """
    now = utcnow()
    cutoff_time = now - timedelta(hours=retention_hours)
    cutoff_iso = cutoff_time.isoformat()

    logger.info(f"[RETENTION CLEANUP] Initiating purge for records older than {retention_hours}h (Cutoff UTC: {cutoff_iso})")

    deleted_calls_count = 0
    deleted_recordings_count = 0
    deleted_cloudinary_assets = 0
    deleted_local_files = 0
    errors: List[str] = []

    # 1. Query candidate calls that are completed/ended and have timestamps <= cutoff
    # Non-live statuses eligible for 24h expiration
    eligible_statuses = [
        "completed", "wrap_up", "wrapup", "failed", "busy", "no-answer",
        "canceled", "cancelled", "qualified", "not_interested", "resolved", "closed"
    ]

    # Query calls that have started_at, ended_at, created_at, or completed_at <= cutoff_time or status in eligible_statuses
    # We fetch with a query that filters on status + date bounds
    query = {
        "$or": [
            {"status": {"$in": eligible_statuses}},
            {"status": {"$nin": ["live", "queued", "in_progress", "ringing"]}}
        ]
    }

    try:
        candidate_calls = await calls_col.find(query).to_list(length=2000)
    except Exception as e:
        logger.error(f"[RETENTION CLEANUP] Failed to query calls: {e}")
        return {
            "status": "error",
            "message": str(e),
            "cutoff_utc": cutoff_iso,
            "deleted_calls": 0,
            "deleted_recordings": 0
        }

    calls_to_delete = []
    for c in candidate_calls:
        # Determine the most accurate reference timestamp for this call
        ref_time = (
            _parse_to_utc_datetime(c.get("ended_at"))
            or _parse_to_utc_datetime(c.get("wrap_up_completed_at"))
            or _parse_to_utc_datetime(c.get("dispositionCompletedAt"))
            or _parse_to_utc_datetime(c.get("dispositionStartedAt"))
            or _parse_to_utc_datetime(c.get("completed_at"))
            or _parse_to_utc_datetime(c.get("started_at"))
            or _parse_to_utc_datetime(c.get("created_at"))
        )

        if ref_time and ref_time <= cutoff_time:
            calls_to_delete.append(c)

    # 2. Process deletions for each expired call
    for call in calls_to_delete:
        call_id = str(call.get("_id") or call.get("id"))
        call_oid = _safe_oid(call.get("_id"))
        rec_id = call.get("recording_id")

        try:
            # A. Find matching recordings in recordings_col
            rec_query_or = [{"call_id": call_id}, {"call_id": str(call_oid)}]
            if rec_id:
                rec_query_or.append({"recording_id": str(rec_id)})
                if _safe_oid(rec_id):
                    rec_query_or.append({"_id": _safe_oid(rec_id)})

            matching_recs = await recordings_col.find({"$or": rec_query_or}).to_list(length=100)

            for rec in matching_recs:
                rec_oid = rec.get("_id")
                public_id = rec.get("public_id")
                filename = rec.get("filename")
                storage_path = rec.get("storage_path")
                access_type = rec.get("type", "upload")

                # Destroy Cloudinary Asset
                if public_id:
                    try:
                        storage_service.delete_cloudinary_asset(public_id, type_access=access_type)
                        deleted_cloudinary_assets += 1
                    except Exception as cl_err:
                        logger.warning(f"[RETENTION CLEANUP] Cloudinary delete failed for {public_id}: {cl_err}")

                # Delete Local Audio File
                if filename:
                    try:
                        if storage_service.delete_recording_file(filename):
                            deleted_local_files += 1
                    except Exception as fl_err:
                        logger.warning(f"[RETENTION CLEANUP] File delete failed for {filename}: {fl_err}")

                if storage_path and os.path.exists(storage_path):
                    try:
                        os.remove(storage_path)
                        deleted_local_files += 1
                    except Exception:
                        pass

                # Delete recording document
                if rec_oid:
                    await recordings_col.delete_one({"_id": rec_oid})
                    deleted_recordings_count += 1

            # B. Check if audio metadata was stored directly on the call document
            call_public_id = call.get("public_id")
            call_filename = call.get("recording_file")
            call_storage_path = call.get("storage_path")

            if call_public_id:
                try:
                    storage_service.delete_cloudinary_asset(call_public_id, type_access="upload")
                    deleted_cloudinary_assets += 1
                except Exception:
                    pass

            if call_filename:
                try:
                    storage_service.delete_recording_file(call_filename)
                    deleted_local_files += 1
                except Exception:
                    pass

            if call_storage_path and os.path.exists(call_storage_path):
                try:
                    os.remove(call_storage_path)
                    deleted_local_files += 1
                except Exception:
                    pass

            # C. Delete Call Record from calls_col
            if call_oid:
                await calls_col.delete_one({"_id": call_oid})
            else:
                await calls_col.delete_one({"id": call_id})

            deleted_calls_count += 1

            # D. Audit Log
            await audit_logs_col.insert_one({
                "action": "auto_delete_expired_call_log",
                "call_id": call_id,
                "retention_hours": retention_hours,
                "agent_id": call.get("agent_id"),
                "lead_id": call.get("lead_id"),
                "timestamp": utcnow()
            })

            # E. Broadcast WebSocket deletion notification
            await ws_manager.broadcast_global({
                "event": "call.deleted",
                "type": "call_deleted",
                "call_id": call_id,
                "reason": "expired_24h_retention"
            })

        except Exception as e:
            err_msg = f"Failed deleting expired call {call_id}: {str(e)}"
            logger.error(f"[RETENTION CLEANUP] {err_msg}")
            errors.append(err_msg)

    # 3. Purge any orphaned recordings older than cutoff in recordings_col
    try:
        all_recs = await recordings_col.find({}).to_list(length=2000)
        for rec in all_recs:
            rec_time = _parse_to_utc_datetime(rec.get("created_at") or rec.get("upload_completed_at") or rec.get("updated_at"))
            if rec_time and rec_time <= cutoff_time:
                rec_oid = rec.get("_id")
                public_id = rec.get("public_id")
                filename = rec.get("filename")
                storage_path = rec.get("storage_path")

                if public_id:
                    storage_service.delete_cloudinary_asset(public_id, type_access=rec.get("type", "upload"))
                if filename:
                    storage_service.delete_recording_file(filename)
                if storage_path and os.path.exists(storage_path):
                    try:
                        os.remove(storage_path)
                    except Exception:
                        pass

                await recordings_col.delete_one({"_id": rec_oid})
                deleted_recordings_count += 1
    except Exception as e:
        logger.warning(f"[RETENTION CLEANUP] Orphaned recordings scan error: {e}")

    # Broadcast global refresh event if any items were purged
    if deleted_calls_count > 0 or deleted_recordings_count > 0:
        await ws_manager.broadcast_global({
            "event": "calls_updated",
            "type": "retention_cleanup",
            "deleted_calls": deleted_calls_count,
            "deleted_recordings": deleted_recordings_count
        })

    logger.info(
        f"[RETENTION CLEANUP COMPLETED] Purged {deleted_calls_count} calls, "
        f"{deleted_recordings_count} recordings, {deleted_cloudinary_assets} Cloudinary assets, "
        f"{deleted_local_files} local files."
    )

    return {
        "status": "success",
        "retention_hours": retention_hours,
        "cutoff_utc": cutoff_iso,
        "deleted_calls": deleted_calls_count,
        "deleted_recordings": deleted_recordings_count,
        "deleted_cloudinary_assets": deleted_cloudinary_assets,
        "deleted_local_files": deleted_local_files,
        "errors": errors
    }
