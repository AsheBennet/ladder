import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createSession, playerIdFromToken } from "./auth/session.js";
import {
  enqueue,
  leaveQueue,
  getStatus,
  type Advertise,
} from "./queue/matchmaking.js";
import { reportResult } from "./match/result.js";

export async function buildApp(env: NodeJS.ProcessEnv = process.env) {
  const cfg = loadConfig(env);
  const db = createPool(cfg.databaseUrl);
  await migrate(db);

  // Seed port allocator from config if still at default insert
  await db.query(
    `UPDATE port_alloc SET next_port = GREATEST(next_port, $1) WHERE id = 1`,
    [cfg.placeholderPortBase],
  );

  const app = Fastify({ logger: true });

  app.decorate("db", db);
  app.decorate("cfg", cfg);

  async function requirePlayer(authHeader?: string): Promise<string> {
    if (!authHeader?.startsWith("Bearer ")) {
      const err = new Error("unauthorized");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
    }
    const token = authHeader.slice("Bearer ".length);
    const playerId = await playerIdFromToken(db, token);
    if (!playerId) {
      const err = new Error("unauthorized");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
    }
    return playerId;
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/session", async () => createSession(db, cfg.seasonId));

  app.post<{
    Body: { advertise?: Advertise };
  }>("/queue", async (req, reply) => {
    try {
      const playerId = await requirePlayer(req.headers.authorization);
      const existing = await db.query(
        "SELECT 1 FROM queue WHERE player_id = $1",
        [playerId],
      );
      if (existing.rowCount) {
        return reply.code(409).send({ error: "already_queued" });
      }
      const advertise = req.body?.advertise;
      const status = await enqueue(
        db,
        playerId,
        cfg.seasonId,
        cfg,
        advertise,
      );
      return { status };
    } catch (e) {
      const err = e as Error & { code?: string; statusCode?: number };
      if (err.code === "already_in_match") {
        return reply.code(409).send({ error: "already_in_match" });
      }
      if (err.code === "bad_advertise") {
        return reply.code(400).send({ error: "bad_advertise" });
      }
      if (err.statusCode === 401) return reply.code(401).send({ error: "unauthorized" });
      throw e;
    }
  });

  app.delete("/queue", async (req, reply) => {
    try {
      const playerId = await requirePlayer(req.headers.authorization);
      const status = await leaveQueue(db, playerId);
      return { status };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode === 401) return reply.code(401).send({ error: "unauthorized" });
      throw e;
    }
  });

  app.get("/queue/status", async (req, reply) => {
    try {
      const playerId = await requirePlayer(req.headers.authorization);
      return getStatus(db, cfg, playerId);
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode === 401) return reply.code(401).send({ error: "unauthorized" });
      throw e;
    }
  });

  app.post<{
    Params: { matchId: string };
    Body: { winnerId: string; reportId: string };
  }>("/match/:matchId/result", async (req, reply) => {
    try {
      const playerId = await requirePlayer(req.headers.authorization);
      const { winnerId, reportId } = req.body ?? ({} as { winnerId: string; reportId: string });
      if (!winnerId || !reportId) {
        return reply.code(400).send({ error: "winnerId_and_reportId_required" });
      }
      return await reportResult(db, {
        matchId: req.params.matchId,
        reporterId: playerId,
        winnerId,
        reportId,
      });
    } catch (e) {
      const err = e as Error & { code?: string; statusCode?: number };
      if (err.statusCode === 401) return reply.code(401).send({ error: "unauthorized" });
      if (err.code === "not_found") return reply.code(404).send({ error: "not_found" });
      if (err.code === "forbidden") return reply.code(403).send({ error: "forbidden" });
      if (err.code === "bad_winner") return reply.code(400).send({ error: "bad_winner" });
      throw e;
    }
  });

  app.addHook("onClose", async () => {
    await db.end();
  });

  return { app, cfg, db };
}
