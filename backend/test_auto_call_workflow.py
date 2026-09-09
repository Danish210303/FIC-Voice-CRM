import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import users_col, leads_col, follow_ups_col, calls_col
from app.services.follow_up_service import (
    create_or_update_lead_follow_up,
    process_scheduled_auto_calls,
    initiate_auto_callback_for_agent,
    record_follow_up_timeline_event,
    auto_link_follow_up_on_call_completed
)

async def test_full_auto_call_workflow():
    print("Database connected.")
    ts = int(datetime.now().timestamp())

    # 1. Setup Test Agents and Pool
    pool_id = f"test_pool_{ts}"
    pool_name = "Banking Inbound VIP"
    
    agent_1_oid = ObjectId()
    agent_2_oid = ObjectId()

    # Agent 1 is busy/offline
    await users_col.insert_one({
        "_id": agent_1_oid,
        "name": "Sarah Connor",
        "email": f"sarah_{ts}@forge.test",
        "status": "offline",
        "is_active": True,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "created_at": datetime.now(timezone.utc)
    })

    # Agent 2 is ready/online
    await users_col.insert_one({
        "_id": agent_2_oid,
        "name": "John Matrix",
        "email": f"john_{ts}@forge.test",
        "status": "ready",
        "is_active": True,
        "pool_id": pool_id,
        "pool_name": pool_name,
        "created_at": datetime.now(timezone.utc)
    })

    print("Setup test agents (Agent 1: offline, Agent 2: ready).")

    # 2. Create Lead
    lead_oid = ObjectId()
    await leads_col.insert_one({
        "_id": lead_oid,
        "name": "Alexander Pierce",
        "phone": "+919876543210",
        "assigned_agent_id": str(agent_1_oid),
        "assigned_agent_name": "Sarah Connor",
        "pool_id": pool_id,
        "pool_name": pool_name,
        "created_at": datetime.now(timezone.utc)
    })

    # 3. Create Follow-Up scheduled for 2 minutes ago (so it is immediately due)
    past_due_dt = (datetime.now(timezone.utc) - timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M")
    fu_doc = await create_or_update_lead_follow_up(
        lead_id=str(lead_oid),
        phone="+919876543210",
        agent_id=str(agent_1_oid),
        follow_up_time_str=past_due_dt,
        reason="Follow up on Term Deposit rate",
        notes="Customer asked for rate comparison at 2 PM",
        related_call_id=f"orig_call_{ts}"
    )

    assert fu_doc is not None, "Follow-up document must be created"
    fu_id = str(fu_doc["_id"])
    print(f"Created Follow-Up: {fu_id} with scheduled_at={past_due_dt}")

    # Verify initial fields
    assert fu_doc["original_agent_name"] == "Sarah Connor"
    assert fu_doc["current_agent_name"] == "Sarah Connor"
    assert len(fu_doc.get("timeline", [])) >= 1

    # 4. Trigger Scheduler Evaluation
    print("Running process_scheduled_auto_calls()...")
    await process_scheduled_auto_calls()

    # 5. Verify Fallback Reassignment & Auto-Call Initiation
    updated_fu = await follow_ups_col.find_one({"_id": ObjectId(fu_id)})
    assert updated_fu is not None

    print(f"Status after scheduler: {updated_fu.get('status')}")
    print(f"Current Agent: {updated_fu.get('current_agent_name')} (ID: {updated_fu.get('current_agent_id')})")
    print(f"Related Call ID: {updated_fu.get('related_call_id')}")

    # Because Agent 1 was offline, Agent 2 was available in the same pool!
    assert updated_fu.get("current_agent_id") == str(agent_2_oid), f"Expected agent_2 ({agent_2_oid}), got {updated_fu.get('current_agent_id')}"
    assert updated_fu.get("status") == "auto_calling"
    assert updated_fu.get("related_call_id") is not None

    # Check timeline events
    timeline = updated_fu.get("timeline", [])
    actions = [t.get("action") for t in timeline]
    print(f"Timeline actions recorded: {actions}")
    assert any("FALLBACK" in a or "AUTO_CALL" in a or "AGENT" in a for a in actions)

    # 6. Simulate Call Completion
    call_id = updated_fu.get("related_call_id")
    print(f"Simulating call completion for call {call_id}...")
    await auto_link_follow_up_on_call_completed(
        call_id=call_id,
        outcome="Interested - Deposit Booked",
        duration_seconds=185,
        notes="Customer agreed to 1-year FD at 7.5%"
    )

    # Verify Follow-up is Completed
    completed_fu = await follow_ups_col.find_one({"_id": ObjectId(fu_id)})
    assert completed_fu.get("status") == "completed", f"Expected completed, got {completed_fu.get('status')}"
    assert completed_fu.get("completion_outcome") == "Interested - Deposit Booked"
    assert completed_fu.get("call_duration") == 185
    print("Follow-up successfully completed and linked!")

    # 7. Clean up
    await follow_ups_col.delete_one({"_id": ObjectId(fu_id)})
    await leads_col.delete_one({"_id": lead_oid})
    await users_col.delete_one({"_id": agent_1_oid})
    await users_col.delete_one({"_id": agent_2_oid})
    if call_id:
        await calls_col.delete_one({"_id": call_id})
    print("ALL TESTS PASSED SUCCESSFULLY! Cleaned up test records.")

if __name__ == "__main__":
    asyncio.run(test_full_auto_call_workflow())
