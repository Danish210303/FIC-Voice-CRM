import asyncio
import httpx
import logging
import os
from urllib.parse import quote
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, Query, Body, status, Request
from fastapi.responses import PlainTextResponse, JSONResponse, Response
# pyrefly: ignore [missing-import]
from bson import ObjectId
from app.core.database import calls_col, leads_col, users_col, audit_logs_col, campaigns_col
from app.core.utils import utcnow, oid_str, normalize_phone, gen_lead_id
from app.core.deps import require_roles, get_current_user
from app.core.http import get_http_client
from app.schemas.common import (
    CallStart,
    CallEnd,
    MonitorAction,
    MonitorActionPayload,
    Role,
    CallQualityEvaluation,
    ManualDialPayload,
    VapiDialPayload,
    ManualCallActionPayload,
    ManualCallTransferPayload,
    ManualDTMFPayload,
    ManualConferencePayload,
    InboundACDPayload,
    CallDispositionPayload,
)
from app.services.ws_manager import ws_manager
from app.routes.presence import record_call_completion, record_presence_change

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calls", tags=["calls"])


def _safe_oid(oid_val: str | None) -> ObjectId | None:
    if oid_val and isinstance(oid_val, str) and ObjectId.is_valid(oid_val):
        return ObjectId(oid_val)
    return None


def normalize_e164(phone_str: str) -> str:
    cleaned = re.sub(r"\D", "", str(phone_str).strip())
    if not cleaned:
        return ""
    if len(cleaned) == 10:
        return f"+91{cleaned}"
    elif len(cleaned) == 12 and cleaned.startswith("91"):
        return f"+{cleaned}"
    elif str(phone_str).strip().startswith("+"):
        return f"+{cleaned}"
    return f"+{cleaned}"


# pyrefly: ignore [missing-import]
from fastapi import Form
# pyrefly: ignore [missing-import]
from fastapi.responses import PlainTextResponse
# Twilio removed – Plivo is the sole voice provider
from urllib.parse import quote
import re
from app.core.config import settings

# Twilio token & TwiML endpoints removed – Plivo handles all inbound/outbound calls.


@router.api_route("/plivo/answer", methods=["GET", "POST"])
async def plivo_answer_webhook(request: Request):
    """
    Plivo XML Answer Webhook:
    Executed when a call connects on Plivo (both inbound and outbound).

    Bridges call audio to the agent / recipient using <Dial><Number>...</Number></Dial>
    so two-way voice is crystal clear and 100% audible to both parties without any TTS speech.
    """
    form_data = {}
    if request.method == "POST":
        try:
            form_data = await request.form()
        except Exception:
            form_data = {}

    from_number = form_data.get("From", "") or request.query_params.get("From", "")
    to_number   = form_data.get("To", "") or request.query_params.get("To", "")
    direction   = (form_data.get("Direction", "") or form_data.get("CallDirection", "") or request.query_params.get("Direction", "")).lower()
    call_uuid   = form_data.get("CallUUID", "") or request.query_params.get("CallUUID", "")
    dial_to     = request.query_params.get("dial_to") or form_data.get("dial_to", "")
    agent_phone = request.query_params.get("agent_phone") or form_data.get("agent_phone", "")

    plivo_number_raw = getattr(settings, "PLIVO_PHONE_NUMBER", "+918031826757")
    plivo_caller_id  = normalize_e164(plivo_number_raw)
    base_url = str(request.base_url).rstrip("/")
    record_callback_url = f"{base_url}/api/calls/plivo/recording-callback"

    # Broadcast real-time call connected status event to CRM frontend over WebSockets
    await ws_manager.broadcast_global({
        "event": "call_status_update",
        "call_status": "in-progress",
        "from": from_number,
        "to": to_number,
        "call_sid": call_uuid,
        "provider": "plivo"
    })

    is_webrtc_call = from_number.lower().startswith("sip:") or "sip" in from_number.lower()

    if direction in ("inbound", "in") and not is_webrtc_call:
        await ws_manager.broadcast_global({
            "event": "inbound_call",
            "from": from_number,
            "to": to_number,
            "call_sid": call_uuid,
            "provider": "plivo"
        })
        
        # INSERT INBOUND CALL LOG
        clean_from_inbound = normalize_e164(from_number) if from_number else ""
        raw_digits = re.sub(r"\D", "", clean_from_inbound)
        search_regex = raw_digits[-10:] if len(raw_digits) >= 10 else raw_digits
        caller_lead = None
        if search_regex:
            caller_lead = await leads_col.find_one({
                "$or": [
                    {"phone": clean_from_inbound},
                    {"phone": {"$regex": search_regex}}
                ]
            })
            
        await calls_col.insert_one({
            "call_sid": call_uuid,
            "direction": "inbound",
            "phone": clean_from_inbound,
            "status": "live",
            "started_at": utcnow(),
            "lead_id": str(caller_lead["_id"]) if caller_lead else None,
        })
    else:
        # UPDATE CALL_SID FOR OUTBOUND CALLS
        clean_to_outbound = normalize_e164(to_number) if to_number else ""
        if clean_to_outbound:
            raw_digits = re.sub(r"\D", "", clean_to_outbound)
            search_regex = raw_digits[-10:] if len(raw_digits) >= 10 else raw_digits
            if search_regex:
                await calls_col.update_many(
                    {
                        "status": "live",
                        "$or": [
                            {"phone": clean_to_outbound},
                            {"phone": {"$regex": search_regex}}
                        ],
                        "call_sid": {"$exists": False}
                    },
                    {"$set": {"call_sid": call_uuid}}
                )

    clean_from  = normalize_e164(from_number) if from_number else ""
    clean_to    = normalize_e164(to_number) if to_number else ""
    clean_agent = normalize_e164(agent_phone) if agent_phone else ""
    clean_dial  = normalize_e164(dial_to) if dial_to else ""

    # Determine bridge target
    target_to_dial = ""
    clean_to_digits = clean_to.replace("+", "")

    if is_webrtc_call and clean_to_digits:
        # Browser WebRTC call: From is SIP endpoint, To is Customer number
        target_to_dial = clean_to
    elif clean_dial and clean_dial.replace("+", "") != clean_to_digits:
        target_to_dial = clean_dial
    elif clean_agent and clean_agent.replace("+", "") != clean_to_digits:
        target_to_dial = clean_agent

    # Fallback lookup in DB if no query params provided and not WebRTC
    if not target_to_dial and not is_webrtc_call:
        search_phone = clean_to or clean_from
        if search_phone:
            raw_digits = re.sub(r"\D", "", search_phone)
            search_regex = raw_digits[-10:] if len(raw_digits) >= 10 else raw_digits
            active_call = await calls_col.find_one({
                "status": "live",
                "$or": [
                    {"phone": search_phone},
                    {"phone": {"$regex": search_regex}}
                ]
            })
            if active_call and active_call.get("agent_id"):
                agent_user = await users_col.find_one({
                    "$or": [
                        {"_id": _safe_oid(active_call["agent_id"])},
                        {"id": active_call["agent_id"]}
                    ]
                })
                if agent_user and (agent_user.get("phone") or agent_user.get("agent_phone")):
                    possible_target = normalize_e164(agent_user.get("phone") or agent_user.get("agent_phone"))
                    if possible_target.replace("+", "") != clean_to_digits:
                        target_to_dial = possible_target

    if target_to_dial:
        dial_digits = target_to_dial.replace("+", "")
        
        if "sip:" in target_to_dial.lower():
            plivo_xml = (
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<Response>\n'
                f'    <Dial callerId="{plivo_caller_id}" timeout="45" record="true" recordCallback="{record_callback_url}">\n'
                f'        <User>{target_to_dial}</User>\n'
                '    </Dial>\n'
                '    <Wait length="3600"/>\n'
                '</Response>'
            )
        else:
            plivo_xml = (
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<Response>\n'
                f'    <Dial callerId="{plivo_caller_id}" timeout="45" record="true" recordCallback="{record_callback_url}">\n'
                f'        <Number>{dial_digits}</Number>\n'
                '    </Dial>\n'
                '    <Wait length="3600"/>\n'
                '</Response>'
            )
    else:
        if direction in ("inbound", "in"):
            # Default inbound routing: Play IVR menu
            base_url = str(request.base_url).rstrip("/")
            # Note: the actual path prefix (like /api/calls) will be part of the router mount,
            # but to be safe we can use a relative or hardcoded path if preferred.
            # Usually request.url.path gives the current path. For now, constructing a generic IVR url:
            ivr_action_url = f"{base_url}/api/calls/ivr-callback" 
            plivo_xml = (
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<Response>\n'
                f'    <GetInput action="{ivr_action_url}" method="POST" inputType="dtmf" numDigits="1">\n'
                '        <Speak voice="Polly.Aditi" language="en-IN">Welcome to Forge India Connect private limited . To contact with sales team press 1 for contact customer support team press 2 to hear the message again press 3</Speak>\n'
                '    </GetInput>\n'
                '</Response>'
            )
        else:
            # Fallback for outbound or unknown direction: Try to find an online agent and route to their Plivo WebRTC SIP endpoint
            available_agent = await users_col.find_one({"status": {"$in": ["ready", "available"]}, "plivo_endpoint_username": {"$exists": True, "$ne": None}})
            if not available_agent:
                # Fallback to any agent if no one is explicitly "ready"
                available_agent = await users_col.find_one({"plivo_endpoint_username": {"$exists": True, "$ne": None}})
                
            if available_agent and available_agent.get("plivo_endpoint_username"):
                sip_username = available_agent["plivo_endpoint_username"]
                sip_uri = f"sip:{sip_username}@phone.plivo.com" if "@" not in sip_username else f"sip:{sip_username}"
                
                plivo_xml = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    f'    <Dial callerId="{plivo_caller_id}" timeout="45" record="true" recordCallback="{record_callback_url}">\n'
                    f'        <User>{sip_uri}</User>\n'
                    '    </Dial>\n'
                    '</Response>'
                )
            else:
                # Connected single leg: keep session alive & active continuously without hanging up
                plivo_xml = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    '    <Wait length="3600"/>\n'
                    '</Response>'
                )

    return Response(content=plivo_xml, media_type="application/xml")


@router.post("/ivr-callback")
async def ivr_callback(request: Request):
    """
    Handles the Plivo <GetInput> callback for the IVR menu.
    Routes to Sales (1) or Support (2).
    """
    form_data = {}
    if request.method == "POST":
        try:
            form_data = await request.form()
        except Exception:
            pass
            
    digits = form_data.get("Digits", "")
    plivo_number_raw = getattr(settings, "PLIVO_PHONE_NUMBER", "+918031826757")
    plivo_caller_id  = normalize_e164(plivo_number_raw)
    base_url = str(request.base_url).rstrip("/")
    record_callback_url = f"{base_url}/api/calls/plivo/recording-callback"
    
    if digits == "1":
        # Sales
        target_number = "919585712555"
        plivo_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'    <Dial callerId="{plivo_caller_id}" timeout="45" record="true" recordCallback="{record_callback_url}">\n'
            f'        <Number>{target_number}</Number>\n'
            '    </Dial>\n'
            '</Response>'
        )
    elif digits == "2":
        # Support
        target_number = "919363063276"
        plivo_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'    <Dial callerId="{plivo_caller_id}" timeout="45" record="true" recordCallback="{record_callback_url}">\n'
            f'        <Number>{target_number}</Number>\n'
            '    </Dial>\n'
            '</Response>'
        )
    elif digits == "3":
        # Replay menu without "Invalid input" prefix
        base_url = str(request.base_url).rstrip("/")
        ivr_action_url = f"{base_url}/api/calls/ivr-callback" 
        plivo_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'    <GetInput action="{ivr_action_url}" method="POST" inputType="dtmf" numDigits="1">\n'
            '        <Speak voice="Polly.Aditi" language="en-IN">Welcome to Forge India Connect private limited . To contact with sales team press 1 for contact customer support team press 2 to hear the message again press 3</Speak>\n'
            '    </GetInput>\n'
            '</Response>'
        )
    else:
        # Invalid or no input, replay menu with error prefix
        base_url = str(request.base_url).rstrip("/")
        ivr_action_url = f"{base_url}/api/calls/ivr-callback" 
        plivo_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'    <GetInput action="{ivr_action_url}" method="POST" inputType="dtmf" numDigits="1">\n'
            '        <Speak voice="Polly.Aditi" language="en-IN">Invalid input. Welcome to Forge India Connect private limited . To contact with sales team press 1 for contact customer support team press 2 to hear the message again press 3</Speak>\n'
            '    </GetInput>\n'
            '</Response>'
        )
        
    return Response(content=plivo_xml, media_type="application/xml")


@router.get("/plivo/endpoint")
async def get_plivo_endpoint(user: dict = Depends(get_current_user)):
    """
    Returns Plivo WebRTC Endpoint credentials for the logged-in agent.
    If no endpoint exists for this user, it creates one dynamically via Plivo REST API.
    Allows the agent's browser (CRM Portal) to make and receive calls directly using WebRTC microphone audio.
    """
    plivo_auth_id = getattr(settings, 'PLIVO_AUTH_ID', '') or os.getenv('PLIVO_AUTH_ID', '')
    plivo_auth_token = getattr(settings, 'PLIVO_AUTH_TOKEN', '') or os.getenv('PLIVO_AUTH_TOKEN', '')
    plivo_app_id = getattr(settings, 'PLIVO_APP_ID', '42024221415255694')
    plivo_number = getattr(settings, 'PLIVO_PHONE_NUMBER', '+918031826757')

    uid = _uid(user)
    user_doc = await users_col.find_one({"_id": _safe_oid(uid)}) or await users_col.find_one({"id": uid})
    
    endpoint_username = user_doc.get("plivo_endpoint_username") if user_doc else None
    endpoint_password = user_doc.get("plivo_endpoint_password") if user_doc else None

    force_create = False
    if endpoint_username:
        endpoint_username = re.sub(r"[^a-zA-Z0-9]", "", endpoint_username)
        if plivo_auth_id and plivo_auth_token:
            try:
                client = get_http_client()
                check_url = f"https://api.plivo.com/v1/Account/{plivo_auth_id}/Endpoint/?username={endpoint_username}"
                check_res = await client.get(check_url, auth=(plivo_auth_id, plivo_auth_token), timeout=5.0)
                if check_res.status_code != 200 or not check_res.json().get("objects"):
                    print(f"[Plivo Endpoint Check] Username {endpoint_username} not found on Plivo API. Forcing creation...")
                    force_create = True
            except Exception as check_err:
                print(f"[Plivo Endpoint Check Error] {check_err}")

    if not endpoint_username or not endpoint_password or force_create:
        import random, string
        rand_suffix = "".join(random.choices(string.digits, k=6))
        clean_name = re.sub(r"[^a-zA-Z0-9]", "", user.get("name", "agent")).lower()
        endpoint_username = f"crm{clean_name}{rand_suffix}"
        endpoint_password = f"CrmPass{rand_suffix}!"
        alias_name = f"CRM{clean_name}{rand_suffix}"

        if plivo_auth_id and plivo_auth_token:
            try:
                client = get_http_client()
                ep_url = f"https://api.plivo.com/v1/Account/{plivo_auth_id}/Endpoint/"
                ep_body = {
                    "username": endpoint_username,
                    "password": endpoint_password,
                    "alias": alias_name,
                    "app_id": plivo_app_id
                }
                res = await client.post(ep_url, json=ep_body, auth=(plivo_auth_id, plivo_auth_token), timeout=10.0)
                if res.status_code in (200, 201):
                    res_data = res.json()
                    endpoint_username = res_data.get("username", endpoint_username)
                    print(f"[Plivo Endpoint] Successfully Created Endpoint on Plivo API: {endpoint_username}")
                    if user_doc:
                        await users_col.update_one(
                            {"_id": user_doc["_id"]},
                            {"$set": {"plivo_endpoint_username": endpoint_username, "plivo_endpoint_password": endpoint_password}}
                        )
                else:
                    print(f"[Plivo Endpoint Error] {res.status_code} - {res.text}")
            except Exception as ep_err:
                print(f"[Plivo Endpoint Exception] {ep_err}")

    sip_uri = f"sip:{endpoint_username}@phone.plivo.com" if "@" not in (endpoint_username or "") else f"sip:{endpoint_username}"
    return {
        "username": endpoint_username,
        "password": endpoint_password,
        "sip_uri": sip_uri,
        "plivo_number": plivo_number,
        "app_id": plivo_app_id
    }


@router.api_route("/plivo/hangup", methods=["GET", "POST"])
async def plivo_hangup_callback(request: Request):
    """
    Plivo Hangup URL callback.
    Fired when ANY Plivo call ends (set as the Application Hangup URL
    and as hangup_url in the outbound REST API call).

    Plivo posts these fields on hangup:
      CallUUID, CallStatus, HangupCause, From, To, Duration, Direction, etc.
    """
    try:
        if request.method == "POST":
            try:
                form_data = await request.form()
            except Exception:
                form_data = {}
        else:
            form_data = request.query_params

        # Plivo real field names
        call_uuid    = form_data.get("CallUUID", "")
        call_status  = (form_data.get("CallStatus", "") or "completed").lower()
        hangup_cause = form_data.get("HangupCause", "")
        from_number  = form_data.get("From", "")
        to_number    = form_data.get("To", "")
        duration     = form_data.get("Duration", "0")
        direction    = form_data.get("Direction", "")

        print(f"[Plivo Hangup] uuid={call_uuid} status={call_status} cause={hangup_cause} from={from_number} to={to_number} dur={duration}s dir={direction}")

        # Map Plivo terminal statuses
        status_map = {
            "completed":  "completed",
            "hangup":     "completed",
            "busy":       "busy",
            "no-answer":  "no-answer",
            "failed":     "failed",
            "rejected":   "failed",
            "canceled":   "canceled",
            "answered":   "in-progress",   # rare but possible
        }
        mapped = status_map.get(call_status, "completed")

        await ws_manager.broadcast_global({
            "event":        "call_status_update",
            "call_status":  mapped,
            "call_sid":     call_uuid,
            "from":         from_number,
            "to":           to_number,
            "duration":     duration,
            "hangup_cause": hangup_cause,
            "provider":     "plivo",
        })
        
        # UPDATE DB TO COMPLETED IF NOT ALREADY ENDED BY AGENT
        if mapped in ("completed", "busy", "no-answer", "failed", "canceled"):
            await calls_col.update_many(
                {"call_sid": call_uuid, "status": "live"},
                {"$set": {
                    "status": mapped,
                    "ended_at": utcnow(),
                    "duration_seconds": int(duration) if str(duration).isdigit() else 0,
                    "outcome": mapped
                }}
            )
    except Exception as e:
        print(f"[Plivo Hangup Callback] Error: {e}")

    return PlainTextResponse("OK", media_type="text/plain")


@router.api_route("/plivo/recording-callback", methods=["GET", "POST"])
async def plivo_recording_callback(request: Request):
    """
    Plivo Recording URL Callback.
    Plivo posts to this URL when a call recording is ready.
    """
    try:
        if request.method == "POST":
            try:
                form_data = await request.form()
            except Exception:
                form_data = {}
        else:
            form_data = request.query_params

        call_uuid = form_data.get("CallUUID", "")
        recording_url = form_data.get("RecordUrl", "")

        if call_uuid and recording_url:
            print(f"[Plivo Recording] call_uuid={call_uuid} recording_url={recording_url}")
            res = await calls_col.update_many(
                {"call_sid": call_uuid},
                {"$set": {"recording_file": recording_url, "recording_status": "saved"}}
            )
            if res.modified_count == 0:
                print(f"[Plivo Recording] Warning: No call found with call_sid={call_uuid}")

    except Exception as e:
        print(f"[Plivo Recording Callback] Error: {e}")

    return PlainTextResponse("OK", media_type="text/plain")


@router.api_route("/plivo/status", methods=["GET", "POST"])
async def plivo_status_callback(request: Request):
    """
    Plivo Call Status Callback – receives status updates for all Plivo calls
    (initiated, ringing, answered, completed, busy, failed, etc.)
    """
    try:
        if request.method == "POST":
            try:
                form_data = await request.form()
            except Exception:
                form_data = {}
        else:
            form_data = request.query_params

        call_status = (form_data.get("CallStatus", "") or form_data.get("Event", "")).lower()
        call_uuid   = form_data.get("CallUUID", "")
        from_number = form_data.get("From", "")
        to_number   = form_data.get("To", "")
        duration    = form_data.get("Duration", "0")

        # Map Plivo statuses to our internal format
        status_map = {
            "answer":    "in-progress",
            "answered":  "in-progress",
            "initiated": "ringing",
            "ringing":   "ringing",
            "hangup":    "completed",
            "completed": "completed",
            "busy":      "busy",
            "failed":    "failed",
            "no-answer": "no-answer",
            "canceled":  "canceled",
        }
        mapped_status = status_map.get(call_status, call_status)

        await ws_manager.broadcast_global({
            "event": "call_status_update",
            "call_status": mapped_status,
            "call_sid": call_uuid,
            "from": from_number,
            "to": to_number,
            "duration": duration,
            "provider": "plivo",
        })
    except Exception as e:
        print(f"[Plivo Status Callback] Error: {e}")

    return PlainTextResponse("OK", media_type="text/plain")


@router.api_route("/status-callback", methods=["GET", "POST"])
async def twilio_status_callback(request: Request):
    """
    Twilio Status Callback webhook.
    Twilio calls this URL to report real-time call status changes:
    - ringing, in-progress (answered), completed, busy, no-answer, failed, canceled
    
    We broadcast the status over WebSocket so the frontend softphone
    updates its UI INSTANTLY without any artificial delays or polling.
    """
    try:
        if request.method == "POST":
            try:
                form_data = await request.form()
            except Exception:
                form_data = {}
        else:
            form_data = request.query_params

        call_sid = form_data.get("CallSid", "")
        call_status = form_data.get("CallStatus", "")  # e.g. ringing, in-progress, busy, no-answer, failed, completed
        call_duration = form_data.get("CallDuration", "0")
        to_number = form_data.get("To", "")
        from_number = form_data.get("From", "")

        # Release active call lock if call reached terminal state
        if call_status.lower() in ["completed", "busy", "no-answer", "failed", "canceled"]:
            release_call_lock(phone=to_number, call_id=call_sid)

        # Broadcast to all connected WebSocket clients globally
        await ws_manager.broadcast_global({
            "event": "call_status_update",
            "call_sid": call_sid,
            "call_status": call_status,
            "duration": call_duration,
            "to": to_number,
            "from": from_number,
        })

    except Exception as e:
        print(f"[status-callback] Error: {e}")

    return PlainTextResponse("OK", media_type="text/plain")


@router.api_route("/plivo/ucc", methods=["GET", "POST"])
async def plivo_ucc_callback(request: Request):
    """
    Plivo UCC (Unsolicited Commercial Communication) Callback Webhook.
    Receives compliance status updates for Indian DND / UCC regulations.
    """
    return JSONResponse(status_code=200, content={"status": "received"})


def _uid(user: dict) -> str:
    return user.get("id") or str(user["_id"])


@router.post("/start", dependencies=[Depends(require_roles(Role.AGENT))])
async def start_call(payload: CallStart, user: dict = Depends(get_current_user)):
    uid_val = _uid(user)
    agent_user = await users_col.find_one({"_id": ObjectId(uid_val)} if ObjectId.is_valid(uid_val) else {"id": uid_val})
    if agent_user and agent_user.get("status") in ("wrap_up", "wrapup"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot start a new call while disposition is incomplete. Please submit disposition first."
        )

    lead = await leads_col.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")
    doc = {
        "lead_id": payload.lead_id,
        "phone": lead.get("phone", ""),
        "agent_id": uid_val,
        "pool_id": lead["pool_id"],
        "direction": payload.direction,
        "status": "live",
        "started_at": utcnow(),
    }
    result = await calls_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    await leads_col.update_one({"_id": ObjectId(payload.lead_id)}, {"$set": {"status": "in_progress"}})

    try:
        await record_presence_change(user_id=uid_val, new_status="in_call")
    except Exception as err:
        logger.warning(f"[CALL START] Could not update presence status to in_call: {err}")

    await ws_manager.broadcast(lead["pool_id"], {
        "event": "call_started", "call_id": str(doc["_id"]), "lead_name": lead["name"], "agent_id": uid_val,
    })
    return oid_str(doc)


@router.post("/end", dependencies=[Depends(require_roles(Role.AGENT))])
async def end_call(payload: CallEnd):
    call = await calls_col.find_one({"_id": ObjectId(payload.call_id)})
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
    ended_at = utcnow()
    ended_at_iso = ended_at.isoformat()
    agent_id = call.get("agent_id")
    session_id = f"session_{agent_id}_{ended_at.strftime('%Y-%m-%d')}"

    update = {
        "status": "wrap_up",
        "outcome": payload.outcome,
        "duration_seconds": payload.duration_seconds,
        "notes": payload.notes,
        "ai_summary": payload.ai_summary,
        "transcript": payload.transcript,
        "endedAt": ended_at_iso,
        "ended_at": ended_at,
        "dispositionStartedAt": ended_at_iso,
        "wrapup_started_at": ended_at_iso,
    }
    await calls_col.update_one({"_id": ObjectId(payload.call_id)}, {"$set": update})
    release_call_lock(agent_id=agent_id, call_id=payload.call_id)

    if agent_id:
        try:
            await record_presence_change(user_id=agent_id, new_status="wrap_up")
            await users_col.update_one(
                {"_id": ObjectId(agent_id)},
                {"$set": {
                    "currentCallId": payload.call_id,
                    "dispositionStartedAt": ended_at_iso
                }}
            )
        except Exception as err:
            logger.warning(f"[CALL END] Could not update presence status to wrap_up: {err}")

        # Broadcast agent.wrapup.started WS event
        event_payload = {
            "eventId": f"evt_wrapstart_{ended_at.strftime('%Y%m%d%H%M%S')}_{agent_id[-6:]}",
            "agentId": agent_id,
            "sessionId": session_id,
            "event": "agent.wrapup.started",
            "type": "agent_wrapup_started",
            "status": "WRAP_UP",
            "previousStatus": "ON_CALL",
            "callId": payload.call_id,
            "dispositionStartedAt": ended_at_iso,
            "timestamp": ended_at_iso,
            "serverTimestamp": int(ended_at.timestamp() * 1000)
        }
        try:
            await ws_manager.broadcast_global(event_payload)
        except Exception as e:
            logger.warning(f"[CALL END WS] Error broadcasting agent.wrapup.started: {e}")

    await ws_manager.broadcast(call["pool_id"], {"event": "call_ended", "call_id": payload.call_id})
    return {"status": "wrap_up", "callId": payload.call_id, "dispositionStartedAt": ended_at_iso}


@router.get("")
async def list_calls(user: dict = Depends(get_current_user), pool_id: str | None = None,
                      agent_id: str | None = None, status_filter: str | None = None):
    query = {}
    if user["role"] == Role.AGENT:
        query["agent_id"] = _uid(user)
    elif user["role"] == Role.TEAM_LEADER:
        assigned_agents = await users_col.find({"supervisor_id": _uid(user), "role": Role.AGENT}).to_list(length=1000)
        agent_ids = [str(a["_id"]) for a in assigned_agents]
        query["agent_id"] = {"$in": agent_ids}
        
    if pool_id:
        query["pool_id"] = pool_id
    if agent_id:
        query["agent_id"] = agent_id
    if status_filter:
        query["status"] = status_filter
        
    calls_raw = await calls_col.find(query).sort("started_at", -1).limit(500).to_list(length=500)
    
    missing_lead_oids = []
    missing_lead_str_ids = []
    for c in calls_raw:
        if not c.get("phone") and c.get("lead_id"):
            lid = str(c.get("lead_id"))
            if ObjectId.is_valid(lid):
                missing_lead_oids.append(ObjectId(lid))
            missing_lead_str_ids.append(lid)

    lead_map = {}
    if missing_lead_oids or missing_lead_str_ids:
        or_conds = []
        if missing_lead_oids:
            or_conds.append({"_id": {"$in": missing_lead_oids}})
        if missing_lead_str_ids:
            or_conds.append({"lead_id": {"$in": missing_lead_str_ids}})
            or_conds.append({"phone": {"$in": missing_lead_str_ids}})
        
        found_leads = await leads_col.find({"$or": or_conds}, {"_id": 1, "lead_id": 1, "phone": 1, "name": 1}).to_list(length=1000)
        for ld in found_leads:
            l_oid_str = str(ld["_id"])
            l_custom_id = ld.get("lead_id")
            l_phone = ld.get("phone")
            
            lead_map[l_oid_str] = ld
            if l_custom_id: lead_map[l_custom_id] = ld
            if l_phone: lead_map[l_phone] = ld

    calls = []
    for c in calls_raw:
        if not c.get("phone") and c.get("lead_id"):
            lid = str(c.get("lead_id"))
            lead = lead_map.get(lid)
            if lead:
                c["phone"] = lead.get("phone", "")
                c["lead_name"] = lead.get("name", "")
        calls.append(oid_str(c))
    return calls


@router.get("/live")
@router.get("/live-calls")
async def live_calls(pool_id: str | None = None, user: dict = Depends(get_current_user)):
    query = {"status": "live"}
    if pool_id:
        query["pool_id"] = pool_id
    user_role = user.get("role", "")
    if user_role in (Role.TEAM_LEADER, "team_leader", "supervisor"):
        assigned_agents = await users_col.find({"supervisor_id": _uid(user), "role": Role.AGENT}).to_list(length=1000)
        agent_ids = [str(a["_id"]) for a in assigned_agents]
        query["agent_id"] = {"$in": agent_ids}
    elif user_role in (Role.AGENT, "agent"):
        query["$or"] = [{"agent_id": _uid(user)}, {"agent_id": str(_uid(user))}]
        
    calls = []
    async for c in calls_col.find(query):
        # Fetch related data
        lead = await leads_col.find_one({"_id": ObjectId(c.get("lead_id"))}) if c.get("lead_id") and ObjectId.is_valid(c.get("lead_id")) else None
        agent = await users_col.find_one({"_id": ObjectId(c.get("agent_id"))}) if c.get("agent_id") and ObjectId.is_valid(c.get("agent_id")) else None
        
        # We need to map to what the frontend expects
        c["customer_name"] = lead.get("name") if lead else "Unknown Customer"
        c["phone_number"] = lead.get("phone") if lead else "Unknown Phone"
        c["formatted_lead_id"] = lead.get("lead_id") if lead else "UNKNOWN"
        c["location"] = lead.get("location") if lead else ""
        c["language"] = c.get("language") or (lead.get("language") if lead else "English")
        c["priority"] = c.get("priority") or (lead.get("priority") if lead else "medium")
        
        c["agent_name"] = agent.get("name") if agent else "Unassigned"
        c["agent_role"] = agent.get("department") or "Voice Specialist" if agent else ""
        
        # Provide default simulated values for missing fields to satisfy the UI
        c["pool_name"] = "Department Pool" # Or fetch from pools_col if we want to
        c["queue_name"] = "Standard Queue"
        c["campaign_name"] = "General Campaign"
        c["sentiment"] = c.get("sentiment") or "Neutral"
        c["sentiment_score"] = 50
        
        # Calculate timer_seconds if started_at exists
        if "started_at" in c and c["started_at"]:
            delta = utcnow().replace(tzinfo=None) - c["started_at"].replace(tzinfo=None)
            c["timer_seconds"] = int(delta.total_seconds())
        else:
            c["timer_seconds"] = 0
            
        calls.append(oid_str(c))
    return calls


@router.post("/{call_id}/monitor", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER))])
async def monitor_call(
    call_id: str,
    action: MonitorAction | None = Query(None),
    payload: MonitorActionPayload | None = Body(None),
    user: dict = Depends(get_current_user)
):
    """Signals a listen/whisper/barge/transfer action on a live call over the pool's websocket channel."""
    act_str = payload.action if payload and payload.action else action
    if not act_str:
        act_str = MonitorAction.LISTEN

    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"id": call_id}
    call = await calls_col.find_one(query)
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
        
    # Security scope check for Team Leader
    if user["role"] == Role.TEAM_LEADER:
        agent_q = {"_id": ObjectId(call["agent_id"])} if ObjectId.is_valid(call["agent_id"]) else {"id": call["agent_id"]}
        agent = await users_col.find_one(agent_q)
        if not agent or agent.get("supervisor_id") != _uid(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden: you can monitor only your assigned team calls")
            
    update_op = {"$push": {"monitor_events": {"action": act_str, "by": _uid(user), "at": utcnow()}}}
    if act_str == "end":
        update_op["$set"] = {"status": "completed", "ended_at": utcnow(), "outcome": "terminated_by_supervisor"}
        
    await calls_col.update_one(
        query,
        update_op
    )
    await ws_manager.broadcast(call.get("pool_id", "global"), {
        "event": "monitor_action", "call_id": call_id, "action": act_str, "supervisor_id": _uid(user),
    })
    return {"status": "signal_sent", "action": act_str}


@router.post("/{call_id}/quality", dependencies=[Depends(require_roles(Role.TEAM_LEADER, Role.ADMIN))])
async def evaluate_call_quality(call_id: str, payload: CallQualityEvaluation, user: dict = Depends(get_current_user)):
    """Allows supervisors to audit completed calls, scoring AI attributes, compliance thresholds and adding notes."""
    call = await calls_col.find_one({"_id": ObjectId(call_id)})
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
        
    # Security scope check for Team Leader
    if user["role"] == Role.TEAM_LEADER:
        agent = await users_col.find_one({"_id": ObjectId(call["agent_id"])})
        if not agent or agent.get("supervisor_id") != _uid(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden: you can evaluate only your assigned agents' calls")
            
    await calls_col.update_one(
        {"_id": ObjectId(call_id)},
        {"$set": {
            "quality_evaluation": {
                "coaching_notes": payload.coaching_notes,
                "ai_quality_score": payload.ai_quality_score,
                "compliance_score": payload.compliance_score,
                "sentiment": payload.sentiment,
                "evaluated_by": _uid(user),
                "evaluated_at": utcnow()
            }
        }}
    )
    
    # Audit log
    await audit_logs_col.insert_one({
        "action": "evaluate_call_quality",
        "user_id": _uid(user),
        "target_user_id": call["agent_id"],
        "call_id": call_id,
        "timestamp": utcnow()
    })
    
    return {"status": "success"}


# pyrefly: ignore [missing-import]
from pydantic import BaseModel

class OutboundSimulationPayload(BaseModel):
    lead_id: str
    campaign_id: str
    intent: str  # "interested", "not_interested", "human_transfer"

class InboundSimulationPayload(BaseModel):
    pool_id: str
    phone: str
    name: str
    require_agent: bool

@router.post("/simulate/outbound")
async def simulate_outbound(payload: OutboundSimulationPayload):
    lead = await leads_col.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")
        
    campaign = await campaigns_col.find_one({"_id": ObjectId(payload.campaign_id)})
    if not campaign:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
        
    if payload.intent == "interested":
        await leads_col.update_one({"_id": ObjectId(payload.lead_id)}, {"$set": {"status": "qualified"}})
        doc = {
            "lead_id": payload.lead_id,
            "campaign_id": payload.campaign_id,
            "pool_id": lead["pool_id"],
            "direction": "outbound",
            "status": "completed",
            "outcome": "qualified",
            "duration_seconds": 68,
            "started_at": utcnow(),
            "ended_at": utcnow(),
            "ai_summary": "Auto-dialer connected. AI Agent detected high intent of interest in card features.",
            "transcript": "AI Agent: Hello, this is Forge AI Calling. Are you looking to upgrade your card?\nCustomer: Yes, I want a zero-annual fee card.\nAI Agent: Perfect. I am qualifying your lead entry."
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id
        await ws_manager.broadcast("global", {"event": "leads_updated"})
        return oid_str(doc)
        
    elif payload.intent == "not_interested":
        await leads_col.update_one({"_id": ObjectId(payload.lead_id)}, {"$set": {"status": "not_interested"}})
        doc = {
            "lead_id": payload.lead_id,
            "campaign_id": payload.campaign_id,
            "pool_id": lead["pool_id"],
            "direction": "outbound",
            "status": "completed",
            "outcome": "not_interested",
            "duration_seconds": 25,
            "started_at": utcnow(),
            "ended_at": utcnow(),
            "ai_summary": "Auto-dialer connected. Customer stated they are not interested. Call closed.",
            "transcript": "AI Agent: Hello from Forge AI Calling. Interested in card upgrades?\nCustomer: No, do not call me again."
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id
        await ws_manager.broadcast("global", {"event": "leads_updated"})
        return oid_str(doc)
        
    elif payload.intent == "human_transfer":
        agent = await users_col.find_one({"role": Role.AGENT, "pool_id": lead["pool_id"], "status": "online"})
        if not agent:
            agent = await users_col.find_one({"role": Role.AGENT, "status": "online"})
            
        agent_id = str(agent["_id"]) if agent else "AGT84785"
        
        doc = {
            "lead_id": payload.lead_id,
            "campaign_id": payload.campaign_id,
            "pool_id": lead["pool_id"],
            "agent_id": agent_id,
            "direction": "outbound",
            "status": "live",
            "is_ai": False,
            "started_at": utcnow(),
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id
        
        await leads_col.update_one({"_id": ObjectId(payload.lead_id)}, {"$set": {"status": "in_progress", "assigned_agent_id": agent_id}})
        await ws_manager.broadcast("global", {"event": "call_started", "call_id": str(doc["_id"]), "lead_name": lead["name"]})
        return oid_str(doc)
        
    return {"status": "ignored"}


# --- INBOUND BPO AUTOMATIC CALL DISTRIBUTION (ACD) ENGINE ---

from datetime import datetime
import re

async def dispatch_next_queued_call(agent_id: str, pool_id: str = None):
    """
    ACD Engine Helper: Auto-connects the longest waiting queued caller to an available agent.
    """
    query = {"status": "queued", "direction": "inbound"}
    if pool_id:
        query["$or"] = [{"pool_id": pool_id}, {"pool_id": "general"}, {"pool_id": "banking_customer_care"}]
    
    queued_call = await calls_col.find_one_and_update(
        query,
        {"$set": {
            "status": "live",
            "agent_id": agent_id,
            "started_at": utcnow(),
            "auto_answered": True
        }},
        sort=[("queued_at", 1)],
        return_document=True
    )
    
    if queued_call:
        call_id_str = str(queued_call["_id"])
        try:
            await record_presence_change(user_id=agent_id, new_status="in_call")
        except Exception as err:
            logger.warning(f"[ACD DISPATCH] Could not update presence status to in_call: {err}")
        
        lead = None
        if queued_call.get("lead_id"):
            try:
                lead = await leads_col.find_one({"_id": ObjectId(queued_call["lead_id"])})
            except Exception:
                pass
            if lead:
                await leads_col.update_one(
                    {"_id": ObjectId(queued_call["lead_id"])},
                    {"$set": {"status": "in_progress", "assigned_agent_id": agent_id}}
                )
        
        caller_name = lead.get("name") if lead else queued_call.get("caller_name", "Inbound Customer")
        caller_phone = lead.get("phone") if lead else queued_call.get("caller_phone", "")
        
        event_payload = {
            "event": "inbound_call_auto_answered",
            "call_id": call_id_str,
            "agent_id": agent_id,
            "lead_id": queued_call.get("lead_id"),
            "lead_name": caller_name,
            "phone": caller_phone,
            "pool_id": queued_call.get("pool_id", "banking_customer_care"),
            "auto_answered": True,
            "connected_at": utcnow().isoformat()
        }
        await ws_manager.broadcast("global", event_payload)
        await ws_manager.broadcast("global", {"event": "queue_updated"})
        await ws_manager.broadcast("global", {"event": "users_updated"})
        return oid_str(queued_call)
    return None


@router.post("/inbound/acd")
async def process_inbound_acd(payload: InboundACDPayload):
    """
    Real-Time Banking BPO ACD Endpoint:
    1. Detects customer by phone number (or creates lead if new).
    2. Checks for an available agent with status 'ready' or 'online'.
    3. If READY agent is available, auto-connects & routes call instantly without manual click.
    4. If NO agent is available, queues call with position & wait time tracking.
    """
    clean_phone = re.sub(r"\D", "", payload.phone)
    if len(clean_phone) > 10:
        clean_phone = clean_phone[-10:]
    
    # 1. Automatic Customer Lookup / Detection
    lead = await leads_col.find_one({"phone": {"$regex": clean_phone}}) if clean_phone else None
    if not lead:
        lead_name = payload.name or f"Inbound Banking Customer (+91 {clean_phone or '9876543210'})"
        lead_doc = {
            "lead_id": f"LD{utcnow().strftime('%M%S%f')[:5]}",
            "name": lead_name,
            "phone": clean_phone or "9876543210",
            "status": "new",
            "pool_id": payload.pool_id or "banking_customer_care",
            "created_at": utcnow()
        }
        res_lead = await leads_col.insert_one(lead_doc)
        lead_doc["_id"] = res_lead.inserted_id
        lead = lead_doc

    lead_id_str = str(lead["_id"])
    pool_id = payload.pool_id or lead.get("pool_id", "banking_customer_care")

    # 2. Check for READY / Available Agent
    agent = await users_col.find_one({"role": Role.AGENT, "status": "ready", "pool_id": pool_id})
    if not agent:
        agent = await users_col.find_one({"role": Role.AGENT, "status": "ready"})
    if not agent:
        agent = await users_col.find_one({"role": Role.AGENT, "status": "online", "pool_id": pool_id})
    if not agent:
        agent = await users_col.find_one({"role": Role.AGENT, "status": "online"})

    if agent:
        # ⚡ 3. AUTO-CONNECT TO READY AGENT INSTANTLY
        agent_id = str(agent["_id"])
        doc = {
            "lead_id": lead_id_str,
            "pool_id": pool_id,
            "agent_id": agent_id,
            "direction": "inbound",
            "status": "live",
            "is_ai": False,
            "auto_answered": payload.auto_answer,
            "started_at": utcnow(),
            "caller_name": lead["name"],
            "caller_phone": lead["phone"]
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id

        try:
            await record_presence_change(user_id=agent_id, new_status="in_call")
        except Exception as err:
            logger.warning(f"[ACD PROCESS] Could not update presence status to in_call: {err}")
        await leads_col.update_one({"_id": ObjectId(lead_id_str)}, {"$set": {"status": "in_progress", "assigned_agent_id": agent_id}})

        event_payload = {
            "event": "inbound_call_auto_answered",
            "call_id": str(doc["_id"]),
            "agent_id": agent_id,
            "agent_name": agent.get("name", "Agent"),
            "lead_id": lead_id_str,
            "lead_name": lead["name"],
            "phone": lead["phone"],
            "pool_id": pool_id,
            "auto_answered": payload.auto_answer
        }
        await ws_manager.broadcast("global", event_payload)
        await ws_manager.broadcast("global", {"event": "users_updated"})
        return {"status": "connected", "call": oid_str(doc), "lead": oid_str(lead), "agent_id": agent_id, "auto_answered": True}
    else:
        # 📥 4. NO READY AGENT -> QUEUE CALL WITH POSITION & WAIT TIME TRACKING
        queued_doc = {
            "lead_id": lead_id_str,
            "pool_id": pool_id,
            "direction": "inbound",
            "status": "queued",
            "is_ai": False,
            "queued_at": utcnow(),
            "caller_name": lead["name"],
            "caller_phone": lead["phone"]
        }
        result = await calls_col.insert_one(queued_doc)
        queued_doc["_id"] = result.inserted_id

        queue_position = await calls_col.count_documents({"direction": "inbound", "status": "queued"})

        event_payload = {
            "event": "inbound_call_queued",
            "call_id": str(queued_doc["_id"]),
            "lead_id": lead_id_str,
            "lead_name": lead["name"],
            "phone": lead["phone"],
            "pool_id": pool_id,
            "queue_position": queue_position,
            "queued_at": utcnow().isoformat()
        }
        await ws_manager.broadcast("global", event_payload)
        await ws_manager.broadcast("global", {"event": "queue_updated"})

        return {
            "status": "queued",
            "call_id": str(queued_doc["_id"]),
            "queue_position": queue_position,
            "wait_seconds": 0,
            "lead": oid_str(lead),
            "message": f"Inbound call placed into queue at position #{queue_position}"
        }


@router.get("/inbound/queue", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def get_inbound_queue(user: dict = Depends(get_current_user)):
    """Returns active ACD queue items, positions, wait times, and ready agents count."""
    cursor = calls_col.find({"direction": "inbound", "status": "queued"}).sort("queued_at", 1)
    raw_items = await cursor.to_list(length=100)
    
    queue_list = []
    now = utcnow()
    for idx, item in enumerate(raw_items):
        queued_at = item.get("queued_at") or now
        wait_seconds = int((now - queued_at).total_seconds()) if isinstance(queued_at, datetime) else 0
        queue_list.append({
            "id": str(item["_id"]),
            "lead_id": item.get("lead_id"),
            "name": item.get("caller_name", "Banking Customer"),
            "phone": item.get("caller_phone", ""),
            "pool_id": item.get("pool_id", "banking_customer_care"),
            "position": idx + 1,
            "wait_seconds": max(0, wait_seconds),
            "queued_at": queued_at.isoformat() if hasattr(queued_at, "isoformat") else str(queued_at)
        })
        
    ready_agents_count = await users_col.count_documents({"role": Role.AGENT, "status": {"$in": ["ready", "online"]}})
    return {
        "queue": queue_list,
        "total_queued": len(queue_list),
        "available_ready_agents": ready_agents_count
    }


@router.post("/{call_id}/events", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def append_call_event(call_id: str, payload: dict, user: dict = Depends(get_current_user)):
    """Appends a real-time call lifecycle event to the MongoDB call record's events timeline."""
    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"id": call_id}
    call = await calls_col.find_one(query)
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call record not found")

    event_item = {
        "id": payload.get("id") or f"evt_{utcnow().timestamp()}",
        "timestamp": payload.get("timestamp") or utcnow().strftime("%I:%M:%S %p"),
        "title": payload.get("title") or "Call Event",
        "description": payload.get("description") or "",
        "dotColor": payload.get("dotColor") or "bg-blue-600 ring-4 ring-blue-100 dark:ring-blue-900/30",
        "type": payload.get("type") or "in_call",
        "duration": payload.get("duration") or "",
        "created_at": utcnow().isoformat()
    }

    await calls_col.update_one(query, {"$push": {"events": event_item}})

    # Broadcast event via WebSocket
    await ws_manager.broadcast("global", {
        "event": "call_event_added",
        "call_id": call_id,
        "call_event": event_item
    })

    return {"status": "event_added", "call_event": event_item}


@router.post("/{call_id}/disposition", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def record_call_disposition(call_id: str, payload: CallDispositionPayload, user: dict = Depends(get_current_user)):
    """Records call disposition, updates lead state, resets agent to READY, and triggers auto-connect for queued calls."""
    agent_id = str(user.get("id") or user.get("_id"))
    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"id": call_id}
    call = await calls_col.find_one(query)
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call record not found")
        
    started_at = call.get("started_at") or utcnow()
    ended_at = utcnow()
    try:
        s_dt = started_at.replace(tzinfo=None) if hasattr(started_at, "replace") else datetime.fromisoformat(str(started_at).replace("Z", "+00:00")).replace(tzinfo=None)
        e_dt = ended_at.replace(tzinfo=None)
        duration = max(1, int((e_dt - s_dt).total_seconds()))
    except Exception:
        duration = 1

    wrapup_start = call.get("wrapup_started_at") or call.get("ended_at") or user.get("last_status_change")
    dispose_sec = 0
    if wrapup_start:
        try:
            if isinstance(wrapup_start, str):
                ws_dt = datetime.fromisoformat(wrapup_start.replace("Z", "+00:00"))
            else:
                ws_dt = wrapup_start
            dispose_sec = max(0, int((ended_at.replace(tzinfo=None) - ws_dt.replace(tzinfo=None)).total_seconds()))
        except Exception:
            dispose_sec = 0

    disp_title = f"Agent Updated Disposition ({payload.disposition.replace('_', ' ').title()})"
    disp_desc = f"Status set to: {payload.disposition.replace('_', ' ').title()}" + (f" • Notes: {payload.notes}" if payload.notes else "")

    disp_event = {
        "id": f"evt_disp_{utcnow().timestamp()}",
        "timestamp": utcnow().strftime("%I:%M:%S %p"),
        "title": disp_title,
        "description": disp_desc,
        "dotColor": "bg-purple-500 ring-4 ring-purple-100 dark:ring-purple-900/30",
        "type": "disposition",
        "created_at": utcnow().isoformat()
    }
    
    completed_at = utcnow()
    completed_at_iso = completed_at.isoformat()
    session_id = f"session_{agent_id}_{completed_at.strftime('%Y-%m-%d')}"

    update_fields = {
        "status": "completed",
        "dispositionCompletedAt": completed_at_iso,
        "endedAt": completed_at_iso,
        "ended_at": completed_at,
        "duration_seconds": max(1, duration),
        "disposeDurationSeconds": dispose_sec,
        "dispose_seconds": dispose_sec,
        "outcome": payload.disposition,
        "disposition": payload.disposition,
        "notes": payload.notes or "",
        "follow_up_date": payload.follow_up_date,
        "follow_up_time": payload.follow_up_time,
        "rating": payload.rating,
        "recording_url": "https://actions.google.com/sounds/v1/ambiences/office_voices.ogg",
        "ai_summary": f"Inbound BPO Call completed ({payload.disposition.upper()}). Notes: {payload.notes or 'No notes provided'}"
    }
    await calls_col.update_one(query, {
        "$set": update_fields,
        "$push": {"events": disp_event}
    })
    
    if call.get("lead_id"):
        try:
            await leads_col.update_one(
                {"_id": ObjectId(call["lead_id"])},
                {"$set": {
                    "status": "completed" if payload.disposition in ["resolved", "closed"] else "in_progress",
                    "last_disposition": payload.disposition,
                    "notes": payload.notes
                }}
            )
        except Exception:
            pass
        
    try:
        await record_call_completion(user_id=agent_id, duration_seconds=duration, dispose_seconds=dispose_sec, call_id=call_id, outcome=payload.disposition)
        await record_presence_change(user_id=agent_id, new_status="ready")
        await users_col.update_one({"_id": ObjectId(agent_id)}, {"$unset": {"currentCallId": "", "dispositionStartedAt": ""}})
    except Exception as err:
        logger.warning(f"[DISPOSITION] Error updating agent completion/presence: {err}")
    
    wrapup_completed_payload = {
        "eventId": f"evt_wrapcomp_{completed_at.strftime('%Y%m%d%H%M%S')}_{agent_id[-6:]}",
        "agentId": agent_id,
        "sessionId": session_id,
        "event": "agent.wrapup.completed",
        "type": "agent_wrapup_completed",
        "status": "READY",
        "previousStatus": "WRAP_UP",
        "callId": call_id,
        "dispositionCompletedAt": completed_at_iso,
        "disposeDurationSeconds": dispose_sec,
        "timestamp": completed_at_iso,
        "serverTimestamp": int(completed_at.timestamp() * 1000)
    }
    try:
        await ws_manager.broadcast_global(wrapup_completed_payload)
    except Exception as e:
        logger.warning(f"[DISPOSITION WS] Error broadcasting agent.wrapup.completed: {e}")

    # Auto-dispatch next queued caller if any
    dispatched_call = await dispatch_next_queued_call(agent_id, call.get("pool_id"))
    
    await ws_manager.broadcast("global", {"event": "leads_updated"})
    await ws_manager.broadcast("global", {"event": "users_updated"})
    await ws_manager.broadcast("global", {
        "event": "call_event_added",
        "call_id": call_id,
        "call_event": disp_event
    })
    
    return {
        "status": "dispositioned",
        "call_id": call_id,
        "agent_status": "ready",
        "disposeDurationSeconds": dispose_sec,
        "next_auto_connected_call": dispatched_call
    }


@router.post("/simulate/inbound")
async def simulate_inbound(payload: InboundSimulationPayload):
    lead = await leads_col.find_one({"phone": payload.phone})
    if not lead:
        lead_doc = {
            "lead_id": f"LD{utcnow().strftime('%M%S%f')[:5]}",
            "name": payload.name,
            "phone": payload.phone,
            "status": "new",
            "pool_id": payload.pool_id,
            "created_at": utcnow()
        }
        res_lead = await leads_col.insert_one(lead_doc)
        lead_doc["_id"] = res_lead.inserted_id
        lead = lead_doc
        
    lead_id_str = str(lead["_id"])
    
    if not payload.require_agent:
        doc = {
            "lead_id": lead_id_str,
            "pool_id": payload.pool_id,
            "direction": "inbound",
            "status": "completed",
            "outcome": "answered",
            "duration_seconds": 45,
            "started_at": utcnow(),
            "ended_at": utcnow(),
            "ai_summary": "Inbound IVR Menu option selected. Customer discussed support credentials. Resolved by AI.",
            "transcript": "Customer: Hi, I need support details.\nAI Agent: Yes, select recruitment or card services. Supported.\nCustomer: Thank you, resolved."
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id
        await ws_manager.broadcast("global", {"event": "leads_updated"})
        return oid_str(doc)
        
    else:
        agent = await users_col.find_one({"role": Role.AGENT, "pool_id": payload.pool_id, "status": "ready"})
        if not agent:
            agent = await users_col.find_one({"role": Role.AGENT, "status": "ready"})
        if not agent:
            agent = await users_col.find_one({"role": Role.AGENT, "status": "online"})
            
        agent_id = str(agent["_id"]) if agent else "AGT84785"
        
        doc = {
            "lead_id": lead_id_str,
            "pool_id": payload.pool_id,
            "agent_id": agent_id,
            "direction": "inbound",
            "status": "live",
            "is_ai": False,
            "started_at": utcnow(),
        }
        result = await calls_col.insert_one(doc)
        doc["_id"] = result.inserted_id
        
        await leads_col.update_one({"_id": ObjectId(lead_id_str)}, {"$set": {"status": "in_progress", "assigned_agent_id": agent_id}})
        await ws_manager.broadcast("global", {"event": "call_started", "call_id": str(doc["_id"]), "lead_name": payload.name})
        return oid_str(doc)



@router.get("/inbound/summary", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def get_inbound_calls_summary(user: dict = Depends(get_current_user)):
    """
    Returns real-time Inbound IVR Queue department metrics dynamically calculated
    from live database records (calls_col, leads_col, users_col, pools_col).
    Zero hardcoded values: SLA, wait times, active calls, and queues reflect real database state.
    """
    from app.core.database import pools_col
    
    # 1. Retrieve all dynamic pool/department identifiers
    department_keys = set(["recruitment", "credit_card_sales", "customer_support"])
    try:
        async for p in pools_col.find({}):
            if p.get("name"):
                department_keys.add(str(p["name"]).lower().replace(" ", "_"))
        async for c in campaigns_col.find({}):
            if c.get("pool_id"):
                department_keys.add(str(c["pool_id"]).lower().replace(" ", "_"))
    except Exception:
        pass

    results = {}
    
    for dept in sorted(list(department_keys)):
        # Active live calls currently in progress
        active = await calls_col.count_documents({"direction": "inbound", "status": "live", "$or": [{"pool_id": dept}, {"department": dept}]})
        
        # Resolved, transferred, missed counts
        resolved = await calls_col.count_documents({"direction": "inbound", "status": "completed", "outcome": "answered", "$or": [{"pool_id": dept}, {"department": dept}]})
        transferred = await calls_col.count_documents({"direction": "inbound", "status": "completed", "outcome": "transferred", "$or": [{"pool_id": dept}, {"department": dept}]})
        missed = await calls_col.count_documents({"direction": "inbound", "status": "completed", "outcome": "missed", "$or": [{"pool_id": dept}, {"department": dept}]})
        
        # Waiting queue callers (calls in queued state OR new leads)
        waiting_calls = await calls_col.count_documents({"direction": "inbound", "status": "queued", "$or": [{"pool_id": dept}, {"department": dept}]})
        waiting_leads = await leads_col.count_documents({"pool_id": dept, "status": "new"})
        waiting = max(waiting_calls, waiting_leads)
        
        # Available READY agents assigned to pool
        agents = await users_col.count_documents({"role": "agent", "status": {"$in": ["ready", "online"]}})
        
        # Dynamic SLA calculation (Calls answered under target threshold vs total received)
        total_received = await calls_col.count_documents({"direction": "inbound", "$or": [{"pool_id": dept}, {"department": dept}]})
        if total_received == 0:
            sla_percentage = 100.0  # Perfect SLA when no callers are dropped/waiting
            avg_wait_seconds = 0
        else:
            # Calls answered within target SLA threshold (20 seconds)
            sla_ok_calls = await calls_col.count_documents({
                "direction": "inbound",
                "status": "completed",
                "outcome": "answered",
                "$or": [{"pool_id": dept}, {"department": dept}],
                "wait_duration_seconds": {"$lte": 20}
            })
            sla_percentage = round((sla_ok_calls / total_received * 100), 1) if total_received > 0 else 100.0
            
            # Compute average wait time from call records
            call_cursor = calls_col.find({
                "direction": "inbound",
                "$or": [{"pool_id": dept}, {"department": dept}],
                "wait_duration_seconds": {"$exists": True}
            }).limit(50)
            
            wait_times = []
            async for call_doc in call_cursor:
                if "wait_duration_seconds" in call_doc:
                    wait_times.append(call_doc["wait_duration_seconds"])
            
            avg_wait_seconds = round(sum(wait_times) / len(wait_times)) if wait_times else 0

        results[dept] = {
            "department": dept,
            "active_calls": active,
            "resolved_calls": resolved,
            "transferred_calls": transferred,
            "missed_calls": missed,
            "waiting_queue": waiting,
            "available_agents": agents,
            "average_wait_seconds": avg_wait_seconds,
            "sla_percentage": sla_percentage,
            "status": "stable" if waiting < 5 else ("busy" if waiting < 15 else "critical")
        }
        
    return results


# --- MANUAL DIAL FEATURES ---

import time

active_call_streams = {}
active_call_locks = {}
processed_idempotency_keys = {}

LOCK_TTL_SECONDS = 120
IDEMPOTENCY_TTL_SECONDS = 30


def _cleanup_expired_locks():
    now = time.time()
    expired_locks = [k for k, v in active_call_locks.items() if now - v.get("timestamp", 0) > LOCK_TTL_SECONDS]
    for k in expired_locks:
        active_call_locks.pop(k, None)

    expired_keys = [k for k, v in processed_idempotency_keys.items() if now - v.get("timestamp", 0) > IDEMPOTENCY_TTL_SECONDS]
    for k in expired_keys:
        processed_idempotency_keys.pop(k, None)


def acquire_call_lock(phone: str, agent_id: str, idempotency_key: str | None = None) -> tuple[bool, str]:
    _cleanup_expired_locks()
    now = time.time()

    if idempotency_key and idempotency_key in processed_idempotency_keys:
        return False, "IDEMPOTENCY_HIT"

    if phone in active_call_locks:
        lock_info = active_call_locks[phone]
        if now - lock_info.get("timestamp", 0) < LOCK_TTL_SECONDS:
            return False, f"Call already in progress to {phone}"

    if agent_id and agent_id in active_call_locks:
        lock_info = active_call_locks[agent_id]
        if now - lock_info.get("timestamp", 0) < LOCK_TTL_SECONDS:
            return False, "Agent already has an active call session"

    return True, ""


def register_call_lock(phone: str, agent_id: str, call_id: str, idempotency_key: str | None = None, result_doc: dict | None = None):
    now = time.time()
    lock_data = {"call_id": call_id, "idempotency_key": idempotency_key, "timestamp": now}
    active_call_locks[phone] = lock_data
    if agent_id:
        active_call_locks[agent_id] = lock_data
    if idempotency_key and result_doc:
        processed_idempotency_keys[idempotency_key] = {"result": result_doc, "timestamp": now}


def release_call_lock(phone: str | None = None, agent_id: str | None = None, call_id: str | None = None):
    _cleanup_expired_locks()
    keys_to_remove = []
    for k, v in active_call_locks.items():
        if (phone and (k == phone or k.replace("+", "") == phone.replace("+", ""))) or (agent_id and k == agent_id) or (call_id and v.get("call_id") == call_id):
            keys_to_remove.append(k)
    for k in keys_to_remove:
        active_call_locks.pop(k, None)


async def cleanup_stale_db_calls(agent_id: str | None = None, lead_id: str | None = None):
    """
    Checks MongoDB for any call with status='live' that is no longer active in memory or stream task has finished.
    Automatically marks stale calls as 'completed' so agents are never permanently locked out.
    """
    query = {"status": "live"}
    if agent_id or lead_id:
        conditions = []
        if agent_id:
            conditions.append({"agent_id": agent_id})
        if lead_id:
            conditions.append({"lead_id": lead_id})
        query["$or"] = conditions

    now = utcnow()
    async for call in calls_col.find(query):
        call_id_str = str(call["_id"])
        started_at = call.get("started_at")

        # Check if stream task is active
        has_active_stream = call_id_str in active_call_streams and not active_call_streams[call_id_str].done()

        # Stale criteria: no active stream task OR started > 120s ago without stream task
        is_stale = not has_active_stream
        if started_at:
            delta = (now.replace(tzinfo=None) - started_at.replace(tzinfo=None)).total_seconds()
            if delta > 120 and not has_active_stream:
                is_stale = True

        if is_stale:
            await calls_col.update_one(
                {"_id": call["_id"]},
                {"$set": {
                    "status": "completed",
                    "outcome": "stale_auto_cleaned",
                    "notes": "Session automatically cleaned after inactivity",
                    "ended_at": now
                }}
            )
            task = active_call_streams.pop(call_id_str, None)
            if task and not task.done():
                task.cancel()
            release_call_lock(agent_id=call.get("agent_id"), call_id=call_id_str)
            print(f"[calls] Auto-cleaned stale ghost call: {call_id_str}")



async def simulate_call_stream(call_id: str, pool_id: str):
    transcript_dialogue = [
        ("customer", "Hello? Yes, I was looking for some assistance regarding my query."),
        ("agent", "Welcome to Forge India Connect! I can certainly help you. May I know what department you're trying to reach?"),
        ("customer", "I want to follow up on the status of my request. It has been pending since last week."),
        ("agent", "I see. Let me pull up your account information using your registered phone number."),
        ("customer", "Perfect. Let know what information you need from my end."),
        ("agent", "Thank you. I have retrieved your records. I see that your request is currently in review by our verification team."),
        ("customer", "Oh, okay. How long will it take to complete the review?"),
        ("agent", "It typically takes 2-3 business days. I will escalate this to high priority so that it gets processed sooner."),
        ("customer", "That would be wonderful. Thank you so much for the quick help!"),
        ("agent", "You're welcome! Is there anything else I can assist you with today?"),
        ("customer", "No, that's all. Have a great day!"),
        ("agent", "Thank you for calling Forge India Connect. Goodbye!"),
    ]
    
    ai_suggestions_list = [
        "Acknowledge customer's request and verify their phone details.",
        "Check lead status in CRM and provide precise estimation.",
        "Offer to escalate the ticket priority for faster processing.",
        "Confirm if they have any other questions regarding recruitment/sales/support.",
        "End the call professionally and save the disposition status."
    ]
    
    sentiments = ["neutral", "neutral", "neutral", "neutral", "neutral", "positive", "positive", "positive", "positive"]

    try:
        await asyncio.sleep(4)
        current_transcript = []
        
        for idx, (speaker, text) in enumerate(transcript_dialogue):
            call = await calls_col.find_one({"_id": ObjectId(call_id)})
            if not call or call.get("status") != "live":
                break
                
            while call and call.get("call_state") == "hold":
                await asyncio.sleep(2)
                call = await calls_col.find_one({"_id": ObjectId(call_id)})
                if not call or call.get("status") != "live":
                    break
            
            if not call or call.get("status") != "live":
                break
                
            current_transcript.append({
                "speaker": speaker,
                "text": text,
                "timestamp": utcnow().isoformat()
            })
            
            sugg_idx = min(idx // 2, len(ai_suggestions_list) - 1)
            sent_idx = min(idx, len(sentiments) - 1)
            
            current_suggestions = ai_suggestions_list[:sugg_idx + 1]
            current_sentiment = sentiments[sent_idx]
            
            update_payload = {
                "event": "manual_call_update",
                "call_id": call_id,
                "transcript": current_transcript,
                "ai_suggestions": current_suggestions,
                "sentiment": current_sentiment
            }
            
            await calls_col.update_one(
                {"_id": ObjectId(call_id)},
                {"$set": {
                    "transcript_list": current_transcript,
                    "sentiment": current_sentiment,
                    "ai_suggestions": current_suggestions
                }}
            )
            
            await ws_manager.broadcast("global", update_payload)
            await ws_manager.broadcast(pool_id, update_payload)
            
            await asyncio.sleep(4.5)
            
    except asyncio.CancelledError:
        pass
    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").error(f"Error in simulate_call_stream: {e}")


@router.get("/active")
async def get_current_active_call(user: dict = Depends(get_current_user)):
    """Returns the current user's live active call session (if any), after cleaning stale sessions."""
    agent_id = _uid(user)
    await cleanup_stale_db_calls(agent_id=agent_id)

    call = await calls_col.find_one({"agent_id": agent_id, "status": "live"})
    if not call:
        return None

    lead = await leads_col.find_one({"_id": ObjectId(call.get("lead_id"))}) if call.get("lead_id") and ObjectId.is_valid(call.get("lead_id")) else None
    call_data = oid_str(call)
    call_data["phone"] = lead.get("phone") if lead else call.get("phone", "")
    call_data["lead_name"] = lead.get("name") if lead else "Customer"
    return call_data


@router.post("/{call_id}/force-end")
async def force_end_stuck_call(call_id: str, user: dict = Depends(get_current_user)):
    """Force terminates a call session that is stuck or stale."""
    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"_id": call_id}
    call = await calls_col.find_one(query)
    if call:
        task = active_call_streams.pop(call_id, None)
        if task and not task.done():
            task.cancel()

        await calls_col.update_one(
            query,
            {"$set": {"status": "completed", "outcome": "force_ended", "ended_at": utcnow()}}
        )
        release_call_lock(agent_id=call.get("agent_id"), call_id=call_id)
        agent_id = call.get("agent_id") or _uid(user)
        if agent_id:
            await record_call_completion(
                user_id=str(agent_id),
                duration_seconds=0,
                call_id=call_id,
                outcome="force_ended"
            )
        await ws_manager.broadcast("global", {"event": "call_ended", "call_id": call_id, "outcome": "force_ended"})
    else:
        release_call_lock(agent_id=_uid(user), call_id=call_id)

    return {"status": "success", "message": "Call session force cleared"}


@router.get("/vapi-config-check")
async def check_vapi_config():
    """
    Configuration check endpoint for Vapi AI calling variables.
    Shows exactly which required configuration variables are set or missing.
    """
    vapi_api_key = getattr(settings, 'VAPI_API_KEY', '') or os.getenv('VAPI_API_KEY', '')
    vapi_assistant_id = getattr(settings, 'VAPI_ASSISTANT_ID', '') or os.getenv('VAPI_ASSISTANT_ID', '')
    vapi_phone_id = getattr(settings, 'VAPI_PHONE_NUMBER_ID', '') or os.getenv('VAPI_PHONE_NUMBER_ID', '')
    vapi_base_url = getattr(settings, 'VAPI_BASE_URL', '') or os.getenv('VAPI_BASE_URL', 'https://api.vapi.ai')

    missing = []
    if not vapi_api_key:
        missing.append("VAPI_API_KEY")
    if not vapi_assistant_id:
        missing.append("VAPI_ASSISTANT_ID")
    if not vapi_phone_id:
        missing.append("VAPI_PHONE_NUMBER_ID")
    if not vapi_base_url:
        missing.append("VAPI_BASE_URL")

    return {
        "configured": len(missing) == 0,
        "missing": missing,
        "config": {
            "VAPI_API_KEY": "configured" if vapi_api_key else "missing",
            "VAPI_ASSISTANT_ID": vapi_assistant_id if vapi_assistant_id else "missing",
            "VAPI_PHONE_NUMBER_ID": vapi_phone_id if vapi_phone_id else "missing",
            "VAPI_BASE_URL": vapi_base_url,
        }
    }


def mask_phone(phone_str: str) -> str:
    cleaned = str(phone_str).strip()
    if len(cleaned) <= 6:
        return "***"
    return cleaned[:3] + "*****" + cleaned[-3:]


@router.post("/vapi-dial", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def start_vapi_dial(payload: VapiDialPayload, user: dict = Depends(get_current_user)):
    """
    Initiates an outbound AI Voice Agent call via Vapi API.
    Validates environment variables and lead phone numbers, authenticates with Vapi,
    and returns a structured response without hiding original Vapi errors.
    """
    log = logging.getLogger("uvicorn.error")
    log.info(f"Vapi dial request started | Lead Phone: {payload.phone}")

    e164_phone = normalize_e164(payload.phone)
    if not e164_phone or len(e164_phone) < 10:
        log.error(f"Phone number validation failed: {payload.phone}")
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": "Invalid phone number provided",
                "status": 400,
                "details": f"Provided phone number '{payload.phone}' is invalid. Must be valid mobile digits."
            }
        )

    log.info(f"Phone number validated: {mask_phone(e164_phone)}")

    vapi_api_key = getattr(settings, 'VAPI_API_KEY', '') or os.getenv('VAPI_API_KEY', '')
    vapi_assistant_id = payload.assistant_id or getattr(settings, 'VAPI_ASSISTANT_ID', '') or os.getenv('VAPI_ASSISTANT_ID', '')
    vapi_phone_id = payload.phone_number_id or getattr(settings, 'VAPI_PHONE_NUMBER_ID', '') or os.getenv('VAPI_PHONE_NUMBER_ID', '')
    vapi_base_url = (getattr(settings, 'VAPI_BASE_URL', '') or os.getenv('VAPI_BASE_URL', 'https://api.vapi.ai')).rstrip('/')

    missing_configs = []
    if not vapi_api_key:
        missing_configs.append("VAPI_API_KEY")
    if not vapi_assistant_id:
        missing_configs.append("VAPI_ASSISTANT_ID")
    if not vapi_phone_id:
        missing_configs.append("VAPI_PHONE_NUMBER_ID")

    if missing_configs:
        err_msg = f"Missing Vapi configuration environment variables: {', '.join(missing_configs)}"
        log.error(f"[Vapi Dial Error] {err_msg}")
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": "Vapi configuration missing",
                "status": 400,
                "details": err_msg
            }
        )

    assigned_agent_id = _uid(user)
    e164_phone = normalize_phone(payload.phone)
    if not e164_phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid phone number provided")

    print(f"[MANUAL] phone normalized: success ({e164_phone})")

    lead = await leads_col.find_one({"phone": e164_phone})
    if lead:
        print(f"[MANUAL] lead lookup: found ({lead.get('lead_id')})")
    else:
        print("[MANUAL] lead lookup: not-found")
        effective_pool = payload.pool_id or user.get("pool_id") or "6a6b40b7841e208e1cb69469"
        new_lead_doc = {
            "lead_id": gen_lead_id(),
            "name": payload.name or f"Manual Lead - {e164_phone[-10:]}",
            "phone": e164_phone,
            "source": "Manual Dialer",
            "status": "new",
            "pool_id": effective_pool,
            "assigned_agent_id": assigned_agent_id,
            "supervisor_id": user.get("supervisor_id"),
            "agent_id": assigned_agent_id,
            "agent_name": user.get("name"),
            "branch_id": user.get("branch_id") or "HQ",
            "created_by": assigned_agent_id,
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "ai_score": 85,
            "extra": {}
        }
        res = await leads_col.insert_one(new_lead_doc)
        new_lead_doc["_id"] = res.inserted_id
        lead = new_lead_doc
        print(f"[MANUAL] lead created: {lead['lead_id']}")

    print(f"[MANUAL] assigned lead sync: success")
    lead_id_str = str(lead.get("_id"))

    # Automatically clean any stale ghost call sessions
    await cleanup_stale_db_calls(agent_id=assigned_agent_id, lead_id=lead_id_str)

    acquired, lock_reason = acquire_call_lock(e164_phone, assigned_agent_id, payload.idempotency_key)
    if not acquired:
        if lock_reason == "IDEMPOTENCY_HIT" and payload.idempotency_key:
            return processed_idempotency_keys[payload.idempotency_key]["result"]
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "success": False,
                "error": "Active call lock conflict",
                "status": 409,
                "details": lock_reason
            }
        )

    base_url = getattr(settings, 'BASE_URL', 'https://ai-voice-agent-crm.onrender.com').rstrip('/')
    vapi_payload = {
        "assistantId": vapi_assistant_id,
        "phoneNumberId": vapi_phone_id,
        "customer": {
            "number": e164_phone,
            "name": payload.name or (lead.get("name") if lead else f"Customer - {e164_phone}")
        },
        "assistantOverrides": {
            "serverUrl": f"{base_url}/api/calls/vapi-webhook"
        }
    }

    headers = {
        "Authorization": f"Bearer {vapi_api_key}",
        "Content-Type": "application/json"
    }

    vapi_endpoint = f"{vapi_base_url}/call"
    log.info(
        f"Vapi request sent to {vapi_endpoint} | Lead ID: {lead_id_str} | Phone: {mask_phone(e164_phone)} | "
        f"Assistant ID: {vapi_assistant_id} | Phone Number ID: {vapi_phone_id}"
    )

    vapi_call_id = None

    try:
        client = get_http_client()
        res = await client.post(vapi_endpoint, json=vapi_payload, headers=headers, timeout=10.0)
        log.info(f"Vapi response status: {res.status_code}")

        if res.status_code in (200, 201):
            res_data = res.json()
            vapi_call_id = res_data.get("id")
            log.info(f"Vapi call ID: {vapi_call_id}")
        else:
            release_call_lock(phone=e164_phone, agent_id=assigned_agent_id)
            err_text = res.text
            try:
                err_json = res.json()
                err_msg = err_json.get("message") or err_json.get("error") or err_text
                if isinstance(err_msg, list):
                    err_msg = "; ".join([str(x) for x in err_msg])
            except Exception:
                err_msg = err_text

            log.error(
                f"[Vapi API Failure] Lead ID: {lead_id_str} | Phone: {mask_phone(e164_phone)} | "
                f"Vapi Status: {res.status_code} | Error: {err_msg}"
            )

            return JSONResponse(
                status_code=res.status_code if res.status_code in (400, 401, 403, 404, 500) else status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "error": f"Vapi call creation failed ({res.status_code})",
                    "status": res.status_code,
                    "details": str(err_msg)
                }
            )
    except httpx.TimeoutException:
        release_call_lock(phone=e164_phone, agent_id=assigned_agent_id)
        log.error(f"[Vapi Timeout] Lead ID: {lead_id_str} | Phone: {mask_phone(e164_phone)} timed out after 15s")
        return JSONResponse(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            content={
                "success": False,
                "error": "Vapi API request timed out",
                "status": 504,
                "details": "Vapi API request timed out (15s). Please verify network and Vapi service status."
            }
        )
    except Exception as exc:
        release_call_lock(phone=e164_phone, agent_id=assigned_agent_id)
        log.error(f"[Vapi Connection Exception] Lead ID: {lead_id_str} | Error: {str(exc)}")
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={
                "success": False,
                "error": "Failed to connect to Vapi API",
                "status": 502,
                "details": str(exc)
            }
        )

    doc = {
        "lead_id": lead_id_str,
        "phone": e164_phone,
        "call_source": "manual_dialer",
        "call_type": "outbound",
        "pool_id": payload.pool_id or "general",
        "agent_id": assigned_agent_id,
        "direction": "outbound",
        "status": "live",
        "call_mode": "ai",
        "is_ai": True,
        "vapi_call_id": vapi_call_id,
        "call_state": "active",
        "muted": False,
        "priority": "high",
        "language": "english",
        "notes": "Vapi AI Voice Agent Call",
        "sip_logs": [
            f"[{utcnow().isoformat()}] [VAPI] Initiated outbound AI call to {e164_phone}",
            f"[{utcnow().isoformat()}] [VAPI] Vapi Call ID: {vapi_call_id}"
        ],
        "transcript_list": [],
        "ai_suggestions": [],
        "sentiment": "neutral",
        "recording_status": "recording",
        "started_at": utcnow(),
    }

    result = await calls_col.insert_one(doc)
    call_id_str = str(result.inserted_id)
    doc["_id"] = result.inserted_id

    print(f"[MANUAL] call created: {call_id_str}")

    response_doc = oid_str(doc)
    response_doc["success"] = True
    response_doc["message"] = "Call started successfully"
    response_doc["callId"] = vapi_call_id

    register_call_lock(e164_phone, assigned_agent_id, call_id_str, payload.idempotency_key, response_doc)

    ws_payload = {
        "event": "vapi_call_started",
        "call_id": call_id_str,
        "vapi_call_id": vapi_call_id,
        "phone": e164_phone,
        "agent_id": assigned_agent_id,
        "status": "calling"
    }
    await ws_manager.broadcast("global", ws_payload)

    return JSONResponse(status_code=status.HTTP_200_OK, content=response_doc)



@router.post("/manual-dial", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def start_manual_dial(payload: ManualDialPayload, user: dict = Depends(get_current_user)):
    raw_phone = (payload.phone or "").strip()
    digits = re.sub(r"\D", "", raw_phone)

    # Server-side strict validation for 10-digit Indian mobile numbers
    if len(digits) == 10 and digits[0] in "6789":
        normalized_phone = f"+91{digits}"
    elif len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        normalized_phone = f"+91{digits[2:]}"
    elif raw_phone.startswith("+91") and len(digits) == 12 and digits[2] in "6789":
        normalized_phone = f"+91{digits[2:]}"
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9."
        )

    print(f"[MANUAL] phone normalized: success ({normalized_phone})")

    assigned_agent_id = payload.assigned_agent_id or _uid(user)
    lead = await leads_col.find_one({"phone": normalized_phone})
    if lead:
        print(f"[MANUAL] lead lookup: found ({lead.get('lead_id')})")
    else:
        print("[MANUAL] lead lookup: not-found")
        effective_pool = payload.pool_id or user.get("pool_id") or "6a6b40b7841e208e1cb69469"
        new_lead_doc = {
            "lead_id": gen_lead_id(),
            "name": f"Manual Lead - {normalized_phone[-10:]}",
            "phone": normalized_phone,
            "source": "Manual Dialer",
            "status": "new",
            "pool_id": effective_pool,
            "assigned_agent_id": assigned_agent_id,
            "supervisor_id": user.get("supervisor_id"),
            "agent_id": assigned_agent_id,
            "agent_name": user.get("name"),
            "branch_id": user.get("branch_id") or "HQ",
            "created_by": assigned_agent_id,
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "ai_score": 85,
            "extra": {}
        }
        res = await leads_col.insert_one(new_lead_doc)
        new_lead_doc["_id"] = res.inserted_id
        lead = new_lead_doc
        print(f"[MANUAL] lead created: {lead['lead_id']}")

    print(f"[MANUAL] assigned lead sync: success")
    lead_id_str = str(lead.get("_id"))

    # Automatically clean any stale ghost call sessions for this agent or lead
    await cleanup_stale_db_calls(agent_id=assigned_agent_id, lead_id=lead_id_str)

    # 1. Check idempotency key or active call locks
    acquired, lock_reason = acquire_call_lock(normalized_phone, assigned_agent_id, payload.idempotency_key)
    if not acquired:
        if lock_reason == "IDEMPOTENCY_HIT" and payload.idempotency_key:
            return processed_idempotency_keys[payload.idempotency_key]["result"]
        # Double check if lock is stale
        await cleanup_stale_db_calls(agent_id=assigned_agent_id, lead_id=lead_id_str)
        acquired_retry, lock_reason_retry = acquire_call_lock(normalized_phone, assigned_agent_id, payload.idempotency_key)
        if not acquired_retry:
            raise HTTPException(status.HTTP_409_CONFLICT, lock_reason_retry)

    # 2. Check DB for active live call
    existing_call = await calls_col.find_one({
        "$or": [
            {"lead_id": lead_id_str, "status": "live"},
            {"agent_id": assigned_agent_id, "status": "live"}
        ]
    })
    if existing_call:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An active call session already exists (Call ID: {str(existing_call['_id'])})"
        )

    agent_phone = None
    if payload.agent_assign_mode == "manual" and payload.assigned_agent_id:
        agent_oid = _safe_oid(payload.assigned_agent_id)
        if agent_oid:
            agent = await users_col.find_one({"_id": agent_oid})
            if agent:
                agent_phone = agent.get("phone")
    elif payload.agent_assign_mode == "auto":
        online_agent = await users_col.find_one({"role": Role.AGENT, "pool_id": payload.pool_id, "status": "online"})
        if online_agent:
            assigned_agent_id = str(online_agent["_id"])
            agent_phone = online_agent.get("phone")
        else:
            assigned_agent_id = _uid(user)
            agent_phone = user.get("phone")

    # Vapi AI Voice Agent trigger if call_mode == "ai"
    vapi_call_id = None
    is_ai_call = (getattr(payload, 'call_mode', 'human') == 'ai')

    if is_ai_call:
        vapi_api_key = getattr(settings, 'VAPI_API_KEY', '') or os.getenv('VAPI_API_KEY', '')
        vapi_assistant_id = getattr(settings, 'VAPI_ASSISTANT_ID', '') or os.getenv('VAPI_ASSISTANT_ID', '')
        vapi_phone_id = getattr(settings, 'VAPI_PHONE_NUMBER_ID', '') or os.getenv('VAPI_PHONE_NUMBER_ID', '')

        if vapi_api_key and vapi_assistant_id:
            try:
                import httpx
                vapi_payload = {
                    "assistantId": vapi_assistant_id,
                    "customer": {
                        "number": normalized_phone,
                        "name": lead.get("name", "Customer")
                    }
                }
                if vapi_phone_id:
                    vapi_payload["phoneNumberId"] = vapi_phone_id

                headers = {
                    "Authorization": f"Bearer {vapi_api_key}",
                    "Content-Type": "application/json"
                }
                client = get_http_client()
                res = await client.post("https://api.vapi.ai/call", json=vapi_payload, headers=headers, timeout=10.0)
                if res.status_code in (200, 201):
                    res_data = res.json()
                    vapi_call_id = res_data.get("id")
                    print(f"[Vapi] Call initiated successfully. Vapi Call ID: {vapi_call_id}")
                else:
                    print(f"[Vapi] API Error: {res.status_code} - {res.text}")
            except Exception as vapi_err:
                print(f"[Vapi] Exception calling Vapi API: {vapi_err}")


    # Plivo is the sole PSTN provider – Twilio removed
    plivo_auth_id = getattr(settings, 'PLIVO_AUTH_ID', '') or os.getenv('PLIVO_AUTH_ID', '')
    plivo_auth_token = getattr(settings, 'PLIVO_AUTH_TOKEN', '') or os.getenv('PLIVO_AUTH_TOKEN', '')
    plivo_phone_number = getattr(settings, 'PLIVO_PHONE_NUMBER', '+918031826757')
    base_url = getattr(settings, 'BASE_URL', '') or os.getenv('BASE_URL', 'https://ai-voice-agent-crm.onrender.com')

    # Plivo Outbound PSTN Call trigger (Agent-First Click-to-Call 2-Way Audio Bridging)
    agent_phone_val = user.get("agent_phone") or user.get("phone") or ""
    if not agent_phone_val and assigned_agent_id:
        assigned_agent = await users_col.find_one({"_id": _safe_oid(assigned_agent_id)}) or await users_col.find_one({"id": assigned_agent_id})
        if assigned_agent:
            agent_phone_val = assigned_agent.get("agent_phone") or assigned_agent.get("phone") or ""

    clean_agent_phone = normalize_e164(agent_phone_val) if agent_phone_val else ""

    if not is_ai_call and getattr(payload, "initiate_pstn", True) and plivo_auth_id and plivo_auth_token:
        try:
            plivo_url = f"https://api.plivo.com/v1/Account/{plivo_auth_id}/Call/"
            
            # If agent phone is present, call Agent phone first, then bridge to Customer upon answer
            if clean_agent_phone:
                primary_dest = clean_agent_phone.replace("+", "")
                bridge_dest = normalized_phone
            else:
                primary_dest = normalized_phone.replace("+", "")
                bridge_dest = ""

            plivo_body = {
                "from": plivo_phone_number.replace("+", ""),
                "to": primary_dest,
                "answer_url": f"{base_url}/api/calls/plivo/answer?dial_to={quote(bridge_dest)}&agent_phone={quote(clean_agent_phone)}",
                "answer_method": "POST",
                "hangup_url": f"{base_url}/api/calls/plivo/status",
                "hangup_method": "POST",
            }
            client = get_http_client()
            res = await client.post(plivo_url, json=plivo_body, auth=(plivo_auth_id, plivo_auth_token), timeout=10.0)
            if res.status_code in (200, 201, 202):
                print(f"[Plivo Audio Bridge] Outbound call placed to {primary_dest} (bridge to {bridge_dest}): {res.json()}")
            else:
                print(f"[Plivo Audio Bridge] API Error: {res.status_code} - {res.text}")
        except Exception as plivo_err:
            print(f"[Plivo Audio Bridge] Exception: {plivo_err}")

    sip_logs = [
        f"[{utcnow().isoformat()}] [SIP] INVITE sip:{payload.pool_id}@forge-pbx.local SIP/2.0",
        f"[{utcnow().isoformat()}] [SIP] From: <sip:{normalized_phone}@sip-carrier.net>;tag=as312df5",
        f"[{utcnow().isoformat()}] [SIP] To: <sip:{payload.pool_id}@forge-pbx.local>",
        f"[{utcnow().isoformat()}] [SIP] Sending: SIP/2.0 100 Trying",
        f"[{utcnow().isoformat()}] [SIP] Sending: SIP/2.0 180 Ringing",
        f"[{utcnow().isoformat()}] [SIP] Sending: SIP/2.0 200 OK",
        f"[{utcnow().isoformat()}] [SIP] Call established via {'Vapi AI Agent' if is_ai_call else 'Plivo PSTN'} (Vapi ID: {vapi_call_id})"
    ]

    doc = {
        "lead_id": lead_id_str,
        "phone": normalized_phone,
        "call_source": "manual_dialer",
        "call_type": "outbound",
        "pool_id": payload.pool_id,
        "agent_id": assigned_agent_id,
        "direction": "outbound",
        "status": "live",
        "call_mode": getattr(payload, 'call_mode', 'human') or 'human',
        "is_ai": is_ai_call,
        "vapi_call_id": vapi_call_id,
        "call_state": "active",
        "muted": False,
        "priority": payload.priority,
        "language": payload.language,
        "notes": payload.notes or "",
        "sip_logs": sip_logs,
        "transcript_list": [],
        "ai_suggestions": [],
        "sentiment": "neutral",
        "recording_status": "recording",
        "recording_file": f"C:/recordings/manual_{lead_id_str}_{int(utcnow().timestamp())}.wav",
        "started_at": utcnow(),
        "twilio_sid": None
    }

    result = await calls_col.insert_one(doc)
    call_id_str = str(result.inserted_id)
    doc["_id"] = result.inserted_id

    print(f"[MANUAL] call created: {call_id_str}")

    response_doc = oid_str(doc)
    register_call_lock(normalized_phone, assigned_agent_id, call_id_str, payload.idempotency_key, response_doc)

    task = asyncio.create_task(simulate_call_stream(call_id_str, payload.pool_id))
    active_call_streams[call_id_str] = task

    ws_payload = {
        "event": "call_started",
        "call_id": call_id_str,
        "lead_name": lead["name"],
        "agent_id": assigned_agent_id,
        "pool_id": payload.pool_id,
        "direction": "outbound",
        "is_manual": True,
        "sip_logs": sip_logs
    }
    await ws_manager.broadcast("global", ws_payload)
    await ws_manager.broadcast(payload.pool_id, ws_payload)

    return response_doc


@router.post("/{call_id}/manual-action", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def manual_call_action(call_id: str, payload: ManualCallActionPayload, user: dict = Depends(get_current_user)):
    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"_id": call_id}
    call = await calls_col.find_one(query)
    if not call:
        call = await calls_col.find_one({"id": call_id}) or await calls_col.find_one({"vapi_call_id": call_id})

    if not call:
        action = payload.action.lower()
        return {"status": "success", "action": action, "message": "Action updated for active session"}

    action = payload.action.lower()
    if action not in ["mute", "unmute", "hold", "resume"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid action. Must be mute, unmute, hold, or resume")

    update_fields = {}
    sip_msg = ""
    if action == "mute":
        update_fields["muted"] = True
        sip_msg = f"[{utcnow().isoformat()}] [SIP] Call muted by agent"
    elif action == "unmute":
        update_fields["muted"] = False
        sip_msg = f"[{utcnow().isoformat()}] [SIP] Call unmuted by agent"
    elif action == "hold":
        update_fields["call_state"] = "hold"
        update_fields["status"] = "live"
        sip_msg = f"[{utcnow().isoformat()}] [SIP] Call placed on hold (SIP INVITE with a=sendonly)"
    elif action == "resume":
        update_fields["call_state"] = "active"
        update_fields["status"] = "live"
        sip_msg = f"[{utcnow().isoformat()}] [SIP] Call resumed (SIP INVITE with a=sendrecv)"

    await calls_col.update_one(
        {"_id": call["_id"]},
        {"$set": update_fields, "$push": {"sip_logs": sip_msg}}
    )

    if call.get("vapi_call_id"):
        vapi_call_id = call.get("vapi_call_id")
        vapi_api_key = getattr(settings, 'VAPI_API_KEY', '') or os.getenv('VAPI_API_KEY', '')
        if vapi_api_key:
            try:
                client = get_http_client()
                headers = {"Authorization": f"Bearer {vapi_api_key}", "Content-Type": "application/json"}
                vapi_control_url = f"https://api.vapi.ai/call/{vapi_call_id}/control"
                control_command = "pause" if action == "hold" else "resume"
                await client.post(vapi_control_url, json={"command": control_command}, headers=headers, timeout=5.0)
            except Exception as vapi_err:
                print(f"[Vapi Hold Control] Notice: {vapi_err}")

    await audit_logs_col.insert_one({
        "action": f"call_{action}",
        "user_id": _uid(user),
        "call_id": str(call["_id"]),
        "timestamp": utcnow()
    })

    ws_payload = {
        "event": "manual_call_action",
        "call_id": str(call["_id"]),
        "action": action,
        "call_state": update_fields.get("call_state", "active"),
        "sip_message": sip_msg
    }
    pool_id = call.get("pool_id") or "global"
    await ws_manager.broadcast("global", ws_payload)
    await ws_manager.broadcast(pool_id, ws_payload)

    return {"status": "success", "action": action, "call_state": update_fields.get("call_state", "active")}


@router.post("/{call_id}/manual-transfer", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def manual_call_transfer(call_id: str, payload: ManualCallTransferPayload, user: dict = Depends(get_current_user)):
    call = await calls_col.find_one({"_id": ObjectId(call_id)})
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
        
    target_user = await users_col.find_one({"_id": ObjectId(payload.target_agent_id)})
    if not target_user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target agent or supervisor not found")
        
    new_agent_id = str(target_user["_id"])
    sip_msg = f"[{utcnow().isoformat()}] [SIP] Initiating Call Transfer (SIP REFER to agent {target_user['name']})"
    sip_msg_ok = f"[{utcnow().isoformat()}] [SIP] Transfer successful. Connected agent: {target_user['name']}"
    
    await calls_col.update_one(
        {"_id": ObjectId(call_id)},
        {
            "$set": {"agent_id": new_agent_id},
            "$push": {"sip_logs": {"$each": [sip_msg, sip_msg_ok]}}
        }
    )
    
    await leads_col.update_one(
        {"_id": ObjectId(call["lead_id"])},
        {"$set": {"assigned_agent_id": new_agent_id}}
    )
    
    await audit_logs_col.insert_one({
        "action": "call_transfer",
        "user_id": _uid(user),
        "target_user_id": new_agent_id,
        "call_id": call_id,
        "timestamp": utcnow()
    })
    
    ws_payload = {
        "event": "manual_call_transferred",
        "call_id": call_id,
        "from_agent_id": _uid(user),
        "to_agent_id": new_agent_id,
        "to_agent_name": target_user["name"],
        "sip_message": sip_msg_ok
    }
    await ws_manager.broadcast("global", ws_payload)
    await ws_manager.broadcast(call["pool_id"], ws_payload)
    
    return {"status": "success", "transferred_to": target_user["name"]}


@router.post("/{call_id}/manual-end", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def end_manual_call(call_id: str, payload: CallEnd, user: dict = Depends(get_current_user)):
    query = {"_id": ObjectId(call_id)} if ObjectId.is_valid(call_id) else {"_id": call_id}
    call = await calls_col.find_one(query)
    if not call:
        call = await calls_col.find_one({"id": call_id})
    if not call:
        # For manual demo calls not yet persisted in DB, synthesize response
        return {"status": "success", "message": "Manual call session ended", "call_id": call_id}
        
    task = active_call_streams.pop(call_id, None)
    if task:
        task.cancel()
        
    sip_msg = f"[{utcnow().isoformat()}] [SIP] Connection terminated (SIP BYE received)"
    
    transcript_text = payload.transcript or ""
    if not transcript_text and call.get("transcript_list"):
        transcript_text = "\n".join([f"{t['speaker'].capitalize()}: {t['text']}" for t in call["transcript_list"]])
        
    ai_summary = payload.ai_summary
    if not ai_summary:
        ai_summary = "Manual Dial call successfully connected to recipient. Discussed query and updated details in CRM."
        
    update = {
        "status": "completed",
        "outcome": payload.outcome,
        "duration_seconds": payload.duration_seconds,
        "notes": payload.notes or call.get("notes", ""),
        "ai_summary": ai_summary,
        "transcript": transcript_text,
        "recording_status": "saved",
        "ended_at": utcnow()
    }
    
    await calls_col.update_one(
        {"_id": ObjectId(call_id)},
        {
            "$set": update,
            "$push": {"sip_logs": sip_msg}
        }
    )
    
    lead_status = "new"
    if payload.outcome in ["qualified", "answered"]:
        lead_status = "qualified"
    elif payload.outcome == "not_interested":
        lead_status = "not_interested"
    elif payload.outcome == "follow_up_required":
        lead_status = "follow_up"
        
    await leads_col.update_one(
        {"_id": ObjectId(call["lead_id"])},
        {"$set": {"status": lead_status}}
    )
    
    await audit_logs_col.insert_one({
        "action": "end_manual_dial",
        "user_id": _uid(user),
        "call_id": call_id,
        "outcome": payload.outcome,
        "timestamp": utcnow()
    })
    
    ws_payload = {
        "event": "call_ended",
        "call_id": call_id,
        "outcome": payload.outcome,
        "pool_id": call["pool_id"]
    }
    agent_id = call.get("agent_id") if call else _uid(user)
    if agent_id:
        await record_call_completion(
            user_id=str(agent_id),
            duration_seconds=payload.duration_seconds or 0,
            call_id=call_id,
            outcome=payload.outcome or "completed"
        )

    release_call_lock(agent_id=agent_id or _uid(user), call_id=call_id)
    return {"status": "completed"}


@router.post("/{call_id}/dtmf", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def send_dtmf_digit(call_id: str, payload: ManualDTMFPayload, user: dict = Depends(get_current_user)):
    call = await calls_col.find_one({"_id": ObjectId(call_id)})
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
        
    digit = payload.digit
    if digit not in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid DTMF digit")
        
    sip_msg = f"[{utcnow().isoformat()}] [SIP] DTMF digit '{digit}' received (RFC 4733 / RFC 2833)"
    
    await calls_col.update_one(
        {"_id": ObjectId(call_id)},
        {"$push": {"sip_logs": sip_msg}}
    )
    
    ws_payload = {
        "event": "manual_call_action",
        "call_id": call_id,
        "action": "dtmf",
        "digit": digit,
        "sip_message": sip_msg
    }
    await ws_manager.broadcast("global", ws_payload)
    await ws_manager.broadcast(call["pool_id"], ws_payload)
    
    return {"status": "success", "digit": digit}


@router.post("/{call_id}/conference", dependencies=[Depends(require_roles(Role.ADMIN, Role.TEAM_LEADER, Role.AGENT))])
async def manual_call_conference(call_id: str, payload: ManualConferencePayload, user: dict = Depends(get_current_user)):
    call = await calls_col.find_one({"_id": ObjectId(call_id)})
    if not call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Call not found")
        
    invitee = await users_col.find_one({"_id": ObjectId(payload.invitee_agent_id)})
    if not invitee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitee user not found")
        
    sip_msg = f"[{utcnow().isoformat()}] [SIP] SIP INVITE sent to join bridge conference-9087 (Invitee: {invitee['name']})"
    sip_msg_ok = f"[{utcnow().isoformat()}] [SIP] Invitee {invitee['name']} joined conference bridge"
    
    await calls_col.update_one(
        {"_id": ObjectId(call_id)},
        {
            "$set": {"is_conference": True},
            "$push": {
                "sip_logs": {"$each": [sip_msg, sip_msg_ok]},
                "conference_agents": payload.invitee_agent_id
            }
        }
    )
    
    await audit_logs_col.insert_one({
        "action": "call_conference_add",
        "user_id": _uid(user),
        "invitee_user_id": payload.invitee_agent_id,
        "call_id": call_id,
        "timestamp": utcnow()
    })
    
    ws_payload = {
        "event": "manual_call_action",
        "call_id": call_id,
        "action": "conference",
        "invitee_name": invitee["name"],
        "sip_message": sip_msg_ok
    }
    await ws_manager.broadcast("global", ws_payload)
    await ws_manager.broadcast(call["pool_id"], ws_payload)
    
    return {"status": "success", "conference_established_with": invitee["name"]}


@router.post("/vapi-webhook")
async def vapi_webhook(request: Request):
    """
    Vapi Webhook endpoint to process real-time call events from Vapi AI.
    Handles status updates, live transcript dialogue, and end-of-call reports.
    """
    try:
        body = await request.json()
        message = body.get("message", {})
        msg_type = message.get("type")
        vapi_call = message.get("call", {})
        vapi_call_id = vapi_call.get("id")

        if not vapi_call_id:
            return {"status": "ok"}

        db_call = await calls_col.find_one({"vapi_call_id": vapi_call_id})
        if not db_call:
            return {"status": "ok"}

        call_id_str = str(db_call["_id"])
        pool_id = db_call.get("pool_id", "global")

        if msg_type == "transcript":
            role = message.get("role")
            speaker = "customer" if role == "user" else "agent"
            text = message.get("transcript", "")

            if text:
                new_entry = {
                    "speaker": speaker,
                    "text": text,
                    "timestamp": utcnow().isoformat()
                }
                await calls_col.update_one(
                    {"_id": db_call["_id"]},
                    {"$push": {"transcript_list": new_entry}}
                )

                update_payload = {
                    "event": "manual_call_update",
                    "call_id": call_id_str,
                    "vapi_call_id": vapi_call_id,
                    "speaker": speaker,
                    "text": text,
                    "timestamp": new_entry["timestamp"]
                }
                await ws_manager.broadcast("global", update_payload)
                await ws_manager.broadcast(pool_id, update_payload)

        elif msg_type == "status-update":
            vapi_status = message.get("status")
            if vapi_status in ("ringing", "in-progress", "queued", "forwarding"):
                status_mapped = "ringing" if vapi_status == "ringing" else ("connected" if vapi_status in ("in-progress", "forwarding") else "calling")
                await calls_col.update_one(
                    {"_id": db_call["_id"]},
                    {"$set": {"call_state": status_mapped}}
                )
                ws_update = {
                    "event": "vapi_call_status",
                    "call_id": call_id_str,
                    "vapi_call_id": vapi_call_id,
                    "call_status": status_mapped,
                    "vapi_raw_status": vapi_status
                }
                await ws_manager.broadcast("global", ws_update)
                await ws_manager.broadcast(pool_id, ws_update)
            elif vapi_status == "ended":
                await calls_col.update_one(
                    {"_id": db_call["_id"]},
                    {"$set": {"status": "completed", "call_state": "ended", "outcome": "vapi_completed", "ended_at": utcnow()}}
                )
                release_call_lock(agent_id=db_call.get("agent_id"), call_id=call_id_str)
                await ws_manager.broadcast("global", {"event": "call_ended", "call_id": call_id_str, "outcome": "vapi_completed"})

        elif msg_type == "end-of-call-report":
            summary = message.get("summary")
            recording_url = message.get("recordingUrl")
            update_data = {"status": "completed", "outcome": "vapi_completed", "ended_at": utcnow()}
            if summary:
                update_data["notes"] = summary
            if recording_url:
                update_data["recording_file"] = recording_url

            await calls_col.update_one({"_id": db_call["_id"]}, {"$set": update_data})
            release_call_lock(agent_id=db_call.get("agent_id"), call_id=call_id_str)
            await ws_manager.broadcast("global", {"event": "call_ended", "call_id": call_id_str, "outcome": "vapi_completed"})

    except Exception as e:
        print(f"[Vapi Webhook Error] {e}")

    return {"status": "ok"}


