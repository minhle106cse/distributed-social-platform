# ☁️ DEVOPS & HẠ TẦNG (INFRASTRUCTURE)


Hướng dẫn setup môi trường Local và quy chuẩn quản lý Monorepo cho **Cortex**.

> ✅ Tài liệu này được **đồng bộ với `docker-compose.yml` thực tế** (audit 2026-06). Mọi service/port dưới đây khớp file compose.

---

## 1. Cấu trúc Thư mục Monorepo (Turborepo)

```
cortex-knowledge-hub/
├── apps/
│   ├── web/                    # Vite + React SPA (Frontend)
│   ├── core-api/               # NestJS Modular Monolith (Business Logic)
│   ├── auth-service/           # Fastify Microservice (Identity, org-scoped RBAC)
│   ├── worker-service/         # Background Jobs (Embeddings, Re-index, Digest, Stale)
│   ├── notification-service/   # WebSocket + Push Notifications
│   ├── search-service/         # Elasticsearch Indexer (Kafka consumer)
│   └── chat-service/           # Realtime threads + AI Assistant (RAG)
├── packages/
│   ├── shared-kernel/          # Abstractions, CQRS bus, logger, types
│   └── event-contracts/        # Kafka event schemas (Phase 2+)
├── directives/                 # AI Workflow SOPs (the coding rulebook)
├── docs/                       # Design & spec (business, schema, API, security)
├── .ai/                        # KNOWLEDGE_INDEX (generated) + memory buffer + status
├── .claude/                    # settings.json (2 hooks) + hooks/turn-context.cjs
├── docker-init/                # init-dbs.sql, nginx.conf, prometheus/, grafana/
└── docker-compose.yml          # Local infrastructure
```

---

## 2. Hạ tầng Local (Docker Compose) — TRẠNG THÁI THỰC TẾ

### 2.1. Data Tier

| Service | Image | Container | Port (host:container) | Vai trò |
|---------|-------|-----------|------------------------|---------|
| **postgres** | `pgvector/pgvector:pg16` | `dsp-postgres` | `${DB_PORT}:5432` (15432) | **1 instance**, **4 logical DB**: `core_db` (mặc định qua `POSTGRES_DB`) + `auth_db` + `notification_db` + `search_db` (3 DB sau tạo qua `docker-init/init-dbs.sql`). **pgvector** bật trên `core_db` (hiện vestigial — schema không còn model nào dùng, xem `docs/04` §1) và `search_db` (nơi thực sự dùng — `knowledge_chunks`) |
| **redis** | `redis:7-alpine` | `dsp-redis` | `${REDIS_PORT}:6379` | Cache, Pub/Sub, rate-limit (AOF on) |
| **kafka** | `confluentinc/cp-kafka:7.5.0` | `dsp-kafka` | `9092` + `9093` | Event backbone, **KRaft mode (KHÔNG Zookeeper)** |
| **elasticsearch** | `elasticsearch:8.10.2` | `dsp-elasticsearch` | `${ELASTIC_PORT}:9200` | Full-text search (xpack security on) — per-tenant index, hợp nhất với pgvector bằng RRF |
| **embedding (Ollama)** | `ollama/ollama` | `dsp-embedding` | `${EMBEDDING_SERVICE_PORT}:11434` (11434) | Self-hosted embeddings (`nomic-embed-text`, dim 768) cho search-service — Claude KHÔNG có embeddings API |

> ⚠️ **Đính chính so với tài liệu cũ:** KHÔNG có 2 Postgres (5432/5433) và KHÔNG có Zookeeper. Chỉ **1 Postgres** (port `15432`), giờ tạo **4 DB** (không phải 2 — notification-service và search-service đã lên own-DB kể từ Phase 4/6), và Kafka chạy **KRaft**.

### 2.2. Gateway & Tools

| Service | Container | Port | Vai trò |
|---------|-----------|------|---------|
| **api-gateway** (nginx) | `dsp-api-gateway` | `${API_GATEWAY_PORT}:80`, `:8001`, `:9090` | Reverse proxy → auth-service (4001) / core-api (4002) / **notification-service (4003)** / **search-service (4004)**; proxy RedisInsight & Prometheus (basic auth) |
| **kafka-ui** | `dsp-kafka-ui` | `${KAFKA_UI_PORT}:8080` | Inspect topic/consumer |
| **kibana** | `dsp-kibana` | `${KIBANA_PORT}:5601` | UI Elasticsearch |
| **redisinsight** | `dsp-redisinsight` | qua nginx `:8001` | UI Redis |

### 2.3. Observability (Prometheus + Grafana + Exporters)

| Service | Container | Port | Scrape |
|---------|-----------|------|--------|
| **prometheus** | `dsp-prometheus` | qua nginx `:9090` | Thu thập metrics |
| **grafana** | `dsp-grafana` | `${GRAFANA_PORT}:3000` | Dashboard (datasource Prometheus auto-provision) |
| **node-exporter** | `dsp-node-exporter` | `9100` | Host metrics |
| **postgres-exporter** | `dsp-postgres-exporter` | `9187` | Postgres |
| **redis-exporter** | `dsp-redis-exporter` | `9121` | Redis |
| **kafka-exporter** | `dsp-kafka-exporter` | `9308` | Kafka (`kafka:29092`) |
| **elasticsearch-exporter** | `dsp-elasticsearch-exporter` | `9114` | Elasticsearch |
| **nginx-exporter** | `dsp-nginx-exporter` | `9113` | `api-gateway:80/stub_status` |

**Volumes:** `postgres_data`, `redis_data`, `kafka_data`, `es_data`, `prometheus_data`, `grafana_data`.

---

## 3. Map Service ↔ Hạ tầng ↔ Phase kích hoạt

| Hạ tầng | Dùng cho (business) | Kích hoạt ở Phase |
|---------|---------------------|-------------------|
| **PostgreSQL** | Knowledge, Event Store, Read Model | Phase 1 |
| **pgvector** | Embeddings, semantic search (RAG) | Phase 4 |
| **Kafka** | Outbox, re-index/re-embed events, DLQ | Phase 2 |
| **Elasticsearch** | Full-text search (Hybrid với pgvector) | Phase 4 |
| **Redis** | Cache feed/balance, rate-limit AI, Pub/Sub realtime, stampede lock | Phase 3 (cache) → Phase 5/6 |
| **notification-service** | Realtime notify (REST, không phải WebSocket — xem `docs/06`) | Phase 6 (early, B1+B2 done) |
| **search-service** | Semantic + hybrid search, RAG summary | Phase 4 (code-complete, smoke-tested) |
| **Prometheus/Grafana** | Observability | Phase 0 (nền) → 2026-07-08 monitoring-as-code (recording rules + dashboard/alerting provisioned) |

> Redis/ES hiện **đã khai báo trong compose nhưng chưa được code dùng cho mọi mục đích liệt kê** (vd rate-limit AI, cache feed/balance — chưa implement, xem `docs/10` §4); Kafka + pgvector **đã dùng thật** (outbox/event backbone từ Phase 2, embeddings/hybrid search từ Phase 4). Phần chưa dùng là chủ ý theo lộ trình phased ("tiếp cận công nghệ trước khi cần"), không phải thừa.

---

## 4. Cấu hình Khởi tạo (`docker-init/`)

- **`init-dbs.sql`** — tạo `auth_db` + `notification_db` + `search_db` (core_db auto-tạo qua `POSTGRES_DB`). ✅ Bật pgvector trên **cả `core_db`** (`\c core_db; CREATE EXTENSION IF NOT EXISTS vector;` — vestigial, không model nào dùng nữa) **và `search_db`** (`\c search_db; CREATE EXTENSION IF NOT EXISTS vector;` — nơi dùng thật, `knowledge_chunks`).
- **`nginx.conf`** — định tuyến gateway theo 3 upstream + regex path: `auth_service` (`auth|users|roles|permissions` → :4001), `search_service` (`search` → :4004), `notification_service` (`notifications` → :4003), `core_api` (`orgs|spaces|invites|knowledge|follows|bookmarks|ai|credits|reputation|feed|admin` → :4002 — `admin` = endpoint system-admin platform-wide, `SystemPermissionGuard` chứ không phải `OrgGuard`). Giữ `/stub_status` cho nginx-exporter.
- **`prometheus/prometheus.yml`** — scrape targets cho các exporter; recording rules + alerting rules provisioned as code (thêm 2026-07-08).
- **`grafana/provisioning/`** — datasource Prometheus + dashboard "cortex-overview" + alerting rules (provisioned as code).

---

## 5. Biến môi trường (`.env`)

Nhóm chính (xem `.env.example`):
- **DB:** `DB_HOST/PORT/USER/PASSWORD`, `CORE_DB_NAME`, `AUTH_DB_NAME`, `NOTIFICATION_DB_NAME`, `SEARCH_DB_NAME`, và `*_DATABASE_URL` tương ứng cho từng service.
- **Redis/Kafka/Elastic/Embedding:** `REDIS_*`, `KAFKA_*` (per-service `clientId`/consumer-group), `ELASTIC_*`, `EMBEDDING_SERVICE_PORT` (Ollama).
- **App ports:** `AUTH_SERVICE_PORT=4001`, `CORE_API_PORT=4002`, `NOTIFICATION_SERVICE_PORT=4003`, `SEARCH_SERVICE_PORT=4004`, `API_GATEWAY_PORT=8000`.
- **gRPC (org-provisioning saga, 2026-07-07):** `AUTH_GRPC_PORT=50051`, `CORE_GRPC_PORT=50052`, `INTERNAL_GRPC_SHARED_SECRET` (M2M auth, không phải JWT).
- **gRPC (AI-Query saga, Phase 5b 2026-08-22):** `SEARCH_GRPC_PORT=50054` (search-service mọc gRPC
  **server** đầu tiên — trước đó nó chỉ là client), `SEARCH_GRPC_URL=localhost:50054` phía core-api.
  Dùng chung `INTERNAL_GRPC_SHARED_SECRET`.
- **AI-Query saga (core-api, Phase 5b):** `AI_QUERY_CREDIT_COST=1` (giá phẳng — pricing theo token
  cần usage trả về từ provider, port summarizer chưa expose), `AI_QUERY_TOP_K=10`,
  `AI_QUOTA_CAP=20` / `AI_QUOTA_REFILL_PER_MIN=10` (token bucket, xem `docs/10` §4),
  `AI_RESERVATION_TTL_MS=300000` + `AI_RESERVATION_SWEEP_INTERVAL_MS=60000` (sweeper release các
  credit hold bị bỏ lại bởi saga chết giữa chừng — TTL phải rộng hơn deadline gRPC 30s).
- **JWT:** `JWT_PUBLIC_KEY` (dùng chung, giữ ở root `.env`) + `JWT_PRIVATE_KEY`/`JWT_REFRESH_SECRET` (chỉ auth-service, tách vào `apps/auth-service/.env.secrets`, gitignored).
- **AI:** `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` (RAG summary + FE, tách vào `apps/search-service/.env.secrets`) — qua Circuit Breaker. Embeddings **không** dùng Claude (self-hosted Ollama, xem §2.1).
- **Naming debt đã biết:** `CORS_ORIGINS` (auth-service) vs `CORS_ALLOWED_ORIGINS` (3 service NestJS) — chưa hợp nhất (xem `.ai/PROJECT_STATUS.md` → Live debts).
- **Monitoring & exporter ports:** `GRAFANA_*`, `KAFKA_UI_*`, `KIBANA_PORT`, `PROMETHEUS_PORT`, `*_EXPORTER_PORT`.

---

## 6. AI Workflow Automation (Claude Code hooks)

Không có container sandbox — automation chạy bằng 2 hook trong `.claude/settings.json`:
- **`UserPromptSubmit`** → `.claude/hooks/turn-context.cjs`: bơm **trạng thái theo lượt** vào context của agent — branch, các path chưa commit (có đi vào trong submodule `apps/*`), nợ After-Task — kèm 1 dòng trỏ tới `directives/README.md`. Cố ý **không** nhắc lại luật đã có trong `CLAUDE.md`: đo 2026-08-07 cho thấy lặp lại luật tĩnh không đổi được hành vi, hook chỉ đáng tiền khi mang thứ `CLAUDE.md` không mang được.
- **`Stop`** → `scripts/sync.cjs`: sau mỗi lượt agent, detect git change → regenerate `.ai/KNOWLEDGE_INDEX.md`
  (host `python .ai/knowledge_builder.py`), rebuild shared-kernel / `prisma generate` khi cần, + cảnh báo
  warn-only nếu code đổi mà chưa log `.ai/memory` / `PROJECT_STATUS`.

---

## 7. Serverless (tuỳ chọn)
- `apps/auth-service/serverless.yml` + `apps/core-api/serverless.yml` — AWS Lambda (nodejs20.x, ap-southeast-1) cho phương án deploy serverless. Handler `dist/main.lambda.handler`.

---

## 8. Quy trình khởi chạy

```bash
docker-compose up -d           # Postgres+pgvector, Redis, Kafka, ES, Monitoring
npx turbo run db:push          # Prisma db push (mỗi service push DB riêng của mình)
npx turbo run dev              # Chạy tất cả apps
```
