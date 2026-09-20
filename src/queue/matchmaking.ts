import { randomUUID, randomInt } from "node:crypto";
import type { Db } from "../db/pool.js";
import type { Config } from "../config.js";

export type MatchPayload = {
  matchId: string;
  seed: number;
  localPlayerIndex: number;
  players: Array<{ playerId: string; rating: number }>;
  endpoints: Array<{ playerId: string; host: string; port: number }>;
};

export type StatusResponse =
  | { status: "idle" | "queued" }
  | { status: "matched"; match: MatchPayload };

export async function enqueue(
  db: Db,
  playerId: string,
  seasonId: string,
): Promise<"queued"> {
  const active = await db.query(
    `SELECT 1 FROM matches
     WHERE winner_id IS NULL
       AND (player0_id = $1 OR player1_id = $1)
     LIMIT 1`,
    [playerId],
  );
  if (active.rowCount) {
    const err = new Error("already_in_match");
    (err as Error & { code: string }).code = "already_in_match";
    throw err;
  }
  await db.query("INSERT INTO queue (player_id) VALUES ($1)", [playerId]);
  await tryPair(db, seasonId);
  return "queued";
}

export async function leaveQueue(db: Db, playerId: string): Promise<"left"> {
  await db.query("DELETE FROM queue WHERE player_id = $1", [playerId]);
  return "left";
}

async function tryPair(db: Db, seasonId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const waiting = await client.query<{ player_id: string }>(
      `SELECT player_id FROM queue
       ORDER BY enqueued_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 2`,
    );
    if (waiting.rows.length < 2) {
      await client.query("COMMIT");
      return;
    }
    const [a, b] = waiting.rows;
    const matchId = randomUUID();
    const seed = randomInt(0, 0xffff_ffff);
    await client.query(
      `INSERT INTO matches (id, seed, season_id, player0_id, player1_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [matchId, seed, seasonId, a.player_id, b.player_id],
    );
    await client.query("DELETE FROM queue WHERE player_id = ANY($1::text[])", [
      [a.player_id, b.player_id],
    ]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getStatus(
  db: Db,
  cfg: Config,
  playerId: string,
): Promise<StatusResponse> {
  const match = await db.query<{
    id: string;
    seed: string;
    player0_id: string;
    player1_id: string;
    season_id: string;
  }>(
    `SELECT id, seed::text, player0_id, player1_id, season_id FROM matches
     WHERE winner_id IS NULL
       AND (player0_id = $1 OR player1_id = $1)
     ORDER BY created_at DESC
     LIMIT 1`,
    [playerId],
  );
  if (match.rows[0]) {
    const m = match.rows[0];
    const ids = [m.player0_id, m.player1_id];
    const ratings = await db.query<{ player_id: string; mu: number }>(
      `SELECT player_id, mu FROM ratings
       WHERE season_id = $1 AND player_id = ANY($2::text[])`,
      [m.season_id, ids],
    );
    const muById = new Map(ratings.rows.map((r) => [r.player_id, r.mu]));
    const localPlayerIndex = m.player0_id === playerId ? 0 : 1;
    const players = ids.map((id) => ({
      playerId: id,
      rating: muById.get(id) ?? 1500,
    }));
    const endpoints = ids.map((id, idx) => ({
      playerId: id,
      host: cfg.placeholderHost,
      port: cfg.placeholderPortBase + idx,
    }));
    return {
      status: "matched",
      match: {
        matchId: m.id,
        seed: Number(m.seed),
        localPlayerIndex,
        players,
        endpoints,
      },
    };
  }
  const q = await db.query("SELECT 1 FROM queue WHERE player_id = $1", [
    playerId,
  ]);
  if (q.rowCount) return { status: "queued" };
  return { status: "idle" };
}
