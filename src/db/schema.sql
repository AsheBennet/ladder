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
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  advertise_host TEXT,
  advertise_port INT
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  seed BIGINT NOT NULL,
  season_id TEXT NOT NULL,
  player0_id TEXT NOT NULL REFERENCES players(id),
  player1_id TEXT NOT NULL REFERENCES players(id),
  endpoint0_host TEXT NOT NULL DEFAULT '127.0.0.1',
  endpoint0_port INT NOT NULL DEFAULT 40000,
  endpoint1_host TEXT NOT NULL DEFAULT '127.0.0.1',
  endpoint1_port INT NOT NULL DEFAULT 40001,
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
CREATE TABLE IF NOT EXISTS port_alloc (
  id INT PRIMARY KEY,
  next_port INT NOT NULL
);
INSERT INTO port_alloc (id, next_port) VALUES (1, 40000)
  ON CONFLICT (id) DO NOTHING;
ALTER TABLE queue ADD COLUMN IF NOT EXISTS advertise_host TEXT;
ALTER TABLE queue ADD COLUMN IF NOT EXISTS advertise_port INT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS endpoint0_host TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS endpoint0_port INT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS endpoint1_host TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS endpoint1_port INT;
UPDATE matches SET endpoint0_host = '127.0.0.1' WHERE endpoint0_host IS NULL;
UPDATE matches SET endpoint0_port = 40000 WHERE endpoint0_port IS NULL;
UPDATE matches SET endpoint1_host = '127.0.0.1' WHERE endpoint1_host IS NULL;
UPDATE matches SET endpoint1_port = 40001 WHERE endpoint1_port IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player0_id, player1_id);
