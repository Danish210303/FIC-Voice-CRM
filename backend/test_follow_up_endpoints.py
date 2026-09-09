import asyncio
import httpx
from app.main import app
from app.core.deps import get_current_user

# Mock authenticated admin user
mock_user = {
    "_id": "660000000000000000000001",
    "id": "660000000000000000000001",
    "name": "System Admin",
    "email": "admin@forgeindia.com",
    "role": "admin",
    "is_active": True
}

app.dependency_overrides[get_current_user] = lambda: mock_user

async def main():
    headers = {"Authorization": "Bearer mock_token"}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        print("1. Testing GET /api/follow-ups/stats ...")
        res_stats = await client.get("/api/follow-ups/stats", headers=headers)
        print("Stats Status:", res_stats.status_code)
        print("Stats JSON:", res_stats.json())
        assert res_stats.status_code == 200, f"Expected 200 for stats, got {res_stats.status_code}"
        assert res_stats.json().get("success") is True, "Expected success: true in stats response"
        assert "stats" in res_stats.json(), "Expected 'stats' key in stats response"

        print("\n2. Testing GET /api/follow-ups?limit=150 ...")
        res_list = await client.get("/api/follow-ups?limit=150", headers=headers)
        print("List Status:", res_list.status_code)
        print("List JSON:", res_list.json())
        assert res_list.status_code == 200, f"Expected 200 for list, got {res_list.status_code}"
        assert res_list.json().get("success") is True, "Expected success: true in list response"
        assert "data" in res_list.json(), "Expected 'data' key in list response"
        assert "total" in res_list.json(), "Expected 'total' key in list response"

        print("\n3. Testing GET /api/follow-ups/stats/ (trailing slash) ...")
        res_stats_slash = await client.get("/api/follow-ups/stats/", headers=headers)
        print("Stats Slash Status:", res_stats_slash.status_code)
        assert res_stats_slash.status_code == 200, f"Expected 200 for stats with trailing slash"

        print("\n ALL LOCAL ENDPOINT TESTS PASSED SUCCESSFULLY! (Status 200 OK)")

if __name__ == "__main__":
    asyncio.run(main())

