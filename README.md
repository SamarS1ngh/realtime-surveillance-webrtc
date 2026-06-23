# Real-Time Camera Surveillance Dashboard (WebRTC + Person Detection)

A small Video Management System. Register cameras by RTSP URL, watch the live
feed in the browser over WebRTC, and get real-time alerts when a person enters
the frame.

Three services + Postgres + Redis, wired together with Docker Compose:

```
                       ┌──────────────────────────────────────────────┐
                       │                  Browser                      │
                       │   Next.js (React + TS)                        │
                       │   • login / JWT       • camera CRUD           │
                       │   • dashboard grid    • <video> over WebRTC   │
                       └───────▲───────────────▲──────────────▲────────┘
                          REST │          WS   │     WebRTC    │ (SDP/ICE
                          +JWT │   (alerts+    │   media       │  via API)
                               │    stats)     │               │
                       ┌───────┴───────────────┴───────┐       │
                       │      Backend API              │       │
                       │      Bun + Hono               │       │
                       │  • auth  • CRUD  • alerts      │       │
                       │  • WS fan-out  • SDP relay     │       │
                       └───┬───────────────▲────────────┘       │
                  publish  │ camera:commands│ detections+stats   │
                           ▼               │ (subscribe)         │
                       ┌───────────────────┴───────┐             │
                       │           Redis            │             │
                       │   pub/sub message bus      │             │
                       └───────────────▲────────────┘             │
                       commands (sub)  │  events (pub)            │
                       ┌───────────────┴────────────────────────┐ │
                       │              Worker (Python)            │ │
                       │  • RTSP ingest (FFmpeg/OpenCV)          │ │
                       │  • YOLOv8n person detection             │◄┘
                       │  • WebRTC re-stream (aiortc)            │  peer connection
                       │  • emit detections + stats              │
                       └─────────────────▲──────────────────────┘
                                         │ RTSP
                       ┌─────────────────┴──────────────────────┐
                       │   mediamtx — loops a sample video as    │
                       │   an RTSP source (no real camera needed)│
                       └─────────────────────────────────────────┘

         Postgres ── stores users, cameras, alerts (owned by API)
```

## Why these pieces

| Concern | Choice | Why |
|---|---|---|
| Frontend | Next.js (React + TS) | Spec wants React+TS; Next gives routing + protected routes cheaply. |
| Backend | Bun + Hono + Postgres | Per spec. Bun ships a native WebSocket server — cleaner than bolting WS onto a framework that fights it. |
| Worker | Python + aiortc + ultralytics | aiortc is the most batteries-included WebRTC stack outside the browser; ultralytics YOLO is one import to a pretrained person detector. Go's WebRTC (pion) is excellent but pairing it with a detection model is far more plumbing — spec allows any language, so we optimize for a working pipeline. |
| Detection | **YOLOv8n** (COCO, class 0 = person) | See below. |
| Message bus | Redis pub/sub | Decouples API from worker; lets cameras start/stop and emit events without a direct socket. One small container. |
| DB | Postgres | Per spec. Relational fit: users → cameras → alerts. |
| Test RTSP | mediamtx looping a sample file | Reproducible, no hardware, comes up inside compose. |

## Detection model — YOLOv8n, and why

- **Pretrained on COCO**, which includes a `person` class (class id 0). No
  training needed — filter detections to class 0.
- **`n` = nano**: the smallest YOLOv8 variant (~3M params). On CPU it sustains a
  usable frame rate for several concurrent cameras; on GPU it's trivial. We
  optimize for "runs on a laptop in `docker compose up`", not max mAP.
- **One-line inference** via `ultralytics`, and it exports cleanly to ONNX if you
  later want `onnxruntime` without the heavy torch dependency.
- **Open source** (AGPL-3.0). Noted because the spec asks which model and why.

Swappable: the detector is isolated behind a `Detector` interface in the worker,
so YOLOv5n / RT-DETR / an ONNX model drops in without touching the pipeline.

## Event format

The contract every service shares lives in [`docs/EVENT_FORMAT.md`](docs/EVENT_FORMAT.md).
Defined once: camera command, detection event, camera stats, state change, and
the WebSocket envelope. The worker emits it, Redis carries it, the API persists
and re-broadcasts it, the browser renders it — identical shape end to end.

## Running it

```bash
cp .env.example .env        # defaults work out of the box
docker compose up --build
```

Then open http://localhost:3000 and log in with the seeded demo account:

```
username: demo
password: demo12345
```

A demo camera pointing at the looped sample clip is pre-seeded — hit **Start** on
its tile to see live WebRTC video with person boxes, plus alerts and FPS/det-min
updating live. You can also add your own camera (any RTSP URL).

- Frontend → http://localhost:3000
- API → http://localhost:8080
- Seeded RTSP source → `rtsp://localhost:8554/cam` (ffmpeg loops `infra/sample/people.mp4`)

### A note on WebRTC + Docker networking

The worker runs with `network_mode: host` on purpose: WebRTC needs the worker's
ICE candidates to be addresses the browser can actually reach. On the host
network those are the host's address (browser is on the same machine), so media
flows. The trade-off is the worker reaches Redis/RTSP via `localhost` + their
published ports — hence the seeded camera URL is `rtsp://localhost:8554/cam`. For
a multi-host deployment you'd add a TURN server and put the worker on the shared
network instead.

## Tests

```bash
# backend — jwt unit tests + api integration (integration self-skips without a DB)
cd backend && bun test
DATABASE_URL=postgres://vms:vms_dev_pw@localhost:5432/vms bun test   # full

# worker — dedup + event-format logic (pure, no ML deps needed)
cd worker && python -m unittest discover -s tests -v
```

## Project layout

```
backend/    Bun + Hono API, Drizzle schema, WS server
worker/     Python RTSP→YOLO→WebRTC pipeline
frontend/   Next.js dashboard
infra/      mediamtx config, sample stream, seed sql
docs/       EVENT_FORMAT.md (the cross-service contract)
docker-compose.yml
```

## Design decisions

- **API owns the DB; the worker never touches Postgres.** The worker only speaks
  Redis + HTTP to the API. Keeps the worker stateless and horizontally scalable —
  run N workers, shard cameras across them, no DB contention.
- **WebRTC signaling is relayed through the API**, not a separate signaling
  server — the browser POSTs an SDP offer to the API, which forwards to the
  worker over Redis and returns the answer. One less moving part.
- **One WebSocket per browser session**, multiplexed by `channel`. The API
  filters events to cameras the user owns before pushing.
- **Dedup + rate-limit live in the worker** (closest to the firehose) so noise
  never reaches Redis/DB. Knobs documented in the event spec.

## Future improvements

- Swap Redis pub/sub for a durable queue (NATS JetStream / Kafka) so detections
  survive an API restart.
- A coordinator that assigns cameras to the least-loaded worker; autoscale on
  camera count (the scalable-architecture bonus).
- TURN server for WebRTC across restrictive NATs (currently STUN-only).
- Persist a short clip / thumbnail per alert, not just metadata.
- Kubernetes manifests + HPA on worker CPU.

## Tests

- Backend: unit tests for auth + alert filtering, integration test hitting a
  throwaway Postgres.
- Worker: unit tests for the dedup/rate-limit logic and the detection→event mapping.

See each service's README for how to run its tests.
