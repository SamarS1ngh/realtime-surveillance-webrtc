# Worker (Python)

Handles camera start/stop commands, ingests RTSP, runs person detection,
re-streams the (annotated) video to the browser over WebRTC, and emits
detection + stats events. Each camera is fully independent — one failing or
stopping never affects the others.

## How it works

- `main.py` subscribes to `camera:commands` and `webrtc:requests` on Redis and
  keeps a dict of running `CameraWorker`s.
- `camera_worker.py` — one per camera. The blocking RTSP decode + YOLO inference
  runs in a worker **thread**; detections/stats flow back to the asyncio loop
  via a thread-safe queue. Exceptions become an `error` state event, isolated
  from sibling cameras.
- `detector.py` — `Detector` interface + `YoloDetector` (YOLOv8n, COCO person
  class). Swappable.
- `dedup.py` — pure dedup + rate-limit logic (unit tested).
- `signaling.py` — builds the aiortc peer connection and answers SDP offers.
- `events.py` — builds the event payloads (see `../docs/EVENT_FORMAT.md`).

## Detection model — YOLOv8n

COCO-pretrained, nano variant (~3M params). Filtered to class 0 (`person`). Runs
on CPU at a usable rate for several cameras; one-line inference via
`ultralytics`; ONNX-exportable. Chosen for "runs in `docker compose up` on a
laptop", not max accuracy. Detection runs on every Nth frame (`DETECT_EVERY_N`)
because inference is the cost, not decode.

## Test

```bash
python -m unittest discover -s tests -v   # dedup + event-format logic, no heavy deps
```

## Env

| Var | Default | Meaning |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | message bus |
| `WORKER_ID` | `worker-1` | stamped on events |
| `DEDUP_WINDOW_MS` | `3000` | suppress same-count detections within this window |
| `MAX_EVENTS_PER_MIN` | `30` | hard cap on persisted alerts per camera/min |
| `MODEL_PATH` | `yolov8n.pt` | detector weights |
| `CONF_THRESHOLD` | `0.4` | min detection confidence |
| `DETECT_EVERY_N` | `3` | run YOLO on every Nth decoded frame |
| `STUN_URL` | google STUN | WebRTC ICE |
