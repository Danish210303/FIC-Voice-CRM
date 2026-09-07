import asyncio
import os
import sys
from bson import ObjectId
from httpx import AsyncClient, ASGITransport

# Set env if needed
os.environ["MONGO_DB_NAME"] = os.environ.get("MONGO_DB_NAME", "forge_crm")

from app.main import app
from app.core.database import users_col, leads_col, calls_col, recordings_col, audit_logs_col, pools_col
from app.core.security import hash_password
from app.core.utils import utcnow, gen_employee_id

def log(msg):
    print(f"[TEST RECORDINGS] {msg}")

async def ensure_seeded():
    # Ensure pools
    for p in ["recruitment", "credit_card_sales", "customer_support"]:
        if not await pools_col.find_one({"name": p}):
            await pools_col.insert_one({"name": p, "description": f"{p} pool", "created_at": utcnow()})
    
    # Ensure admin
    admin = await users_col.find_one({"email": "admin@forgeindia.com"})
    if not admin:
        await users_col.insert_one({
            "name": "Admin User",
            "email": "admin@forgeindia.com",
            "password": hash_password("Admin@123"),
            "role": "admin",
            "is_active": True,
            "employee_id": gen_employee_id("admin"),
            "created_at": utcnow()
        })
    else:
        await users_col.update_one({"_id": admin["_id"]}, {"$set": {"password": hash_password("Admin@123"), "is_active": True, "locked_until": None, "failed_attempts": 0}})

    # Ensure agent
    agent = await users_col.find_one({"email": "agent@forgeindia.com"})
    if not agent:
        await users_col.insert_one({
            "name": "Agent Ramesh",
            "email": "agent@forgeindia.com",
            "password": hash_password("Agent@123"),
            "role": "agent",
            "pool_id": "customer_support",
            "is_active": True,
            "employee_id": gen_employee_id("agent"),
            "created_at": utcnow()
        })
    else:
        await users_col.update_one({"_id": agent["_id"]}, {"$set": {"password": hash_password("Agent@123"), "is_active": True, "locked_until": None, "failed_attempts": 0}})


async def run_tests():
    log("=== STARTING DIRECT ASYNC RECORDINGS SYSTEM TESTS ===")
    await ensure_seeded()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login Admin
        log("1. Authenticating as Admin...")
        login_res = await client.post("/api/auth/login", json={"email": "admin@forgeindia.com", "password": "Admin@123"})
        if login_res.status_code != 200:
            log(f"Admin login failed: {login_res.status_code} {login_res.text}")
            return
        admin_token = login_res.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        log("Admin authenticated successfully.")

        # 2. Login Agent
        log("2. Authenticating as Agent...")
        agent_login_res = await client.post("/api/auth/login", json={"email": "agent@forgeindia.com", "password": "Agent@123"})
        if agent_login_res.status_code != 200:
            log(f"Agent login failed: {agent_login_res.status_code} {agent_login_res.text}")
            return
        agent_token = agent_login_res.json()["access_token"]
        agent_headers = {"Authorization": f"Bearer {agent_token}"}
        log("Agent authenticated successfully.")

        # 3. GET /api/recordings/stats
        log("3. Testing GET /api/recordings/stats...")
        stats_res = await client.get("/api/recordings/stats", headers=admin_headers)
        assert stats_res.status_code == 200, f"Stats failed: {stats_res.text}"
        stats = stats_res.json()
        log(f"Stats: Total={stats.get('total_recordings')}, Ready={stats.get('ready_count')}, Size={stats.get('total_size_mb')} MB")

        # 4. Fetch or create a lead
        leads_res = await client.get("/api/leads?limit=1", headers=agent_headers)
        leads_data = leads_res.json()
        if leads_data.get("items") and len(leads_data["items"]) > 0:
            lead_id = leads_data["items"][0]["id"]
        else:
            create_lead = await client.post("/api/leads", json={
                "name": "Alex Morgan",
                "phone": "+919876501234",
                "pool_id": "credit_card_sales",
                "status": "new"
            }, headers=admin_headers)
            lead_id = create_lead.json().get("id") or str(create_lead.json().get("_id"))
        log(f"Using Lead ID: {lead_id}")

        # 5. Start call -> verify recording document in RECORDING state
        log("5. Testing call start -> handle_call_recording_start...")
        await client.post("/api/presence/status", json={"status": "ready"}, headers=agent_headers)
        start_res = await client.post("/api/calls/start", json={
            "lead_id": str(lead_id),
            "direction": "outbound"
        }, headers=agent_headers)
        assert start_res.status_code == 200, f"Call start failed: {start_res.text}"
        call_id = start_res.json().get("id") or start_res.json().get("_id")
        log(f"Started Call ID: {call_id}")

        # Verify initial recording state
        rec_res = await client.get(f"/api/recordings/{call_id}", headers=admin_headers)
        assert rec_res.status_code == 200, f"Recording not created: {rec_res.text}"
        rec_data = rec_res.json()
        assert rec_data.get("status") in ("RECORDING", "READY"), f"Unexpected status: {rec_data.get('status')}"
        assert rec_data.get("masked_phone"), "Masked phone missing"
        log(f"Verified recording initialized: Status={rec_data.get('status')}, MaskedPhone={rec_data.get('masked_phone')}")

        # 6. End and dispose call -> verify status -> READY and audio file in storage
        log("6. Testing call disposition -> stores audio file & updates status to READY...")
        disp_res = await client.post(f"/api/calls/{call_id}/disposition", json={
            "disposition": "interested",
            "notes": "Customer agreed for demo on Monday.",
            "rating": 5
        }, headers=agent_headers)
        assert disp_res.status_code == 200, f"Disposition failed: {disp_res.text}"

        rec_ready_res = await client.get(f"/api/recordings/{call_id}", headers=admin_headers)
        assert rec_ready_res.status_code == 200, f"Recording fetch failed: {rec_ready_res.text}"
        rec_ready = rec_ready_res.json()
        assert rec_ready.get("status") == "READY", f"Expected READY, got {rec_ready.get('status')}"
        assert rec_ready.get("filename"), "Filename missing"
        assert rec_ready.get("checksum_sha256"), "Checksum missing"
        assert rec_ready.get("file_size_bytes", 0) > 0, "File size is 0"
        log(f"Verified READY recording: File={rec_ready.get('filename')}, Size={rec_ready.get('file_size_bytes')} bytes, Checksum={rec_ready.get('checksum_sha256')[:16]}...")

        # 7. Test Streaming Endpoint (HTTP 200 full and HTTP 206 Partial Content)
        rec_id = str(rec_ready.get("_id") or rec_ready.get("id"))
        log(f"7a. Testing full range stream on /api/recordings/{rec_id}/stream...")
        stream_full = await client.get(f"/api/recordings/{rec_id}/stream", headers=admin_headers)
        assert stream_full.status_code == 200, f"Full stream failed: {stream_full.status_code}"
        assert len(stream_full.content) == rec_ready.get("file_size_bytes")
        assert stream_full.headers.get("accept-ranges") == "bytes"
        log(f"Full stream verified ({len(stream_full.content)} bytes).")

        log(f"7b. Testing Range request (bytes=0-49)...")
        stream_range = await client.get(f"/api/recordings/{rec_id}/stream", headers={**admin_headers, "Range": "bytes=0-49"})
        assert stream_range.status_code == 206, f"Expected 206, got {stream_range.status_code}"
        assert len(stream_range.content) == 50, f"Expected 50 bytes, got {len(stream_range.content)}"
        assert "bytes 0-49/" in stream_range.headers.get("content-range", "")
        log(f"HTTP 206 Partial Content verified: {stream_range.headers.get('content-range')}")

        log("7c. Testing query token stream authentication (HTML5 audio element)...")
        query_stream = await client.get(f"/api/recordings/{rec_id}/stream?token={admin_token}")
        assert query_stream.status_code == 200, f"Query token stream failed: {query_stream.status_code}"
        log("Query token stream authentication verified.")

        log("7d. Testing Cloudinary secure-playback access generation...")
        playback_res = await client.get(f"/api/recordings/{rec_id}/secure-playback", headers=admin_headers)
        assert playback_res.status_code == 200, f"Secure playback failed: {playback_res.text}"
        pb_data = playback_res.json()
        assert "signed_playback_url" in pb_data, "signed_playback_url missing"
        assert pb_data.get("status") == "READY", "Status should be READY"
        log(f"Secure playback verified: Provider={pb_data.get('storage_provider')}, URL={pb_data.get('signed_playback_url')}")

        # 8. Test Search & Filter Endpoints
        log("8. Testing Search & Filtering...")
        # Search by Call ID prefix
        s_res = await client.get(f"/api/recordings?q={call_id[:6]}", headers=admin_headers)
        assert s_res.status_code == 200 and s_res.json()["total"] >= 1
        log(f"Search query returned {s_res.json()['total']} matches.")

        # Filter by status=READY
        f_res = await client.get("/api/recordings?status_filter=READY", headers=admin_headers)
        assert f_res.status_code == 200
        for itm in f_res.json()["items"]:
            assert itm["status"] == "READY"
        log(f"Filter status=READY returned {len(f_res.json()['items'])} items.")

        # 9. Test Download & Audit Log
        log("9. Testing Secure Download & Audit Log...")
        dl_res = await client.get(f"/api/recordings/{rec_id}/download", headers=admin_headers)
        assert dl_res.status_code == 200
        assert "attachment" in dl_res.headers.get("content-disposition", "")
        log("Download verified.")

        # Verify audit log entry
        audit_entry = await audit_logs_col.find_one({"recording_id": rec_id, "action": "download_call_recording"})
        assert audit_entry is not None, "Download audit log missing!"
        log(f"Verified Audit Log entry: Action={audit_entry.get('action')}, User={audit_entry.get('user_name')}")

        # 10. Test Orphan Cleanup
        log("10. Testing Admin Orphan Cleanup...")
        clean_res = await client.post("/api/recordings/cleanup-orphans", headers=admin_headers)
        assert clean_res.status_code == 200 and clean_res.json()["status"] == "success"
        log(f"Orphan Cleanup verified: {clean_res.json()}")

        # 11. Test RBAC permissions
        log("11. Testing RBAC restrictions...")
        # Agent forbidden from downloading
        agent_dl = await client.get(f"/api/recordings/{rec_id}/download", headers=agent_headers)
        assert agent_dl.status_code == 403, f"Expected 403, got {agent_dl.status_code}"
        log("RBAC verified: Agent download denied (403 Forbidden).")

        # Unauthenticated stream denied
        unauth_stream = await client.get(f"/api/recordings/{rec_id}/stream")
        assert unauth_stream.status_code == 401, f"Expected 401, got {unauth_stream.status_code}"
        log("RBAC verified: Unauthenticated stream denied (401 Unauthorized).")

        log("=== ALL TESTS PASSED PROPERLY! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())
