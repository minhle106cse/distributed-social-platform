# ☁️ DEVOPS & HẠ TẦNG (INFRASTRUCTURE)

> 📖 **[English Version](./en/09_devops_infrastructure.md)**

Hướng dẫn setup môi trường Local và quy chuẩn quản lý Monorepo cho **TeamFin**.

---

## 1. Cấu trúc Thư mục Monorepo (Turborepo)

```
team-finance-platform/
├── apps/
│   ├── web/                    # Vite + React SPA (Frontend)
│   ├── core-api/               # NestJS Modular Monolith (Business Logic)
│   ├── auth-service/           # Fastify Microservice (Identity)
│   ├── worker-service/         # Background Jobs (Debt Simplify, Export, Cron)
│   ├── notification-service/   # WebSocket + Push Notifications
│   ├── exchange-rate-service/  # Currency API Proxy + Circuit Breaker
│   └── search-service/        # Elasticsearch Indexer (Phase 3)
├── packages/
│   ├── shared-kernel/          # Abstractions, Interfaces, Domain Types
│   ├── event-contracts/        # Kafka Event Schema (TypeScript types)
│   └── logger/                 # Structured Logging (Pino)
├── .ai/                        # AI Knowledge System
│   ├── KNOWLEDGE_INDEX.md      # Auto-generated project knowledge
│   ├── knowledge_builder.py    # Index generator script
│   └── memory/                 # Categorized experience entries (JSONL)
├── directives/                 # AI Agent SOPs
├── execution/                  # AI Agent Python Scripts
├── docs/                       # Project Documentation
│   └── en/                     # English translations
├── docker-init/                # Docker configs (Infra + Agent Sandbox)
│   └── Dockerfile.agent        # Agent container image
├── docker-compose.yml          # Local Infrastructure
├── docker-compose.agent.yml    # AI Agent Sandbox
├── turbo.json                  # Turborepo config
└── README.md
```

---

## 2. Docker Compose (Local Environment)

**Yêu cầu:** Docker Desktop, Node.js v18+, npm.

```bash
# Khởi động toàn bộ hạ tầng
docker-compose up -d

# Kiểm tra status
docker-compose ps
```

### Services

| Service | Port | Image | Dùng cho |
|---------|------|-------|----------|
| **PostgreSQL** | 5432 | `postgres:15-alpine` | Core Database |
| **PostgreSQL (Auth)** | 5433 | `postgres:15-alpine` | Auth Service Database (cách ly) |
| **Redis** | 6379 | `redis:7-alpine` | Cache, Pub/Sub, Rate Limiting |
| **Kafka** | 9092 | `confluentinc/cp-kafka` | Event Streaming |
| **Zookeeper** | 2181 | `confluentinc/cp-zookeeper` | Kafka coordination |
| **Elasticsearch** | 9200 | `elasticsearch:8.x` | Full-text Search (Phase 3) |
| **Kafka UI** | 8080 | `provectuslabs/kafka-ui` | Debug Kafka topics/messages |

---

## 3. Environment Variables

Copy `.env.example` → `.env`. KHÔNG commit `.env` lên Git.

```env
# === Core API ===
DATABASE_URL="postgresql://root:rootpassword@localhost:5432/teamfin_core?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379
KAFKA_BROKERS="localhost:9092"
KAFKA_CLIENT_ID="core-api"

# === Auth Service ===
AUTH_DATABASE_URL="postgresql://root:rootpassword@localhost:5433/teamfin_auth?schema=public"
JWT_SECRET="your-super-secret-key-change-in-production"
JWT_ACCESS_EXPIRATION="15m"
JWT_REFRESH_EXPIRATION="7d"

# === Exchange Rate Service ===
EXCHANGE_RATE_API_KEY="your-fixer-io-api-key"
EXCHANGE_RATE_BASE_URL="https://api.exchangerate-api.com/v4"
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=30000

# === Notification Service ===
WEBSOCKET_PORT=3004
PUSH_NOTIFICATION_KEY="your-push-key"

# === Elasticsearch (Phase 3) ===
ELASTICSEARCH_URL="http://localhost:9200"
```

---

## 4. Khởi chạy Development

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure
docker-compose up -d

# 3. Run database migrations
npx turbo run db:migrate

# 4. Seed sample data (optional)
npx turbo run db:seed

# 5. Start all apps in dev mode
npx turbo run dev

# Services will be available at:
# - Web:                  http://localhost:5173
# - Core API:             http://localhost:3000
# - Auth Service:         http://localhost:3001
# - Notification Service: http://localhost:3004 (WebSocket)
# - Exchange Rate Service: http://localhost:3005
# - Kafka UI:             http://localhost:8080
```

---

## 5. CI/CD Pipeline

```mermaid
flowchart LR
    PR["Pull Request"] --> Lint["Lint & Type Check"]
    Lint --> Test["Unit + Integration Tests"]
    Test --> Build["Build All Apps"]
    Build --> Deploy{"Branch?"}
    Deploy -->|main| Prod["Deploy to Production"]
    Deploy -->|develop| Staging["Deploy to Staging"]

    subgraph "Production Deploy"
        Prod --> Web["Vercel (web)"]
        Prod --> Docker["Docker Image → ECR"]
        Docker --> ECS["ECS/K8s (APIs)"]
    end
```

### Pipeline Steps

1. **Lint & Type Check:** `npx turbo run lint type-check` trên tất cả packages.
2. **Unit Test:** `npx turbo run test:unit` — Vitest.
3. **Integration Test:** `npx turbo run test:integration` — Testcontainers.
4. **Build:** `npx turbo run build` — TypeScript compile + bundle.
5. **Deploy:**
   - `apps/web` → **Vercel** (static SPA).
   - `apps/core-api`, `apps/auth-service`, etc. → **Docker Image** → AWS ECR → ECS/Kubernetes.

---

## 6. Kafka Topics

| Topic | Producer | Consumer | Mô tả |
|-------|----------|----------|-------|
| `expense-events` | core-api (Outbox) | notification-svc, search-svc, worker-svc | Expense created/updated/deleted |
| `settlement-events` | core-api (Outbox) | notification-svc, worker-svc | Settlement created/failed |
| `group-events` | core-api (Outbox) | notification-svc, search-svc | Group/member changes |
| `expense-events-dlq` | Kafka (auto) | — | Dead Letter Queue for expense events |
| `settlement-events-dlq` | Kafka (auto) | — | Dead Letter Queue for settlement events |

---

## 7. Monitoring (Phase 8)

| Tool | Dùng cho | Port |
|------|----------|------|
| **Prometheus** | Metrics collection | 9090 |
| **Grafana** | Dashboards & Alerts | 3100 |
| **Jaeger** | Distributed Tracing | 16686 |
| **Kafka UI** | Topic/Consumer inspection | 8080 |
