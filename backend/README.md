# Backend (Bun + Hono + Postgres)

The API. Owns the database, issues JWTs, exposes camera + alert REST routes,
relays WebRTC signaling, and pushes realtime events to the browser over a
WebSocket. It talks to the worker only through Redis.

## Run

```bash
bun install
# needs Postgres + Redis reachable (see root docker-compose.yml)
DATABASE_URL=postgres://vms:vms_dev_pw@localhost:5432/vms \
REDIS_URL=redis://localhost:6379 \
bun run db:push        # create tables
bun run seed           # demo user + camera (idempotent)
bun run dev            # http://localhost:8080
```

## Test

```bash
bun test                         # jwt unit tests always run
DATABASE_URL=postgres://vms:vms_dev_pw@localhost:5432/vms bun test   # + api integration
```

## Layout

| Path | Role |
|---|---|
| `src/app.ts` | the Hono app graph (no side effects on import — testable) |
| `src/index.ts` | server boot: starts Redis ingest, serves |
| `src/auth/` | JWT sign/verify, `requireAuth` middleware, signup/login |
| `src/cameras/` | CRUD scoped to owner, start/stop (publishes Redis commands), WebRTC offer |
| `src/alerts/` | alert query (camera/time filter + pagination), owner-scoped |
| `src/realtime/` | Redis pub/sub, WS connection registry, ingest, SDP relay |
| `src/db/` | Drizzle schema + client |

## Routes

```
POST /auth/signup            {username,password} -> {token,user}
POST /auth/login             {username,password} -> {token,user}
GET  /me                     (auth) current user

GET    /cameras              (auth) list own cameras
POST   /cameras              (auth) create
GET    /cameras/:id          (auth) read
PATCH  /cameras/:id          (auth) update
DELETE /cameras/:id          (auth) delete
POST   /cameras/:id/start    (auth) publish start command
POST   /cameras/:id/stop     (auth) publish stop command
POST   /cameras/:id/webrtc   (auth) {sdp} offer -> {sdp} answer (relayed to worker)

GET  /alerts?camera_id=&from=&to=&limit=&offset=   (auth) owner-scoped, newest first

WS   /ws?token=<jwt>         multiplexed: {channel:"alert"|"stats"|"state", data}
```

See [`../docs/EVENT_FORMAT.md`](../docs/EVENT_FORMAT.md) for payload shapes.
