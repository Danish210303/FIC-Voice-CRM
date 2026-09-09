import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Body, status, Request
from pydantic import BaseModel

from app.core.database import follow_ups_col, leads_col, users_col, calls_col, pools_col, audit_logs_col
from app.core.utils import utcnow, oid_str, normalize_phone
from app.core.deps import require_roles, get_current_user
from app.schemas.common import FollowUpCreate, FollowUpUpdate, FollowUpComplete, Role
from app.services.ws_manager import ws_manager
from app.services.follow_up_service import (
    parse_datetime_to_utc,
    evaluate_follow_ups,
    initiate_auto_callback_for_agent,
    record_follow_up_timeline_event
)

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/follow-ups", tags=["follow-ups"])


class ReassignPayload(BaseModel):
    agent_id: Optional[str] = None
    pool_id: Optional[str] = None
    notes: Optional[str] = None


def _safe_oid(oid_val: str | None) -> ObjectId | None:
    if oid_val and isinstance(oid_val, str) and ObjectId.is_valid(oid_val):
        return ObjectId(oid_val)
    elif isinstance(oid_val, ObjectId):
        return oid_val
    return None


def serialize_follow_up(fu: Dict[str, Any]) -> Dict[str, Any]:
    """Helper to convert MongoDB follow_up document into a clean JSON response with full timeline."""
    fu_id = str(fu["_id"]) if "_id" in fu else str(fu.get("id", ""))
    
    # Format ISO strings safely
    fu_dt = fu.get("follow_up_datetime") or fu.get("scheduled_at")
    if isinstance(fu_dt, datetime):
        fu_dt_iso = fu_dt.isoformat()
    elif fu_dt:
        fu_dt_iso = str(fu_dt)
    else:
        fu_dt_iso = ""

    created_at = fu.get("created_at")
    created_at_iso = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")

    completed_at = fu.get("completed_at")
    completed_at_iso = completed_at.isoformat() if isinstance(completed_at, datetime) else str(completed_at or "")

    missed_at = fu.get("missed_at")
    missed_at_iso = missed_at.isoformat() if isinstance(missed_at, datetime) else (str(missed_at) if missed_at else None)

    # Resolve agent names
    orig_agent_id = str(fu.get("original_agent_id") or fu.get("assigned_agent_id") or fu.get("agent_id") or "")
    orig_agent_name = fu.get("original_agent_name") or fu.get("assigned_agent_name") or fu.get("agent_name") or "Agent"

    curr_agent_id = str(fu.get("current_agent_id") or fu.get("agent_id") or fu.get("assigned_agent_id") or "")
    curr_agent_name = fu.get("current_agent_name") or fu.get("agent_name") or fu.get("assigned_agent_name") or "Agent"

    timeline_raw = fu.get("timeline") or []
    attempts_raw = fu.get("attempts") or []

    return {
        "id": fu_id,
        "_id": fu_id,
        "follow_up_id": fu_id,
        "customer_id": str(fu.get("customer_id") or fu.get("lead_id") or ""),
        "lead_id": str(fu.get("lead_id") or fu.get("customer_id") or ""),
        "customer_name": fu.get("customer_name") or "Customer",
        "customer_phone": fu.get("customer_phone") or fu.get("phone_number") or "",
        "phone_number": fu.get("customer_phone") or fu.get("phone_number") or "",
        "original_agent_id": orig_agent_id,
        "original_agent_name": orig_agent_name,
        "assigned_agent_id": orig_agent_id,
        "assigned_agent_name": orig_agent_name,
        "current_agent_id": curr_agent_id,
        "current_agent_name": curr_agent_name,
        "agent_id": curr_agent_id,
        "agent_name": curr_agent_name,
        "agent_employee_id": fu.get("agent_employee_id") or "",
        "pool_id": str(fu.get("pool_id") or "general"),
        "pool_name": fu.get("pool_name") or "Customer Support",
        "scheduled_at": fu_dt_iso,
        "follow_up_datetime": fu_dt_iso,
        "reason": fu.get("reason") or "Follow-Up Call",
        "notes": fu.get("notes") or "",
        "status": fu.get("status") or "scheduled",
        "priority": fu.get("priority") or "medium",
        "time_zone": fu.get("time_zone") or "Asia/Kolkata",
        "original_call_id": str(fu.get("original_call_id") or fu.get("related_call_id") or ""),
        "related_call_id": str(fu.get("related_call_id") or fu.get("original_call_id") or ""),
        "timeline": timeline_raw,
        "attempts": attempts_raw,
        "call_attempts_count": fu.get("call_attempts_count") or len(attempts_raw),
        "completion_outcome": fu.get("completion_outcome") or "",
        "completion_notes": fu.get("completion_notes") or "",
        "created_at": created_at_iso,
        "completed_at": completed_at_iso if completed_at else None,
        "missed_at": missed_at_iso,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_follow_up(
    payload: FollowUpCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a scheduled BPO Follow-Up Task for a customer and agent with complete audit timeline.
    Broadcasts real-time FOLLOW_UP_CREATED event over WebSockets.
    """
    now = utcnow()
    fu_dt = parse_datetime_to_utc(payload.follow_up_datetime)

    # Determine initial status based on scheduled time
    status_val = "due" if fu_dt <= now else "scheduled"

    agent_id = payload.agent_id or str(current_user.get("_id") or current_user.get("id"))
    agent_name = "Agent"
    agent_emp_id = ""
    agent_user = None

    if agent_id:
        agent_oid = _safe_oid(agent_id)
        agent_user = await users_col.find_one({"$or": [{"_id": agent_oid}, {"id": agent_id}]}) if (agent_oid or agent_id) else None
        if agent_user:
            agent_name = agent_user.get("name") or agent_user.get("email", "").split("@")[0]
            agent_emp_id = agent_user.get("employee_id", "")

    # Resolve Lead / Customer details
    cust_name = payload.customer_name or "Customer"
    cust_phone = normalize_phone(payload.customer_phone)
    cust_id = payload.customer_id or payload.lead_id
    pool_id = payload.pool_id or (agent_user.get("pool_id") if agent_user else None) or "general"
    pool_name = "Customer Support"

    if cust_id:
        lead_oid = _safe_oid(cust_id)
        lead = await leads_col.find_one({"$or": [{"_id": lead_oid}, {"lead_id": cust_id}]}) if (lead_oid or cust_id) else None
        if lead:
            cust_name = lead.get("name") or cust_name
            cust_phone = normalize_phone(lead.get("phone") or cust_phone)
            if not pool_id or pool_id == "general":
                pool_id = str(lead.get("pool_id") or pool_id)

    if pool_id and pool_id != "general":
        pool_oid = _safe_oid(pool_id)
        pool = await pools_col.find_one({"$or": [{"_id": pool_oid}, {"id": pool_id}]}) if (pool_oid or pool_id) else None
        if pool:
            pool_name = pool.get("name") or pool_name

    initial_timeline = [
        {
            "id": f"evt_{uuid.uuid4().hex[:8]}",
            "timestamp": now.isoformat(),
            "action": "FOLLOW_UP_SCHEDULED",
            "description": f"Callback scheduled for {fu_dt.strftime('%d %b %Y, %I:%M %p IST')} ({payload.reason or payload.notes or 'Callback Request'})",
            "actor": str(current_user.get("name") or "Agent"),
            "actor_role": str(current_user.get("role", "Agent")).title(),
            "metadata": {
                "scheduled_datetime": fu_dt.isoformat(),
                "agent_id": agent_id,
                "agent_name": agent_name,
                "pool_id": pool_id,
                "pool_name": pool_name
            }
        }
    ]

    doc = {
        "customer_id": cust_id or cust_phone or str(now.timestamp()),
        "lead_id": cust_id,
        "customer_name": cust_name,
        "customer_phone": cust_phone,
        "phone_number": cust_phone,
        "user_id": str(current_user.get("_id") or current_user.get("id")),
        "original_agent_id": agent_id,
        "original_agent_name": agent_name,
        "assigned_agent_id": agent_id,
        "assigned_agent_name": agent_name,
        "current_agent_id": agent_id,
        "current_agent_name": agent_name,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_employee_id": agent_emp_id,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "scheduled_at": fu_dt,
        "follow_up_datetime": fu_dt,
        "reason": payload.reason or "Follow-Up Call",
        "notes": payload.notes or "",
        "status": status_val,
        "priority": payload.priority or "medium",
        "time_zone": payload.time_zone or "Asia/Kolkata",
        "original_call_id": payload.call_id or None,
        "related_call_id": payload.call_id or None,
        "timeline": initial_timeline,
        "attempts": [],
        "call_attempts_count": 0,
        "is_locked": False,
        "lock_timestamp": None,
        "created_by": str(current_user.get("_id") or current_user.get("id")),
        "created_at": now,
        "updated_at": now
    }

    res = await follow_ups_col.insert_one(doc)
    doc["_id"] = res.inserted_id
    fu_id = str(res.inserted_id)

    # If linked to a lead, update lead status to follow_up_required
    if cust_id:
        lead_oid = _safe_oid(cust_id)
        if lead_oid:
            try:
                await leads_col.update_one(
                    {"_id": lead_oid},
                    {"$set": {
                        "status": "follow_up_required",
                        "follow_up_date": fu_dt.strftime("%Y-%m-%d %H:%M"),
                        "follow_up_id": fu_id
                    }}
                )
            except Exception:
                pass

    serialized = serialize_follow_up(doc)

    # Broadcast real-time event
    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_CREATED",
        "type": "follow_up_created",
        "follow_up": serialized,
        "id": fu_id,
        "customer_name": cust_name,
        "agent_id": agent_id,
        "status": status_val,
        "timestamp": now.isoformat()
    })

    return serialized


@router.get("", include_in_schema=True)
@router.get("/", include_in_schema=False)
async def list_follow_ups(
    status_filter: Optional[str] = Query(None, alias="status"),
    agent_id: Optional[str] = Query(None),
    pool_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(150, ge=1, le=500),
    current_user: dict = Depends(get_current_user)
):
    """
    List follow-up reminders with support for BPO Dashboard tabs:
    - upcoming (status == scheduled & future)
    - due (status == due)
    - waiting (status == waiting_for_agent)
    - auto_calling (status == auto_calling)
    - completed (status == completed)
    - missed (status == missed)
    - all
    """
    # Trigger an on-the-fly evaluation to guarantee freshest due/missed states
    try:
        await evaluate_follow_ups()
    except Exception:
        pass

    now = utcnow()
    user_role = str(current_user.get("role", "agent")).lower()
    user_id = str(current_user.get("_id") or current_user.get("id"))

    query: Dict[str, Any] = {}

    # Status tab filtering
    if status_filter:
        s_clean = status_filter.lower().strip()
        if s_clean == "upcoming":
            query["status"] = "scheduled"
            query["follow_up_datetime"] = {"$gt": now}
        elif s_clean in ["due", "due_now"]:
            query["status"] = {"$in": ["due", "waiting_for_agent", "auto_calling"]}
        elif s_clean == "waiting":
            query["status"] = "waiting_for_agent"
        elif s_clean == "completed":
            query["status"] = "completed"
        elif s_clean == "missed":
            query["status"] = "missed"
        elif s_clean != "all":
            query["status"] = s_clean

    # Role-based agent scope (agents view own or assigned, TL/Admin can view all)
    if agent_id:
        query["$or"] = [
            {"agent_id": agent_id},
            {"current_agent_id": agent_id},
            {"assigned_agent_id": agent_id},
            {"original_agent_id": agent_id}
        ]
    elif user_role in ("agent", "agent_user") and not pool_id and not search:
        # Default agent to their own follow-ups if no specific search
        query["$or"] = [
            {"agent_id": user_id},
            {"current_agent_id": user_id},
            {"assigned_agent_id": user_id},
            {"original_agent_id": user_id}
        ]

    if pool_id and pool_id != "all":
        query["pool_id"] = pool_id

    # Search by customer name, phone, or customer/lead ID
    if search:
        s_term = search.strip()
        raw_digits = "".join(filter(str.isdigit, s_term))
        query["$or"] = [
            {"customer_name": {"$regex": s_term, "$options": "i"}},
            {"reason": {"$regex": s_term, "$options": "i"}},
            {"customer_id": {"$regex": s_term, "$options": "i"}},
            {"customer_phone": {"$regex": s_term, "$options": "i"}},
            {"agent_name": {"$regex": s_term, "$options": "i"}},
            {"current_agent_name": {"$regex": s_term, "$options": "i"}},
            {"original_agent_name": {"$regex": s_term, "$options": "i"}},
        ]
        if raw_digits:
            query["$or"].append({"customer_phone": {"$regex": raw_digits}})

    total_count = await follow_ups_col.count_documents(query)
    cursor = follow_ups_col.find(query).sort("follow_up_datetime", 1).limit(limit)
    docs = await cursor.to_list(length=limit)
    serialized_docs = [serialize_follow_up(d) for d in docs]

    return {
        "success": True,
        "data": serialized_docs,
        "total": total_count
    }


@router.get("/stats", include_in_schema=True)
@router.get("/stats/", include_in_schema=False)
async def get_follow_up_stats(
    agent_id: Optional[str] = Query(None),
    pool_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Returns BPO Follow-Up KPI statistics for dashboard metric cards:
    - upcoming (Scheduled for future)
    - due (Due right now / auto_calling / waiting)
    - completed (Successfully linked/completed)
    - missed (Overdue / missed window)
    """
    now = utcnow()
    user_role = str(current_user.get("role", "agent")).lower()
    user_id = str(current_user.get("_id") or current_user.get("id"))

    base_query: Dict[str, Any] = {}
    if agent_id:
        base_query["$or"] = [{"agent_id": agent_id}, {"current_agent_id": agent_id}, {"assigned_agent_id": agent_id}]
    elif user_role in ("agent", "agent_user"):
        base_query["$or"] = [{"agent_id": user_id}, {"current_agent_id": user_id}, {"assigned_agent_id": user_id}]

    if pool_id and pool_id != "all":
        base_query["pool_id"] = pool_id

    upcoming_count = await follow_ups_col.count_documents({
        **base_query,
        "status": "scheduled",
        "follow_up_datetime": {"$gt": now}
    })
    due_count = await follow_ups_col.count_documents({
        **base_query,
        "status": {"$in": ["due", "waiting_for_agent", "auto_calling"]}
    })
    completed_count = await follow_ups_col.count_documents({
        **base_query,
        "status": "completed"
    })
    missed_count = await follow_ups_col.count_documents({
        **base_query,
        "status": "missed"
    })

    total_kpi = upcoming_count + due_count + completed_count + missed_count

    return {
        "success": True,
        "stats": {
            "total": total_kpi,
            "upcoming": upcoming_count,
            "due": due_count,
            "due_now": due_count,
            "completed": completed_count,
            "missed": missed_count
        },
        "total": total_kpi,
        "upcoming": upcoming_count,
        "due": due_count,
        "due_now": due_count,
        "completed": completed_count,
        "missed": missed_count
    }


@router.get("/{id}")
async def get_follow_up_details(id: str, current_user: dict = Depends(get_current_user)):
    """Fetch single follow-up details, including full timeline and linked call info."""
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    serialized = serialize_follow_up(doc)

    # Attach related call object if present
    if doc.get("related_call_id"):
        call_oid = _safe_oid(doc["related_call_id"])
        call_doc = await calls_col.find_one({"$or": [{"_id": call_oid}, {"call_sid": doc["related_call_id"]}]})
        if call_doc:
            serialized["related_call"] = {
                "id": str(call_doc["_id"]),
                "duration_seconds": call_doc.get("duration_seconds", 0),
                "outcome": call_doc.get("outcome") or call_doc.get("disposition") or "completed",
                "notes": call_doc.get("notes") or "",
                "started_at": str(call_doc.get("started_at") or ""),
                "recording_url": call_doc.get("recording_url")
            }

    return serialized


@router.post("/{id}/trigger-call")
async def trigger_follow_up_auto_call(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Manually triggers an instant auto-call for a follow-up from the dashboard:
    1. Checks if current agent is available (or searches pool).
    2. Immediately initiates outbound call record & sends WebSocket dispatch.
    """
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    uid = str(current_user.get("_id") or current_user.get("id"))
    user_doc = await users_col.find_one({"$or": [{"_id": _safe_oid(uid)}, {"id": uid}]})
    if not user_doc:
        user_doc = current_user

    # Initiate callback
    call_doc = await initiate_auto_callback_for_agent(
        fu_doc=doc,
        agent_user=user_doc,
        trigger_reason="Manual Dashboard Trigger"
    )

    updated_doc = await follow_ups_col.find_one({"_id": doc["_id"]})
    return {
        "success": True,
        "message": f"Auto-callback initiated for {doc.get('customer_name')}",
        "call_id": str(call_doc["_id"]) if call_doc else None,
        "follow_up": serialize_follow_up(updated_doc)
    }


@router.post("/{id}/reassign")
async def reassign_follow_up(
    id: str,
    payload: ReassignPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    Reassigns follow-up to a different agent and/or pool, recording the timeline audit.
    """
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    now = utcnow()
    actor_name = current_user.get("name") or "Supervisor"
    actor_role = current_user.get("role", "Supervisor").title()

    updates: Dict[str, Any] = {"updated_at": now}
    reassign_desc = []

    if payload.agent_id:
        ag_oid = _safe_oid(payload.agent_id)
        ag = await users_col.find_one({"$or": [{"_id": ag_oid}, {"id": payload.agent_id}]})
        if ag:
            updates["current_agent_id"] = str(ag["_id"])
            updates["current_agent_name"] = ag.get("name", "Agent")
            updates["agent_id"] = str(ag["_id"])
            updates["agent_name"] = ag.get("name", "Agent")
            updates["agent_employee_id"] = ag.get("employee_id", "")
            reassign_desc.append(f"Agent changed from {doc.get('current_agent_name', 'None')} to {ag.get('name')}")

    if payload.pool_id:
        p_oid = _safe_oid(payload.pool_id)
        pl = await pools_col.find_one({"$or": [{"_id": p_oid}, {"id": payload.pool_id}]})
        if pl:
            updates["pool_id"] = str(pl["_id"])
            updates["pool_name"] = pl.get("name", "Customer Support")
            reassign_desc.append(f"Pool changed to {pl.get('name')}")

    timeline_item = {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "FOLLOW_UP_REASSIGNED",
        "description": f"Manual Reassignment by {actor_name}: {'; '.join(reassign_desc)}." + (f" Note: {payload.notes}" if payload.notes else ""),
        "actor": actor_name,
        "actor_role": actor_role,
        "metadata": {
            "reassigned_by": str(current_user.get("_id") or current_user.get("id")),
            "new_agent_id": updates.get("agent_id"),
            "new_pool_id": updates.get("pool_id"),
            "notes": payload.notes or ""
        }
    }

    await follow_ups_col.update_one(
        {"_id": doc["_id"]},
        {
            "$set": updates,
            "$push": {"timeline": {"$each": [timeline_item], "$position": 0}}
        }
    )

    updated_doc = await follow_ups_col.find_one({"_id": doc["_id"]})
    serialized = serialize_follow_up(updated_doc)

    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_REASSIGNED",
        "type": "follow_up_reassigned",
        "follow_up": serialized,
        "id": str(doc["_id"]),
        "customer_name": doc.get("customer_name"),
        "reassigned_agent_name": updates.get("agent_name"),
        "timestamp": now.isoformat()
    })

    return serialized


@router.patch("/{id}")
async def update_follow_up(
    id: str,
    payload: FollowUpUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update or Reschedule a follow-up.
    If rescheduled to a new future time, status automatically returns to 'scheduled'.
    """
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    now = utcnow()
    actor_name = current_user.get("name") or "Agent"
    actor_role = current_user.get("role", "Agent").title()

    updates: Dict[str, Any] = {"updated_at": now}
    timeline_desc = []

    if payload.follow_up_datetime:
        new_dt = parse_datetime_to_utc(payload.follow_up_datetime)
        updates["follow_up_datetime"] = new_dt
        updates["scheduled_at"] = new_dt
        if new_dt > now:
            updates["status"] = "scheduled"
        else:
            updates["status"] = "due"
        timeline_desc.append(f"Rescheduled to {new_dt.strftime('%d %b %Y, %I:%M %p IST')}")

    if payload.reason:
        updates["reason"] = payload.reason
    if payload.notes is not None:
        updates["notes"] = payload.notes
    if payload.status:
        updates["status"] = payload.status
    if payload.priority:
        updates["priority"] = payload.priority

    if payload.reschedule_reason:
        updates["reschedule_reason"] = payload.reschedule_reason
        timeline_desc.append(f"Reason: {payload.reschedule_reason}")

    timeline_item = {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "FOLLOW_UP_UPDATED",
        "description": f"Follow-up updated by {actor_name}: {'; '.join(timeline_desc) if timeline_desc else 'Details updated'}",
        "actor": actor_name,
        "actor_role": actor_role,
        "metadata": {
            "rescheduled_to": updates.get("follow_up_datetime").isoformat() if updates.get("follow_up_datetime") else None,
            "reschedule_reason": payload.reschedule_reason or ""
        }
    }

    await follow_ups_col.update_one(
        {"_id": doc["_id"]},
        {
            "$set": updates,
            "$push": {"timeline": {"$each": [timeline_item], "$position": 0}}
        }
    )
    updated_doc = await follow_ups_col.find_one({"_id": doc["_id"]})
    serialized = serialize_follow_up(updated_doc)

    # Broadcast real-time update
    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_UPDATED",
        "type": "follow_up_updated",
        "follow_up": serialized,
        "id": str(doc["_id"]),
        "status": serialized.get("status"),
        "timestamp": now.isoformat()
    })

    return serialized


@router.post("/{id}/complete")
async def mark_follow_up_completed(
    id: str,
    payload: FollowUpComplete = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Explicitly marks a follow-up task as COMPLETED, recording outcome and audit timeline.
    """
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    now = utcnow()
    actor_name = current_user.get("name") or "Agent"
    actor_role = current_user.get("role", "Agent").title()

    outcome_str = payload.outcome or payload.disposition or "completed"
    notes_str = payload.notes or doc.get("notes", "")

    completed_timeline = {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "FOLLOW_UP_COMPLETED",
        "description": f"Follow-up completed by {actor_name} (Outcome: {outcome_str.upper()})" + (f" Notes: {notes_str}" if notes_str else ""),
        "actor": actor_name,
        "actor_role": actor_role,
        "metadata": {
            "outcome": outcome_str,
            "call_id": payload.call_id or doc.get("related_call_id"),
            "notes": notes_str
        }
    }

    update_fields = {
        "status": "completed",
        "completed_at": now,
        "related_call_id": payload.call_id or doc.get("related_call_id"),
        "completion_outcome": outcome_str,
        "completion_notes": notes_str,
        "updated_at": now
    }

    await follow_ups_col.update_one(
        {"_id": doc["_id"]},
        {
            "$set": update_fields,
            "$push": {"timeline": {"$each": [completed_timeline], "$position": 0}}
        }
    )
    updated_doc = await follow_ups_col.find_one({"_id": doc["_id"]})
    serialized = serialize_follow_up(updated_doc)

    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_COMPLETED",
        "type": "follow_up_completed",
        "follow_up": serialized,
        "id": str(doc["_id"]),
        "status": "completed",
        "timestamp": now.isoformat()
    })

    return serialized


@router.delete("/{id}", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, "admin", "team_leader"))])
async def delete_follow_up(
    id: str,
    current_user: dict = Depends(get_current_user)
):
    """Deletes a follow-up reminder."""
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if (oid or id) else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    await follow_ups_col.delete_one({"_id": doc["_id"]})
    await audit_logs_col.insert_one({
        "action": "delete_follow_up",
        "follow_up_id": str(doc["_id"]),
        "user_id": str(current_user.get("_id") or current_user.get("id")),
        "timestamp": utcnow()
    })

    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_DELETED",
        "type": "follow_up_deleted",
        "id": str(doc["_id"]),
        "timestamp": utcnow().isoformat()
    })

    return {"success": True, "message": "Follow-Up deleted successfully", "id": str(doc["_id"])}
