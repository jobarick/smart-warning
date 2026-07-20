"""
Alert relay (Python / FastAPI) — broadcasts every alert / all-clear message to
all connected clients.

This is a functional equivalent of the Node.js relay in ../server/index.js:
same WebSocket protocol, same JSON message shapes, same port (3001). Run either
one — not both at once (they both bind 3001).

Run:
    pip install -r requirements.txt
    uvicorn relay:app --host 0.0.0.0 --port 3001
    # or simply:  python relay.py
"""

import json
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Alert Relay")

_started = time.time()
_clients: set[WebSocket] = set()


async def broadcast(payload: dict) -> None:
    """Send a JSON payload to every connected client, dropping any that fail."""
    data = json.dumps(payload)
    dead: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)


async def broadcast_presence() -> None:
    await broadcast({"kind": "presence", "count": len(_clients)})


@app.get("/")
async def status() -> dict:
    """HTTP health endpoint (mirrors the Node relay's status response)."""
    return {"service": "alert-relay", "clients": len(_clients), "uptime": time.time() - _started}


@app.websocket("/")
async def relay(ws: WebSocket) -> None:
    await ws.accept()
    _clients.add(ws)
    print(f"[+] client connected ({len(_clients)} online)")
    await broadcast_presence()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict) or msg.get("kind") not in ("alert", "all-clear"):
                continue
            if msg["kind"] == "alert":
                print(
                    f'[!] ALERT {msg.get("type")}/{msg.get("severity")} '
                    f'from "{msg.get("sender")}": {msg.get("message") or "(no message)"}'
                )
            else:
                print(f'[.] all-clear from "{msg.get("sender")}"')
            await broadcast(msg)
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(ws)
        print(f"[-] client disconnected ({len(_clients)} online)")
        await broadcast_presence()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3001)
