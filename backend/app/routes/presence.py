import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from bson import ObjectId
from app.core.database import (
    users_col,
    pools_col,
    campaigns_col,
    agent_shifts_col,
    agent_presence_col,
    agent_status_history_col,
    attendance_col,
    calls_col
)
from app.core.utils import utcnow, oid_str
from app.core.deps import get_current_user
from app.services.ws_manager import ws_manager
from app.services.attendance_service import get_local_date_str, get_local_now

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/presence", tags=["presence"])
agent_router = APIRouter(prefix="/api/agent", tags=["agent-presence"])
agents_router = APIRouter(prefix="/api/agents", tags=["agents-status"])


async def get_supervisor_assigned_pool_ids(current_user: dict) -> list[str] | None:
    """
    Resolves the list of requirement pools assigned to a Supervisor (Team Leader).
    Admins get None (unrestricted access to all requirement pools).
    """
    role = (current_user.get("role") or "").lower().strip()
    if role == "admin":
        return None  # All pools permitted

    uid_str = str(current_user.get("id") or current_user.get("_id", ""))

    # Fetch active pools mapping name <-> _id
    pools_cursor = pools_col.find({"is_deleted": {"$ne": True}})
    pool_map = {}
    async for p in pools_cursor:
        pid = str(p["_id"])
        pname = p.get("name")
        if pname:
            pool_map[pname] = pid
            pool_map[pid] = pname

    permitted_set = set()

    # 1. Pools from assigned_pools / assigned_pool_ids on supervisor document
    assigned = current_user.get("assigned_pools") or current_user.get("assigned_pool_ids") or []
    if isinstance(assigned, list):
        for item in assigned:
            item_str = str(item).strip()
            permitted_set.add(item_str)
            if item_str in pool_map:
                permitted_set.add(pool_map[item_str])
    elif isinstance(assigned, str) and assigned.strip():
        item_str = assigned.strip()
        permitted_set.add(item_str)
        if item_str in pool_map:
            permitted_set.add(pool_map[item_str])

    # 2. Pool ID directly on supervisor document
    sup_pool = current_user.get("pool_id")
    if sup_pool:
        sp_str = str(sup_pool).strip()
        permitted_set.add(sp_str)
        if sp_str in pool_map:
            permitted_set.add(pool_map[sp_str])

    # 3. Requirement pools of agents supervised by this user
    sup_query_id = ObjectId(uid_str) if ObjectId.is_valid(uid_str) else uid_str
    agents_cursor = users_col.find(
        {"$or": [{"supervisor_id": uid_str}, {"supervisor_id": sup_query_id}]},
        {"pool_id": 1}
    )
    async for a in agents_cursor:
        apool = a.get("pool_id")
        if apool:
            ap_str = str(apool).strip()
            permitted_set.add(ap_str)
            if ap_str in pool_map:
                permitted_set.add(pool_map[ap_str])

    # 4. Requirement pools of campaigns managed by this supervisor
    campaigns_cursor = campaigns_col.find(
        {"$or": [{"supervisor_id": uid_str}, {"supervisor_id": sup_query_id}]},
        {"pool_id": 1}
    )
    async for c in campaigns_cursor:
        cpool = c.get("pool_id")
        if cpool:
            cp_str = str(cpool).strip()
            permitted_set.add(cp_str)
            if cp_str in pool_map:
                permitted_set.add(pool_map[cp_str])

    return list(permitted_set)


# State machine allowed transition rules
ALLOWED_TRANSITIONS = {
    "offline": ["ready", "offline"],
    "ready": ["ready", "paused", "break", "ringing", "in_call", "offline"],
    "paused": ["paused", "ready", "offline"],
    "break": ["break", "ready", "offline"],
    "ringing": ["ringing", "in_call", "ready", "wrap_up", "offline"],
    "in_call": ["in_call", "wrap_up", "ready", "offline"],
    "wrap_up": ["wrap_up", "ready", "offline"]
}


def normalize_status_input(st: str) -> str:
    s = (st or "").strip().lower()
    if s in ("available", "ready"):
        return "ready"
    if s in ("on_break", "paused", "break"):
        return "paused"
    if s in ("offline", "logged_out"):
        return "offline"
    if s in ("in_call", "busy", "calling", "on_call"):
        return "in_call"
    if s in ("ringing", "ring"):
        return "ringing"
    if s in ("wrap_up", "wrapup", "disposition"):
        return "wrap_up"
    return s


def map_status_to_enum(st: str) -> str:
    s = (st or "").strip().lower()
    if s == "ready":
        return "READY"
    if s in ("paused", "break"):
        return "BREAK"
    if s == "offline":
        return "OFFLINE"
    if s in ("in_call", "busy"):
        return "ON_CALL"
    if s == "ringing":
        return "RINGING"
    if s == "wrap_up":
        return "WRAP_UP"
    return st.upper() if st else "OFFLINE"


def get_break_type_code(reason: Optional[str]) -> str:
    if not reason:
        return "PERSONAL"
    r = reason.strip().upper()
    if "LUNCH" in r:
        return "LUNCH"
    if "TEA" in r or "REFRESHMENT" in r:
        return "TEA"
    if "OTHER" in r:
        return "OTHER"
    return "PERSONAL"


class StatusUpdateRequest(BaseModel):
    status: str = Field(..., description="Target status: AVAILABLE, ON_BREAK, OFFLINE or ready, paused, offline")
    pause_reason: Optional[str] = Field(None, description="Optional pause reason e.g. Lunch, Tea Break, Personal Reason")
    break_type: Optional[str] = Field(None, description="Break type code: LUNCH, TEA, PERSONAL")
    force_offline: Optional[bool] = Field(False, description="Force offline even if 8 hours incomplete")
    forceOffline: Optional[bool] = Field(False, description="Force offline alias")


class PauseRequest(BaseModel):
    reason: Optional[str] = Field(None, description="Break reason e.g. Lunch Break, Tea Break, Personal Reason")
    pause_reason: Optional[str] = Field(None, description="Break reason alias")
    break_type: Optional[str] = Field(None, description="Break type code e.g. LUNCH, TEA, PERSONAL")


class OfflineRequest(BaseModel):
    force_offline: Optional[bool] = Field(True, description="Confirmation flag for going offline")


def normalize_break_key(reason: Optional[str]) -> str:
    if not reason:
        return "personal_reason"
    r = reason.lower().strip()
    if "tea" in r:
        return "tea_break"
    if "lunch" in r:
        return "lunch_break"
    return "personal_reason"



async def record_presence_change(
    user_id: str,
    new_status: str,
    pause_reason: Optional[str] = None,
    source: str = "manual",
    force_offline: bool = False
) -> dict | None:
    """Core function to update user presence using strict state machine and explicit timestamp logic."""
    now = utcnow()
    now_iso = now.isoformat()
    
    new_status = normalize_status_input(new_status)
    valid_statuses = {"ready", "paused", "in_call", "offline", "ringing", "wrap_up"}
    if new_status not in valid_statuses:
        logger.warning(f"[PRESENCE] Invalid status '{new_status}' requested for user {user_id}")
        return None

    query = {"_id": ObjectId(user_id)} if ObjectId.is_valid(user_id) else {"id": user_id}
    user = await users_col.find_one(query)
    if not user:
        return None

    uid_str = str(user["_id"])
    shift_date = get_local_date_str(now)
    user_shift_date = user.get("shift_date")
    
    # 1. Get current states
    current_status = user.get("status", "offline")
    if user_shift_date != shift_date:
        current_status = "offline"

    # Enforce Check-in rules
    today_att = await attendance_col.find_one({"agent_id": uid_str, "date": shift_date})
    has_checked_in = bool(today_att and today_att.get("check_in_time") and today_att.get("status") not in ("NOT_CHECKED_IN", "ABSENT"))

    if new_status in ("ready", "paused", "in_call", "ringing", "wrap_up") and not has_checked_in and source not in ("session_start", "check_in", "attendance_service"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agent has not checked in today.")

    # Prevent identical transitions (Idempotency)
    if current_status == new_status and user_shift_date == shift_date:
        logger.info(f"[PRESENCE DUP] Redundant status update '{new_status}' for user {user_id}")
        pass

    # Validate Transitions
    allowed_next = ALLOWED_TRANSITIONS.get(current_status, ["ready", "paused", "offline"])
    if new_status != current_status and new_status not in allowed_next and user_shift_date == shift_date and not (force_offline and new_status == "offline"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status transition from '{map_status_to_enum(current_status)}' to '{map_status_to_enum(new_status)}'."
        )

    # Calculate Elapsed Time for Current State
    state_started_at = user.get("state_started_at") or user.get("last_status_change") or now_iso
    if user_shift_date != shift_date:
        state_started_at = now_iso
        
    try:
        start_dt = datetime.fromisoformat(state_started_at.replace("Z", "+00:00"))
        elapsed_seconds = max(0, int((now - start_dt).total_seconds()))
    except Exception:
        elapsed_seconds = 0

    # Accumulate durations based on the exiting state ONLY if in same shift date
    inc_updates = {}
    if user_shift_date == shift_date:
        if current_status == "ready":
            inc_updates["total_ready_seconds"] = elapsed_seconds
            inc_updates["ready_seconds"] = elapsed_seconds
            inc_updates["waiting_seconds"] = elapsed_seconds
        elif current_status == "paused":
            inc_updates["total_pause_seconds"] = elapsed_seconds
            inc_updates["total_break_seconds"] = elapsed_seconds
            inc_updates["paused_seconds"] = elapsed_seconds
        elif current_status == "ringing":
            inc_updates["total_ringing_seconds"] = elapsed_seconds
            inc_updates["ringing_seconds"] = elapsed_seconds
        elif current_status in ("in_call", "calling"):
            inc_updates["total_talk_seconds"] = elapsed_seconds
            inc_updates["talk_seconds"] = elapsed_seconds
        elif current_status == "wrap_up":
            inc_updates["total_wrapup_seconds"] = elapsed_seconds
            inc_updates["dispose_seconds"] = elapsed_seconds

    # Handle breaks specifically
    break_logs = list(user.get("break_logs") or []) if user_shift_date == shift_date else []
    current_break = user.get("current_break") if user_shift_date == shift_date else None
    
    if current_status == "paused" and new_status != "paused":
        if current_break:
            current_break["end_time"] = now_iso
            current_break["duration_seconds"] = elapsed_seconds
            break_logs.append(current_break)
            current_break = None

    if new_status == "paused":
        if current_status != "paused":
            current_break = {
                "type": pause_reason or "Personal Reason",
                "start_time": now_iso
            }

    # Ensure login/logout logic
    login_val = user.get("login_at") if user_shift_date == shift_date else None
    logout_val = user.get("logout_at") if user_shift_date == shift_date else None
    
    if new_status in ("ready", "paused", "in_call", "ringing", "wrap_up"):
        if current_status == "offline" or not login_val:
            login_val = now_iso
            logout_val = None
    elif new_status == "offline":
        logout_val = now_iso

    # Assemble update
    set_updates = {
        "status": new_status,
        "state_started_at": now_iso,
        "last_status_change": now_iso,
        "pause_reason": pause_reason if new_status == "paused" else None,
        "login_at": login_val,
        "logout_at": logout_val if new_status == "offline" else None,
        "shift_date": shift_date,
        "current_break": current_break,
        "break_logs": break_logs,
        "updated_at": now_iso
    }

    # If new shift day, reset all daily telemetry counters
    if user_shift_date != shift_date:
        set_updates.update({
            "total_ready_seconds": 0,
            "ready_seconds": 0,
            "waiting_seconds": 0,
            "waiting_started_at": now_iso if new_status == "ready" else None,
            "total_talk_seconds": 0,
            "talk_seconds": 0,
            "total_ringing_seconds": 0,
            "ringing_seconds": 0,
            "total_wrapup_seconds": 0,
            "dispose_seconds": 0,
            "total_pause_seconds": 0,
            "total_break_seconds": 0,
            "paused_seconds": 0,
            "gross_seconds": 0,
            "total_login_seconds": 0,
            "total_calls_handled": 0,
            "currentCallId": None,
            "currentCallType": None,
            "dispositionStartedAt": None,
            "break_stats": {
                "tea_break": {"count": 0, "total_seconds": 0},
                "lunch_break": {"count": 0, "total_seconds": 0},
                "personal_reason": {"count": 0, "total_seconds": 0}
            }
        })
    else:
        if new_status == "ready":
            set_updates["waiting_started_at"] = now_iso
        elif current_status == "ready":
            set_updates["waiting_started_at"] = None
    
    update_doc = {"$set": set_updates, "$inc": {"version": 1}}
    if inc_updates:
        update_doc["$inc"].update(inc_updates)

    await users_col.update_one(query, update_doc)
    
    # Fetch unified telemetry object
    updated_user = await users_col.find_one(query)
    current_version = updated_user.get("version", 1)
    
    # Prepare Session Snapshot Data Payload
    session_id = f"session_{uid_str}_{shift_date}"
    
    total_ready = updated_user.get("total_ready_seconds", 0)
    total_pause = updated_user.get("total_pause_seconds", 0) or updated_user.get("total_break_seconds", 0)
    total_ringing = updated_user.get("total_ringing_seconds", 0) or updated_user.get("ringing_seconds", 0)
    total_talk = updated_user.get("total_talk_seconds", 0) or updated_user.get("talk_seconds", 0)
    total_wrapup = updated_user.get("total_wrapup_seconds", 0) or updated_user.get("dispose_seconds", 0)
    
    login_dt = datetime.fromisoformat(login_val.replace("Z", "+00:00")) if login_val else now
    gross_seconds = max(0, int((now - login_dt).total_seconds())) if login_val else 0

    data_payload = {
        "sessionId": session_id,
        "agentId": uid_str,
        "user_id": uid_str,
        "id": uid_str,
        "currentState": new_status,
        "status": map_status_to_enum(new_status),
        "raw_status": new_status,
        "stateStartedAt": now_iso,
        "last_status_change": now_iso,
        "pause_reason": pause_reason if new_status == "paused" else None,
        "breakType": get_break_type_code(pause_reason) if new_status == "paused" else None,
        "break_type": get_break_type_code(pause_reason) if new_status == "paused" else None,
        "currentBreak": current_break,
        "current_break": current_break,
        "login_at": login_val,
        "logout_at": logout_val,
        "shift_date": shift_date,
        "serverTime": now_iso,
        "version": current_version,
        "ready_seconds": total_ready,
        "total_ready_seconds": total_ready,
        "paused_seconds": total_pause,
        "total_pause_seconds": total_pause,
        "total_break_seconds": total_pause,
        "talk_seconds": total_talk,
        "total_talk_seconds": total_talk,
        "ringing_seconds": total_ringing,
        "total_ringing_seconds": total_ringing,
        "dispose_seconds": total_wrapup,
        "total_wrapup_seconds": total_wrapup,
        "waiting_seconds": updated_user.get("waiting_seconds", 0),
        "waiting_started_at": updated_user.get("waiting_started_at"),
        "total_calls_handled": updated_user.get("total_calls_handled", 0),
        "gross_seconds": gross_seconds,
        "total_login_seconds": gross_seconds,
        "telemetry": {
            "readySeconds": total_ready,
            "pauseSeconds": total_pause,
            "ringingSeconds": total_ringing,
            "talkSeconds": total_talk,
            "wrapUpSeconds": total_wrapup,
            "sessionSeconds": gross_seconds,
            "breaksTaken": len(break_logs) + (1 if new_status == "paused" else 0),
            "callsHandled": updated_user.get("total_calls_handled", 0)
        }
    }

    # Broadcast WebSocket
    presence_payload = {
        "event": "session.state_changed",
        "type": "agent_presence_updated", # Legacy compatibility
        "agentId": uid_str,
        "user_id": uid_str,
        "sessionId": session_id,
        "status": new_status,
        "timestamp": now_iso,
        "version": current_version,
        "data": data_payload
    }
    
    # Save to agent_presence_col for recovery
    await agent_presence_col.update_one({"agent_id": uid_str}, {"$set": {
        **data_payload,
        "updated_at": now_iso
    }}, upsert=True)

    # Save transition history
    history_doc = {
        "agent_id": uid_str,
        "previous_status": current_status,
        "new_status": new_status,
        "break_reason": pause_reason if new_status == "paused" else None,
        "started_at": state_started_at,
        "ended_at": now_iso,
        "duration_seconds": elapsed_seconds,
        "session_id": session_id,
        "version": current_version,
        "created_at": now_iso
    }
    await agent_status_history_col.insert_one(history_doc)

    try:
        await ws_manager.broadcast_global(presence_payload)
    except Exception as e:
        logger.warning(f"[PRESENCE WS ERROR] Broadcast failed: {e}")

    return data_payload


async def record_call_completion(
    user_id: str,
    duration_seconds: int = 0,
    dispose_seconds: int = 0,
    call_id: Optional[str] = None,
    outcome: str = "completed",
    call_duration: Optional[int] = None
) -> dict | None:
    """Idempotently records completed call, increments total_calls_handled, talk_seconds, and dispose_seconds in MongoDB, and emits WebSocket broadcast."""
    now = utcnow()
    now_iso = now.isoformat()
    shift_date = get_local_date_str(now)

    if call_duration is not None and duration_seconds == 0:
        duration_seconds = call_duration

    uid_str = str(user_id)
    query = {"_id": ObjectId(uid_str)} if ObjectId.is_valid(uid_str) else {"id": uid_str}

    # Increment total_calls_handled, talk_seconds, and dispose_seconds in users collection
    await users_col.update_one(
        query,
        {
            "$inc": {
                "total_calls_handled": 1,
                "talk_seconds": duration_seconds,
                "dispose_seconds": dispose_seconds
            },
            "$set": {"updated_at": now_iso}
        }
    )

    # Increment total_calls_handled, talk_seconds, and dispose_seconds in agent_shifts collection
    await agent_shifts_col.update_one(
        {"user_id": uid_str, "shift_date": shift_date},
        {
            "$inc": {
                "total_calls_handled": 1,
                "talk_seconds": duration_seconds,
                "dispose_seconds": dispose_seconds
            },
            "$set": {"updated_at": now_iso}
        }
    )

    # Fetch updated user doc
    updated_user = await users_col.find_one(query)
    if not updated_user:
        return None

    new_total_calls = updated_user.get("total_calls_handled", 1)

    # Broadcast WSS payload to all dashboards globally
    payload = {
        "type": "call_completed",
        "data": {
            "user_id": uid_str,
            "agent_id": uid_str,
            "call_id": call_id or "session_completed",
            "duration_seconds": duration_seconds,
            "dispose_seconds": dispose_seconds,
            "outcome": outcome,
            "total_calls_handled": new_total_calls,
            "talk_seconds": updated_user.get("talk_seconds", 0),
            "dispose_seconds": updated_user.get("dispose_seconds", 0),
            "timestamp": now_iso
        }
    }

    try:
        await ws_manager.broadcast_global(payload)
        logger.info(f"[CALL COMPLETED WS BROADCAST] Agent {uid_str} → Total Calls: {new_total_calls}, Dispose Sec: {updated_user.get('dispose_seconds', 0)}")
    except Exception as e:
        logger.warning(f"[CALL COMPLETED WS ERROR] Broadcast failed: {e}")

    return payload["data"]


@router.post("/status")
@router.post("/status-update")
@router.post("/update")
async def update_status(payload: StatusUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update current agent status (Ready, Paused, Offline) and broadcast to all dashboards."""
    uid = str(current_user["_id"])
    target_status = payload.status.lower().strip()
    force_flag = bool(payload.force_offline or payload.forceOffline)
    result = await record_presence_change(
        user_id=uid,
        new_status=target_status,
        pause_reason=payload.pause_reason,
        source="user_action",
        force_offline=force_flag
    )
    if not result:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Failed to update presence status")
    return {"status": "success", "presence": result}


@router.get("/agents")
async def get_agents_presence(current_user: dict = Depends(get_current_user)):
    """Fetch live presence details for agents based on role-based requirement pool access control."""
    role = (current_user.get("role") or "").lower().strip()
    uid_str = str(current_user.get("id") or current_user.get("_id", ""))

    query = {}
    if role == "agent":
        query["_id"] = current_user["_id"] if ObjectId.is_valid(uid_str) else uid_str
    elif role == "team_leader":
        permitted_pools = await get_supervisor_assigned_pool_ids(current_user)
        if permitted_pools is not None:
            query["$or"] = [
                {"pool_id": {"$in": permitted_pools}},
                {"supervisor_id": uid_str},
                {"_id": current_user["_id"]}
            ]

    cursor = users_col.find(query, {"password": 0})

    # Fetch pool documents for name resolution
    pools_cursor = pools_col.find({"is_deleted": {"$ne": True}})
    pools_map = {}
    async for p in pools_cursor:
        pid = str(p["_id"])
        pname = p.get("name", "General")
        # Format pool name e.g. credit_card_sales -> Credit Card Sales
        formatted_name = " ".join([word.capitalize() for word in pname.replace("_", " ").split()])
        pools_map[pid] = formatted_name
        pools_map[pname] = formatted_name

    # Fetch supervisor names
    supervisors_cursor = users_col.find({"role": {"$in": ["team_leader", "admin"]}}, {"name": 1})
    supervisors_map = {}
    async for sup in supervisors_cursor:
        supervisors_map[str(sup["_id"])] = sup.get("name", "Supervisor")

    agents = []
    now = utcnow()
    now_iso = now.isoformat()
    today_str = get_local_date_str(now)

    async for u in cursor:
        uid = str(u["_id"])
        is_today = (u.get("shift_date") == today_str)

        st = u.get("status", "offline") if is_today else "offline"
        login_val = u.get("login_at") if is_today else None
        logout_val = u.get("logout_at") if is_today else None
        current_break = u.get("current_break") if is_today else None
        break_logs = list(u.get("break_logs") or []) if is_today else []

        completed_break_sec = sum(int(b.get("duration_seconds", 0)) for b in break_logs)
        active_break_sec = 0
        if st == "paused" and current_break and current_break.get("start_time"):
            try:
                cb_start = datetime.fromisoformat(current_break["start_time"].replace("Z", "+00:00"))
                active_break_sec = max(0, int((now - cb_start).total_seconds()))
            except Exception:
                pass
        tot_break_sec = completed_break_sec + active_break_sec

        gross_sec = 0
        if login_val:
            try:
                l_dt = datetime.fromisoformat(login_val.replace("Z", "+00:00"))
                ref_end = datetime.fromisoformat(logout_val.replace("Z", "+00:00")) if logout_val and st == "offline" else now
                gross_sec = max(0, int((ref_end - l_dt).total_seconds()))
            except Exception:
                pass

        waiting_sec = u.get("waiting_seconds", 0) if is_today else 0
        w_started = u.get("waiting_started_at") if is_today else None
        act_waiting_sec = 0
        if st == "ready" and w_started:
            try:
                w_dt = datetime.fromisoformat(w_started.replace("Z", "+00:00"))
                act_waiting_sec = max(0, int((now - w_dt).total_seconds()))
            except Exception:
                pass
        tot_waiting_sec = waiting_sec + act_waiting_sec
        ready_sec = max(0, gross_sec - tot_break_sec)

        raw_stats = u.get("break_stats") or {}
        break_stats = {
            "tea_break": {"count": raw_stats.get("tea_break", {}).get("count", 0), "total_seconds": raw_stats.get("tea_break", {}).get("total_seconds", 0)},
            "lunch_break": {"count": raw_stats.get("lunch_break", {}).get("count", 0), "total_seconds": raw_stats.get("lunch_break", {}).get("total_seconds", 0)},
            "personal_reason": {"count": raw_stats.get("personal_reason", {}).get("count", 0), "total_seconds": raw_stats.get("personal_reason", {}).get("total_seconds", 0)},
        } if is_today else {
            "tea_break": {"count": 0, "total_seconds": 0},
            "lunch_break": {"count": 0, "total_seconds": 0},
            "personal_reason": {"count": 0, "total_seconds": 0},
        }

        pid_raw = u.get("pool_id") or "unassigned"
        pool_name_display = pools_map.get(str(pid_raw), pools_map.get(pid_raw, "General Pool"))

        sup_id_raw = u.get("supervisor_id")
        sup_name_display = supervisors_map.get(str(sup_id_raw), "N/A") if sup_id_raw else "N/A"

        status_since_val = u.get("last_status_change") if is_today else login_val or now_iso

        agents.append({
            # Standardized Central Realtime Pool State Fields
            "agentId": uid,
            "agentName": u.get("name", "Unknown Agent"),
            "requirementPoolId": str(pid_raw),
            "requirementPoolName": pool_name_display,
            "supervisorId": str(sup_id_raw) if sup_id_raw else None,
            "supervisorName": sup_name_display,
            "status": st,
            "statusSince": status_since_val,
            "currentCallId": u.get("currentCallId") if is_today else None,
            "currentCallType": u.get("currentCallType") if is_today else None,
            "loginAt": login_val,
            "lastUpdatedAt": now_iso,

            # Legacy compatibility fields
            "id": uid,
            "user_id": uid,
            "name": u.get("name", "Unknown Agent"),
            "email": u.get("email"),
            "role": u.get("role", "agent"),
            "employee_id": u.get("employee_id"),
            "pool_id": str(pid_raw),
            "pause_reason": u.get("pause_reason") if is_today else None,
            "login_at": login_val,
            "logout_at": logout_val,
            "current_break": current_break,
            "break_logs": break_logs,
            "total_break_seconds": tot_break_sec,
            "working_seconds": ready_sec,
            "gross_seconds": gross_sec,
            "total_login_seconds": gross_sec,
            "total_ready_seconds": ready_sec,
            "total_pause_seconds": tot_break_sec,
            "ready_seconds": ready_sec,
            "paused_seconds": tot_break_sec,
            "talk_seconds": u.get("talk_seconds", 0) if is_today else 0,
            "dispose_seconds": u.get("dispose_seconds", 0) if is_today else 0,
            "waiting_seconds": waiting_sec,
            "active_waiting_seconds": act_waiting_sec,
            "total_waiting_seconds": tot_waiting_sec,
            "waiting_started_at": w_started,
            "total_calls_handled": u.get("total_calls_handled", 0) if is_today else 0,
            "break_stats": break_stats,
            "shift_target_reached": gross_sec >= 28800,
            "completed_8_hours": gross_sec >= 28800,
            "remaining_seconds": max(0, 28800 - gross_sec),
            "last_status_change": status_since_val,
            "last_activity": status_since_val or u.get("updated_at") or u.get("created_at"),
            "is_active": u.get("is_active", True)
        })

    return agents


@router.get("/summary")
async def get_presence_summary(current_user: dict = Depends(get_current_user)):
    """Fetch aggregate presence counts for top dashboard summary cards, strictly authorized for the user's role/pools."""
    agents_list = await get_agents_presence(current_user=current_user)

    total_agents = len(agents_list)
    ready_count = sum(1 for a in agents_list if a.get("status") in ("ready", "available"))
    paused_count = sum(1 for a in agents_list if a.get("status") in ("paused", "break", "on_break"))
    ringing_count = sum(1 for a in agents_list if a.get("status") == "ringing")
    in_call_count = sum(1 for a in agents_list if a.get("status") in ("in_call", "talking", "on_call", "busy"))
    wrap_up_count = sum(1 for a in agents_list if a.get("status") in ("wrap_up", "wrapup"))
    offline_count = sum(1 for a in agents_list if a.get("status") in ("offline", None) or not a.get("status"))
    online_count = ready_count + paused_count + ringing_count + in_call_count + wrap_up_count

    return {
        "total_agents": total_agents,
        "online_count": online_count,
        "ready_count": ready_count,
        "paused_count": paused_count,
        "ringing_count": ringing_count,
        "in_call_count": in_call_count,
        "wrap_up_count": wrap_up_count,
        "offline_count": offline_count,
    }



@router.get("/shifts")
async def get_shift_history(current_user: dict = Depends(get_current_user)):
    """Fetch shift history logs for reporting."""
    uid = str(current_user["_id"])
    role = current_user.get("role")

    query = {}
    if role == "agent":
        query["user_id"] = uid

    shifts = []
    cursor = agent_shifts_col.find(query).sort("created_at", -1).limit(50)
    async for doc in cursor:
        shifts.append(oid_str(doc))
    return shifts


@router.get("/shift-summary")
async def get_current_shift_summary(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Fetch live or completed shift telemetry summary for current user for today or a specific date."""
    uid_str = str(current_user["_id"])
    now = utcnow()
    today_str = get_local_date_str(now)
    shift_date = date or today_str

    user = await users_col.find_one({"_id": current_user["_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    shift_doc = await agent_shifts_col.find_one({"user_id": uid_str, "shift_date": shift_date})
    is_today = (shift_date == today_str)

    raw_stats = (user.get("break_stats") if is_today else None) or (shift_doc.get("break_stats") if shift_doc else {}) or {}
    break_stats = {
        "tea_break": {"count": raw_stats.get("tea_break", {}).get("count", 0), "total_seconds": raw_stats.get("tea_break", {}).get("total_seconds", 0)},
        "lunch_break": {"count": raw_stats.get("lunch_break", {}).get("count", 0), "total_seconds": raw_stats.get("lunch_break", {}).get("total_seconds", 0)},
        "personal_reason": {"count": raw_stats.get("personal_reason", {}).get("count", 0), "total_seconds": raw_stats.get("personal_reason", {}).get("total_seconds", 0)},
    }

    login_at = (user.get("login_at") if is_today else None) or (shift_doc.get("login_at") if shift_doc else None)
    logout_at = (user.get("logout_at") if is_today else None) or (shift_doc.get("logout_at") if shift_doc else None)
    st = (user.get("status") if is_today else "offline")
    current_break = user.get("current_break") if is_today else None
    break_logs = list((user.get("break_logs") if is_today else None) or (shift_doc.get("break_logs") if shift_doc else []) or [])

    completed_break_sec = sum(int(b.get("duration_seconds", 0)) for b in break_logs)
    active_break_sec = 0
    if is_today and st == "paused" and current_break and current_break.get("start_time"):
        try:
            cb_start = datetime.fromisoformat(current_break["start_time"].replace("Z", "+00:00"))
            active_break_sec = max(0, int((now - cb_start).total_seconds()))
        except Exception:
            pass
    tot_break_sec = (shift_doc.get("total_break_seconds") if not is_today and shift_doc else None) or (completed_break_sec + active_break_sec)

    gross_seconds = 0
    if login_at:
        try:
            l_dt = datetime.fromisoformat(login_at.replace("Z", "+00:00"))
            ref_end = datetime.fromisoformat(logout_at.replace("Z", "+00:00")) if logout_at else (now if is_today else l_dt)
            gross_seconds = max(0, int((ref_end - l_dt).total_seconds()))
        except Exception:
            pass

    if not is_today and shift_doc and shift_doc.get("gross_seconds"):
        gross_seconds = shift_doc["gross_seconds"]


    ready_sec = max(0, gross_seconds - tot_break_sec)
    completed_8_hours = gross_seconds >= 28800
    remaining_sec = max(0, 28800 - gross_seconds)

    talk_sec = user.get("talk_seconds", 0) if is_today else (shift_doc.get("talk_seconds", 0) if shift_doc else 0)
    calls_count = user.get("total_calls_handled", 0) if is_today else (shift_doc.get("total_calls_handled", 0) if shift_doc else 0)

    waiting_sec = user.get("waiting_seconds", 0) if is_today else 0
    w_started = user.get("waiting_started_at") if is_today else None
    act_waiting_sec = 0
    if is_today and st == "ready" and w_started:
        try:
            w_dt = datetime.fromisoformat(w_started.replace("Z", "+00:00"))
            act_waiting_sec = max(0, int((now - w_dt).total_seconds()))
        except Exception:
            pass
    tot_waiting_sec = waiting_sec + act_waiting_sec

    return {
        "user_id": uid_str,
        "name": user.get("name"),
        "email": user.get("email"),
        "shift_date": shift_date,
        "status": st,
        "pause_reason": user.get("pause_reason"),
        "login_at": login_at,
        "logout_at": logout_at,
        "current_break": current_break,
        "break_logs": break_logs,
        "gross_seconds": gross_seconds,
        "total_login_seconds": gross_seconds,
        "total_ready_seconds": ready_sec,
        "total_pause_seconds": tot_break_sec,
        "working_seconds": ready_sec,
        "net_working_seconds": ready_sec,
        "ready_seconds": ready_sec,
        "paused_seconds": tot_break_sec,
        "talk_seconds": talk_sec,
        "waiting_seconds": waiting_sec,
        "active_waiting_seconds": act_waiting_sec,
        "total_waiting_seconds": tot_waiting_sec,
        "waiting_started_at": w_started,
        "total_calls_handled": calls_count,
        "avg_handling_seconds": int(talk_sec / calls_count) if calls_count > 0 else 0,
        "break_stats": break_stats,
        "required_seconds": 28800,
        "target_seconds": 28800,
        "completed_8_hours": completed_8_hours,
        "target_completed": completed_8_hours,
        "remaining_seconds": remaining_sec,
        "session_status": "COMPLETED" if completed_8_hours else "INCOMPLETE",
        "completion_percentage": round(min(150, (gross_seconds / 28800) * 100), 1),
    }



# ── Additional Agent Presence API Endpoints ─────────────────────────────────────

@router.get("/me")
@agent_router.get("/me")
@agent_router.get("/presence")
async def get_my_presence_endpoint(current_user: dict = Depends(get_current_user)):
    """Fetch current authoritative presence state and active attendance session for authenticated agent."""
    uid = str(current_user["_id"])
    query = {"_id": ObjectId(uid)} if ObjectId.is_valid(uid) else {"id": uid}
    user = await users_col.find_one(query)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = utcnow()
    now_iso = now.isoformat()
    today_str = get_local_date_str(now)

    # Check today's attendance record
    today_att = await attendance_col.find_one({"agent_id": uid, "date": today_str})
    has_checked_in = bool(today_att and today_att.get("check_in_time") and today_att.get("status") not in ("NOT_CHECKED_IN", "ABSENT"))

    if not has_checked_in:
        return {
            "success": True,
            "agentId": uid,
            "user_id": uid,
            "status": "OFFLINE",
            "raw_status": "offline",
            "is_checked_in": False,
            "businessDate": today_str,
            "loginTime": None,
            "logoutTime": None,
            "check_in_time": None,
            "readySeconds": 0,
            "pauseSeconds": 0,
            "loginSeconds": 0,
            "remainingSeconds": 28800,
            "eightHourCompleted": False,
            "pause_reason": None,
            "statusSince": None,
            "last_status_change": None,
            "serverTime": now_iso,
            "login_at": None,
            "logout_at": None,
            "current_break": None,
            "break_logs": [],
            "working_seconds": 0,
            "gross_seconds": 0,
            "total_login_seconds": 0,
            "total_ready_seconds": 0,
            "total_pause_seconds": 0,
            "ready_seconds": 0,
            "paused_seconds": 0,
            "talk_seconds": 0,
            "dispose_seconds": 0,
            "total_calls_handled": 0,
            "completed_8_hours": False,
        }

    check_in_time = today_att["check_in_time"]
    user_shift_date = user.get("shift_date")
    is_today = (user_shift_date == today_str)

    st = user.get("status", "offline") if is_today else "offline"
    login_val = check_in_time
    logout_val = user.get("logout_at") if is_today else None
    current_break = user.get("current_break") if is_today else None
    break_logs = list(user.get("break_logs") or []) if is_today else []

    completed_break_sec = sum(int(b.get("duration_seconds", 0)) for b in break_logs)
    active_break_sec = 0
    if st == "paused" and current_break and current_break.get("start_time"):
        try:
            cb_start = datetime.fromisoformat(current_break["start_time"].replace("Z", "+00:00"))
            active_break_sec = max(0, int((now - cb_start).total_seconds()))
        except Exception:
            pass
    tot_break_sec = completed_break_sec + active_break_sec

    gross_sec = 0
    if login_val:
        try:
            l_dt = datetime.fromisoformat(login_val.replace("Z", "+00:00"))
            ref_end = datetime.fromisoformat(logout_val.replace("Z", "+00:00")) if logout_val and st == "offline" else now
            gross_sec = max(0, int((ref_end - l_dt).total_seconds()))
        except Exception:
            pass

    ready_sec = max(0, gross_sec - tot_break_sec)
    eight_completed = gross_sec >= 28800

    waiting_sec = user.get("waiting_seconds", 0) if is_today else 0
    w_started = user.get("waiting_started_at") if is_today else None
    act_waiting_sec = 0
    if st == "ready" and w_started:
        try:
            w_dt = datetime.fromisoformat(w_started.replace("Z", "+00:00"))
            elapsed = max(0, int((now - w_dt).total_seconds()))
            if elapsed < 43200:
                act_waiting_sec = elapsed
        except Exception:
            pass
    tot_waiting_sec = waiting_sec + act_waiting_sec

    # Session-specific call telemetry (only calls in active attendance session)
    check_in_dt_naive = None
    try:
        check_in_dt_naive = datetime.fromisoformat(check_in_time.replace("Z", "+00:00")).replace(tzinfo=None) - timedelta(seconds=60)
    except Exception:
        pass

    agent_id_match = [uid]
    if ObjectId.is_valid(uid):
        agent_id_match.append(ObjectId(uid))

    cursor = calls_col.find({"agent_id": {"$in": agent_id_match}})
    session_calls = []
    async for c in cursor:
        st_at = c.get("started_at")
        if not st_at:
            continue
        if isinstance(st_at, str):
            try:
                st_at = datetime.fromisoformat(st_at.replace("Z", "+00:00"))
            except Exception:
                continue
        if isinstance(st_at, datetime):
            st_naive = st_at.replace(tzinfo=None)
            if check_in_dt_naive is None or st_naive >= check_in_dt_naive:
                session_calls.append(c)

    total_calls_session = len(session_calls) if is_today else 0
    talk_sec_session = sum(c.get("duration_seconds", 0) for c in session_calls) if is_today else 0
    dispose_sec_session = sum(c.get("dispose_seconds", 0) for c in session_calls) if is_today else 0

    return {
        "success": True,
        "agentId": uid,
        "user_id": uid,
        "status": st.upper(),
        "raw_status": st,
        "is_checked_in": True,
        "businessDate": today_str,
        "loginTime": login_val,
        "logoutTime": logout_val,
        "check_in_time": check_in_time,
        "readySeconds": ready_sec,
        "pauseSeconds": tot_break_sec,
        "loginSeconds": gross_sec,
        "remainingSeconds": max(0, 28800 - gross_sec),
        "eightHourCompleted": eight_completed,

        "waiting_seconds": waiting_sec,
        "active_waiting_seconds": act_waiting_sec,
        "total_waiting_seconds": tot_waiting_sec,
        "waiting_started_at": w_started if st == "ready" else None,

        "pause_reason": user.get("pause_reason") if is_today else None,
        "statusSince": user.get("last_status_change") if is_today else now_iso,
        "last_status_change": user.get("last_status_change") if is_today else now_iso,
        "serverTime": now_iso,
        "login_at": login_val,
        "logout_at": logout_val,
        "current_break": current_break,
        "break_logs": break_logs,
        "working_seconds": ready_sec,
        "gross_seconds": gross_sec,
        "total_login_seconds": gross_sec,
        "total_ready_seconds": ready_sec,
        "total_pause_seconds": tot_break_sec,
        "ready_seconds": ready_sec,
        "paused_seconds": tot_break_sec,
        "talk_seconds": talk_sec_session,
        "dispose_seconds": dispose_sec_session,
        "total_calls_handled": total_calls_session,
        "completed_8_hours": eight_completed,
    }




@agent_router.post("/presence/ready")
@agent_router.post("/presence/resume")
@agent_router.post("/status/ready")
@agent_router.post("/status/resume")
async def set_agent_ready_endpoint(current_user: dict = Depends(get_current_user)):
    """Set agent status to READY."""
    uid = str(current_user["_id"])
    result = await record_presence_change(user_id=uid, new_status="ready", source="user_action")
    return {
        "success": True,
        "agentId": uid,
        "status": "READY",
        "statusSince": result.get("last_status_change") if result else None,
        "presence": result
    }



@agent_router.post("/presence/pause")
@agent_router.post("/status/pause")
async def set_agent_pause_endpoint(payload: PauseRequest, current_user: dict = Depends(get_current_user)):
    """Set agent status to PAUSED with break reason."""
    uid = str(current_user["_id"])
    reason = payload.pause_reason or payload.reason or "Personal Reason"
    result = await record_presence_change(user_id=uid, new_status="paused", pause_reason=reason, source="user_action")
    return {
        "success": True,
        "agentId": uid,
        "status": "PAUSED",
        "reason": reason,
        "statusSince": result.get("last_status_change") if result else None,
        "presence": result
    }


@agent_router.post("/presence/offline")
@agent_router.post("/status/offline")
async def set_agent_offline_endpoint(payload: Optional[OfflineRequest] = None, current_user: dict = Depends(get_current_user)):
    """Set agent status to OFFLINE."""
    uid = str(current_user["_id"])
    force = payload.force_offline if payload else True
    result = await record_presence_change(user_id=uid, new_status="offline", force_offline=force, source="user_action")
    return {
        "success": True,
        "agentId": uid,
        "status": "OFFLINE",
        "statusSince": result.get("last_status_change") if result else None,
        "presence": result
    }



@router.get("/history")
@agent_router.get("/status-history")
async def get_status_history_endpoint(current_user: dict = Depends(get_current_user)):
    """Fetch status transition history records."""
    uid = str(current_user["_id"])
    role = current_user.get("role")

    query = {}
    if role == "agent":
        query["agent_id"] = uid

    logs = []
    cursor = agent_status_history_col.find(query).sort("created_at", -1).limit(100)
    async for doc in cursor:
        logs.append(oid_str(doc))
    return logs


# ── BPO Agent Session Management Endpoints (/api/agent/session/* & /agent/session/*) ─────────

session_router = APIRouter(prefix="/api/agent/session", tags=["agent-session"])
root_session_router = APIRouter(prefix="/agent/session", tags=["agent-session-root"])


class SessionBreakPayload(BaseModel):
    break_type: Optional[str] = Field(None, description="Break type code: LUNCH, TEA, PERSONAL")
    reason: Optional[str] = Field(None, description="Break reason string")

class SessionLogoutPayload(BaseModel):
    force_offline: Optional[bool] = Field(True, description="Confirmation flag for going offline")


class SessionHeartbeatPayload(BaseModel):
    session_id: Optional[str] = None
    session_version: Optional[int] = None


async def handle_session_start(current_user: dict):
    uid_str = str(current_user["_id"])
    from app.services.attendance_service import check_in_agent
    try:
        await check_in_agent(uid_str)
    except ValueError:
        pass  # Already checked in today

    res = await record_presence_change(user_id=uid_str, new_status="ready", source="session_start")
    if not res:
        raise HTTPException(status_code=400, detail="Failed to start agent session")
    
    now_iso = res.get("login_at") or utcnow().isoformat()
    today_str = res.get("shift_date") or get_local_date_str(utcnow())

    return {
        "success": True,
        "agentId": uid_str,
        "sessionDate": today_str,
        "status": "READY",
        "raw_status": "ready",
        "loginTime": now_iso,
        "logoutTime": None,
        "totalWorkingSeconds": res.get("working_seconds", 0),
        "totalBreakSeconds": res.get("total_break_seconds", 0),
        "presence": res
    }


async def handle_session_break(payload: Optional[SessionBreakPayload], current_user: dict):
    uid_str = str(current_user["_id"])
    reason = payload.break_type if payload and payload.break_type else (payload.reason if payload else "Personal Break")

    if reason:
        r_upper = reason.strip().upper()
        if r_upper == "LUNCH":
            reason = "Lunch Break"
        elif r_upper == "TEA":
            reason = "Tea Break"
        elif r_upper == "PERSONAL":
            reason = "Personal Break"
        elif r_upper == "OTHER":
            reason = "Other Break"

    res = await record_presence_change(user_id=uid_str, new_status="paused", pause_reason=reason, source="session_break")
    if not res:
        raise HTTPException(status_code=400, detail="Failed to start break")

    b_type = get_break_type_code(reason)
    b_start = res.get("current_break", {}).get("start_time") if isinstance(res.get("current_break"), dict) else None

    return {
        "success": True,
        "agentId": uid_str,
        "status": "BREAK",
        "raw_status": "paused",
        "breakType": b_type,
        "breakStart": b_start,
        "presence": res
    }


async def handle_session_resume(current_user: dict):
    uid_str = str(current_user["_id"])
    res = await record_presence_change(user_id=uid_str, new_status="ready", source="session_resume")
    if not res:
        raise HTTPException(status_code=400, detail="Failed to resume work")

    return {
        "success": True,
        "agentId": uid_str,
        "status": "READY",
        "raw_status": "ready",
        "breakType": None,
        "breakStart": None,
        "breakEnd": res.get("last_status_change"),
        "presence": res
    }


async def handle_session_logout(payload: Optional[SessionLogoutPayload], current_user: dict):
    uid_str = str(current_user["_id"])
    force = payload.force_offline if payload else True
    res = await record_presence_change(user_id=uid_str, new_status="offline", force_offline=force, source="session_logout")
    if not res:
        raise HTTPException(status_code=400, detail="Failed to logout session")

    return {
        "success": True,
        "agentId": uid_str,
        "status": "OFFLINE",
        "raw_status": "offline",
        "logoutTime": res.get("logout_at"),
        "totalWorkingSeconds": res.get("working_seconds", 0),
        "totalBreakSeconds": res.get("total_break_seconds", 0),
        "totalLoginSeconds": res.get("total_login_seconds", 0),
        "callsMade": res.get("calls_made", 0),
        "connectedCalls": res.get("connected_calls", 0),
        "totalCallSeconds": res.get("talk_seconds", 0),
        "presence": res
    }


async def handle_session_heartbeat(payload: Optional[SessionHeartbeatPayload], current_user: dict):
    uid_str = str(current_user["_id"])
    now = utcnow()
    now_iso = now.isoformat()
    await users_col.update_one(
        {"_id": ObjectId(uid_str)},
        {"$set": {"last_heartbeat_at": now_iso}}
    )
    return {
        "success": True,
        "agentId": uid_str,
        "timestamp": now_iso,
        "serverTimestamp": int(now.timestamp() * 1000)
    }


async def handle_session_resync(current_user: dict):
    uid_str = str(current_user["_id"])
    user = await users_col.find_one({"_id": ObjectId(uid_str)})
    if not user:
        raise HTTPException(status_code=404, detail="Agent user not found")

    now = utcnow()
    now_iso = now.isoformat()
    today_str = get_local_date_str(now)

    today_att = await attendance_col.find_one({"agent_id": uid_str, "date": today_str})
    has_checked_in = bool(today_att and today_att.get("check_in_time") and today_att.get("status") not in ("NOT_CHECKED_IN", "ABSENT"))
    session_id = f"session_{uid_str}_{today_str}"
    session_ver = user.get("session_version", 1)

    if not has_checked_in:
        return {
            "event": "agent.session.synced",
            "type": "agent_session_synced",
            "agentId": uid_str,
            "sessionId": session_id,
            "sessionVersion": session_ver,
            "status": "OFFLINE",
            "raw_status": "offline",
            "is_checked_in": False,
            "currentCallId": None,
            "dispositionStartedAt": None,
            "pause_reason": None,
            "breakType": None,
            "loginTime": None,
            "logoutTime": None,
            "check_in_time": None,
            "currentBreak": None,
            "breakLogs": [],
            "totalReadySeconds": 0,
            "totalBreakSeconds": 0,
            "disposeSeconds": 0,
            "completedDisposeSeconds": 0,
            "activeWrapupSeconds": 0,
            "grossSeconds": 0,
            "totalLoginSeconds": 0,
            "totalCallsHandled": 0,
            "talkSeconds": 0,
            "eightHourCompleted": False,
            "serverTime": now_iso,
            "serverTimestamp": int(now.timestamp() * 1000),
            "timestamp": now_iso
        }

    check_in_time = today_att["check_in_time"]
    user_shift_date = user.get("shift_date")
    is_today = (user_shift_date == today_str)

    raw_st = user.get("status", "offline") if is_today else "offline"
    normalized_st = normalize_status_input(raw_st)
    
    current_break = user.get("current_break") if is_today else None
    break_logs = list(user.get("break_logs") or []) if is_today else []

    completed_break_sec = sum(int(b.get("duration_seconds", 0)) for b in break_logs)
    active_break_sec = 0
    if normalized_st == "paused" and current_break and current_break.get("start_time"):
        try:
            cb_start = datetime.fromisoformat(current_break["start_time"].replace("Z", "+00:00"))
            active_break_sec = max(0, int((now - cb_start).total_seconds()))
        except Exception:
            pass
    tot_break_sec = completed_break_sec + active_break_sec

    login_val = check_in_time
    logout_val = user.get("logout_at") if is_today else None

    gross_sec = 0
    if login_val:
        try:
            l_dt = datetime.fromisoformat(login_val.replace("Z", "+00:00"))
            ref_end = datetime.fromisoformat(logout_val.replace("Z", "+00:00")) if logout_val and normalized_st == "offline" else now
            gross_sec = max(0, int((ref_end - l_dt).total_seconds()))
        except Exception:
            pass

    ready_sec = max(0, gross_sec - tot_break_sec)
    eight_completed = gross_sec >= 28800

    waiting_sec = user.get("waiting_seconds", 0) if is_today else 0
    w_started = user.get("waiting_started_at") if is_today else None
    act_waiting_sec = 0
    if normalized_st == "ready" and w_started and not user.get("currentCallId"):
        try:
            w_dt = datetime.fromisoformat(w_started.replace("Z", "+00:00"))
            act_waiting_sec = max(0, int((now - w_dt).total_seconds()))
        except Exception:
            pass
    tot_waiting_sec = waiting_sec + act_waiting_sec

    active_wrapup_sec = 0
    disposition_started_at = user.get("dispositionStartedAt") or (user.get("last_status_change") if normalized_st == "wrap_up" else None) if is_today else None
    if normalized_st == "wrap_up" and disposition_started_at:
        try:
            w_start = datetime.fromisoformat(disposition_started_at.replace("Z", "+00:00"))
            active_wrapup_sec = max(0, int((now - w_start).total_seconds()))
        except Exception:
            pass

    # Session-specific call telemetry
    check_in_dt_naive = None
    try:
        check_in_dt_naive = datetime.fromisoformat(check_in_time.replace("Z", "+00:00")).replace(tzinfo=None) - timedelta(seconds=60)
    except Exception:
        pass

    agent_id_match = [uid_str]
    if ObjectId.is_valid(uid_str):
        agent_id_match.append(ObjectId(uid_str))

    cursor = calls_col.find({"agent_id": {"$in": agent_id_match}})
    session_calls = []
    async for c in cursor:
        st_at = c.get("started_at")
        if not st_at:
            continue
        if isinstance(st_at, str):
            try:
                st_at = datetime.fromisoformat(st_at.replace("Z", "+00:00"))
            except Exception:
                continue
        if isinstance(st_at, datetime):
            st_naive = st_at.replace(tzinfo=None)
            if check_in_dt_naive is None or st_naive >= check_in_dt_naive:
                session_calls.append(c)

    total_calls_today = len(session_calls) if is_today else 0
    talk_sec_today = sum(c.get("duration_seconds", 0) for c in session_calls) if is_today else 0
    completed_dispose_sec = sum(c.get("dispose_seconds", 0) for c in session_calls) if is_today else 0
    tot_dispose_sec = completed_dispose_sec + active_wrapup_sec

    return {
        "event": "agent.session.synced",
        "type": "agent_session_synced",
        "agentId": uid_str,
        "sessionId": session_id,
        "sessionVersion": session_ver,
        "status": map_status_to_enum(normalized_st),
        "raw_status": normalized_st,
        "is_checked_in": True,
        "currentCallId": user.get("currentCallId"),
        "dispositionStartedAt": disposition_started_at,
        "pause_reason": user.get("pause_reason") if is_today else None,
        "breakType": get_break_type_code(current_break.get("type") if isinstance(current_break, dict) else user.get("pause_reason")) if normalized_st == "paused" else None,
        "loginTime": login_val,
        "logoutTime": logout_val,
        "check_in_time": check_in_time,
        "currentBreak": current_break,
        "breakLogs": break_logs,
        "totalReadySeconds": ready_sec,
        "totalBreakSeconds": tot_break_sec,
        "disposeSeconds": tot_dispose_sec,
        "completedDisposeSeconds": completed_dispose_sec,
        "activeWrapupSeconds": active_wrapup_sec,
        "grossSeconds": gross_sec,
        "totalLoginSeconds": gross_sec,
        "waitingSeconds": waiting_sec,
        "activeWaitingSeconds": act_waiting_sec,
        "totalWaitingSeconds": tot_waiting_sec,
        "waiting_seconds": waiting_sec,
        "active_waiting_seconds": act_waiting_sec,
        "total_waiting_seconds": tot_waiting_sec,
        "waiting_started_at": w_started,
        "totalCallsHandled": total_calls_today,
        "talkSeconds": talk_sec_today,
        "eightHourCompleted": eight_completed,
        "serverTime": now_iso,
        "serverTimestamp": int(now.timestamp() * 1000),
        "timestamp": now_iso
    }


async def handle_get_telemetry(current_user: dict):
    resync_data = await handle_session_resync(current_user)
    
    total_calls = resync_data.get("totalCallsHandled", 0)
    talk_sec = resync_data.get("talkSeconds", 0)
    dispose_sec = resync_data.get("disposeSeconds", 0)
    
    answered_calls = total_calls
    aht_sec = int((talk_sec + dispose_sec) / answered_calls) if answered_calls > 0 else 0

    return {
        **resync_data,
        "totalCalls": total_calls,
        "answeredCalls": answered_calls,
        "talkSeconds": talk_sec,
        "disposeSeconds": dispose_sec,
        "ahtSeconds": aht_sec,
        "ahtFormatted": f"{aht_sec // 60:02d}:{aht_sec % 60:02d}"
    }


async def handle_get_active_session(current_user: dict):
    uid_str = str(current_user["_id"])
    user = await users_col.find_one({"_id": ObjectId(uid_str)})
    if not user:
        raise HTTPException(status_code=404, detail="Agent user not found")

    now = utcnow()
    now_iso = now.isoformat()
    today_str = get_local_date_str(now)
    is_today = (user.get("shift_date") == today_str)

    raw_st = user.get("status", "offline") if is_today else "offline"
    normalized_st = normalize_status_input(raw_st)
    
    if normalized_st == "ready":
        display_st = "READY"
    elif normalized_st == "paused":
        display_st = "BREAK"
    elif normalized_st == "in_call":
        display_st = "IN_CALL"
    elif normalized_st == "ringing":
        display_st = "RINGING"
    elif normalized_st == "wrap_up":
        display_st = "WRAP_UP"
    else:
        display_st = "OFFLINE"

    current_break = user.get("current_break") if is_today else None
    break_logs = list(user.get("break_logs") or []) if is_today else []

    break_type = get_break_type_code(current_break.get("type") if isinstance(current_break, dict) else user.get("pause_reason")) if normalized_st == "paused" else None
    break_start = current_break.get("start_time") if isinstance(current_break, dict) else None

    shift_doc = await agent_shifts_col.find_one({"user_id": uid_str, "shift_date": today_str}) if is_today else None

    return {
        "agentId": uid_str,
        "sessionDate": today_str if is_today else today_str,
        "status": display_st,
        "raw_status": normalized_st,
        "loginTime": user.get("login_at") if is_today else None,
        "logoutTime": user.get("logout_at") if is_today else None,
        "breakType": break_type,
        "breakStart": break_start,
        "currentBreak": current_break,
        "breakLogs": break_logs,
        "totalWorkingSeconds": shift_doc.get("working_seconds", 0) if shift_doc else 0,
        "totalBreakSeconds": shift_doc.get("total_break_seconds", 0) if shift_doc else 0,
        "callsMade": shift_doc.get("calls_made", 0) if shift_doc else 0,
        "connectedCalls": shift_doc.get("connected_calls", 0) if shift_doc else 0,
        "totalCallSeconds": shift_doc.get("talk_seconds", 0) if shift_doc else 0,
        "timestamp": now_iso
    }


# Route Registrations for /api/agent/session
@session_router.post("/start")
async def api_session_start(current_user: dict = Depends(get_current_user)):
    return await handle_session_start(current_user)

@session_router.post("/break")
@session_router.post("/break/start")
async def api_session_break(payload: Optional[SessionBreakPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_break(payload, current_user)

@session_router.post("/resume")
@session_router.post("/break/end")
async def api_session_resume(current_user: dict = Depends(get_current_user)):
    return await handle_session_resume(current_user)

@session_router.post("/logout")
@session_router.post("/offline")
async def api_session_logout(payload: Optional[SessionLogoutPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_logout(payload, current_user)

@session_router.post("/heartbeat")
async def api_session_heartbeat(payload: Optional[SessionHeartbeatPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_heartbeat(payload, current_user)

@session_router.get("/resync")
@session_router.post("/resync")
async def api_session_resync(current_user: dict = Depends(get_current_user)):
    return await handle_session_resync(current_user)

@session_router.get("/telemetry")
async def api_session_telemetry(current_user: dict = Depends(get_current_user)):
    return await handle_get_telemetry(current_user)

@session_router.get("/active")
@session_router.get("/current")
async def api_session_active(current_user: dict = Depends(get_current_user)):
    return await handle_get_active_session(current_user)

@session_router.get("/today")
async def api_session_today(current_user: dict = Depends(get_current_user)):
    return await handle_get_active_session(current_user)


# Route Registrations for /agent/session (root fallback)
@root_session_router.post("/start")
async def root_session_start(current_user: dict = Depends(get_current_user)):
    return await handle_session_start(current_user)

@root_session_router.post("/break")
@root_session_router.post("/break/start")
async def root_session_break(payload: Optional[SessionBreakPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_break(payload, current_user)

@root_session_router.post("/resume")
@root_session_router.post("/break/end")
async def root_session_resume(current_user: dict = Depends(get_current_user)):
    return await handle_session_resume(current_user)

@root_session_router.post("/logout")
@root_session_router.post("/offline")
async def root_session_logout(payload: Optional[SessionLogoutPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_logout(payload, current_user)

@root_session_router.post("/heartbeat")
async def root_session_heartbeat(payload: Optional[SessionHeartbeatPayload] = None, current_user: dict = Depends(get_current_user)):
    return await handle_session_heartbeat(payload, current_user)

@root_session_router.get("/resync")
@root_session_router.post("/resync")
async def root_session_resync(current_user: dict = Depends(get_current_user)):
    return await handle_session_resync(current_user)

@root_session_router.get("/telemetry")
async def root_session_telemetry(current_user: dict = Depends(get_current_user)):
    return await handle_get_telemetry(current_user)

@root_session_router.get("/active")
@root_session_router.get("/current")
async def root_session_active(current_user: dict = Depends(get_current_user)):
    return await handle_get_active_session(current_user)

@root_session_router.get("/today")
async def root_session_today(current_user: dict = Depends(get_current_user)):
    return await handle_get_active_session(current_user)








@router.get("/session/current")
@agent_router.get("/session/current")
async def get_current_session_endpoint(current_user: dict = Depends(get_current_user)):
    """Fetch current authoritative snapshot of the session state and telemetry."""
    uid = str(current_user["_id"])
    query = {"_id": ObjectId(uid)} if ObjectId.is_valid(uid) else {"id": uid}
    user = await users_col.find_one(query)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    now = utcnow()
    now_iso = now.isoformat()
    shift_date = get_local_date_str(now)
    user_shift_date = user.get("shift_date")
    
    current_status = user.get("status", "offline") if user_shift_date == shift_date else "offline"
    state_started_at = user.get("state_started_at") or user.get("last_status_change") or now_iso
    if user_shift_date != shift_date:
        state_started_at = now_iso
        
    login_val = user.get("login_at") if user_shift_date == shift_date else None
    gross_seconds = 0
    if login_val:
        login_dt = datetime.fromisoformat(login_val.replace("Z", "+00:00"))
        gross_seconds = max(0, int((now - login_dt).total_seconds()))

    session_id = f"session_{uid}_{shift_date}"
    break_logs = list(user.get("break_logs") or []) if user_shift_date == shift_date else []
    
    data_payload = {
        "sessionId": session_id,
        "agentId": uid,
        "currentState": current_status,
        "stateStartedAt": state_started_at,
        "login_at": login_val,
        "serverTime": now_iso,
        "version": user.get("version", 1),
        "telemetry": {
            "readySeconds": user.get("total_ready_seconds", 0) if user_shift_date == shift_date else 0,
            "pauseSeconds": (user.get("total_pause_seconds", 0) or user.get("total_break_seconds", 0)) if user_shift_date == shift_date else 0,
            "ringingSeconds": (user.get("total_ringing_seconds", 0) or user.get("ringing_seconds", 0)) if user_shift_date == shift_date else 0,
            "talkSeconds": (user.get("total_talk_seconds", 0) or user.get("talk_seconds", 0)) if user_shift_date == shift_date else 0,
            "wrapUpSeconds": (user.get("total_wrapup_seconds", 0) or user.get("dispose_seconds", 0)) if user_shift_date == shift_date else 0,
            "sessionSeconds": gross_seconds,
            "breaksTaken": len(break_logs) + (1 if current_status == "paused" else 0),
            "callsHandled": user.get("total_calls_handled", 0) if user_shift_date == shift_date else 0,
        }
    }
    
    return data_payload
