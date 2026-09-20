import { createPool } from "./pool.js";

const sql = `
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

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player0_id, player1_id);
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const pool = createPool(url);
  await pool.query(sql);
  await pool.end();
  console.log("migrate ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
