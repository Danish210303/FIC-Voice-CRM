import os
import sys
import json
import time
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8000"

def log(msg):
    print(f"[TEST RECORDINGS] {msg}")

def http_post(url, data_dict, token=None):
    data = json.dumps(data_dict).encode("utf-8") if data_dict is not None else b""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{url}", data=data, headers=headers)
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode("utf-8")), res.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body}
        return parsed, e.code

def http_get(url, token=None, headers_extra=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if headers_extra:
        headers.update(headers_extra)
    req = urllib.request.Request(f"{BASE_URL}{url}", headers=headers)
    try:
        res = urllib.request.urlopen(req)
        content_type = res.headers.get("Content-Type", "")
        if "json" in content_type:
            return json.loads(res.read().decode("utf-8")), res.status, res.headers
        else:
            return res.read(), res.status, res.headers
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception:
            parsed = body
        return parsed, e.code, e.headers


def run_tests():
    log("=== STARTING VOICE CALL RECORDING SYSTEM TEST SUITE ===")

    # 1. Login as Admin
    log("1. Authenticating as Admin (admin@forgeindia.com)...")
    login_res, status = http_post("/api/auth/login", {"email": "admin@forgeindia.com", "password": "Admin@123"})
    if status != 200 or "access_token" not in login_res:
        log(f"Admin login failed: {login_res}")
        sys.exit(1)
    admin_token = login_res["access_token"]
    log("Admin authenticated successfully.")

    # 2. Login as Agent
    log("2. Authenticating as Agent (agent@forgeindia.com)...")
    agent_login_res, status = http_post("/api/auth/login", {"email": "agent@forgeindia.com", "password": "Agent@123"})
    if status != 200 or "access_token" not in agent_login_res:
        log(f"Agent login failed: {agent_login_res}")
        sys.exit(1)
    agent_token = agent_login_res["access_token"]
    log("Agent authenticated successfully.")

    # 3. Check /api/recordings/stats
    log("3. Testing GET /api/recordings/stats...")
    stats, status, _ = http_get("/api/recordings/stats", admin_token)
    assert status == 200, f"Stats failed with status {status}"
    log(f"Stats: Total={stats.get('total_recordings')}, Ready={stats.get('ready_count')}, Storage={stats.get('total_size_mb')}MB")

    # 4. Fetch a lead to start a call
    log("4. Fetching a lead for call testing...")
    leads_res, status, _ = http_get("/api/leads?limit=1", agent_token)
    if not leads_res or not leads_res.get("items"):
        log("Creating a test lead for call...")
        lead_create_res, status = http_post("/api/leads", {
            "name": "Test Customer",
            "phone": "+919876543210",
            "pool_id": "customer_support",
            "status": "new"
        }, admin_token)
        lead_id = lead_create_res["id"] if "id" in lead_create_res else lead_create_res["_id"]
    else:
        lead_id = leads_res["items"][0]["id"]
    log(f"Target Lead ID: {lead_id}")

    # 5. Start a call as agent -> verify RECORDING state is created
    log("5. Testing POST /api/calls/start -> triggers handle_call_recording_start...")
    # First set agent to ready if needed
    http_post("/api/presence/status", {"status": "ready"}, agent_token)
    call_start_res, status = http_post("/api/calls/start", {
        "lead_id": str(lead_id),
        "direction": "outbound"
    }, agent_token)
    assert status == 200, f"Call start failed: {call_start_res}"
    call_id = call_start_res.get("id") or call_start_res.get("_id")
    log(f"Call started with ID: {call_id}")

    # Verify recording document exists in RECORDING state
    time.sleep(0.5)
    rec_detail, status, _ = http_get(f"/api/recordings/{call_id}", admin_token)
    assert status == 200, f"Recording not found for call_id {call_id}: {rec_detail}"
    assert rec_detail.get("status") in ("RECORDING", "READY"), f"Unexpected status: {rec_detail.get('status')}"
    assert rec_detail.get("masked_phone"), "Masked phone number missing!"
    log(f"Verified recording initialized: ID={rec_detail.get('_id')}, Status={rec_detail.get('status')}, MaskedPhone={rec_detail.get('masked_phone')}")

    # 6. End and dispose call -> verify audio stored to disk & state transition to READY
    log("6. Testing POST /api/calls/{call_id}/disposition -> completes recording and stores audio...")
    disp_res, status = http_post(f"/api/calls/{call_id}/disposition", {
        "disposition": "completed",
        "notes": "Customer interested in service. Recording saved securely.",
        "rating": 5
    }, agent_token)
    assert status == 200, f"Disposition failed: {disp_res}"
    log("Disposition recorded.")

    time.sleep(1)
    rec_ready, status, _ = http_get(f"/api/recordings/{call_id}", admin_token)
    assert status == 200, f"Recording lookup failed: {rec_ready}"
    assert rec_ready.get("status") == "READY", f"Expected READY, got {rec_ready.get('status')}"
    assert rec_ready.get("filename"), "Recording filename missing!"
    assert rec_ready.get("checksum_sha256"), "SHA256 checksum missing!"
    assert rec_ready.get("file_size_bytes", 0) > 0, "File size is 0!"
    log(f"Verified READY recording: File={rec_ready.get('filename')}, Size={rec_ready.get('file_size_bytes')} bytes, Checksum={rec_ready.get('checksum_sha256')[:16]}...")

    # 7. Test Range-Streaming Endpoint (/api/recordings/{id}/stream)
    log("7. Testing GET /api/recordings/{id}/stream (Full stream and HTTP 206 partial content)...")
    rec_id = str(rec_ready.get("_id") or rec_ready.get("id"))
    
    # 7a. Full stream
    audio_bytes, status, headers = http_get(f"/api/recordings/{rec_id}/stream", admin_token)
    assert status == 200, f"Stream full file failed with status {status}"
    assert len(audio_bytes) == rec_ready.get("file_size_bytes"), f"Size mismatch: {len(audio_bytes)} vs {rec_ready.get('file_size_bytes')}"
    log(f"Full stream successful ({len(audio_bytes)} bytes, Accept-Ranges={headers.get('Accept-Ranges')}).")

    # 7b. Range stream (bytes=0-99)
    range_bytes, status, headers = http_get(f"/api/recordings/{rec_id}/stream", admin_token, headers_extra={"Range": "bytes=0-99"})
    assert status in (206, 200), f"Range stream status: {status}"
    if status == 206:
        assert len(range_bytes) == 100, f"Range length expected 100, got {len(range_bytes)}"
        assert "bytes 0-99/" in headers.get("Content-Range", ""), f"Invalid Content-Range: {headers.get('Content-Range')}"
        log(f"HTTP 206 Partial Content stream successful: {headers.get('Content-Range')}")

    # 7c. Streaming with query token (HTML5 <audio> element authentication)
    audio_query_bytes, status, _ = http_get(f"/api/recordings/{rec_id}/stream?token={admin_token}")
    assert status == 200, f"Query token stream failed: {status}"
    log("HTML5 audio player query token authentication verified.")

    # 8. Test Search & Filters
    log("8. Testing GET /api/recordings with search and filter queries...")
    # Search by call_id
    search_res, status, _ = http_get(f"/api/recordings?q={call_id[:8]}", admin_token)
    assert status == 200 and search_res["total"] >= 1, f"Search by call_id failed: {search_res}"
    log(f"Search by query returned {search_res['total']} results.")

    # Filter by status=READY
    ready_res, status, _ = http_get("/api/recordings?status_filter=READY", admin_token)
    assert status == 200, f"Filter by status failed: {ready_res}"
    for itm in ready_res["items"]:
        assert itm["status"] == "READY", f"Non-ready item returned: {itm['status']}"
    log(f"Filter by status=READY returned {len(ready_res['items'])} items.")

    # 9. Test Secure Download & Audit Log
    log("9. Testing GET /api/recordings/{id}/download and audit logging...")
    dl_bytes, status, headers = http_get(f"/api/recordings/{rec_id}/download", admin_token)
    assert status == 200, f"Download failed with status {status}"
    assert "attachment" in headers.get("Content-Disposition", ""), "Content-Disposition attachment header missing!"
    log(f"Download successful ({len(dl_bytes)} bytes).")

    # 10. Test Cleanup Orphans Utility (Admin Only)
    log("10. Testing POST /api/recordings/cleanup-orphans...")
    cleanup_res, status = http_post("/api/recordings/cleanup-orphans", {}, admin_token)
    assert status == 200 and cleanup_res.get("status") == "success", f"Cleanup failed: {cleanup_res}"
    log(f"Cleanup Orphans executed successfully: {cleanup_res.get('orphans_cleaned_count')} orphans cleaned, {cleanup_res.get('reclaimed_mb')} MB reclaimed.")

    # 11. Test RBAC Permissions
    log("11. Testing RBAC access controls...")
    # Agent trying to download (restricted to Admin/Supervisor)
    dl_agent_res, status, _ = http_get(f"/api/recordings/{rec_id}/download", agent_token)
    assert status == 403, f"Agent was unexpectedly allowed to download (status {status})"
    log("RBAC verified: Agent forbidden from direct download (403 Forbidden).")

    # Unauthenticated stream request
    unauth_res, status, _ = http_get(f"/api/recordings/{rec_id}/stream")
    assert status == 401, f"Unauthenticated request was not rejected (status {status})"
    log("RBAC verified: Unauthenticated stream rejected (401 Unauthorized).")

    log("=== ALL RECORDINGS SYSTEM TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    run_tests()
