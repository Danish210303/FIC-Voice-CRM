import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add backend root to python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.core.database import calls_col, recordings_col, users_col, audit_logs_col
from app.core.utils import utcnow
from app.services.cleanup_service import purge_expired_calls_and_recordings
from app.services.storage import storage_service


async def run_tests():
    print("=================================================================")
    print("   RUNNING COMPLETED SHIFT LOGS & RETENTION TESTS")
    print("=================================================================")

    now = utcnow()
    cutoff_26h = now - timedelta(hours=26)
    recent_2h = now - timedelta(hours=2)

    # 1. Setup Test Users
    agent = await users_col.find_one({"email": "agent@forgeindia.com"})
    admin = await users_col.find_one({"email": "admin@forgeindia.com"})

    if not agent:
        agent_res = await users_col.insert_one({
            "name": "Ramesh Kumar (Sales Agent)",
            "email": "agent@forgeindia.com",
            "role": "agent",
            "employee_id": "AGT-8472",
            "is_active": True,
            "created_at": now
        })
        agent_id = str(agent_res.inserted_id)
    else:
        agent_id = str(agent["_id"])

    if not admin:
        admin_res = await users_col.insert_one({
            "name": "System Administrator",
            "email": "admin@forgeindia.com",
            "role": "admin",
            "employee_id": "ADM-001",
            "is_active": True,
            "created_at": now
        })
        admin_id = str(admin_res.inserted_id)
    else:
        admin_id = str(admin["_id"])

    print(f"[*] Verified test users -> Agent ID: {agent_id}, Admin ID: {admin_id}")

    # 2. Create Dummy Audio Files
    test_old_audio_filename, test_old_path, _, _ = await storage_service.save_audio_bytes(
        call_id="test_old_call_26h",
        audio_bytes=b"RIFFdummywavdataold26hours",
        extension="wav"
    )
    test_recent_audio_filename, test_recent_path, _, _ = await storage_service.save_audio_bytes(
        call_id="test_recent_call_2h",
        audio_bytes=b"RIFFdummywavdatarecent2hours",
        extension="wav"
    )

    assert os.path.exists(test_old_path), "Old test audio file must exist on disk"
    assert os.path.exists(test_recent_path), "Recent test audio file must exist on disk"
    print(f"[*] Created local test audio files: {test_old_audio_filename}, {test_recent_audio_filename}")

    # 3. Insert Test Calls
    # Call 1: Expired (26h old)
    old_call_doc = {
        "lead_id": "LD_TEST_OLD",
        "phone": "+919876543210",
        "agent_id": agent_id,
        "pool_id": "banking_customer_care",
        "direction": "outbound",
        "status": "completed",
        "outcome": "completed",
        "duration_seconds": 120,
        "started_at": cutoff_26h,
        "ended_at": cutoff_26h + timedelta(seconds=120),
        "created_at": cutoff_26h,
        "recording_file": test_old_audio_filename,
        "storage_path": test_old_path,
        "public_id": "fic_voice_recordings/test_rec_old_26h"
    }
    old_call_res = await calls_col.insert_one(old_call_doc)
    old_call_id = str(old_call_res.inserted_id)

    # Recording doc for Call 1
    await recordings_col.insert_one({
        "call_id": old_call_id,
        "agent_id": agent_id,
        "filename": test_old_audio_filename,
        "storage_path": test_old_path,
        "public_id": "fic_voice_recordings/test_rec_old_26h",
        "status": "READY",
        "created_at": cutoff_26h.isoformat()
    })

    # Call 2: Recent Agent Call (2h old)
    recent_agent_call_doc = {
        "lead_id": "LD_TEST_RECENT_AGT",
        "phone": "+919876543211",
        "agent_id": agent_id,
        "pool_id": "banking_customer_care",
        "direction": "inbound",
        "status": "completed",
        "outcome": "completed",
        "duration_seconds": 85,
        "started_at": recent_2h,
        "ended_at": recent_2h + timedelta(seconds=85),
        "created_at": recent_2h,
        "recording_file": test_recent_audio_filename,
        "storage_path": test_recent_path,
        "public_id": "fic_voice_recordings/test_rec_recent_2h"
    }
    recent_agent_res = await calls_col.insert_one(recent_agent_call_doc)
    recent_agent_call_id = str(recent_agent_res.inserted_id)

    # Recording doc for Call 2
    await recordings_col.insert_one({
        "call_id": recent_agent_call_id,
        "agent_id": agent_id,
        "filename": test_recent_audio_filename,
        "storage_path": test_recent_path,
        "public_id": "fic_voice_recordings/test_rec_recent_2h",
        "status": "READY",
        "created_at": recent_2h.isoformat()
    })

    # Call 3: Recent Admin Call (2h old)
    recent_admin_call_doc = {
        "lead_id": "LD_TEST_RECENT_ADM",
        "phone": "+919876543212",
        "agent_id": admin_id,
        "pool_id": "banking_customer_care",
        "direction": "outbound",
        "status": "completed",
        "outcome": "qualified",
        "duration_seconds": 45,
        "started_at": recent_2h,
        "ended_at": recent_2h + timedelta(seconds=45),
        "created_at": recent_2h
    }
    recent_admin_res = await calls_col.insert_one(recent_admin_call_doc)
    recent_admin_call_id = str(recent_admin_res.inserted_id)

    print(f"[*] Inserted test calls: Old={old_call_id}, RecentAgent={recent_agent_call_id}, RecentAdmin={recent_admin_call_id}")

    # 4. Test list_calls endpoint logic for Agent Attribution & Role-based Scoping
    from app.routes.calls import list_calls

    # Admin view test:
    admin_user = {"_id": admin_id, "id": admin_id, "role": "admin"}
    admin_calls = await list_calls(user=admin_user, status_filter="completed")
    admin_call_ids = [c["id"] for c in admin_calls]
    assert recent_agent_call_id in admin_call_ids, "Admin must see Agent's completed shift log"
    assert recent_admin_call_id in admin_call_ids, "Admin must see Admin's completed shift log"

    # Verify agent name attribution
    agent_call_item = next(c for c in admin_calls if c["id"] == recent_agent_call_id)
    assert agent_call_item.get("agent_name"), "agent_name must be populated"
    assert agent_call_item["agent_name"] != agent_id, "agent_name must not be a raw MongoDB ObjectId"
    print(f"[PASSED] Admin sees all logs & agent attribution is '{agent_call_item['agent_name']}'")

    # Agent view test:
    agent_user = {"_id": agent_id, "id": agent_id, "role": "agent"}
    agent_calls = await list_calls(user=agent_user, status_filter="completed")
    agent_call_ids = [c["id"] for c in agent_calls]
    assert recent_agent_call_id in agent_call_ids, "Agent must see own completed call"
    assert recent_admin_call_id not in agent_call_ids, "Agent MUST NOT see other agents' completed logs"
    print("[PASSED] Agent only sees their own completed shift logs (RBAC verified)")

    # 5. Test 24-Hour Expiration & Asset Cleanup
    print("[*] Executing purge_expired_calls_and_recordings(retention_hours=24.0)...")
    cleanup_res = await purge_expired_calls_and_recordings(retention_hours=24.0)
    print(f"[*] Cleanup result: {cleanup_res}")

    assert cleanup_res["status"] == "success", "Cleanup job must report success"
    assert cleanup_res["deleted_calls"] >= 1, "Must have deleted at least 1 expired call"

    # Verify Old Call is DELETED from MongoDB
    db_old_call = await calls_col.find_one({"_id": old_call_res.inserted_id})
    assert db_old_call is None, "Old call (>24h) must be completely purged from calls_col"

    # Verify Old Call Recording is DELETED from MongoDB
    db_old_rec = await recordings_col.find_one({"call_id": old_call_id})
    assert db_old_rec is None, "Old recording (>24h) must be completely purged from recordings_col"

    # Verify Old Audio File is UNLINKED from disk
    assert not os.path.exists(test_old_path), "Old audio file must be deleted from local storage"

    # Verify Recent Calls (2h old) are PRESERVED
    db_recent_agent = await calls_col.find_one({"_id": recent_agent_res.inserted_id})
    assert db_recent_agent is not None, "Recent call (2h old) must NOT be deleted"
    db_recent_admin = await calls_col.find_one({"_id": recent_admin_res.inserted_id})
    assert db_recent_admin is not None, "Recent admin call (2h old) must NOT be deleted"
    assert os.path.exists(test_recent_path), "Recent audio file must NOT be deleted"

    # Verify Audit Log entry
    audit_entry = await audit_logs_col.find_one({"action": "auto_delete_expired_call_log", "call_id": old_call_id})
    assert audit_entry is not None, "Audit log entry must be recorded for retention cleanup"
    print("[PASSED] 24-hour expiration, audio file cleanup, and newer record protection verified")

    # Clean up test recent records
    await calls_col.delete_many({"_id": {"$in": [recent_agent_res.inserted_id, recent_admin_res.inserted_id]}})
    await recordings_col.delete_many({"call_id": recent_agent_call_id})
    if os.path.exists(test_recent_path):
        os.remove(test_recent_path)

    print("=================================================================")
    print("   ALL COMPLETED SHIFT LOGS TESTS PASSED PERFECTLY!")
    print("=================================================================")


if __name__ == "__main__":
    asyncio.run(run_tests())
