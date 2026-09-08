import asyncio
import os
import io
import wave
import math
import struct
import httpx
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv("backend/.env")

from app.core.database import calls_col, recordings_col, users_col
from app.core.security import create_access_token
from app.services.storage import storage_service

def generate_test_wav(duration_sec=3):
    num_samples = int(duration_sec * 8000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(8000)
        for i in range(num_samples):
            t = float(i) / 8000
            val = int(0.3 * math.sin(2 * math.pi * 440 * t) * 32767)
            wav_file.writeframes(struct.pack("<h", val))
    return buf.getvalue()

async def run_e2e_test():
    print("========================================")
    print("STARTING CALL AUDIO & CLOUDINARY E2E TEST")
    print("========================================")

    # 1. Get or create test user
    admin_user = await users_col.find_one({"role": "admin"})
    if not admin_user:
        admin_user = await users_col.find_one()
    if not admin_user:
        raise Exception("No user found in database")
    
    user_id = str(admin_user["_id"])
    role = str(admin_user.get("role", "admin"))
    token = create_access_token(user_id, role)
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Authenticated as user {admin_user.get('email')} ({user_id})")

    # 2. Insert test call record
    call_doc = {
        "phone": "+919876543210",
        "lead_name": "Test Customer",
        "agent_id": user_id,
        "direction": "outbound",
        "status": "live",
        "recording_status": "recording"
    }
    insert_res = await calls_col.insert_one(call_doc)
    call_id = str(insert_res.inserted_id)
    print(f"Created test call: {call_id}")

    # 3. Generate audio data
    audio_bytes = generate_test_wav(duration_sec=3)
    print(f"Generated test audio WAV: {len(audio_bytes)} bytes")

    # 4. Test Cloudinary direct upload via storage_service
    upload_res = await storage_service.upload_recording_to_cloudinary(
        call_id=call_id,
        audio_data=audio_bytes,
        duration_seconds=3,
        extension="wav",
        type_access="upload"
    )
    print("\n[Storage Service Result]:")
    print(f"  Storage Provider: {upload_res.get('storage_provider')}")
    print(f"  Public ID: {upload_res.get('public_id')}")
    print(f"  Secure URL: {upload_res.get('secure_url')}")
    assert upload_res.get("secure_url"), "Missing secure_url from storage service"
    assert "https://res.cloudinary.com" in upload_res.get("secure_url"), "secure_url should be Cloudinary CDN URL"

    # 5. Verify Cloudinary URL accessibility (HTTP 200 & audio Content-Type)
    async with httpx.AsyncClient() as client:
        cdn_resp = await client.get(upload_res["secure_url"])
        print(f"\n[Cloudinary CDN Accessibility Check]:")
        print(f"  HTTP Status: {cdn_resp.status_code}")
        print(f"  Content-Type: {cdn_resp.headers.get('content-type')}")
        print(f"  Content-Length: {cdn_resp.headers.get('content-length')}")
        assert cdn_resp.status_code == 200, f"Expected 200, got {cdn_resp.status_code}"

    # 6. Test direct API upload endpoint POST /api/recordings/upload
    print("\n[Testing POST /api/recordings/upload endpoint]...")
    from app.main import app
    from httpx import ASGITransport

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"file": ("customer_rec.wav", audio_bytes, "audio/wav")}
        data = {
            "call_id": call_id,
            "duration_seconds": "3",
            "outcome": "interested",
            "notes": "Customer interested in Forge CRM platform"
        }
        api_res = await ac.post("/api/recordings/upload", files=files, data=data, headers=headers)
        print(f"  API Status: {api_res.status_code}")
        print(f"  API Response: {api_res.json()}")
        assert api_res.status_code == 200, f"Upload API failed: {api_res.text}"
        api_json = api_res.json()
        assert api_json.get("secure_url"), "Missing secure_url in upload API response"
        assert api_json.get("public_id"), "Missing public_id in upload API response"

        # 7. Check database call record
        updated_call = await calls_col.find_one({"_id": ObjectId(call_id)})
        print("\n[Database Call Record Verification]:")
        print(f"  recording_status: {updated_call.get('recording_status')}")
        print(f"  secure_url: {updated_call.get('secure_url')}")
        print(f"  public_id: {updated_call.get('public_id')}")
        print(f"  recording_file: {updated_call.get('recording_file')}")
        assert updated_call.get("secure_url") == api_json["secure_url"]

        # 8. Check database recording record
        rec_doc = await recordings_col.find_one({"call_id": call_id})
        print("\n[Database Recording Record Verification]:")
        print(f"  status: {rec_doc.get('status')}")
        print(f"  secure_url: {rec_doc.get('secure_url')}")
        print(f"  public_id: {rec_doc.get('public_id')}")
        print(f"  duration: {rec_doc.get('duration')}")
        assert rec_doc.get("status") == "READY"
        assert rec_doc.get("secure_url") == api_json["secure_url"]

        # 9. Test GET /api/recordings/{id}
        rec_id = str(rec_doc["_id"])
        get_rec_res = await ac.get(f"/api/recordings/{rec_id}", headers=headers)
        print(f"\n[GET /api/recordings/{rec_id} Status]: {get_rec_res.status_code}")
        assert get_rec_res.status_code == 200
        assert get_rec_res.json().get("secure_url") == api_json["secure_url"]

        # 10. Test GET /api/recordings/{id}/secure-playback
        sec_pb_res = await ac.get(f"/api/recordings/{rec_id}/secure-playback", headers=headers)
        print(f"[GET /api/recordings/{rec_id}/secure-playback]: {sec_pb_res.json().get('secure_url')}")
        assert sec_pb_res.status_code == 200

    print("\n========================================")
    print("ALL END-TO-END TESTS PASSED SUCCESSFULLY!")
    print("========================================")

if __name__ == "__main__":
    asyncio.run(run_e2e_test())
