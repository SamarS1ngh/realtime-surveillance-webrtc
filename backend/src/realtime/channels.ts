import { redisPub } from "./redis";

// Redis channel names — must match the worker. See docs/EVENT_FORMAT.md.
export const CHANNELS = {
  commands: "camera:commands", // API -> worker
  detections: "detections", // worker -> API
  stats: "stats", // worker -> API (stats + state changes)
} as const;

export type CameraCommand =
  | {
      type: "start";
      camera_id: string;
      rtsp_url: string;
      requested_by: string;
      ts: string;
    }
  | { type: "stop"; camera_id: string; requested_by: string; ts: string };

export async function publishCommand(cmd: CameraCommand): Promise<void> {
  await redisPub.publish(CHANNELS.commands, JSON.stringify(cmd));
}
