# 🚀 DISTRIBUTED SOCIAL PLATFORM — EXECUTION ROADMAP (PHASE-FIRST)

---

# 🧠 MỤC TIÊU GIAI ĐOẠN NÀY

## Không build loạn.
## Không code trước architecture.
## Không microservice trước foundation.

---

# TRIẾT LÝ:
## Build theo thứ tự:
### Foundation → Correctness → Reliability → Scale → Hardening

---

# 🏁 MASTER ROADMAP OVERVIEW

| Phase | Mục tiêu | Output |
|------|----------|--------|
| Phase 0 | Foundation | Repo + standards + infra baseline |
| Phase 1 | Core Domain Correctness | Auth + User + Social Graph |
| Phase 2 | Event Backbone | Outbox + Queue + Worker |
| Phase 3 | Feed System | Timeline + fanout |
| Phase 4 | Realtime | Chat + Notification |
| Phase 5 | Production Hardening | Observability + Security + Cost |
| Phase 6 | Release Engineering | CI/CD + Deploy + Runbook |

---

# 🔥 PHASE 0 — FOUNDATION (BẮT BUỘC)

# 🎯 Goal:
## Tạo nền tảng để toàn bộ system không vỡ về sau.

---

# Deliverables:

## 1. Monorepo Setup
### Chọn:
- Nx hoặc Turborepo

---

## Structure:
```txt
platform/
 ┣ apps/
 ┣ packages/
 ┣ infra/
 ┣ docs/
```

---

# 2. Shared Packages
## Tạo ngay:
- event-contracts
- shared-kernel
- logger
- config
- auth-sdk

---

# 3. Engineering Standards
## Define:
- ESLint
- Prettier
- Commit convention
- Branch strategy
- Environment strategy
- Error response format

---

# 4. ADR System
## Viết docs:
- Why hybrid architecture
- Why SQS
- Why PostgreSQL
- Why Redis
- Why API Gateway

---

# 5. Infra Baseline
## Setup:
- Docker Compose local
- PostgreSQL
- Redis
- LocalStack/SQS emulator
- Terraform skeleton

---

# Output:
## “Platform skeleton ready”

---

---

# 🔷 PHASE 1 — CORE DOMAIN CORRECTNESS

# 🎯 Goal:
## Xây đúng business foundation trước scale.

---

# Build Order:

## 1. auth-service
### Features:
- Register
- Login
- JWT
- Refresh token rotation
- Logout
- Session revoke

---

## 2. core-api
### Modules:
- user-module
- social-graph-module
- interaction-module

---

# MUST:
## Domain boundary:
### auth:
identity only

### core:
profile + graph

---

# Key Decisions:
## Social Graph Table:
- follow
- unfollow
- block
- mute

---

# Deliverables:
## APIs:
- /auth/register
- /auth/login
- /users/:id
- /follow
- /unfollow
- /block

---

# Output:
## “Correct domain + clean ownership”

---

---

# 🟡 PHASE 2 — EVENT BACKBONE

# 🎯 Goal:
## Chuyển từ synchronous CRUD sang distributed architecture.

---

# Build:

## 1. Event Contract
### Define:
```ts
eventId
eventType
version
correlationId
idempotencyKey
payload
```

---

## 2. Outbox Pattern
### Implement:
DB transaction + outbox table

---

## 3. Publisher
### Core emits:
- USER_FOLLOWED
- USER_BLOCKED
- TODO_CREATED

---

## 4. worker-service
### Consume:
- Parse
- Route
- Retry
- DLQ

---

# MUST:
## Inbox dedupe

---

# Output:
## “Reliable async backbone”

---

---

# 🟣 PHASE 3 — FEED SYSTEM

# 🎯 Goal:
## Giải quyết read-heavy architecture.

---

# Build:
## Feed MVP:
- Post create
- Fanout
- Timeline read

---

# Strategy:
## Hybrid:
### Regular:
fanout-on-write

### Large account:
fanout-on-read

---

# Infra:
- Redis sorted sets
- PostgreSQL source

---

# Ranking v1:
- Recency
- Follow score

---

# Output:
## “Feed architecture credibility”

---

---

# 🟢 PHASE 4 — REALTIME LAYER

# 🎯 Goal:
## WebSocket + scaling + realtime state

---

# Build:

## chat-service:
- Connect
- Message send
- Message receive
- Presence
- Redis pub/sub
- Delivery state

---

## notification-service:
- Consume worker events
- Push realtime
- Retry failed sends

---

# MUST:
## Handle:
- reconnect
- duplicate
- ordering

---

# Output:
## “Realtime distributed competency”

---

---

# 🟠 PHASE 5 — PRODUCTION HARDENING

# 🎯 Goal:
## Từ project thành production-grade.

---

# Add:

## Observability:
- requestId
- correlationId
- structured logs
- metrics
- dashboards

---

## Security:
- WAF
- rate limiting
- secret manager
- IAM
- encryption

---

## Performance:
- Redis cache
- query optimization
- k6 load test

---

## Failure:
- replay tool
- DLQ admin
- chaos testing

---

# Output:
## “Operational maturity”

---

---

# 🔴 PHASE 6 — RELEASE ENGINEERING

# 🎯 Goal:
## Có thể deploy và maintain thật.

---

# Build:
## CI/CD:
- GitHub Actions
- Test gates
- Lint
- Build
- Deploy

---

## Infra:
- API Gateway
- ECS/Fargate
- Lambda
- RDS
- Redis
- CloudWatch

---

## Deployment:
- staging
- prod
- rollback
- blue/green (optional)

---

# Documentation:
- Runbook
- Incident playbook
- Cost dashboard

---

# Output:
## “Release-capable platform”

---

# 📌 PRIORITY MATRIX (RẤT QUAN TRỌNG)

# MUST FIRST:
## Before writing serious business code:
- Monorepo
- Shared contracts
- Domain boundaries
- ADR
- Auth
- Core

---

# MUST NOT EARLY:
## Avoid too soon:
- Kafka
- Kubernetes
- ML ranking
- CQRS split
- Multi-region

---

# 🧠 EXECUTION DISCIPLINE

# Rule:
## Mỗi phase phải có:
### 1. Design
### 2. Contract
### 3. Build
### 4. Test
### 5. Failure case
### 6. Documentation

---

# Ví dụ:
## Không chỉ:
“Build follow API”

### Phải:
- Schema
- Event
- Retry
- Block edge case
- Rate limit
- Monitoring

---

# 📚 DOCUMENTS TO CREATE PER PHASE

## Every phase:
- ADR
- Sequence Diagram
- API Spec
- Event Spec
- Failure Spec
- Cost Note

---

# 🚀 THỰC TẾ NÊN BẮT ĐẦU NGAY HÔM NAY

# DAY 1:
## Phase 0:
### Làm:
- Monorepo
- Folder structure
- Shared package
- Logger
- Config
- Docker Compose
- PostgreSQL
- Redis
- Local queue

---

# DAY 2–7:
## Auth + Core

---

# WEEK 2:
## Event backbone

---

# WEEK 3:
## Feed

---

# WEEK 4:
## Realtime

---

# MONTH 2:
## Hardening + deploy

---

# 🔥 FINAL ADVICE

## Đừng hỏi:
“Service nào build trước?”

---

## Hãy hỏi:
### “Foundation nào nếu sai sẽ phá toàn bộ system?”

---

# ANSWER:
## Foundation + Contracts + Domain Boundaries

---

# 🏁 BOTTOM LINE

## Bắt đầu:
# Phase 0 → Foundation

### Nếu Phase 0 yếu:
Toàn bộ project sẽ devolve thành spaghetti distributed system.

---

# 🎯 NEXT STEP:
## Tôi khuyên:
### Bây giờ làm ngay:
# Phase 0.1 — Repo + Package + Boundary Blueprint