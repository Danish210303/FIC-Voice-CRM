import os
import asyncio
import logging
import uuid
from urllib.parse import quote
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from bson import ObjectId

from app.core.config import settings
from app.core.http import get_http_client
from app.core.database import follow_ups_col, leads_col, users_col, calls_col, pools_col, notifications_col, audit_logs_col
from app.core.utils import utcnow, oid_str, normalize_phone
from app.services.ws_manager import ws_manager

logger = logging.getLogger("uvicorn.error")

MISSED_GRACE_MINUTES = 30  # Grace window before marking a due follow-up as MISSED
LOCK_EXPIRY_SECONDS = 60   # Lock expiry window for auto-call worker safety

# Timezone definition for default CRM timezone (India Standard Time UTC+05:30)
IST_TZ = timezone(timedelta(hours=5, minutes=30))


def utc_to_ist(dt_val: Any) -> datetime:
    """Converts a UTC datetime or string to Asia/Kolkata (IST: UTC+05:30) datetime."""
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            dt_val = dt_val.replace(tzinfo=timezone.utc)
        return dt_val.astimezone(IST_TZ)
    if isinstance(dt_val, str) and dt_val.strip():
        dt = parse_datetime_to_utc(dt_val)
        return dt.astimezone(IST_TZ)
    return datetime.now(IST_TZ)


def format_ist_datetime_str(dt_val: Any) -> str:
    """Formats datetime consistently as: '09 Sept 2026, 11:07 AM IST'."""
    if not dt_val:
        return "Not set"
    dt_ist = utc_to_ist(dt_val)
    month_name = dt_ist.strftime("%b")
    if month_name == "Sep":
        month_name = "Sept"
    return f"{dt_ist.strftime('%d')} {month_name} {dt_ist.strftime('%Y')}, {dt_ist.strftime('%I:%M %p')} IST"


def parse_datetime_to_utc(dt_val: Any) -> datetime:
    """
    Safely converts string, ISO format, or datetime object into UTC datetime,
    strictly interpreting all naive date/time inputs as Indian Standard Time (IST / Asia/Kolkata / UTC+05:30).
    """
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=timezone.utc)
        return dt_val.astimezone(timezone.utc)
    
    if not dt_val:
        return utcnow()
    
    s = str(dt_val).strip()
    if not s:
        return utcnow()

    # Clean up duplicate time patterns like "2026-09-10 14:00 14:00" or "2026-09-10T14:00 14:00"
    parts = s.split()
    if len(parts) >= 3 and parts[1] == parts[2]:
        s = f"{parts[0]} {parts[1]}"
    elif len(parts) == 2 and "T" in parts[0] and (":" in parts[0] and ":" in parts[1]):
        s = parts[0]

    s_upper = s.upper()

    # 1. Check if string explicitly contains Z or +offset
    if "Z" in s or ("+" in s and len(s) > 10):
        try:
            clean_s = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_s)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass

    # 2. Try 24h & 12h formats (all treated as IST)
    ist_formats = [
        # 12-hour AM/PM formats
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %I:%M %p",
        "%d/%m/%Y %I:%M:%S %p",
        "%d/%m/%Y %I:%M %p",
        "%d-%m-%Y %I:%M:%S %p",
        "%d-%m-%Y %I:%M %p",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%Y %I:%M %p",
        "%Y/%m/%d %I:%M:%S %p",
        "%Y/%m/%d %I:%M %p",

        # 24-hour formats
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
    ]

    for fmt in ist_formats:
        try:
            dt = datetime.strptime(s_upper, fmt)
            return dt.replace(tzinfo=IST_TZ).astimezone(timezone.utc)
        except Exception:
            continue

    # 3. Try date-only formats (default to 10:00 AM IST)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(s, fmt).replace(hour=10, minute=0, second=0)
            return dt.replace(tzinfo=IST_TZ).astimezone(timezone.utc)
        except Exception:
            continue

    # 4. Try time-only formats like "16:40" or "04:40 PM" (attach today's date in IST)
    now_ist = datetime.now(IST_TZ)
    for fmt in ("%I:%M %p", "%I:%M:%S %p", "%H:%M", "%H:%M:%S"):
        try:
            t = datetime.strptime(s_upper, fmt).time()
            dt_combined = datetime.combine(now_ist.date(), t).replace(tzinfo=IST_TZ)
            return dt_combined.astimezone(timezone.utc)
        except Exception:
            continue

    # 5. Fallback: Try ISO fromisoformat
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=IST_TZ).astimezone(timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass

    return utcnow()


def _safe_oid(oid_val: Any) -> Optional[ObjectId]:
    if oid_val and isinstance(oid_val, str) and ObjectId.is_valid(oid_val):
        return ObjectId(oid_val)
    elif isinstance(oid_val, ObjectId):
        return oid_val
    return None


async def record_follow_up_timeline_event(
    fu_id: str,
    action: str,
    description: str,
    actor: str = "System",
    actor_role: str = "System Engine",
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Appends an immutable audit timeline record to a follow-up document."""
    oid = _safe_oid(fu_id)
    if not oid:
        return {}

    now = utcnow()
    event_id = f"evt_{uuid.uuid4().hex[:8]}"
    timeline_item = {
        "id": event_id,
        "timestamp": now.isoformat(),
        "action": action,
        "description": description,
        "actor": actor,
        "actor_role": actor_role,
        "metadata": metadata or {}
    }

    try:
        await follow_ups_col.update_one(
            {"_id": oid},
            {
                "$push": {"timeline": {"$each": [timeline_item], "$position": 0}},
                "$set": {"updated_at": now}
            }
        )
    except Exception as e:
        logger.warning(f"[FOLLOW-UP TIMELINE] Error logging timeline event for #{fu_id}: {e}")

    return timeline_item


async def is_agent_ready_for_call(agent_user: Dict[str, Any]) -> bool:
    """Checks if an agent is currently online, ready and available to receive callbacks."""
    if not agent_user:
        return False
    status_val = (agent_user.get("status") or "").lower().strip()
    is_active = agent_user.get("is_active", True)
    if not is_active:
        return False
    # Agent must be in ready, online, or available state (not paused/break/in_call/on_call/offline)
    if status_val not in ("ready", "online", "available"):
        return False
    if agent_user.get("currentCallId"):
        return False
    return True


async def find_available_pool_agent(
    pool_id: str,
    exclude_agent_ids: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """
    Finds an available and ready agent in the same pool for callback routing.
    Prefers longest-idle agent. Respects strict pool isolation.
    """
    exclude_oids = [_safe_oid(a) for a in (exclude_agent_ids or []) if _safe_oid(a)]
    exclude_strs = [str(a) for a in (exclude_agent_ids or [])]

    query: Dict[str, Any] = {
        "status": {"$in": ["ready", "online", "available"]},
        "is_active": True,
        "$or": [
            {"currentCallId": None},
            {"currentCallId": ""},
            {"currentCallId": {"$exists": False}}
        ]
    }

    if pool_id and pool_id != "general":
        p_oid = _safe_oid(pool_id)
        pool_cond = [{"pool_id": pool_id}]
        if p_oid:
            pool_cond.append({"pool_id": p_oid})
        query["$and"] = [{"$or": pool_cond}]

    if exclude_oids or exclude_strs:
        nin_list = list(set(exclude_oids + [s for s in exclude_strs if ObjectId.is_valid(s)]))
        query["_id"] = {"$nin": nin_list}

    # Query matching available agents within assigned pool
    candidate = await users_col.find_one(
        query,
        sort=[("last_call_at", 1), ("last_status_change", 1)]
    )
    return candidate

    return None


async def create_or_update_lead_follow_up(
    lead_id: Optional[str] = None,
    phone: Optional[str] = None,
    agent_id: Optional[str] = None,
    follow_up_time_str: Optional[str] = None,
    reason: Optional[str] = None,
    notes: Optional[str] = None,
    current_user_id: Optional[str] = None,
    related_call_id: Optional[str] = None,
    priority: Optional[str] = "medium"
) -> Dict[str, Any]:
    """Helper to persist a scheduled Follow-Up for a lead/customer with complete BPO metadata and timeline."""
    now = utcnow()
    fu_dt = parse_datetime_to_utc(follow_up_time_str) if follow_up_time_str else (now + timedelta(hours=24))
    status_val = "due" if fu_dt <= now else "scheduled"

    cust_name = "Customer"
    cust_phone = normalize_phone(phone or "")
    pool_id = "general"
    pool_name = "Customer Support"
    actual_lead_id = None

    if lead_id:
        lead_oid = _safe_oid(lead_id)
        lead = await leads_col.find_one({"$or": [{"_id": lead_oid}, {"lead_id": lead_id}, {"id": lead_id}]}) if (lead_oid or lead_id) else None
        if lead:
            actual_lead_id = str(lead.get("_id") or lead.get("lead_id") or lead_id)
            cust_name = lead.get("name") or cust_name
            cust_phone = normalize_phone(lead.get("phone") or cust_phone)
            pool_id = str(lead.get("pool_id") or pool_id)

    if not actual_lead_id and cust_phone:
        lead = await leads_col.find_one({"phone": cust_phone})
        if lead:
            actual_lead_id = str(lead.get("_id") or lead.get("lead_id"))
            cust_name = lead.get("name") or cust_name
            pool_id = str(lead.get("pool_id") or pool_id)

    if pool_id and pool_id != "general":
        p_oid = _safe_oid(pool_id)
        p_doc = await pools_col.find_one({"$or": [{"_id": p_oid}, {"id": pool_id}]}) if (p_oid or pool_id) else None
        if p_doc:
            pool_name = p_doc.get("name") or pool_name

    agent_name = "Agent"
    agent_emp_id = ""
    target_agent_id = agent_id or current_user_id
    agent_user = None
    if target_agent_id:
        ag_oid = _safe_oid(target_agent_id)
        agent_user = await users_col.find_one({"$or": [{"_id": ag_oid}, {"id": target_agent_id}]}) if (ag_oid or target_agent_id) else None
        if agent_user:
            agent_name = agent_user.get("name") or agent_user.get("email", "").split("@")[0]
            agent_emp_id = agent_user.get("employee_id", "")
            if not pool_id or pool_id == "general":
                pool_id = str(agent_user.get("pool_id") or pool_id)

    initial_timeline_event = {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "FOLLOW_UP_SCHEDULED",
        "description": f"Callback scheduled for {fu_dt.strftime('%d %b %Y, %I:%M %p IST')} ({reason or notes or 'Callback Request'})",
        "actor": agent_name,
        "actor_role": "Agent",
        "metadata": {
            "scheduled_datetime": fu_dt.isoformat(),
            "original_agent_id": target_agent_id,
            "original_agent_name": agent_name,
            "pool_id": pool_id,
            "pool_name": pool_name,
            "notes": notes or ""
        }
    }

    # Deduplication: Check if an active/matching follow-up already exists
    existing_fu = None
    if related_call_id:
        existing_fu = await follow_ups_col.find_one({
            "$or": [
                {"original_call_id": str(related_call_id)},
                {"related_call_id": str(related_call_id)}
            ]
        })
    if not existing_fu and actual_lead_id:
        existing_fu = await follow_ups_col.find_one({
            "lead_id": str(actual_lead_id),
            "status": {"$in": ["scheduled", "due", "waiting_for_agent"]}
        })
    if not existing_fu and cust_phone:
        existing_fu = await follow_ups_col.find_one({
            "customer_phone": cust_phone,
            "status": {"$in": ["scheduled", "due", "waiting_for_agent"]}
        })

    if existing_fu:
        fu_id = str(existing_fu["_id"])
        update_payload = {
            "customer_name": cust_name,
            "customer_phone": cust_phone,
            "scheduled_at": fu_dt,
            "follow_up_datetime": fu_dt,
            "reason": reason or (notes or existing_fu.get("reason", "Follow-Up Call")),
            "notes": notes or existing_fu.get("notes", ""),
            "status": status_val,
            "completed_at": None,
            "completion_outcome": None,
            "completion_notes": None,
            "priority": priority or existing_fu.get("priority", "medium"),
            "current_agent_id": target_agent_id or existing_fu.get("current_agent_id", ""),
            "current_agent_name": agent_name or existing_fu.get("current_agent_name", "Agent"),
            "agent_id": target_agent_id or existing_fu.get("agent_id", ""),
            "agent_name": agent_name or existing_fu.get("agent_name", "Agent"),
            "pool_id": pool_id or existing_fu.get("pool_id", "general"),
            "pool_name": pool_name or existing_fu.get("pool_name", "Customer Support"),
            "time_zone": "Asia/Kolkata",
            "updated_at": now
        }
        if related_call_id:
            update_payload["related_call_id"] = str(related_call_id)

        await follow_ups_col.update_one(
            {"_id": existing_fu["_id"]},
            {
                "$set": update_payload,
                "$push": {"timeline": {"$each": [initial_timeline_event], "$position": 0}}
            }
        )
        doc = {**existing_fu, **update_payload, "_id": existing_fu["_id"]}

    else:
        doc = {
            "customer_id": actual_lead_id or cust_phone or str(now.timestamp()),
            "lead_id": actual_lead_id,
            "customer_name": cust_name,
            "customer_phone": cust_phone,
            "phone_number": cust_phone,
            "user_id": str(current_user_id or target_agent_id or ""),
            # Original Agent Assignment
            "original_agent_id": target_agent_id or "",
            "original_agent_name": agent_name,
            # Assigned / Current Agent Assignment
            "assigned_agent_id": target_agent_id or "",
            "assigned_agent_name": agent_name,
            "current_agent_id": target_agent_id or "",
            "current_agent_name": agent_name,
            "agent_id": target_agent_id or "",
            "agent_name": agent_name,
            "agent_employee_id": agent_emp_id,
            "pool_id": pool_id,
            "pool_name": pool_name,
            "scheduled_at": fu_dt,
            "follow_up_datetime": fu_dt,
            "reason": reason or (notes or "Follow-Up Call"),
            "notes": notes or "",
            "status": status_val,
            "priority": priority or "medium",
            "time_zone": "Asia/Kolkata",
            "original_call_id": str(related_call_id) if related_call_id else None,
            "related_call_id": str(related_call_id) if related_call_id else None,
            "timeline": [initial_timeline_event],
            "attempts": [],
            "call_attempts_count": 0,
            "is_locked": False,
            "lock_timestamp": None,
            "created_by": str(current_user_id or target_agent_id or "system"),
            "created_at": now,
            "updated_at": now
        }
        res = await follow_ups_col.insert_one(doc)
        doc["_id"] = res.inserted_id
        fu_id = str(res.inserted_id)

    if actual_lead_id and ObjectId.is_valid(actual_lead_id):
        try:
            await leads_col.update_one(
                {"_id": ObjectId(actual_lead_id)},
                {"$set": {
                    "status": "follow_up_required",
                    "follow_up_date": fu_dt.strftime("%Y-%m-%d %H:%M"),
                    "follow_up_id": fu_id,
                    "last_note": notes or "Follow-up scheduled"
                }}
            )
        except Exception:
            pass

    fu_dt_iso = fu_dt.isoformat()
    serialized = {
        "id": fu_id,
        "_id": fu_id,
        "follow_up_id": fu_id,
        "customer_id": doc["customer_id"],
        "lead_id": actual_lead_id,
        "customer_name": cust_name,
        "customer_phone": cust_phone,
        "phone_number": cust_phone,
        "original_agent_id": doc["original_agent_id"],
        "original_agent_name": doc["original_agent_name"],
        "assigned_agent_id": doc["assigned_agent_id"],
        "assigned_agent_name": doc["assigned_agent_name"],
        "current_agent_id": doc["current_agent_id"],
        "current_agent_name": doc["current_agent_name"],
        "agent_id": doc["agent_id"],
        "agent_name": doc["agent_name"],
        "agent_employee_id": agent_emp_id,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "scheduled_at": fu_dt_iso,
        "follow_up_datetime": fu_dt_iso,
        "reason": doc["reason"],
        "notes": doc["notes"],
        "status": status_val,
        "priority": doc["priority"],
        "time_zone": "Asia/Kolkata",
        "original_call_id": doc["original_call_id"],
        "related_call_id": doc["related_call_id"],
        "timeline": doc["timeline"],
        "attempts": doc["attempts"],
        "call_attempts_count": 0,
        "created_at": now.isoformat(),
        "completed_at": None,
        "missed_at": None
    }

    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_CREATED",
        "type": "follow_up_created",
        "follow_up": serialized,
        "id": fu_id,
        "customer_name": cust_name,
        "customer_phone": cust_phone,
        "agent_id": target_agent_id or "",
        "status": status_val,
        "scheduled_datetime": fu_dt_iso,
        "timestamp": now.isoformat()
    })
    logger.info(f"[FOLLOW-UP CREATED] Scheduled #{fu_id} for {cust_name} ({cust_phone}) at {fu_dt_iso}")
    return serialized


async def initiate_auto_callback_for_agent(
    fu_doc: Dict[str, Any],
    agent_user: Dict[str, Any],
    trigger_reason: str = "Scheduled Callback"
) -> Optional[Dict[str, Any]]:
    """
    Initiates an automated outbound callback for an available agent:
    1. Creates outbound call record in calls_col linked to follow_up_id.
    2. Updates agent presence to in_call / on_call.
    3. Updates follow-up status to auto_calling and appends timeline event.
    4. Broadcasts realtime WS event to trigger agent's softphone console.
    """
    fu_id = str(fu_doc["_id"])
    agent_id = str(agent_user["_id"])
    agent_name = agent_user.get("name") or "Agent"
    now = utcnow()

    customer_phone = fu_doc.get("customer_phone") or fu_doc.get("phone_number") or ""
    customer_name = fu_doc.get("customer_name") or "Customer"
    pool_id = str(fu_doc.get("pool_id") or agent_user.get("pool_id") or "general")
    lead_id = fu_doc.get("lead_id")

    # Create Call Document in RINGING state
    call_doc = {
        "direction": "outbound",
        "status": "live",
        "call_status": "ringing",
        "is_ai": False,
        "auto_dialed": True,
        "follow_up_id": fu_id,
        "lead_id": str(lead_id) if lead_id else None,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "pool_id": pool_id,
        "phone": customer_phone,
        "caller_name": customer_name,
        "caller_phone": customer_phone,
        "ringing_started_at": now,
        "started_at": now,
        "created_at": now,
        "notes": f"Auto-Callback for Follow-Up #{fu_id} ({fu_doc.get('reason', '')})"
    }
    call_res = await calls_col.insert_one(call_doc)
    call_id = str(call_res.inserted_id)
    call_doc["_id"] = call_res.inserted_id

    # Update Agent Presence in DB to RINGING
    try:
        await users_col.update_one(
            {"_id": agent_user["_id"]},
            {"$set": {
                "status": "ringing",
                "currentCallId": call_id,
                "last_call_at": now,
                "updated_at": now
            }}
        )
    except Exception as e:
        logger.warning(f"[AUTO-CALL PRESENCE] Could not update agent {agent_id} presence: {e}")

    # Update Follow-Up status to RINGING
    attempt_entry = {
        "attempt_number": (fu_doc.get("call_attempts_count") or 0) + 1,
        "call_id": call_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "timestamp": now.isoformat(),
        "status": "ringing"
    }

    timeline_entry = {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp": now.isoformat(),
        "action": "CALL_RINGING",
        "description": f"Auto-Callback ringing customer {customer_name} ({customer_phone}) -> Connected to assigned agent {agent_name} (Call #{call_id[-6:].upper()})",
        "actor": "Auto-Call Engine",
        "actor_role": "System Scheduler",
        "metadata": {
            "call_id": call_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "trigger_reason": trigger_reason
        }
    }

    await follow_ups_col.update_one(
        {"_id": fu_doc["_id"]},
        {
            "$set": {
                "status": "ringing",
                "current_agent_id": agent_id,
                "current_agent_name": agent_name,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "related_call_id": call_id,
                "last_attempt_at": now,
                "is_locked": False,
                "lock_timestamp": None,
                "updated_at": now
            },
            "$inc": {"call_attempts_count": 1},
            "$push": {
                "timeline": {"$each": [timeline_entry], "$position": 0},
                "attempts": attempt_entry
            }
        }
    )

    # Trigger Real Plivo Outbound Call Bridging (Agent-First Click-to-Call)
    plivo_auth_id = getattr(settings, 'PLIVO_AUTH_ID', '') or os.getenv('PLIVO_AUTH_ID', '')
    plivo_auth_token = getattr(settings, 'PLIVO_AUTH_TOKEN', '') or os.getenv('PLIVO_AUTH_TOKEN', '')
    plivo_phone_number = getattr(settings, 'PLIVO_PHONE_NUMBER', '+918031826757')
    base_url = getattr(settings, 'BASE_URL', '') or os.getenv('BASE_URL', 'https://fic-voice-crm.onrender.com')

    agent_phone_val = agent_user.get("agent_phone") or agent_user.get("phone") or ""
    clean_agent_phone = normalize_phone(agent_phone_val) if agent_phone_val else ""
    norm_cust_phone = normalize_phone(customer_phone) if customer_phone else ""

    if plivo_auth_id and plivo_auth_token and norm_cust_phone:
        try:
            plivo_url = f"https://api.plivo.com/v1/Account/{plivo_auth_id}/Call/"
            if clean_agent_phone:
                primary_dest = clean_agent_phone.replace("+", "")
                bridge_dest = norm_cust_phone
            else:
                primary_dest = norm_cust_phone.replace("+", "")
                bridge_dest = ""

            plivo_body = {
                "from": plivo_phone_number.replace("+", ""),
                "to": primary_dest,
                "answer_url": f"{base_url}/api/calls/plivo/answer?dial_to={quote(bridge_dest)}&agent_phone={quote(clean_agent_phone)}",
                "answer_method": "POST",
                "hangup_url": f"{base_url}/api/calls/plivo/status",
                "hangup_method": "POST",
            }
            client = get_http_client()
            res = await client.post(plivo_url, json=plivo_body, auth=(plivo_auth_id, plivo_auth_token), timeout=10.0)
            if res.status_code in (200, 201, 202):
                logger.info(f"[AUTO-CALL PLIVO BRIDGE] Placed outbound call to {primary_dest} (bridge {bridge_dest}): {res.json()}")
            else:
                logger.warning(f"[AUTO-CALL PLIVO BRIDGE] API response {res.status_code}: {res.text}")
        except Exception as plivo_err:
            logger.warning(f"[AUTO-CALL PLIVO BRIDGE ERROR] {plivo_err}")

    # Broadcast WebSocket Events to agent softphone console & supervisor dashboard
    ringing_event = {
        "event": "FOLLOW_UP_RINGING",
        "type": "follow_up_ringing",
        "follow_up_id": fu_id,
        "id": fu_id,
        "call_id": call_id,
        "callId": call_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "lead_id": str(lead_id) if lead_id else None,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "phone": customer_phone,
        "pool_id": pool_id,
        "status": "ringing",
        "is_follow_up": True,
        "reason": fu_doc.get("reason", "Scheduled Callback"),
        "timestamp": now.isoformat()
    }

    await ws_manager.broadcast_global(ringing_event)
    await ws_manager.broadcast_global({
        "event": "FOLLOW_UP_AUTO_CALLING",
        **ringing_event
    })
    await ws_manager.broadcast_global({
        "event": "CALL_RINGING",
        "call_id": call_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "phone": customer_phone,
        "caller_name": customer_name,
        "is_follow_up": True,
        "timestamp": now.isoformat()
    })
    await ws_manager.broadcast_global({
        "event": "inbound_call_auto_answered",
        "call_id": call_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "lead_id": str(lead_id) if lead_id else None,
        "lead_name": customer_name,
        "phone": customer_phone,
        "pool_id": pool_id,
        "is_follow_up": True
    })
    await ws_manager.broadcast_global({"event": "users_updated"})

    logger.info(f"[AUTO-CALL ENGINE] Successfully started call #{call_id} for Follow-Up #{fu_id} -> Agent {agent_name} ({agent_id})")
    return call_doc



async def process_scheduled_auto_calls() -> Dict[str, Any]:
    """
    Core Server-Side Scheduled Auto-Call Engine:
    1. Evaluates all pending follow-ups due at current timestamp.
    2. Atomically locks each due follow-up to prevent race conditions or duplicate calls.
    3. Checks if assigned agent is online & ready.
       - Available: triggers auto-callback to that agent.
       - Unavailable: automatically reassigns to another available agent in the same pool and triggers callback.
       - No agent available in pool: transitions to WAITING_FOR_AGENT and retries on next cycle.
    4. Records comprehensive timeline audit trail.
    """
    now = utcnow()
    now_iso = now.isoformat()
    stale_lock_cutoff = now - timedelta(seconds=LOCK_EXPIRY_SECONDS)

    calls_initiated = 0
    reassigned_count = 0
    waiting_count = 0

    try:
        # Find all pending scheduled or due follow-ups whose scheduled time has arrived
        query = {
            "status": {"$in": ["scheduled", "due", "waiting_for_agent"]},
            "follow_up_datetime": {"$lte": now},
            "$or": [
                {"is_locked": {"$ne": True}},
                {"lock_timestamp": {"$lt": stale_lock_cutoff}},
                {"lock_timestamp": None}
            ]
        }

        due_follow_ups = await follow_ups_col.find(query).to_list(length=100)

        for fu in due_follow_ups:
            fu_id = str(fu["_id"])

            # 1. Acquire atomic lock
            locked_fu = await follow_ups_col.find_one_and_update(
                {
                    "_id": fu["_id"],
                    "$or": [
                        {"is_locked": {"$ne": True}},
                        {"lock_timestamp": {"$lt": stale_lock_cutoff}},
                        {"lock_timestamp": None}
                    ]
                },
                {"$set": {"is_locked": True, "lock_timestamp": now, "status": "due"}},
                return_document=True
            )

            if not locked_fu:
                continue  # Another worker tick already acquired this follow-up

            # Check if there is already an active call in progress for this follow-up (Idempotency)
            if locked_fu.get("related_call_id"):
                existing_call = await calls_col.find_one({
                    "$or": [
                        {"_id": _safe_oid(locked_fu["related_call_id"])},
                        {"follow_up_id": fu_id}
                    ],
                    "status": "live"
                })
                if existing_call:
                    logger.info(f"[AUTO-CALL ENGINE] Call #{existing_call['_id']} already active for Follow-Up #{fu_id}. Skipping duplicate trigger.")
                    continue

            customer_name = locked_fu.get("customer_name", "Customer")
            customer_phone = locked_fu.get("customer_phone", "")
            pool_id = locked_fu.get("pool_id", "general")
            pool_name = locked_fu.get("pool_name", "General Support")
            assigned_agent_id = locked_fu.get("assigned_agent_id") or locked_fu.get("agent_id")
            original_agent_name = locked_fu.get("assigned_agent_name") or locked_fu.get("agent_name") or "Assigned Agent"

            # 2. Check if Assigned Agent is Available
            assigned_agent_user = None
            is_assigned_available = False

            if assigned_agent_id:
                ag_oid = _safe_oid(assigned_agent_id)
                assigned_agent_user = await users_col.find_one({"$or": [{"_id": ag_oid}, {"id": assigned_agent_id}]}) if (ag_oid or assigned_agent_id) else None
                if assigned_agent_user:
                    is_assigned_available = await is_agent_ready_for_call(assigned_agent_user)

            if is_assigned_available and assigned_agent_user:
                # ── SCENARIO A: Original / Assigned Agent is READY ──
                logger.info(f"[AUTO-CALL ENGINE] Assigned agent {assigned_agent_user.get('name')} is READY for Follow-Up #{fu_id}")
                await initiate_auto_callback_for_agent(locked_fu, assigned_agent_user, trigger_reason="Assigned Agent Ready")
                calls_initiated += 1

            else:
                # ── SCENARIO B: Assigned Agent is UNAVAILABLE ──
                agent_curr_status = assigned_agent_user.get("status", "offline") if assigned_agent_user else "not_found"
                logger.info(f"[AUTO-CALL ENGINE] Assigned agent {original_agent_name} is UNAVAILABLE (status: {agent_curr_status}) for Follow-Up #{fu_id}. Searching pool '{pool_name}'...")

                # Log Agent Unavailable timeline event
                unavail_timeline = {
                    "id": f"evt_{uuid.uuid4().hex[:8]}",
                    "timestamp": now.isoformat(),
                    "action": "AGENT_UNAVAILABLE",
                    "description": f"Original Agent {original_agent_name} is unavailable (Status: {agent_curr_status.upper()}). Routing to available agent in pool '{pool_name}'.",
                    "actor": "Auto-Call Engine",
                    "actor_role": "System Scheduler",
                    "metadata": {
                        "original_agent_id": str(assigned_agent_id),
                        "original_agent_name": original_agent_name,
                        "status": agent_curr_status,
                        "pool_id": pool_id
                    }
                }
                await follow_ups_col.update_one(
                    {"_id": locked_fu["_id"]},
                    {"$push": {"timeline": {"$each": [unavail_timeline], "$position": 0}}}
                )

                # Find another available agent in the same pool
                fallback_agent = await find_available_pool_agent(
                    pool_id=pool_id,
                    exclude_agent_ids=[str(assigned_agent_id)] if assigned_agent_id else []
                )

                if fallback_agent:
                    # ── SUB-SCENARIO B1: Eligible Pool Agent Found ──
                    fallback_agent_id = str(fallback_agent["_id"])
                    fallback_agent_name = fallback_agent.get("name") or "Agent"
                    reassigned_count += 1

                    # Log Reassignment in timeline
                    reassign_timeline = {
                        "id": f"evt_{uuid.uuid4().hex[:8]}",
                        "timestamp": now.isoformat(),
                        "action": "FOLLOW_UP_REASSIGNED",
                        "description": f"Reassigned from {original_agent_name} to {fallback_agent_name} ({pool_name}) for instant callback",
                        "actor": "Auto-Call Engine",
                        "actor_role": "Pool Fallback Engine",
                        "metadata": {
                            "original_agent_id": str(assigned_agent_id),
                            "original_agent_name": original_agent_name,
                            "reassigned_agent_id": fallback_agent_id,
                            "reassigned_agent_name": fallback_agent_name,
                            "pool_id": pool_id
                        }
                    }

                    await follow_ups_col.update_one(
                        {"_id": locked_fu["_id"]},
                        {
                            "$set": {
                                "current_agent_id": fallback_agent_id,
                                "current_agent_name": fallback_agent_name,
                                "agent_id": fallback_agent_id,
                                "agent_name": fallback_agent_name,
                                "updated_at": now
                            },
                            "$push": {"timeline": {"$each": [reassign_timeline], "$position": 0}}
                        }
                    )

                    await ws_manager.broadcast_global({
                        "event": "FOLLOW_UP_REASSIGNED",
                        "type": "follow_up_reassigned",
                        "follow_up_id": fu_id,
                        "id": fu_id,
                        "customer_name": customer_name,
                        "original_agent_name": original_agent_name,
                        "reassigned_agent_name": fallback_agent_name,
                        "reassigned_agent_id": fallback_agent_id,
                        "pool_name": pool_name,
                        "timestamp": now_iso
                    })

                    # Dispatch auto-call to reassigned agent
                    await initiate_auto_callback_for_agent(locked_fu, fallback_agent, trigger_reason="Pool Fallback Routing")
                    calls_initiated += 1

                else:
                    # ── SUB-SCENARIO B2: No Agent in Pool Currently Available ──
                    waiting_count += 1
                    waiting_timeline = {
                        "id": f"evt_{uuid.uuid4().hex[:8]}",
                        "timestamp": now.isoformat(),
                        "action": "WAITING_FOR_AGENT",
                        "description": f"No agent currently available in pool '{pool_name}'. Queued for automatic retry upon agent readiness.",
                        "actor": "Auto-Call Engine",
                        "actor_role": "Queue Manager",
                        "metadata": {
                            "pool_id": pool_id,
                            "pool_name": pool_name
                        }
                    }

                    await follow_ups_col.update_one(
                        {"_id": locked_fu["_id"]},
                        {
                            "$set": {
                                "status": "waiting_for_agent",
                                "is_locked": False,
                                "lock_timestamp": None,
                                "updated_at": now
                            },
                            "$push": {"timeline": {"$each": [waiting_timeline], "$position": 0}}
                        }
                    )

                    await ws_manager.broadcast_global({
                        "event": "FOLLOW_UP_WAITING_FOR_AGENT",
                        "type": "follow_up_waiting_for_agent",
                        "follow_up_id": fu_id,
                        "id": fu_id,
                        "customer_name": customer_name,
                        "pool_name": pool_name,
                        "status": "waiting_for_agent",
                        "timestamp": now_iso
                    })
                    logger.info(f"[AUTO-CALL ENGINE] Follow-Up #{fu_id} placed in WAITING_FOR_AGENT state (no agents ready in pool {pool_name}).")

    except Exception as e:
        logger.error(f"[AUTO-CALL ENGINE CRON ERROR] {e}")

    return {
        "calls_initiated": calls_initiated,
        "reassigned_count": reassigned_count,
        "waiting_count": waiting_count
    }


async def evaluate_follow_ups() -> Dict[str, int]:
    """
    Evaluates follow-up deadlines and transitions:
    1. Triggers Scheduled Auto-Calls via process_scheduled_auto_calls()
    2. Transitions 'due' / 'waiting_for_agent' -> 'missed' when grace period has expired without completion.
    """
    now = utcnow()
    now_iso = now.isoformat()
    now_epoch = int(now.timestamp() * 1000)

    # 1. Run Auto-Call Engine
    auto_call_res = await process_scheduled_auto_calls()

    marked_missed = 0
    try:
        # 2. Check for overdue follow-ups that passed grace period without completion
        missed_cutoff = now - timedelta(minutes=MISSED_GRACE_MINUTES)
        overdue_cursor = follow_ups_col.find({
            "status": {"$in": ["due", "waiting_for_agent"]},
            "follow_up_datetime": {"$lt": missed_cutoff}
        })
        overdue_list = await overdue_cursor.to_list(length=100)

        for fu in overdue_list:
            fu_id = str(fu["_id"])
            customer_name = fu.get("customer_name", "Customer")
            customer_phone = fu.get("customer_phone", "")
            agent_id = str(fu.get("current_agent_id") or fu.get("agent_id") or "")

            missed_timeline = {
                "id": f"evt_{uuid.uuid4().hex[:8]}",
                "timestamp": now_iso,
                "action": "FOLLOW_UP_MISSED",
                "description": f"Follow-up passed {MISSED_GRACE_MINUTES} min grace period without successful callback completion",
                "actor": "Follow-Up Monitor",
                "actor_role": "SLA Engine",
                "metadata": {}
            }

            await follow_ups_col.update_one(
                {"_id": fu["_id"]},
                {
                    "$set": {
                        "status": "missed",
                        "missed_at": now,
                        "updated_at": now
                    },
                    "$push": {"timeline": {"$each": [missed_timeline], "$position": 0}}
                }
            )
            marked_missed += 1

            await ws_manager.broadcast_global({
                "event": "FOLLOW_UP_MISSED",
                "type": "follow_up_missed",
                "follow_up_id": fu_id,
                "id": fu_id,
                "customer_name": customer_name,
                "customer_phone": customer_phone,
                "agent_id": agent_id,
                "status": "missed",
                "timestamp": now_iso,
                "serverTimestamp": now_epoch
            })

    except Exception as e:
        logger.error(f"[FOLLOW-UP MONITOR ERROR] {e}")

    return {
        "calls_initiated": auto_call_res.get("calls_initiated", 0),
        "reassigned_count": auto_call_res.get("reassigned_count", 0),
        "waiting_count": auto_call_res.get("waiting_count", 0),
        "marked_missed": marked_missed
    }


async def auto_link_follow_up_on_call_completed(
    call_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    phone: Optional[str] = None,
    lead_id: Optional[str] = None,
    outcome: str = "completed",
    notes: Optional[str] = None,
    duration_seconds: Optional[int] = None,
    call_duration: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """
    When a call completes with a final outcome (e.g. interested, converted, not_interested, dnc),
    marks the linked active follow-up as COMPLETED.
    Never marks future scheduled follow-ups as completed, and never treats 'call_back' as a completion.
    """
    if outcome.lower() in ("call_back", "follow_up_required", "follow_up", "wrap_up", "live", "ringing"):
        return None

    if not phone and not lead_id and not call_id:
        return None

    duration = duration_seconds if duration_seconds is not None else call_duration

    now = utcnow()
    clean_p = normalize_phone(phone) if phone else ""
    raw_digits = "".join(filter(str.isdigit, clean_p))[-10:] if clean_p else ""

    # Priority 1: Check by direct related_call_id if that follow-up was actively triggered for this call
    matching_fu = None
    if call_id:
        matching_fu = await follow_ups_col.find_one({
            "related_call_id": str(call_id),
            "status": {"$in": ["ringing", "auto_calling", "connected", "due", "waiting_for_agent", "in_call", "wrap_up"]}
        })

    # Priority 2: Check for currently due / active follow-ups for this lead or phone (NEVER future scheduled)
    if not matching_fu:
        query: Dict[str, Any] = {
            "status": {"$in": ["due", "waiting_for_agent", "ringing", "auto_calling", "connected", "in_call", "wrap_up", "no_answer", "missed"]},
            "follow_up_datetime": {"$lte": now + timedelta(minutes=5)}
        }
        or_conditions = []
        if lead_id and ObjectId.is_valid(lead_id):
            or_conditions.append({"lead_id": str(lead_id)})
            or_conditions.append({"customer_id": str(lead_id)})
        if clean_p:
            or_conditions.append({"customer_phone": clean_p})
        if raw_digits:
            or_conditions.append({"customer_phone": {"$regex": raw_digits}})

        if or_conditions:
            query["$or"] = or_conditions
            if agent_id:
                query["$or"].append({"agent_id": agent_id})
            matching_fu = await follow_ups_col.find_one(query, sort=[("follow_up_datetime", 1)])

    if matching_fu:
        fu_id = str(matching_fu["_id"])
        completed_timeline = {
            "id": f"evt_{uuid.uuid4().hex[:8]}",
            "timestamp": now.isoformat(),
            "action": "FOLLOW_UP_COMPLETED",
            "description": f"Follow-up successfully completed via Call #{str(call_id)[-6:].upper()} (Outcome: {outcome.replace('_', ' ').upper()})",
            "actor": "Call Engine",
            "actor_role": "Agent Wrap-Up",
            "metadata": {
                "call_id": str(call_id),
                "outcome": outcome,
                "notes": notes or ""
            }
        }

        update_data = {
            "status": "completed",
            "completed_at": now,
            "related_call_id": str(call_id),
            "completion_outcome": outcome,
            "completion_notes": notes or matching_fu.get("notes", ""),
            "updated_at": now
        }
        if duration is not None:
            update_data["call_duration"] = duration
            completed_timeline["metadata"]["duration_seconds"] = duration

        await follow_ups_col.update_one(
            {"_id": matching_fu["_id"]},
            {
                "$set": update_data,
                "$push": {"timeline": {"$each": [completed_timeline], "$position": 0}}
            }
        )

        await ws_manager.broadcast_global({
            "event": "FOLLOW_UP_COMPLETED",
            "type": "follow_up_completed",
            "follow_up_id": fu_id,
            "id": fu_id,
            "related_call_id": str(call_id),
            "agent_id": agent_id,
            "customer_phone": matching_fu.get("customer_phone"),
            "status": "completed",
            "outcome": outcome,
            "timestamp": now.isoformat()
        })
        logger.info(f"[FOLLOW-UP LINK] Linked call #{call_id} to Follow-Up #{fu_id} and marked COMPLETED")
        return {**matching_fu, **update_data, "id": fu_id}

    return None


async def start_periodic_follow_up_job():
    """Background engine loop evaluating follow-up deadlines & scheduled auto-calls every 5 seconds."""
    logger.info("[FOLLOW-UP ENGINE] Background scheduler worker started (5s interval).")
    while True:
        try:
            await asyncio.sleep(5)
            await evaluate_follow_ups()
        except asyncio.CancelledError:
            logger.info("[FOLLOW-UP ENGINE] Background scheduler worker stopped.")
            break
        except Exception as e:
            logger.error(f"[FOLLOW-UP ENGINE WORKER ERROR] {e}")
            await asyncio.sleep(5)
