import httpx
import json

BASE_URL = "http://localhost:8000"

def test_connectivity():
    print(f"=== Testing Backend Server Connectivity on {BASE_URL} ===")
    
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
        # 1. Health
        res = client.get("/health")
        print(f"GET /health -> Status: {res.status_code}, Body: {res.text}")
        assert res.status_code == 200, f"/health failed: {res.status_code}"

        res_api_health = client.get("/api/health")
        print(f"GET /api/health -> Status: {res_api_health.status_code}, Body: {res_api_health.text}")
        assert res_api_health.status_code == 200

        # 2. Login to get token
        login_res = client.post("/api/auth/login", json={"email": "admin@forgeindia.com", "password": "Admin@123"})
        print(f"POST /api/auth/login -> Status: {login_res.status_code}")
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. Test other endpoints requested by user
        endpoints = [
            "/api/reports/summary",
            "/api/leads?status_filter=new&limit=50",
            "/api/calls",
            "/api/presence/agents",
            "/api/presence/summary",
            "/api/agent/presence",
            "/api/agent/session/active",
            "/api/agent/session/current",
            "/api/attendance/today",
            "/api/recordings/stats"
        ]

        for ep in endpoints:
            r = client.get(ep, headers=headers)
            print(f"GET {ep} -> Status: {r.status_code}")
            assert r.status_code in (200, 201, 204), f"Endpoint {ep} failed: {r.status_code} {r.text}"

    print("=== ALL API ENDPOINTS RESPONDED WITH VALID RESPONSES (200 OK) ===")

if __name__ == "__main__":
    test_connectivity()
