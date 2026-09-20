import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db/pool.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://ladder:ladder@127.0.0.1:5432/ladder";

describe("matchmaking happy path", () => {
  let app: FastifyInstance;
  let db: Db;

  before(async () => {
    const built = await buildApp({
      DATABASE_URL: databaseUrl,
      PORT: "0",
      SEASON_ID: "test",
      PLACEHOLDER_HOST: "127.0.0.1",
      PLACEHOLDER_PORT_BASE: "41000",
    });
    app = built.app;
    db = built.db;
    await app.ready();
    // isolate allocator for this suite
    await db.query("UPDATE port_alloc SET next_port = 41000 WHERE id = 1");
    await db.query("DELETE FROM match_reports");
    await db.query("DELETE FROM matches");
    await db.query("DELETE FROM queue");
  });

  after(async () => {
    await app.close();
  });

  it("two players enqueue → matched → result rates once → reportId idempotent", async () => {
    const s1 = await app.inject({ method: "POST", url: "/auth/session" });
    const s2 = await app.inject({ method: "POST", url: "/auth/session" });
    assert.equal(s1.statusCode, 200);
    assert.equal(s2.statusCode, 200);
    const a = s1.json() as { sessionToken: string; playerId: string };
    const b = s2.json() as { sessionToken: string; playerId: string };

    const q1 = await app.inject({
      method: "POST",
      url: "/queue",
      headers: { authorization: `Bearer ${a.sessionToken}` },
      payload: { advertise: { host: "10.0.0.1", port: 7777 } },
    });
    assert.equal(q1.statusCode, 200);
    assert.equal(q1.json().status, "queued");

    const q2 = await app.inject({
      method: "POST",
      url: "/queue",
      headers: { authorization: `Bearer ${b.sessionToken}` },
      // no advertise → server allocates
    });
    assert.equal(q2.statusCode, 200);

    const st1 = await app.inject({
      method: "GET",
      url: "/queue/status",
      headers: { authorization: `Bearer ${a.sessionToken}` },
    });
    const st2 = await app.inject({
      method: "GET",
      url: "/queue/status",
      headers: { authorization: `Bearer ${b.sessionToken}` },
    });
    assert.equal(st1.statusCode, 200);
    assert.equal(st2.statusCode, 200);
    const m1 = st1.json() as {
      status: string;
      match: {
        matchId: string;
        seed: number;
        localPlayerIndex: number;
        players: Array<{ playerId: string; rating: number }>;
        endpoints: Array<{ playerId: string; host: string; port: number }>;
      };
    };
    const m2 = st2.json() as typeof m1;
    assert.equal(m1.status, "matched");
    assert.equal(m2.status, "matched");
    assert.equal(m1.match.matchId, m2.match.matchId);
    assert.equal(m1.match.seed, m2.match.seed);
    assert.notEqual(m1.match.localPlayerIndex, m2.match.localPlayerIndex);
    assert.equal(m1.match.endpoints.length, 2);

    const epA = m1.match.endpoints.find((e) => e.playerId === a.playerId);
    const epB = m1.match.endpoints.find((e) => e.playerId === b.playerId);
    assert.ok(epA && epB);
    assert.equal(epA.host, "10.0.0.1");
    assert.equal(epA.port, 7777);
    assert.equal(epB.host, "127.0.0.1");
    assert.equal(epB.port, 41000);
    assert.notEqual(epA.port, epB.port);

    const winnerId = a.playerId;
    const r1 = await app.inject({
      method: "POST",
      url: `/match/${m1.match.matchId}/result`,
      headers: { authorization: `Bearer ${a.sessionToken}` },
      payload: { winnerId, reportId: "r-a-1" },
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.json().applied, true);

    const r1b = await app.inject({
      method: "POST",
      url: `/match/${m1.match.matchId}/result`,
      headers: { authorization: `Bearer ${a.sessionToken}` },
      payload: { winnerId, reportId: "r-a-1" },
    });
    assert.equal(r1b.statusCode, 200);
    assert.equal(r1b.json().applied, false);

    const r2 = await app.inject({
      method: "POST",
      url: `/match/${m1.match.matchId}/result`,
      headers: { authorization: `Bearer ${b.sessionToken}` },
      payload: { winnerId, reportId: "r-b-1" },
    });
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.json().applied, false);

    const ratings = await db.query<{ player_id: string; mu: number }>(
      "SELECT player_id, mu FROM ratings WHERE season_id = $1",
      ["test"],
    );
    const mu = Object.fromEntries(ratings.rows.map((row) => [row.player_id, row.mu]));
    assert.ok(mu[a.playerId] > 1500);
    assert.ok(mu[b.playerId] < 1500);
  });
});
