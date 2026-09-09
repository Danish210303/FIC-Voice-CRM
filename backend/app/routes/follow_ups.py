import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Body, status, Request
from fastapi.responses import JSONResponse

from app.core.database import follow_ups_col, leads_col, users_col, calls_col, pools_col, audit_logs_col
from app.core.utils import utcnow, oid_str, normalize_phone
from app.core.deps import require_roles, get_current_user
from app.schemas.common import FollowUpCreate, FollowUpUpdate, FollowUpComplete, Role
from app.services.ws_manager import ws_manager
from app.services.follow_up_service import parse_datetime_to_utc, evaluate_follow_ups

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/follow-ups", tags=["follow-ups"])


def _safe_oid(oid_val: str | None) -> ObjectId | None:
    if oid_val and isinstance(oid_val, str) and ObjectId.is_valid(oid_val):
        return ObjectId(oid_val)
    return None


def serialize_follow_up(fu: Dict[str, Any]) -> Dict[str, Any]:
    """Helper to convert MongoDB follow_up document into a clean JSON response."""
    fu_id = str(fu["_id"]) if "_id" in fu else str(fu.get("id", ""))
    
    # Format ISO strings safely
    fu_dt = fu.get("follow_up_datetime")
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

    return {
        "id": fu_id,
        "_id": fu_id,
        "customer_id": str(fu.get("customer_id") or fu.get("lead_id") or ""),
        "lead_id": str(fu.get("lead_id") or fu.get("customer_id") or ""),
        "customer_name": fu.get("customer_name") or "Customer",
        "customer_phone": fu.get("customer_phone") or "",
        "agent_id": str(fu.get("agent_id") or ""),
        "agent_name": fu.get("agent_name") or "Assigned Agent",
        "agent_employee_id": fu.get("agent_employee_id") or "",
        "pool_id": str(fu.get("pool_id") or ""),
        "pool_name": fu.get("pool_name") or "Customer Support",
        "follow_up_datetime": fu_dt_iso,
        "reason": fu.get("reason") or "Follow-Up Call",
        "notes": fu.get("notes") or "",
        "status": fu.get("status") or "scheduled",
        "priority": fu.get("priority") or "medium",
        "time_zone": fu.get("time_zone") or "Asia/Kolkata",
        "related_call_id": str(fu.get("related_call_id") or ""),
        "completion_outcome": fu.get("completion_outcome") or "",
        "completion_notes": fu.get("completion_notes") or "",
        "created_at": created_at_iso,
        "completed_at": completed_at_iso if completed_at else None,
        "missed_at": fu.get("missed_at").isoformat() if isinstance(fu.get("missed_at"), datetime) else None,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_follow_up(
    payload: FollowUpCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a scheduled BPO Follow-Up Task for a customer and agent.
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
        agent_user = await users_col.find_one({"$or": [{"_id": agent_oid}, {"id": agent_id}]}) if agent_oid or agent_id else None
        if agent_user:
            agent_name = agent_user.get("name") or agent_user.get("email", "").split("@")[0]
            agent_emp_id = agent_user.get("employee_id", "")

    # Resolve Lead / Customer details
    cust_name = payload.customer_name or "Customer"
    cust_phone = normalize_phone(payload.customer_phone)
    cust_id = payload.customer_id or payload.lead_id
    pool_id = payload.pool_id or (agent_user.get("pool_id") if agent_user else None) or "general"
    pool_name = "General Pool"

    if cust_id:
        lead_oid = _safe_oid(cust_id)
        lead = await leads_col.find_one({"$or": [{"_id": lead_oid}, {"lead_id": cust_id}]}) if lead_oid or cust_id else None
        if lead:
            cust_name = lead.get("name") or cust_name
            cust_phone = normalize_phone(lead.get("phone") or cust_phone)
            if not pool_id or pool_id == "general":
                pool_id = str(lead.get("pool_id") or pool_id)

    if pool_id and pool_id != "general":
        pool_oid = _safe_oid(pool_id)
        pool = await pools_col.find_one({"$or": [{"_id": pool_oid}, {"id": pool_id}]}) if pool_oid or pool_id else None
        if pool:
            pool_name = pool.get("name") or pool_name

    doc = {
        "customer_id": cust_id or str(now.timestamp()),
        "lead_id": cust_id,
        "customer_name": cust_name,
        "customer_phone": cust_phone,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_employee_id": agent_emp_id,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "follow_up_datetime": fu_dt,
        "reason": payload.reason or "Follow-Up Call",
        "notes": payload.notes or "",
        "status": status_val,
        "priority": payload.priority or "medium",
        "time_zone": payload.time_zone or "Asia/Kolkata",
        "related_call_id": payload.call_id or None,
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
    user_role = current_user.get("role", "agent")
    user_id = str(current_user.get("_id") or current_user.get("id"))

    query: Dict[str, Any] = {}

    # Status tab filtering
    if status_filter:
        s_clean = status_filter.lower().strip()
        if s_clean == "upcoming":
            query["status"] = "scheduled"
            query["follow_up_datetime"] = {"$gt": now}
        elif s_clean in ["due", "due_now"]:
            query["status"] = "due"
        elif s_clean == "completed":
            query["status"] = "completed"
        elif s_clean == "missed":
            query["status"] = "missed"
        elif s_clean != "all":
            query["status"] = s_clean

    # Role-based agent scope (agents view own or assigned, TL/Admin can view all)
    if agent_id:
        query["agent_id"] = agent_id
    elif user_role == "agent" and not pool_id and not search:
        # Default agent to their own follow-ups if no specific search
        query["agent_id"] = user_id

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
    - due (Due right now)
    - completed (Successfully linked/completed)
    - missed (Overdue / missed window)
    """
    now = utcnow()
    user_role = current_user.get("role", "agent")
    user_id = str(current_user.get("_id") or current_user.get("id"))

    base_query: Dict[str, Any] = {}
    if agent_id:
        base_query["agent_id"] = agent_id
    elif user_role == "agent":
        base_query["agent_id"] = user_id

    if pool_id and pool_id != "all":
        base_query["pool_id"] = pool_id

    upcoming_count = await follow_ups_col.count_documents({
        **base_query,
        "status": "scheduled",
        "follow_up_datetime": {"$gt": now}
    })
    due_count = await follow_ups_col.count_documents({
        **base_query,
        "status": "due"
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
            "completed": completed_count,
            "missed": missed_count
        },
        # Also provide direct fields for maximum client compatibility
        "total": total_kpi,
        "upcoming": upcoming_count,
        "due": due_count,
        "due_now": due_count,
        "completed": completed_count,
        "missed": missed_count
    }


@router.get("/{id}")
async def get_follow_up_details(id: str, current_user: dict = Depends(get_current_user)):
    """Fetch single follow-up details, including linked call info if completed."""
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if oid or id else None
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
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if oid or id else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    now = utcnow()
    updates: Dict[str, Any] = {"updated_at": now}

    if payload.follow_up_datetime:
        new_dt = parse_datetime_to_utc(payload.follow_up_datetime)
        updates["follow_up_datetime"] = new_dt
        # When rescheduled into the future, reset status to scheduled
        if new_dt > now:
            updates["status"] = "scheduled"
        else:
            updates["status"] = "due"

    if payload.reason:
        updates["reason"] = payload.reason
    if payload.notes is not None:
        updates["notes"] = payload.notes
    if payload.status:
        updates["status"] = payload.status
    if payload.priority:
        updates["priority"] = payload.priority
    if payload.agent_id:
        updates["agent_id"] = payload.agent_id
        agent_oid = _safe_oid(payload.agent_id)
        if agent_oid:
            ag = await users_col.find_one({"_id": agent_oid})
            if ag:
                updates["agent_name"] = ag.get("name", "Agent")
                updates["agent_employee_id"] = ag.get("employee_id", "")
    if payload.pool_id:
        updates["pool_id"] = payload.pool_id
        pool_oid = _safe_oid(payload.pool_id)
        if pool_oid:
            pl = await pools_col.find_one({"_id": pool_oid})
            if pl:
                updates["pool_name"] = pl.get("name", "Customer Support")

    if payload.reschedule_reason:
        updates["reschedule_reason"] = payload.reschedule_reason

    await follow_ups_col.update_one({"_id": doc["_id"]}, {"$set": updates})
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
    Explicitly marks a follow-up task as COMPLETED and links the relevant call session.
    """
    oid = _safe_oid(id)
    doc = await follow_ups_col.find_one({"$or": [{"_id": oid}, {"id": id}]}) if oid or id else None
    if not doc:
        raise HTTPException(status_code=404, detail="Follow-Up record not found")

    now = utcnow()
    update_fields = {
        "status": "completed",
        "completed_at": now,
        "related_call_id": payload.call_id or doc.get("related_call_id"),
        "completion_outcome": payload.outcome or payload.disposition or "completed",
        "completion_notes": payload.notes or doc.get("notes", ""),
        "updated_at": now
    }

    await follow_ups_col.update_one({"_id": doc["_id"]}, {"$set": update_fields})
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
