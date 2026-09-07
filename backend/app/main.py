import logging
import time
import traceback

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException, Request, status
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.gzip import GZipMiddleware
from app.core.config import settings
from app.core.database import init_indexes, check_db_connection
from app.core.http import get_http_client, close_http_client
from app.routes import auth, users, pools, campaigns, leads, calls, leave, reports, ws, ai_agents, presence, attendance, recordings

# ── Logging ──────────────────────────────────────────────────────────────────
logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="Forge India Connect — AI Voice Calling CRM API",
    description="Backend for the AI Voice Calling CRM: auth/RBAC, pools (departments), "
                "campaigns, lead import/assignment, call logging, live monitoring, "
                "leave management and reporting backed by local MongoDB.",
    version="0.1.0",
)

# Enable GZip compression for payloads >= 1000 bytes
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── CORS ─────────────────────────────────────────────────────────────────────
# IMPORTANT: allow_origins=["*"] + allow_credentials=True is spec-invalid.
# Browsers silently drop the Access-Control-Allow-Origin header.
# We must list explicit origins when credentials are enabled.
allowed_origins = [
    settings.FRONTEND_ORIGIN,          # http://localhost:5173
    "https://ai-voice-agent-crm.onrender.com", # Production Render domain
    "http://localhost:5173",            # explicit fallback
    "http://127.0.0.1:5173",           # alt localhost
    "http://192.168.1.54:5173",         # LAN origin
    "http://localhost:3000",            # alternate dev port
    "app://.",                          # Electron origin
    "file://*",                         # Electron origin
]
# De-duplicate while preserving order
allowed_origins = list(dict.fromkeys(allowed_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
    max_age=600,  # Cache preflight for 10 minutes
)


# ── Request / Response Performance Timing Middleware ─────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    method = request.method
    path = request.url.path

    try:
        response = await call_next(request)
    except Exception:
        logger.error(f"[PERF] [{method}] {path} — Unhandled exception during request processing")
        raise

    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(f"[PERF] {method} {path} → {response.status_code} → {elapsed_ms}ms")
    return response


# ── Global Exception Handler ────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch any unhandled exception and return a structured JSON 500 response with CORS headers."""
    logger.error(
        f"Unhandled exception on {request.method} {request.url.path}:\n"
        f"{traceback.format_exc()}"
    )
    origin = request.headers.get("origin")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Internal server error: {str(exc)}"},
        headers=headers,
    )


# ── Routes ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(pools.router)
app.include_router(campaigns.router)
app.include_router(leads.router)
# Duplication removed
app.include_router(calls.router)
app.include_router(leave.router)
app.include_router(reports.router)
app.include_router(ws.router)
app.include_router(ai_agents.router)
app.include_router(presence.router)
app.include_router(presence.agent_router)
app.include_router(presence.agents_router)
app.include_router(presence.session_router)
app.include_router(presence.root_session_router)
app.include_router(attendance.router)
app.include_router(recordings.router)


# ── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    get_http_client()
    db_ok = await check_db_connection()
    if db_ok:
        await init_indexes()
        logger.info("[PERF] MongoDB connected and indexes initialized.")
        
        # Seed default public holidays if missing
        from app.core.database import holidays_col, users_col, pools_col
        from app.core.security import hash_password, verify_password
        from app.core.utils import utcnow, gen_employee_id
        
        default_holidays = [
            {"date": "2026-01-01", "name": "New Year's Day", "description": "Global New Year Celebration"},
            {"date": "2026-01-26", "name": "Republic Day", "description": "National Holiday"},
            {"date": "2026-08-15", "name": "Independence Day", "description": "National Holiday"},
            {"date": "2026-10-02", "name": "Gandhi Jayanti", "description": "Mahatma Gandhi Birthday"},
            {"date": "2026-12-25", "name": "Christmas Day", "description": "Christmas Celebration"},
        ]
        for h in default_holidays:
            existing_h = await holidays_col.find_one({"date": h["date"]})
            if not existing_h:
                h["created_at"] = utcnow()
                h["updated_at"] = utcnow()
                await holidays_col.insert_one(h)
                logger.info(f"Seeded holiday: {h['name']} ({h['date']})")

        # Seed default system accounts if missing or password hash needs updating
        try:
            # Migrate legacy 'supervisor' roles to 'team_leader' in DB
            await users_col.update_many({"role": "supervisor"}, {"$set": {"role": "team_leader"}})

            default_users = [
                {"name": "System Admin", "email": "admin@forgeindia.com", "raw_p": "Admin@123", "password": hash_password("Admin@123"), "role": "admin", "employee_id": gen_employee_id("admin"), "is_active": True, "created_at": utcnow()},
                {"name": "Team Leader", "email": "tl@forgeindia.com", "raw_p": "Leader@123", "password": hash_password("Leader@123"), "role": "team_leader", "employee_id": gen_employee_id("team_leader"), "is_active": True, "created_at": utcnow()},
                {"name": "Sales Agent", "email": "agent@forgeindia.com", "raw_p": "Agent@123", "password": hash_password("Agent@123"), "role": "agent", "employee_id": gen_employee_id("agent"), "agent_phone": "+919444667411", "is_active": True, "created_at": utcnow()}
            ]
            
            for u_data in default_users:
                raw_p = u_data.pop("raw_p")
                existing = await users_col.find_one({"email": u_data["email"]})
                if not existing:
                    await users_col.insert_one(u_data)
                    logger.info(f"Seeded user account: {u_data['email']}")
                else:
                    update_fields = {}
                    if not verify_password(raw_p, existing.get("password", "")):
                        update_fields["password"] = u_data["password"]
                    if existing.get("role") == "supervisor":
                        update_fields["role"] = "team_leader"
                    if update_fields:
                        await users_col.update_one({"_id": existing["_id"]}, {"$set": update_fields})
                        logger.info(f"Refreshed account details for: {u_data['email']}")
                
            pool_count = await pools_col.count_documents({})
            if pool_count == 0:
                await pools_col.insert_one({"name": "Customer Support", "description": "Default pool", "created_at": utcnow()})
                logger.info("Seeded default pool.")
        except Exception as e:
            logger.warning(f"Could not seed users due to DB error: {e}")
    else:
        logger.warning(
            "MongoDB is not accessible during startup. "
            "Make sure MongoDB is running."
        )

    # Validate Vapi AI environment variables
    import os
    vapi_api_key = getattr(settings, 'VAPI_API_KEY', '') or os.getenv('VAPI_API_KEY', '')
    vapi_assistant_id = getattr(settings, 'VAPI_ASSISTANT_ID', '') or os.getenv('VAPI_ASSISTANT_ID', '')
    vapi_phone_id = getattr(settings, 'VAPI_PHONE_NUMBER_ID', '') or os.getenv('VAPI_PHONE_NUMBER_ID', '')
    missing_vapi = []
    if not vapi_api_key: missing_vapi.append("VAPI_API_KEY")
    if not vapi_assistant_id: missing_vapi.append("VAPI_ASSISTANT_ID")
    if not vapi_phone_id: missing_vapi.append("VAPI_PHONE_NUMBER_ID")

    if missing_vapi:
        logger.warning(f"Vapi AI Configuration warning: Missing required env vars {', '.join(missing_vapi)}")
    else:
        logger.info("Vapi AI Configuration: All required credentials loaded successfully.")


@app.on_event("shutdown")
async def on_shutdown():
    await close_http_client()


# ── Health & Root ────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    db_status = "connected" if await check_db_connection() else "disconnected"
    return {
        "status": "ok",
        "service": "forge-india-connect-crm-api",
        "database": f"local-mongodb ({settings.MONGO_DB_NAME})",
        "database_status": db_status
    }


@app.get("/api/health")
@app.get("/health")
async def health():
    db_ok = await check_db_connection()
    if not db_ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local MongoDB database connection failed"
        )
    return {"status": "healthy", "database": "connected"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Return 204 No Content for favicon requests to prevent browser 404 noise."""
    return Response(status_code=204)
