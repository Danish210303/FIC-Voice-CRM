import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from bson import ObjectId

from app.core.database import follow_ups_col, leads_col, users_col, calls_col, pools_col, notifications_col, audit_logs_col
from app.core.utils import utcnow, oid_str, normalize_phone
from app.services.ws_manager import ws_manager

logger = logging.getLogger("uvicorn.error")

MISSED_GRACE_MINUTES = 30  # Grace window before marking a due follow-up as MISSED


def parse_datetime_to_utc(dt_val: Any) -> datetime:
    """Safely converts string, ISO format, or datetime object into UTC datetime."""
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=timezone.utc)
        return dt_val.astimezone(timezone.utc)
    
    if not dt_val:
        return utcnow()
    
    s = str(dt_val).strip()
    try:
        # Try ISO 8601 with or without Z/offset
        clean_s = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    
    # Try YYYY-MM-DD HH:MM / YYYY-MM-DD HH:MM:SS
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
            
    return utcnow()


async def evaluate_follow_ups() -> Dict[str, int]:
    """
    Evaluates all active follow-up reminders:
    1. Transitions 'scheduled' -> 'due' when scheduled time has arrived.
    2. Transitions 'due' -> 'missed' when grace period has expired without completion.
    """
    now = utcnow()
    now_iso = now.isoformat()
    now_epoch = int(now.timestamp() * 1000)

    marked_due = 0
    marked_missed = 0

    try:
        # Find all pending scheduled or due follow-ups
        cursor = follow_ups_col.find({
            "status": {"$in": ["scheduled", "due"]}
        })
        pending_list = await cursor.to_list(length=1000)

        for fu in pending_list:
            fu_id = str(fu["_id"])
            status = fu.get("status", "scheduled")
            sched_dt = parse_datetime_to_utc(fu.get("follow_up_datetime"))
            agent_id = str(fu.get("agent_id") or "")
            customer_phone = fu.get("customer_phone", "")
            customer_name = fu.get("customer_name", "Customer")
            pool_id = str(fu.get("pool_id") or "")

            # 1. Transition scheduled -> due
            if status == "scheduled" and sched_dt <= now:
                await follow_ups_col.update_one(
                    {"_id": fu["_id"]},
                    {"$set": {
                        "status": "due",
                        "due_at": now,
                        "updated_at": now
                    }}
                )
                marked_due += 1

                # Broadcast realtime DUE event
                payload = {
                    "event": "FOLLOW_UP_DUE",
                    "type": "follow_up_due",
                    "follow_up_id": fu_id,
                    "id": fu_id,
                    "customer_id": str(fu.get("customer_id") or fu.get("lead_id") or ""),
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "agent_id": agent_id,
                    "pool_id": pool_id,
                    "reason": fu.get("reason", "Follow-Up Scheduled"),
                    "scheduled_datetime": sched_dt.isoformat(),
                    "status": "due",
                    "timestamp": now_iso,
                    "serverTimestamp": now_epoch
                }
                await ws_manager.broadcast_global(payload)

                # Create in-app notification for agent
                if agent_id:
                    try:
                        await notifications_col.insert_one({
                            "user_id": agent_id,
                            "type": "follow_up_due",
                            "title": "Follow-Up Reminder Due Now",
                            "message": f"Follow-up with {customer_name} ({customer_phone}) is due right now.",
                            "follow_up_id": fu_id,
                            "is_read": False,
                            "created_at": now
                        })
                    except Exception:
                        pass

            # 2. Transition due (or overdue scheduled) -> missed
            elif sched_dt + timedelta(minutes=MISSED_GRACE_MINUTES) < now:
                await follow_ups_col.update_one(
                    {"_id": fu["_id"]},
                    {"$set": {
                        "status": "missed",
                        "missed_at": now,
                        "updated_at": now
                    }}
                )
                marked_missed += 1

                # Broadcast realtime MISSED event
                payload = {
                    "event": "FOLLOW_UP_MISSED",
                    "type": "follow_up_missed",
                    "follow_up_id": fu_id,
                    "id": fu_id,
                    "customer_id": str(fu.get("customer_id") or fu.get("lead_id") or ""),
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "agent_id": agent_id,
                    "pool_id": pool_id,
                    "reason": fu.get("reason", "Follow-Up Overdue"),
                    "scheduled_datetime": sched_dt.isoformat(),
                    "status": "missed",
                    "timestamp": now_iso,
                    "serverTimestamp": now_epoch
                }
                await ws_manager.broadcast_global(payload)

                try:
                    await audit_logs_col.insert_one({
                        "action": "FOLLOW_UP_MISSED",
                        "follow_up_id": fu_id,
                        "agent_id": agent_id,
                        "customer_phone": customer_phone,
                        "notes": f"Follow-up not completed within {MISSED_GRACE_MINUTES} min grace period",
                        "created_at": now
                    })
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"[FOLLOW-UP CRON ERROR] {e}")

    return {"marked_due": marked_due, "marked_missed": marked_missed}


async def auto_link_follow_up_on_call_completed(
    call_id: str,
    agent_id: str,
    phone: str,
    lead_id: Optional[str] = None,
    outcome: str = "completed",
    notes: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    When an agent completes a call, checks if there is an active/due/scheduled follow-up
    for this customer/agent. If found, links the call and marks it completed.
    """
    if not phone and not lead_id:
        return None

    now = utcnow()
    clean_p = normalize_phone(phone) if phone else ""
    raw_digits = "".join(filter(str.isdigit, clean_p))[-10:] if clean_p else ""

    query: Dict[str, Any] = {
        "status": {"$in": ["scheduled", "due", "missed"]},
    }

    or_conditions = []
    if lead_id and ObjectId.is_valid(lead_id):
        or_conditions.append({"lead_id": str(lead_id)})
        or_conditions.append({"customer_id": str(lead_id)})
    if clean_p:
        or_conditions.append({"customer_phone": clean_p})
    if raw_digits:
        or_conditions.append({"customer_phone": {"$regex": raw_digits}})

    if not or_conditions:
        return None

    query["$or"] = or_conditions
    if agent_id:
        query["agent_id"] = agent_id

    try:
        # Find closest pending follow-up
        matching_fu = await follow_ups_col.find_one(query, sort=[("follow_up_datetime", 1)])
        if matching_fu:
            fu_id = str(matching_fu["_id"])
            update_data = {
                "status": "completed",
                "completed_at": now,
                "related_call_id": str(call_id),
                "completion_outcome": outcome,
                "completion_notes": notes or matching_fu.get("notes", ""),
                "updated_at": now
            }
            await follow_ups_col.update_one({"_id": matching_fu["_id"]}, {"$set": update_data})

            # Broadcast completion
            await ws_manager.broadcast_global({
                "event": "FOLLOW_UP_COMPLETED",
                "type": "follow_up_completed",
                "follow_up_id": fu_id,
                "id": fu_id,
                "related_call_id": str(call_id),
                "agent_id": agent_id,
                "customer_phone": matching_fu.get("customer_phone"),
                "status": "completed",
                "timestamp": now.isoformat()
            })
            logger.info(f"[FOLLOW-UP LINK] Linked call #{call_id} to follow-up #{fu_id} and marked COMPLETED")
            return {**matching_fu, **update_data, "id": fu_id}
    except Exception as e:
        logger.warning(f"[FOLLOW-UP AUTO LINK WARNING] {e}")

    return None


async def start_periodic_follow_up_job():
    """Background loop that evaluates follow-up due/missed status every 15 seconds."""
    while True:
        try:
            await asyncio.sleep(15)
            await evaluate_follow_ups()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[FOLLOW-UP CRON RUNTIME ERROR] {e}")
            await asyncio.sleep(15)
