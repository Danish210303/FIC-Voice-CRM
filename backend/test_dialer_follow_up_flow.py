import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport

# Set up environment and python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.main import app
from app.services.follow_up_service import parse_datetime_to_utc, IST_TZ
from app.core.database import users_col, leads_col, follow_ups_col, calls_col
from app.core.security import create_access_token


async def run_tests():
    print("=== TEST 1: parse_datetime_to_utc edge cases ===")
    dt1 = parse_datetime_to_utc("2026-09-10 14:00 14:00")
    print("Parsed duplicate string '2026-09-10 14:00 14:00':", dt1.isoformat())
    assert dt1.year == 2026 and dt1.month == 9 and dt1.day == 10
    # 14:00 IST should be 08:30 UTC
    assert dt1.hour == 8 and dt1.minute == 30, f"Expected 08:30 UTC, got {dt1.hour}:{dt1.minute}"

    dt2 = parse_datetime_to_utc("2026-09-10T16:45")
    print("Parsed ISO string '2026-09-10T16:45':", dt2.isoformat())
    # 16:45 IST should be 11:15 UTC
    assert dt2.hour == 11 and dt2.minute == 15, f"Expected 11:15 UTC, got {dt2.hour}:{dt2.minute}"

    dt3 = parse_datetime_to_utc("2026-09-10")
    print("Parsed Date-only '2026-09-10':", dt3.isoformat())
    assert dt3.day == 10

    print("\n=== TEST 2: Endpoint testing via AsyncClient ===")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create or find a test admin/agent user
        user = await users_col.find_one({"role": "admin"})
        if not user:
            user = await users_col.find_one({})
        
        user_id = str(user["_id"]) if user else "test_user"
        token = create_access_token(user_id=user_id, role=user.get("role", "admin"))
        headers = {"Authorization": f"Bearer {token}"}

        # Create a test lead
        lead_doc = {
            "lead_id": "TEST_LEAD_001",
            "name": "Rohan Sharma",
            "phone": "+919876543210",
            "status": "new",
            "pool_id": "credit_card_sales",
            "created_at": datetime.now(timezone.utc)
        }
        res_lead = await leads_col.insert_one(lead_doc)
        test_lead_id = str(res_lead.inserted_id)
        print(f"Created test lead: {test_lead_id}")

        # Test A: Lead disposition with follow-up
        print("\n--- Test A: PATCH /api/leads/{id}/disposition ---")
        disp_payload = {
            "status": "call_back",
            "notes": "Interested in premium card, asked to call back tomorrow 2 PM",
            "follow_up_date": "2026-09-10 14:00"
        }
        res_disp = await client.patch(f"/api/leads/{test_lead_id}/disposition", json=disp_payload, headers=headers)
        print(f"Disposition response ({res_disp.status_code}):", res_disp.json())
        assert res_disp.status_code == 200

        # Check follow-up in database
        fu = await follow_ups_col.find_one({"customer_phone": "+919876543210"})
        print("Follow-up found in DB:", fu is not None)
        assert fu is not None, "Follow-up record was not created in follow_ups collection!"
        print(f"  Follow-Up ID: {fu['_id']}")
        print(f"  Customer: {fu.get('customer_name')}")
        print(f"  Status: {fu.get('status')}")
        print(f"  Scheduled UTC: {fu.get('follow_up_datetime')}")

        # Test B: GET /api/follow-ups/stats
        print("\n--- Test B: GET /api/follow-ups/stats ---")
        res_stats = await client.get("/api/follow-ups/stats", headers=headers)
        print("Stats response:", res_stats.json())
        assert res_stats.status_code == 200
        stats_data = res_stats.json().get("stats", res_stats.json())
        assert stats_data["total"] >= 1, "Stats total should be at least 1"

        # Test C: GET /api/follow-ups list
        print("\n--- Test C: GET /api/follow-ups ---")
        res_list = await client.get("/api/follow-ups", headers=headers)
        print(f"List response ({res_list.status_code}), total count:", res_list.json().get("total"))
        assert res_list.status_code == 200
        assert len(res_list.json()["data"]) >= 1

        # Clean up test artifacts
        await leads_col.delete_one({"_id": res_lead.inserted_id})
        await follow_ups_col.delete_one({"_id": fu["_id"]})
        print("\nCleaned up test data.")

    print("\n ALL TESTS PASSED SUCCESSFULLY! ")


if __name__ == "__main__":
    asyncio.run(run_tests())
