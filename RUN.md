# Running Cortex locally

Cortex is a Turborepo monorepo of backend microservices. **Infra runs in Docker;
the app services run on the host** (fast hot-reload). The nginx API gateway (in
Docker) proxies to the host services, so everything is reachable through **one URL**.

## Prerequisites
- Node 20+, npm 11+, Docker Desktop
- A `.env` at the repo root (see the env keys validated in each `apps/*/src/config/env.validation.ts`)
- `protoc` on PATH — only needed to regenerate `packages/shared-kernel/src/grpc/*`
  after editing a `.proto` file (`npm run proto:gen --workspace=@distributed-social-platform/shared-kernel`).
  Not needed just to run the app — generated code is committed. Install via
  `choco install protoc` (Windows) or your OS package manager.

## Start

```bash
# 1. Infra: postgres(+pgvector) · kafka · elasticsearch · redis · ollama(embeddings) · nginx gateway · prometheus/grafana
npm run infra:up

# 2. First time only — create per-service DBs + push schemas + pull embedding model
#    DBs (auth_db, core_db, notification_db, search_db) are created by docker-init/init-dbs.sql on a fresh volume.
docker exec dsp-embedding ollama pull nomic-embed-text
npm run db:push                       # prisma db push across services

# 3. All services with hot-reload (auth:4001 core:4002 notif:4003 search:4004 + web:3001)
npm run dev
```

## One gateway URL

The gateway listens on **http://localhost:8000** and routes `/api/v1/*`:

| Path | → Service |
|---|---|
| `/api/v1/{auth,users,roles,permissions}` | auth-service (:4001) |
| `/api/v1/{orgs,spaces,knowledge,feed,credits,reputation}` | core-api (:4002) |
| `/api/v1/notifications` | notification-service (:4003) |
| `/api/v1/search` | search-service (:4004) |

Each service also exposes `GET /health`, `GET /metrics`, and Swagger at `/docs`
(dev only) on its own port.

## Quick end-to-end (through the gateway)

```
POST http://localhost:8000/api/v1/auth/register        # get a JWT
POST http://localhost:8000/api/v1/spaces               # create a space (X-Org-Id header)
POST http://localhost:8000/api/v1/knowledge            # create → publish an item
POST http://localhost:8000/api/v1/search               # RAG hybrid search + AI summary
GET  http://localhost:8000/api/v1/notifications        # notifications from followed spaces
```

> Publishing a knowledge item emits a Kafka event; notification-service and
> search-service consume it (fan-out notification + embed-on-publish for search).
> Allow ~2–4s (outbox poll interval) before it shows up.

## Stop
```bash
# Ctrl+C the dev process, then:
npm run infra:down
```
