import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { db } from "../db";
import { cameras } from "../db/schema";

// Live WebSocket connections, grouped by user. A user may have several tabs open.
const byUser = new Map<string, Set<WSContext>>();

export function addConn(userId: string, ws: WSContext) {
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  set.add(ws);
}

export function removeConn(userId: string, ws: WSContext) {
  const set = byUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) byUser.delete(userId);
}

// Push a payload to every live socket owned by this user.
export function sendToUser(userId: string, payload: unknown) {
  const set = byUser.get(userId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    try {
      ws.send(msg);
    } catch {
      // socket mid-teardown; ignore
    }
  }
}

// cameraId -> ownerId cache, so fan-out doesn't hit the DB on every event.
const ownerCache = new Map<string, string>();

export async function ownerOf(cameraId: string): Promise<string | null> {
  const cached = ownerCache.get(cameraId);
  if (cached) return cached;
  const [row] = await db
    .select({ userId: cameras.userId })
    .from(cameras)
    .where(eq(cameras.id, cameraId))
    .limit(1);
  if (row) {
    ownerCache.set(cameraId, row.userId);
    return row.userId;
  }
  return null;
}

export function invalidateOwner(cameraId: string) {
  ownerCache.delete(cameraId);
}
