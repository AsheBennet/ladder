# Ladder

Ranked ladder / matchmaking for Project+ online.

MVP: `enqueue → match → report result → Glicko-2`. Dock is the client (poll `GET /queue/status`).

## Contract

See [`openapi/openapi.yaml`](openapi/openapi.yaml). Auth: `Authorization: Bearer <sessionToken>`.

Match payload fields for Dock → Bridge argv: `matchId`, `seed`, `localPlayerIndex`, `players`, `endpoints` (no `isHost`).

Endpoints currently use placeholder host/port (`PLACEHOLDER_HOST` / `PLACEHOLDER_PORT_BASE + idx`). Real NAT/STUN is later.

## Run

```bash
docker compose up --build
# or locally:
docker compose up -d db
cp .env.example .env
npm install
npm run migrate
npm run dev
```

## Tests

```bash
docker compose up -d db
DATABASE_URL=postgres://ladder:ladder@127.0.0.1:5432/ladder npm test
```

## Stack

TypeScript + Fastify + Postgres. Season tag via `SEASON_ID`.
