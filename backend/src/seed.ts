import { eq } from "drizzle-orm";
import { db, client } from "./db";
import { users, cameras } from "./db/schema";

// Idempotent seed: a demo user + one camera pointing at the mediamtx loop, so a
// fresh `docker compose up` shows a live tile immediately.
const DEMO_USER = process.env.SEED_USER ?? "demo";
const DEMO_PASS = process.env.SEED_PASS ?? "demo12345";
const DEMO_RTSP = process.env.SEED_RTSP_URL ?? "rtsp://mediamtx:8554/cam";

async function seed() {
  let [u] = await db
    .select()
    .from(users)
    .where(eq(users.username, DEMO_USER))
    .limit(1);

  if (!u) {
    const passwordHash = await Bun.password.hash(DEMO_PASS);
    [u] = await db
      .insert(users)
      .values({ username: DEMO_USER, passwordHash })
      .returning();
    console.log(`[seed] created demo user "${DEMO_USER}"`);
  } else {
    console.log(`[seed] demo user "${DEMO_USER}" already exists`);
  }

  const existing = await db
    .select()
    .from(cameras)
    .where(eq(cameras.userId, u.id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(cameras).values({
      userId: u.id,
      name: "Demo Camera",
      rtspUrl: DEMO_RTSP,
      location: "Lobby",
      enabled: true,
    });
    console.log(`[seed] seeded demo camera -> ${DEMO_RTSP}`);
  } else {
    console.log("[seed] demo camera already present");
  }

  console.log(
    `\n  ===> Demo login:  username "${DEMO_USER}"  password "${DEMO_PASS}"\n`,
  );
  await client.end();
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  });
