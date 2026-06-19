# ☁️ DEVOPS & HẠ TẦNG (INFRASTRUCTURE)

> 📖 **[English Version](./en/09_devops_infrastructure.md)**

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
├── directives/                 # AI Workflow SOPs (Layer 1)
├── execution/                  # AI Workflow Python tools (Layer 3)
├── .ai/                        # KNOWLEDGE_INDEX + memory buffer
├── docker-init/                # init-dbs.sql, nginx.conf, prometheus/, grafana/
├── docker-compose.yml          # Local infrastructure
└── docker-compose.agent.yml    # AI Agent sandbox (Layer 0)
```

---

## 2. Hạ tầng Local (Docker Compose) — TRẠNG THÁI THỰC TẾ

### 2.1. Data Tier

| Service | Image | Container | Port (host:container) | Vai trò |
|---------|-------|-----------|------------------------|---------|
| **postgres** | `pgvector/pgvector:pg16` | `dsp-postgres` | `${DB_PORT}:5432` (15432) | **1 instance**, 2 logical DB: `core_db` + `auth_db`. Có **pgvector** cho embeddings |
| **redis** | `redis:7-alpine` | `dsp-redis` | `${REDIS_PORT}:6379` | Cache, Pub/Sub, rate-limit (AOF on) |
| **kafka** | `confluentinc/cp-kafka:7.5.0` | `dsp-kafka` | `9092` + `9093` | Event backbone, **KRaft mode (KHÔNG Zookeeper)** |
| **elasticsearch** | `elasticsearch:8.10.2` | `dsp-elasticsearch` | `${ELASTIC_PORT}:9200` | Full-text search (xpack security on) |

> ⚠️ **Đính chính so với tài liệu cũ:** KHÔNG có 2 Postgres (5432/5433) và KHÔNG có Zookeeper. Chỉ **1 Postgres** (port `15432`) tạo 2 DB qua `docker-init/init-dbs.sql`, và Kafka chạy **KRaft**.

### 2.2. Gateway & Tools

| Service | Container | Port | Vai trò |
|---------|-----------|------|---------|
| **api-gateway** (nginx) | `dsp-api-gateway` | `${API_GATEWAY_PORT}:80`, `:8001`, `:9090` | Reverse proxy → auth-service (4001) / core-api (4002); proxy RedisInsight & Prometheus (basic auth) |
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
| **notification/chat service** | Realtime, AI Assistant | Phase 6 |
| **Prometheus/Grafana** | Observability | Phase 0 (nền) → Phase 8 (đầy đủ) |

> Redis/Kafka/ES/pgvector hiện **đã khai báo trong compose nhưng chưa được code dùng** — đúng theo lộ trình phased. Đây là chủ ý để "tiếp cận công nghệ", không phải thừa.

---

## 4. Cấu hình Khởi tạo (`docker-init/`)

- **`init-dbs.sql`** — tạo `auth_db` (core_db auto-tạo qua `POSTGRES_DB`). ✅ **Đã bật pgvector**: `\c core_db; CREATE EXTENSION IF NOT EXISTS vector;` (phục vụ embeddings — Phase 4).
- **`nginx.conf`** — định tuyến gateway. ✅ **Đã cập nhật** route core-api sang domain Cortex (`orgs|spaces|knowledge|search|ai|credits|reputation|feed|notifications`). Giữ `/stub_status` cho nginx-exporter.
- **`prometheus/prometheus.yml`** — scrape targets (đã cấu hình cho các exporter + auth-service `:4001`); thêm `core-api :4002/metrics` khi core-api expose metrics.
- **`grafana/provisioning/`** — datasource Prometheus.

---

## 5. Biến môi trường (`.env`)

Nhóm chính (xem `.env.example`):
- **DB:** `DB_HOST/PORT/USER/PASSWORD`, `CORE_DB_NAME`, `AUTH_DB_NAME`, `CORE_DATABASE_URL`, `AUTH_DATABASE_URL`.
- **Redis/Kafka/Elastic:** `REDIS_*`, `KAFKA_*`, `ELASTIC_*`.
- **App ports:** `AUTH_SERVICE_PORT=4001`, `CORE_API_PORT=4002`, `API_GATEWAY_PORT=8000`.
- **JWT:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- **AI (Phase 4+):** `ANTHROPIC_API_KEY` (Claude embedding + RAG) — qua Circuit Breaker.
- **Monitoring & exporter ports:** `GRAFANA_*`, `KAFKA_UI_*`, `KIBANA_PORT`, `PROMETHEUS_PORT`, `*_EXPORTER_PORT`.

---

## 6. AI Agent Sandbox (`docker-compose.agent.yml`)

- Service `agent-sandbox` (build `docker-init/Dockerfile.agent`), giới hạn 0.5 CPU / 512M.
- Mount **read-only**: `execution/`, `apps/`, `packages/`, `directives/`, `docs/`, `readme.md`, `.env`.
- Mount **read-write**: `.tmp/`, `.ai/`.
- **Circuit Breaker pattern:** script chạy Read-Only, xuất report `.tmp/`; Agent review rồi mới apply (xem `directives/tool_builder_sop.md`).

---

## 7. Serverless (tuỳ chọn)
- `apps/auth-service/serverless.yml` + `apps/core-api/serverless.yml` — AWS Lambda (nodejs20.x, ap-southeast-1) cho phương án deploy serverless. Handler `dist/main.lambda.handler`.

---

## 8. Quy trình khởi chạy

```bash
docker-compose up -d           # Postgres+pgvector, Redis, Kafka, ES, Monitoring
npx turbo run db:migrate       # Prisma migrate (core_db + auth_db)
npx turbo run dev              # Chạy tất cả apps
# Agent sandbox (khi cần chạy tool AI workflow):
docker-compose -f docker-compose.agent.yml up -d
```
