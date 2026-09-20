import { randomUUID, randomInt } from "node:crypto";
import type { Db } from "../db/pool.js";
import type { Config } from "../config.js";
import type pg from "pg";

export type Endpoint = { playerId: string; host: string; port: number };

export type MatchPayload = {
  matchId: string;
  seed: number;
  localPlayerIndex: number;
  players: Array<{ playerId: string; rating: number }>;
  endpoints: Endpoint[];
};

export type StatusResponse =
  | { status: "idle" | "queued" }
  | { status: "matched"; match: MatchPayload };

export type Advertise = { host: string; port: number };

export async function enqueue(
  db: Db,
  playerId: string,
  seasonId: string,
  cfg: Config,
  advertise?: Advertise,
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
  if (advertise) {
    assertAdvertise(advertise);
  }
  await db.query(
    `INSERT INTO queue (player_id, advertise_host, advertise_port)
     VALUES ($1, $2, $3)`,
    [playerId, advertise?.host ?? null, advertise?.port ?? null],
  );
  await tryPair(db, seasonId, cfg);
  return "queued";
}

function assertAdvertise(a: Advertise): void {
  if (!a.host || typeof a.host !== "string") {
    const err = new Error("bad_advertise");
    (err as Error & { code: string }).code = "bad_advertise";
    throw err;
  }
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) {
    const err = new Error("bad_advertise");
    (err as Error & { code: string }).code = "bad_advertise";
    throw err;
  }
}

export async function leaveQueue(db: Db, playerId: string): Promise<"left"> {
  await db.query("DELETE FROM queue WHERE player_id = $1", [playerId]);
  return "left";
}

async function nextPort(
  client: pg.PoolClient,
  cfg: Config,
): Promise<number> {
  const res = await client.query<{ next_port: number }>(
    `UPDATE port_alloc
     SET next_port = next_port + 1
     WHERE id = 1
     RETURNING next_port - 1 AS next_port`,
  );
  if (!res.rows[0]) {
    await client.query(
      `INSERT INTO port_alloc (id, next_port) VALUES (1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [cfg.placeholderPortBase],
    );
    const again = await client.query<{ next_port: number }>(
      `UPDATE port_alloc
       SET next_port = next_port + 1
       WHERE id = 1
       RETURNING next_port - 1 AS next_port`,
    );
    return again.rows[0]?.next_port ?? cfg.placeholderPortBase;
  }
  return res.rows[0].next_port;
}

async function resolveEndpoint(
  client: pg.PoolClient,
  cfg: Config,
  playerId: string,
  host: string | null,
  port: number | null,
): Promise<Endpoint> {
  if (host && port != null) {
    return { playerId, host, port };
  }
  const allocated = await nextPort(client, cfg);
  return { playerId, host: cfg.placeholderHost, port: allocated };
}

async function tryPair(db: Db, seasonId: string, cfg: Config): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const waiting = await client.query<{
      player_id: string;
      advertise_host: string | null;
      advertise_port: number | null;
    }>(
      `SELECT player_id, advertise_host, advertise_port FROM queue
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
    const ep0 = await resolveEndpoint(
      client,
      cfg,
      a.player_id,
      a.advertise_host,
      a.advertise_port,
    );
    const ep1 = await resolveEndpoint(
      client,
      cfg,
      b.player_id,
      b.advertise_host,
      b.advertise_port,
    );
    await client.query(
      `INSERT INTO matches (
         id, seed, season_id, player0_id, player1_id,
         endpoint0_host, endpoint0_port, endpoint1_host, endpoint1_port
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        matchId,
        seed,
        seasonId,
        a.player_id,
        b.player_id,
        ep0.host,
        ep0.port,
        ep1.host,
        ep1.port,
      ],
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
    endpoint0_host: string;
    endpoint0_port: number;
    endpoint1_host: string;
    endpoint1_port: number;
  }>(
    `SELECT id, seed::text, player0_id, player1_id, season_id,
            endpoint0_host, endpoint0_port, endpoint1_host, endpoint1_port
     FROM matches
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
    const endpoints: Endpoint[] = [
      {
        playerId: m.player0_id,
        host: m.endpoint0_host,
        port: m.endpoint0_port,
      },
      {
        playerId: m.player1_id,
        host: m.endpoint1_host,
        port: m.endpoint1_port,
      },
    ];
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
