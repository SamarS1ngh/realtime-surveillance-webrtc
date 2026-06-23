import { redisPub } from "./redis";
import { CHANNELS } from "./channels";

// WebRTC signaling relay. The browser's SDP offer is forwarded to the worker
// over Redis and the worker's answer is routed back to the waiting HTTP request
// — a small request/response (RPC) pattern over pub/sub keyed by reqId.

export type AnswerResult = { sdp?: string; error?: string };

const pending = new Map<string, (r: AnswerResult) => void>();
const TIMEOUT_MS = 8000;

export async function requestAnswer(
  cameraId: string,
  offerSdp: string,
): Promise<AnswerResult> {
  const reqId = crypto.randomUUID();
  const result = new Promise<AnswerResult>((resolve) => {
    pending.set(reqId, resolve);
    setTimeout(() => {
      if (pending.delete(reqId)) {
        resolve({ error: "worker did not answer (timeout)" });
      }
    }, TIMEOUT_MS);
  });
  await redisPub.publish(
    CHANNELS.webrtcRequests,
    JSON.stringify({ reqId, camera_id: cameraId, sdp: offerSdp }),
  );
  return result;
}

// Called by the Redis subscriber when a worker replies on webrtc:answers.
export function handleAnswer(msg: {
  reqId?: string;
  sdp?: string;
  error?: string;
}) {
  if (!msg?.reqId) return;
  const resolve = pending.get(msg.reqId);
  if (resolve) {
    pending.delete(msg.reqId);
    resolve({ sdp: msg.sdp, error: msg.error });
  }
}
