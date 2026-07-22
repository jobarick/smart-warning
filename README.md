# Smart Emergency Warning & Threat Alert System

A web app (PWA) for instant emergency alerts across all connected devices — desktop and mobile. When an alert fires, every device shows a bright warning border around the screen, optional high-intensity flashing, a synthesized siren, and vibration on phones.

## Structure

- `server/` — Node.js WebSocket relay (port **3001**). Broadcasts every alert / all-clear to all connected clients and tracks how many devices are online.
- `server-python/` — **Python (FastAPI + uvicorn) relay** — a drop-in equivalent of the Node relay: same WebSocket protocol, same JSON messages, same port 3001. Use *either* server, not both (they both bind 3001).
- `client/` — React + TypeScript + Vite PWA (dev port **5300**). Trigger panel, warning settings, alert overlay, and history log.

## Run

Pick one relay server:

```
# Option A — Node relay
cd server && npm install && npm start

# Option B — Python relay (FastAPI + uvicorn)
cd server-python && pip install -r requirements.txt && uvicorn relay:app --host 0.0.0.0 --port 3001
```

Then start the client:

```
cd client && npm install && npm run dev
```

Open `http://localhost:5300`. Other devices on the same Wi-Fi can open `http://<your-PC-LAN-IP>:5300` — the client automatically connects its WebSocket to the same host on port 3001.

## Deploy (Vercel + hosted relay)

The repo is set up to deploy the client to **Vercel** and the relay to any
always-on host. Two parts, because Vercel is static/serverless and can't run a
persistent WebSocket server.

**1. Client → Vercel.** `vercel.json` (repo root) builds the app in `client/`.
Import the repo on Vercel and keep the Root Directory as the repo root — the
config runs `cd client && npm run build` and serves `client/dist`. No settings
to fiddle with.

**2. Relay → an always-on host.** The relay reads `process.env.PORT` and exposes
a `/` health check, so it runs as-is on Render, Railway, Fly.io, etc.
- **Render:** New → Blueprint on this repo (`render.yaml` deploys `server/`).
- **Railway / Fly / Cloud Run:** use `server/Dockerfile`.

**3. Point the client at the relay.** On the Vercel project, set an environment
variable `VITE_WS_URL` to the relay's public URL, e.g.
`wss://smart-warning-relay.onrender.com`, and redeploy. Without it the client
falls back to `ws(s)://<same-host>:3001` (the LAN behaviour). Note: the relay
still has no auth — add a shared token before any real-world use.

## Features

- **Six alert types** — Fire, Medical, Security, Hazard, Cyber Threat, Evacuation — each with its own color and siren tone.
- **Four severities** — low (border only), medium (+ flashing), high/critical (+ siren + vibration).
- **Multi-device broadcast** — trigger on one device, every connected device alarms instantly. "Acknowledge" silences one device; "All clear" stops the alarm everywhere.
- **Fully configurable** — border thickness, brightness, flash pattern (none/pulse/strobe) and rate, siren tone (wail / yelp / hi-lo / pulse beep), volume, vibration, auto-fullscreen. Persisted per device.
- **Photosensitivity safety** — flash rate is capped at 3/sec (WCAG 2.3.1) unless the user explicitly opts into faster strobing.
- **Sirens are synthesized** with the Web Audio API — no audio files. Browsers block sound until the first tap/click; the status bar shows a "Tap to enable sound" button until audio is armed.
- **PWA** — installable on Android/iOS home screen and as a desktop app; screen Wake Lock keeps the display on during an alert.

## Notes & limitations

- Alerts reach a device only while the app is open (foreground tab or installed app). True push notifications with the app closed would need a push service (possible later phase).
- iOS ignores `navigator.vibrate` and may require the tab to be foregrounded for audio.
- The relay trusts all clients on the network — for real deployments add authentication/TLS.
