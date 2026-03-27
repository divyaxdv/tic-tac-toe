# Multiplayer Tic-Tac-Toe (Nakama + React)

Server-authoritative multiplayer Tic-Tac-Toe: **Nakama** (TypeScript runtime) for game logic and realtime sync, **React** (Vite) for the client.

## Prerequisites

- **Node.js** 18+ (for building frontend and Nakama TS runtime)
- **Docker Desktop** (or Docker Engine + Compose) for local Nakama + PostgreSQL

## Project layout

```
todo/
├── backend/                 # Nakama server runtime (TypeScript → Rollup → JS)
│   ├── src/main.ts          # Match handler + find_match RPC
│   ├── local.yml            # Nakama runtime config (js entrypoint)
│   └── Dockerfile           # Builds runtime bundle into Nakama image
├── frontend/                # React + Vite client
│   └── src/
│       ├── App.tsx          # UI + socket match data
│       └── lib/nakama.ts    # Nakama JS client (auth, socket, RPC)
└── docker-compose.yml       # PostgreSQL + Nakama (local dev)
```

## Architecture (short)

- **Server-authoritative**: Board state, turn order, win/draw, timeouts, and forfeit are enforced in `backend/src/main.ts` inside Nakama’s **authoritative match** (`matchLoop`, etc.). Clients only send move intents (`MOVE` opcode with `{ position }`).
- **Realtime**: After each valid update, the server broadcasts match messages (`START`, `UPDATE`, `DONE`, `REJECTED`) to all participants in the match.
- **Matchmaking**: RPC `find_match` either joins an existing open authoritative match or creates a new one (`tic-tac-toe` module).
- **Auth**: Device ID stored in `localStorage` (`nakama_device_id`) via `authenticateDevice` — fine for demos; replace with a stronger auth flow for production.

### Nakama ports (default)

| Port  | Purpose |
|-------|---------|
| 7350  | HTTP / REST / WebSocket (client uses this) |
| 7349  | gRPC API |
| 7351  | **Console** (admin UI; default dev credentials — change for production) |

### Docker network note

`docker-compose.yml` pins PostgreSQL and Nakama to fixed addresses on an internal bridge (`172.20.0.2` / `172.20.0.3`) so the Nakama container can reach Postgres reliably. If another Docker network already uses `172.20.0.0/16`, change the subnet and IPs consistently.

PostgreSQL is **not** published to the host by default (only Nakama ports are). That avoids clashing with a local Postgres on `:5432`.

---

## Local setup

### 1. Start Nakama + PostgreSQL

From the repo root:

```bash
docker compose up --build
```

Wait until both services are healthy. Verify Nakama HTTP:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7350/
```

Expect `200`.

### 2. Build Nakama runtime only (optional)

If you change server code:

```bash
cd backend
npm install
npm run build
```

The Docker image runs this during `docker compose build`.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

### 4. Point the client at Nakama

By default `frontend/src/lib/nakama.ts` uses:

- Host: `127.0.0.1`
- Port: `7350`
- Server key: `defaultkey`
- SSL: `false`

For a deployed server, change these values (prefer **environment variables** + Vite `import.meta.env` so you don’t commit hostnames).

---

## How to test multiplayer locally

1. Start **Docker Compose** (Nakama + Postgres) and **Vite** (`npm run dev`).
2. Open **two browser contexts**, e.g.:
   - Normal window + **Incognito/Private** window, or  
   - Two different browsers  
   (Same `localStorage` in two tabs of the same profile can confuse device IDs; separate profiles/incognito is safer.)
3. In **both** windows:
   - Click **Connect**
   - Click **Find Match**  
   Both should join the same match; play alternates; disconnecting one player should end the match for the other with `reason: "opponent_left"` when applicable.

---

## Server runtime configuration

- **Entrypoint**: `backend/local.yml` → `runtime.js_entrypoint: build/index.js` (bundled file copied into the image at `/nakama/data/modules/build/`).
- **Session**: `session.token_expiry_sec` in `local.yml` (default 2 hours for dev).

**Production**: Replace default console credentials, enable TLS for clients, restrict CORS, and set strong `session` / `socket` keys via Nakama config (see [Nakama configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/)).

---

## API / RPC surface (custom)

| Name | Type | Description |
|------|------|-------------|
| `find_match` | RPC | Returns `{ matchId }` — join or create an authoritative match. |

Match messages use **opcodes** (see `backend/src/main.ts`):

- `START` — both players seated; initial board and marks
- `UPDATE` — board + active player + turn timer ticks
- `DONE` — win / draw / timeout / opponent left
- `MOVE` — client sends `{ position: 0..8 }`
- `REJECTED` — illegal move or wrong turn
