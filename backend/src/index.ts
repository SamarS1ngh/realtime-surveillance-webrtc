import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createBunWebSocket } from "hono/bun";
import { env } from "./env";
import { authRoutes } from "./auth/routes";
import { cameraRoutes } from "./cameras/routes";
import { alertRoutes } from "./alerts/routes";
import { requireAuth } from "./auth/middleware";
import { verifyToken } from "./auth/jwt";
import { addConn, removeConn } from "./realtime/connections";
import { startIngest } from "./realtime/ingest";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/cameras", cameraRoutes);
app.route("/alerts", alertRoutes);

app.get("/me", requireAuth, (c) =>
  c.json({ id: c.get("userId"), username: c.get("username") }),
);

// Realtime channel. Browser connects to /ws?token=<jwt>; we auth on open and
// register the socket under its user so ingest can fan events out by owner.
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const token = c.req.query("token");
    let userId: string | null = null;
    return {
      async onOpen(_evt, ws) {
        try {
          if (!token) throw new Error("missing token");
          const payload = await verifyToken(token);
          userId = payload.sub;
          addConn(userId, ws);
          ws.send(JSON.stringify({ channel: "state", data: { type: "ws_ready" } }));
        } catch {
          ws.close(1008, "unauthorized");
        }
      },
      onClose(_evt, ws) {
        if (userId) removeConn(userId, ws);
      },
    };
  }),
);

// Begin consuming worker events from Redis.
startIngest();

console.log(`[api] listening on :${env.API_PORT}`);

export default {
  port: env.API_PORT,
  fetch: app.fetch,
  websocket,
};
