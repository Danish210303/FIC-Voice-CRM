import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import users_col, leads_col, follow_ups_col, calls_col
from app.core.utils import utcnow
from app.services.follow_up_service import (
    create_or_update_lead_follow_up,
    process_scheduled_auto_calls,
    initiate_auto_callback_for_agent,
    record_follow_up_timeline_event,
    auto_link_follow_up_on_call_completed,
    parse_datetime_to_utc,
    format_ist_datetime_str,
    utc_to_ist
)

async def run_end_to_end_follow_up_test():
    print("=" * 70)
    print("FIC AI VOICE CRM: END-TO-END FOLLOW-UP / CALLBACK VERIFICATION TEST")
    print("=" * 70)
    
    ts = int(datetime.now().timestamp())
    pool_id = f"test_pool_bpo_{ts}"
    pool_name = "Enterprise Inbound Priority"

    # Step 1: Create Test Agents (Agent 1: Assigned but Busy/Offline; Agent 2: Available/Ready)
    agent_1_id = ObjectId()
    agent_2_id = ObjectId()

    await users_col.insert_one({
        "_id": agent_1_id,
        "name": "Sarah Connor",
        "email": f"sarah_{ts}@bpo.test",
        "status": "offline",
        "is_active": True,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "created_at": utcnow()
    })

    await users_col.insert_one({
        "_id": agent_2_id,
        "name": "John Matrix",
        "email": f"john_{ts}@bpo.test",
        "status": "ready",
        "is_active": True,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "created_at": utcnow()
    })

    print(f"[PASS] Step 1: Created test agents (Agent 1: Offline, Agent 2: Ready in pool '{pool_name}')")

    # Step 2: Create Test Lead & Call Record
    lead_id = ObjectId()
    customer_phone = f"+91987{ts % 10000000:07d}"
    await leads_col.insert_one({
        "_id": lead_id,
        "name": "Arun Kumar",
        "phone": customer_phone,
        "assigned_agent_id": str(agent_1_id),
        "assigned_agent_name": "Sarah Connor",
        "pool_id": pool_id,
        "pool_name": pool_name,
        "status": "new",
        "created_at": utcnow()
    })

    call_id = ObjectId()
    await calls_col.insert_one({
        "_id": call_id,
        "lead_id": str(lead_id),
        "agent_id": str(agent_1_id),
        "agent_name": "Sarah Connor",
        "phone": customer_phone,
        "pool_id": pool_id,
        "status": "wrapup",
        "direction": "outbound",
        "started_at": utcnow() - timedelta(seconds=60),
        "ended_at": utcnow(),
        "created_at": utcnow()
    })

    print(f"[PASS] Step 2: Created test lead '{lead_id}' and call record '{call_id}'")

    # Step 3: Agent Selects 'Call Back' in Wrap-Up Panel -> Persist to DB with IST Timezone
    now_ist = utc_to_ist(utcnow())
    scheduled_dt_str = (utcnow() - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M") # Due now
    
    fu_result = await create_or_update_lead_follow_up(
        lead_id=str(lead_id),
        phone=customer_phone,
        agent_id=str(agent_1_id),
        follow_up_time_str=scheduled_dt_str,
        reason="Follow up for Commercial Loan Approval",
        notes="Customer requested callback regarding interest rates",
        current_user_id=str(agent_1_id),
        related_call_id=str(call_id),
        priority="high"
    )

    assert fu_result is not None, "Follow-up record creation failed"
    fu_id = str(fu_result["id"])
    print(f"[PASS] Step 3: Saved SCHEDULED callback '#{fu_id}' to MongoDB (Timezone: Asia/Kolkata)")
    print(f"   - Customer: {fu_result['customer_name']} ({fu_result['customer_phone']})")
    print(f"   - Assigned Agent: {fu_result['assigned_agent_name']}")
    print(f"   - Formatted IST: {format_ist_datetime_str(fu_result['scheduled_at'])}")

    # Step 4: Test Duplicate Prevention
    fu_dup_check = await create_or_update_lead_follow_up(
        lead_id=str(lead_id),
        phone=customer_phone,
        agent_id=str(agent_1_id),
        follow_up_time_str=scheduled_dt_str,
        reason="Updated Follow up notes",
        notes="Customer confirmed 10 AM slot",
        current_user_id=str(agent_1_id),
        related_call_id=str(call_id),
        priority="high"
    )
    assert str(fu_dup_check["id"]) == fu_id, "Duplicate follow-up was created instead of updating existing record!"
    
    fu_count = await follow_ups_col.count_documents({"lead_id": str(lead_id)})
    assert fu_count == 1, f"Expected 1 follow-up document, found {fu_count}"
    print(f"[PASS] Step 4: Duplicate prevention verified (Total records in DB for lead: {fu_count})")

    # Step 5: Run Background Scheduler Engine to Process Due Callbacks & Fallback to Pool Agent
    print("[PASS] Step 5: Executing process_scheduled_auto_calls() background scheduler...")
    proc_res = await process_scheduled_auto_calls()
    print(f"   - Scheduler output: {proc_res}")

    # Verify that Agent 1 (offline) triggered pool fallback routing to Agent 2 (ready)
    fu_after_sched = await follow_ups_col.find_one({"_id": ObjectId(fu_id)})
    assert fu_after_sched is not None
    assert fu_after_sched.get("status") == "auto_calling", f"Expected auto_calling, got {fu_after_sched.get('status')}"
    assert str(fu_after_sched.get("current_agent_id")) == str(agent_2_id), "Pool fallback did not route to available Agent 2"
    print(f"[PASS] Step 6: Fallback routing successful: Callback assigned to available Agent 2 ({fu_after_sched.get('current_agent_name')})")

    # Verify Timeline Events
    timeline = fu_after_sched.get("timeline", [])
    timeline_actions = [t.get("action") for t in timeline]
    print(f"   - Audit Timeline recorded {len(timeline)} events: {timeline_actions}")
    assert "AGENT_UNAVAILABLE" in timeline_actions, "Missing AGENT_UNAVAILABLE timeline event"
    assert "FOLLOW_UP_REASSIGNED" in timeline_actions, "Missing FOLLOW_UP_REASSIGNED timeline event"
    assert "AUTO_CALL_INITIATED" in timeline_actions, "Missing AUTO_CALL_INITIATED timeline event"

    # Step 7: Simulate Call Completion and Disposition Outcome
    callback_call_id = fu_after_sched.get("related_call_id")
    print(f"[PASS] Step 7: Completing callback call '{callback_call_id}' with disposition outcome...")
    
    comp_res = await auto_link_follow_up_on_call_completed(
        call_id=callback_call_id,
        agent_id=str(agent_2_id),
        phone=customer_phone,
        lead_id=str(lead_id),
        outcome="Converted",
        duration_seconds=142,
        notes="Loan agreement signed and initial deposit received."
    )
    assert comp_res is not None, "Call completion auto-linking failed"

    # Step 8: Verify Final Follow-Up State
    final_fu = await follow_ups_col.find_one({"_id": ObjectId(fu_id)})
    assert final_fu.get("status") == "completed", f"Expected status completed, got {final_fu.get('status')}"
    assert final_fu.get("completion_outcome") == "Converted"
    assert final_fu.get("call_duration") == 142
    print(f"[PASS] Step 8: Follow-up successfully marked COMPLETED (Outcome: Converted, Duration: 02:22)")

    # Step 9: Cleanup Test Artifacts
    await follow_ups_col.delete_one({"_id": ObjectId(fu_id)})
    await leads_col.delete_one({"_id": lead_id})
    await users_col.delete_one({"_id": agent_1_id})
    await users_col.delete_one({"_id": agent_2_id})
    await calls_col.delete_one({"_id": call_id})
    if callback_call_id and ObjectId.is_valid(callback_call_id):
        await calls_col.delete_one({"_id": ObjectId(callback_call_id)})

    print("=" * 70)
    print("ALL END-TO-END FOLLOW-UP / CALLBACK WORKFLOW TESTS PASSED 100%!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(run_end_to_end_follow_up_test())
