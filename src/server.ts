import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createSession, playerIdFromToken } from "./auth/session.js";
import {
  enqueue,
  leaveQueue,
  getStatus,
} from "./queue/matchmaking.js";
import { reportResult } from "./match/result.js";

async function migrate(db: ReturnType<typeof createPool>) {
  await db.query(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ratings (
  player_id TEXT NOT NULL REFERENCES players(id),
  season_id TEXT NOT NULL,
  mu DOUBLE PRECISION NOT NULL,
  phi DOUBLE PRECISION NOT NULL,
  sigma DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season_id)
);
CREATE TABLE IF NOT EXISTS queue (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  seed BIGINT NOT NULL,
  season_id TEXT NOT NULL,
  player0_id TEXT NOT NULL REFERENCES players(id),
  player1_id TEXT NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  winner_id TEXT REFERENCES players(id),
  rated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS match_reports (
  report_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  reporter_id TEXT NOT NULL REFERENCES players(id),
  winner_id TEXT NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
}

export async function buildApp(env: NodeJS.ProcessEnv = process.env) {
  const cfg = loadConfig(env);
  const db = createPool(cfg.databaseUrl);
  await migrate(db);

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

  app.post("/auth/session", async () => createSession(db, cfg.seasonId));

  app.post("/queue", async (req, reply) => {
    try {
      const playerId = await requirePlayer(req.headers.authorization);
      const existing = await db.query(
        "SELECT 1 FROM queue WHERE player_id = $1",
        [playerId],
      );
      if (existing.rowCount) {
        return reply.code(409).send({ error: "already_queued" });
      }
      const status = await enqueue(db, playerId, cfg.seasonId);
      return { status };
    } catch (e) {
      const err = e as Error & { code?: string; statusCode?: number };
      if (err.code === "already_in_match") {
        return reply.code(409).send({ error: "already_in_match" });
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
