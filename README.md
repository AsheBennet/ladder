# Ladder

Ranked ladder / matchmaking for Project+ online.

MVP: `enqueue → match → report result → Glicko-2`. Dock is the client (poll `GET /queue/status`).

## Contract

See [`openapi/openapi.yaml`](openapi/openapi.yaml). Auth: `Authorization: Bearer <sessionToken>`.

Match payload fields for Dock → Bridge argv: `matchId`, `seed`, `localPlayerIndex`, `players`, `endpoints` (no `isHost`).

On enqueue, Dock may send optional `advertise: { host, port }` (listen address). If omitted, Ladder allocates `PLACEHOLDER_HOST` + a unique port from `port_alloc` (starts at `PLACEHOLDER_PORT_BASE`). Endpoints are frozen on the match row. Real NAT/STUN is later.

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

## Health

`GET /health` → `{ ok: true }` for compose checks.

## Compose notes

`docker-compose.yml` keeps Postgres on the internal compose network only (no host `:5432` publish) so it won’t fight a local Postgres.

On this agent box, Docker **bridge** inter-container TCP hung; image smoke was proven with:

```bash
docker compose build
docker run --rm --network host \
  -e DATABASE_URL=postgres://ladder:ladder@127.0.0.1:5432/ladder \
  -e PORT=8080 -e SEASON_ID=s1 \
  -e PLACEHOLDER_HOST=127.0.0.1 -e PLACEHOLDER_PORT_BASE=40000 \
  ladder-scaffold-api
curl -s localhost:8080/health
```

Normal `docker compose up --build` is the intended path where bridge networking works.
