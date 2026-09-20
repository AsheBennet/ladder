import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.js";
import { DEFAULT_RATING } from "../rating/glicko2.js";

export async function createSession(
  db: Db,
  seasonId: string,
): Promise<{ sessionToken: string; playerId: string }> {
  const playerId = randomUUID();
  const sessionToken = randomUUID();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO players (id) VALUES ($1)", [playerId]);
    await client.query(
      "INSERT INTO sessions (token, player_id) VALUES ($1, $2)",
      [sessionToken, playerId],
    );
    await client.query(
      `INSERT INTO ratings (player_id, season_id, mu, phi, sigma)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        playerId,
        seasonId,
        DEFAULT_RATING.mu,
        DEFAULT_RATING.phi,
        DEFAULT_RATING.sigma,
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { sessionToken, playerId };
}

export async function playerIdFromToken(
  db: Db,
  token: string,
): Promise<string | null> {
  const res = await db.query<{ player_id: string }>(
    "SELECT player_id FROM sessions WHERE token = $1",
    [token],
  );
  return res.rows[0]?.player_id ?? null;
}
