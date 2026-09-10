import urllib.request
import json
import sys

BASE_URL = "http://localhost:8000"

def log(msg):
    print(f"[TEST ENDPOINTS] {msg}")

def http_post(url, data_dict, token=None):
    req = urllib.request.Request(
        f"{BASE_URL}{url}",
        data=json.dumps(data_dict).encode("utf-8"),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})}
    )
    res = urllib.request.urlopen(req)
    return json.loads(res.read().decode("utf-8"))

def http_get(url, token=None):
    req = urllib.request.Request(
        f"{BASE_URL}{url}",
        headers={"Authorization": f"Bearer {token}"} if token else {}
    )
    res = urllib.request.urlopen(req)
    return json.loads(res.read().decode("utf-8"))

def main():
    log("1. Testing Health Endpoint: GET /health...")
    h = http_get("/health")
    assert h.get("status") == "healthy", f"Health failed: {h}"
    log(f"   [OK] /health -> {h}")

    log("2. Logging in as agent@forgeindia.com...")
    login_res = http_post("/api/auth/login", {"email": "agent@forgeindia.com", "password": "Agent@123"})
    token = login_res["access_token"]
    user = login_res["user"]
    log(f"   [OK] Logged in: {user['name']} ({user['role']})")

    endpoints = [
        ("GET /api/presence/agents", "/api/presence/agents"),
        ("GET /api/presence/summary", "/api/presence/summary"),
        ("GET /api/agent/presence", "/api/agent/presence"),
        ("GET /api/agent/session/active", "/api/agent/session/active"),
        ("GET /api/agent/session/current", "/api/agent/session/current"),
        ("GET /api/attendance/today", "/api/attendance/today"),
        ("GET /api/calls", "/api/calls"),
        ("GET /api/leads?limit=10", "/api/leads?limit=10"),
        ("GET /api/reports/summary", "/api/reports/summary"),
    ]

    for label, url in endpoints:
        try:
            res = http_get(url, token)
            log(f"   [OK] {label} -> Success (Type: {type(res).__name__})")
        except Exception as e:
            log(f"   [FAIL] {label} -> {e}")
            sys.exit(1)

    log("\n=======================================================")
    log(" ALL REQUIRED CRM ENDPOINTS TESTED AND VERIFIED 100%! ")
    log("=======================================================\n")

if __name__ == "__main__":
    main()
