import type { Db } from "../db/pool.js";
import { pairUpdate, type Rating } from "../rating/glicko2.js";

export async function reportResult(
  db: Db,
  opts: {
    matchId: string;
    reporterId: string;
    winnerId: string;
    reportId: string;
  },
): Promise<{ ok: true; applied: boolean }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT report_id FROM match_reports WHERE report_id = $1",
      [opts.reportId],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return { ok: true, applied: false };
    }

    const match = await client.query<{
      id: string;
      season_id: string;
      player0_id: string;
      player1_id: string;
      winner_id: string | null;
    }>(
      `SELECT id, season_id, player0_id, player1_id, winner_id FROM matches
       WHERE id = $1 FOR UPDATE`,
      [opts.matchId],
    );
    const m = match.rows[0];
    if (!m) {
      await client.query("ROLLBACK");
      const err = new Error("not_found");
      (err as Error & { code: string }).code = "not_found";
      throw err;
    }
    if (m.player0_id !== opts.reporterId && m.player1_id !== opts.reporterId) {
      await client.query("ROLLBACK");
      const err = new Error("forbidden");
      (err as Error & { code: string }).code = "forbidden";
      throw err;
    }
    if (opts.winnerId !== m.player0_id && opts.winnerId !== m.player1_id) {
      await client.query("ROLLBACK");
      const err = new Error("bad_winner");
      (err as Error & { code: string }).code = "bad_winner";
      throw err;
    }

    await client.query(
      `INSERT INTO match_reports (report_id, match_id, reporter_id, winner_id)
       VALUES ($1, $2, $3, $4)`,
      [opts.reportId, opts.matchId, opts.reporterId, opts.winnerId],
    );

    if (m.winner_id) {
      await client.query("COMMIT");
      return { ok: true, applied: false };
    }

    await client.query(
      "UPDATE matches SET winner_id = $1, rated_at = now() WHERE id = $2",
      [opts.winnerId, opts.matchId],
    );

    const ratings = await client.query<{
      player_id: string;
      mu: number;
      phi: number;
      sigma: number;
    }>(
      `SELECT player_id, mu, phi, sigma FROM ratings
       WHERE season_id = $1 AND player_id = ANY($2::text[])
       FOR UPDATE`,
      [m.season_id, [m.player0_id, m.player1_id]],
    );
    const byId = new Map(
      ratings.rows.map((r) => [
        r.player_id,
        { mu: r.mu, phi: r.phi, sigma: r.sigma } satisfies Rating,
      ]),
    );
    const r0 = byId.get(m.player0_id);
    const r1 = byId.get(m.player1_id);
    if (!r0 || !r1) {
      await client.query("ROLLBACK");
      throw new Error("missing_ratings");
    }
    const aWon = opts.winnerId === m.player0_id;
    const next = pairUpdate(r0, r1, aWon);
    await client.query(
      `UPDATE ratings SET mu = $1, phi = $2, sigma = $3, updated_at = now()
       WHERE player_id = $4 AND season_id = $5`,
      [next.a.mu, next.a.phi, next.a.sigma, m.player0_id, m.season_id],
    );
    await client.query(
      `UPDATE ratings SET mu = $1, phi = $2, sigma = $3, updated_at = now()
       WHERE player_id = $4 AND season_id = $5`,
      [next.b.mu, next.b.phi, next.b.sigma, m.player1_id, m.season_id],
    );

    await client.query("COMMIT");
    return { ok: true, applied: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
