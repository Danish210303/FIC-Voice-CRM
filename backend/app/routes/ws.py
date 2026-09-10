import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from bson import ObjectId
from app.services.ws_manager import ws_manager
from app.core.security import decode_token
from app.core.database import users_col

logger = logging.getLogger("uvicorn.error")

router = APIRouter()


async def authenticate_ws(websocket: WebSocket, token: str | None = None) -> dict | None:
    """Helper to extract and validate JWT token for WebSocket connections."""
    if not token or token.strip().lower() in ("undefined", "null", "none"):
        token = websocket.query_params.get("token")

    if not token or token.strip().lower() in ("undefined", "null", "none"):
        headers = dict(websocket.headers)
        auth_header = headers.get("authorization") or headers.get("sec-websocket-protocol")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        elif auth_header and len(auth_header) > 20:
            token = auth_header

    if not token or token.strip().lower() in ("undefined", "null", "none"):
        logger.info("[WS AUTH] Connection proceeding as anonymous (no valid token present)")
        return None

    try:
        payload = decode_token(token)
        if not payload:
            logger.warning("[WS AUTH] Token decode returned empty payload")
            return None

        token_type = payload.get("type")
        if token_type and token_type != "access":
            logger.warning(f"[WS AUTH] Non-access token type rejected: {token_type}")
            return None

        sub = payload.get("sub")
        if not sub:
            return None

        query = {"_id": ObjectId(sub)} if ObjectId.is_valid(sub) else {"id": sub}
        user = await users_col.find_one(query)
        if not user or not user.get("is_active", True):
            logger.warning(f"[WS AUTH] User inactive or not found for sub: {sub}")
            return None

        user["_id"] = str(user["_id"])
        if user.get("role") == "supervisor":
            user["role"] = "team_leader"

        logger.info(f"[WS AUTH SUCCESS] Authenticated WS user: {user.get('name') or user.get('email')}")
        return user
    except Exception as e:
        logger.warning(f"[WS AUTH ERROR] Token decode failed: {e}")
        return None


@router.websocket("/ws/global")
async def global_ws(websocket: WebSocket, token: str | None = None):
    """Global WebSocket connection for system-wide notifications (users_updated, etc.)."""
    user = await authenticate_ws(websocket, token)
    user_str = user.get("email") if user else "anonymous"
    logger.info(f"[WS CONNECT] Global room connected by '{user_str}'")

    await ws_manager.connect("global", websocket)
    try:
        while True:
            # Keep connection alive & handle incoming pings
            msg = await websocket.receive_text()
            if msg:
                m_str = msg.strip().lower()
                if m_str == "ping" or '"ping"' in m_str:
                    await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"[WS DISCONNECT] Global room disconnected by '{user_str}'")
        ws_manager.disconnect("global", websocket)
    except Exception as e:
        logger.debug(f"[WS ERROR] Global connection ended: {e}")
        ws_manager.disconnect("global", websocket)


@router.websocket("/ws/pool/{pool_id}")
async def pool_ws(websocket: WebSocket, pool_id: str, token: str | None = None):
    """Department/Pool specific WebSocket channel."""
    user = await authenticate_ws(websocket, token)
    user_str = user.get("email") if user else "anonymous"
    logger.info(f"[WS CONNECT] Pool '{pool_id}' connected by '{user_str}'")

    await ws_manager.connect(pool_id, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg:
                m_str = msg.strip().lower()
                if m_str == "ping" or '"ping"' in m_str:
                    await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"[WS DISCONNECT] Pool '{pool_id}' disconnected by '{user_str}'")
        ws_manager.disconnect(pool_id, websocket)
    except Exception as e:
        logger.debug(f"[WS ERROR] Pool '{pool_id}' connection ended: {e}")
        ws_manager.disconnect(pool_id, websocket)


@router.websocket("/ws/{room_id}")
async def generic_ws(websocket: WebSocket, room_id: str, token: str | None = None):
    """Generic WebSocket room handler."""
    target_room = "global" if room_id == "global" else room_id
    user = await authenticate_ws(websocket, token)
    user_str = user.get("email") if user else "anonymous"
    logger.info(f"[WS CONNECT] Room '{target_room}' connected by '{user_str}'")

    await ws_manager.connect(target_room, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg:
                m_str = msg.strip().lower()
                if m_str == "ping" or '"ping"' in m_str:
                    await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"[WS DISCONNECT] Room '{target_room}' disconnected by '{user_str}'")
        ws_manager.disconnect(target_room, websocket)
    except Exception as e:
        logger.debug(f"[WS ERROR] Room '{target_room}' connection ended: {e}")
        ws_manager.disconnect(target_room, websocket)


@router.websocket("/ws")
async def root_ws(websocket: WebSocket, token: str | None = None):
    """Root WebSocket endpoint."""
    user = await authenticate_ws(websocket, token)
    user_str = user.get("email") if user else "anonymous"
    logger.info(f"[WS CONNECT] Root WS connected by '{user_str}'")

    await ws_manager.connect("global", websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg:
                m_str = msg.strip().lower()
                if m_str == "ping" or '"ping"' in m_str:
                    await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect("global", websocket)
    except Exception as e:
        ws_manager.disconnect("global", websocket)
