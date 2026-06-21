# 📝 KẾ HOẠCH BÀI ĐĂNG LINKEDIN — CORTEX PROJECT

> Mục đích: ghi lại kiến thức học được + showcase system design cho tuyển dụng.
> Mỗi bài viết = 1 concept đủ sâu để kỹ sư Senior thấy giá trị. Tổng: **37 bài**.

---

## 🧩 SERIES 1 — BIG PICTURE (3 bài)

### #1 · Tại sao tôi xây Cortex?
**Góc:** Product + System Design tư duy
- Bài toán thực tế: tri thức tản mát — Slack, Notion, đầu người chủ chốt, bus factor
- Giải pháp: AI-powered internal knowledge hub (RAG + Hybrid Search)
- Điểm khác biệt: **mỗi yêu cầu nghiệp vụ ÉP BUỘC một pattern** — không có gì là trang trí
- Table: Business Requirement → System Design Pattern tương ứng (Event Sourcing / CQRS / Saga / Outbox / Circuit Breaker...)

### #2 · Modular Monolith TRƯỚC — Microservices SAU (không phải ngược lại)
**Góc:** Architecture decision
- Tại sao không làm microservices ngay từ đầu (network latency, distributed transaction pain, infra cost)
- Cách chia module ngay trong monolith để tách được sau: NO cross-domain FK, orgId everywhere, no shared state
- Phase 7: Strangler Fig — tách `discovery-service` zero-downtime khi cần scale AI riêng

### #3 · Turborepo Monorepo — Cách tổ chức codebase khi bạn có 7 apps + 2 packages
**Góc:** Developer tooling
- apps: core-api, auth-service, worker-service, notification-service, search-service, chat-service, web
- packages: shared-kernel (CQRS bus, logger, types), event-contracts (Kafka schemas)
- Turborepo pipeline: `dev`, `build`, `db:push` chạy song song đúng order dependency

---

## 🔐 SERIES 2 — AUTHENTICATION & SECURITY (4 bài)

### #4 · JWT đúng cách: RS256 + HTTP-Only Cookie + Refresh Token Rotation
**Góc:** Security deep-dive
- Không dùng LocalStorage (XSS) — HTTP-Only Secure Cookie
- Access Token 15 phút / Refresh Token 30 ngày
- Refresh Token Rotation: token cũ bị tái dùng → revoke toàn bộ **token family** (phát hiện theft)
- RS256: auth-service ký bằng `privateKey`, core-api verify bằng `publicKey` — không share secret
  (`fastify-jwt: { secret: { private, public }, sign: { algorithm: 'RS256' } }`)

### #5 · Multi-Org Login: một user, nhiều tổ chức — thiết kế thế nào?
**Góc:** Identity design
- Access Token gắn `orgId` hiện tại + role trong org
- Chuyển org → cấp lại token với orgId mới (re-scope), không share token
- Payload: `{ sub, orgId, role, jti }`

### #6 · Multi-tenant B2B: cô lập dữ liệu tuyệt đối giữa các Organization
**Góc:** Multi-tenancy architecture
- Mọi bảng nội dung đều có `orgId` — không có ngoại lệ
- AsyncLocalStorage + TenantInterceptor: tự động inject `orgId` từ JWT vào context, không phải truyền tay
- AI Data Boundary: embedding retrieval luôn filter `WHERE org_id = ?` — dữ liệu org A không bao giờ vào RAG context của org B
- Quota per tenant: seat limit, credit balance, AI rate-limit — chống noisy-neighbor

### #7 · RBAC đa tầng: System Role + Org Role + Reputation-unlocked Privilege
**Góc:** Authorization design
- 2 tầng: System RBAC (auth-service) + Org RBAC (OWNER/ADMIN/MEMBER/GUEST per tenant)
- Reputation-based privilege: đủ điểm uy tín → mở khóa thêm quyền (Verify content, edit wiki không cần duyệt)
- Tại sao không dùng permission table flat? → quản lý được quyền động mà không cần deploy lại

---

## 🏗️ SERIES 3 — HEXAGONAL ARCHITECTURE & DDD (4 bài)

### #8 · Hexagonal Architecture (Ports & Adapters) + Clean Architecture — không phải lý thuyết
**Góc:** Architecture pattern
- Clean Architecture (Uncle Bob) là triết lý gốc: **dependency rule** — mọi dependency trỏ vào trong, domain không biết framework tồn tại
- Hexagonal Architecture là implementation cụ thể: Port (interface trong Application) + Adapter (implement trong Infrastructure)
- Folder structure trong core-api enforce điều này: `domain/` → `application/` → `infrastructure/` → `presentation/`
- Lợi ích thực tế: swap Prisma → TypeORM không đụng business logic

### #9 · DDD Aggregate Pattern — thiết kế domain object đúng cách
**Góc:** Domain-Driven Design thực tế
- Entity vs Aggregate: `Organization`, `Space` là Aggregate — đóng gói state hoàn toàn bên trong, bên ngoài không truy cập trực tiếp `props`
- `private constructor` — không ai `new Organization()` trực tiếp được
- `static create()` — factory method cho creation với default values
- `static rehydrate()` — factory method rebuild từ DB snapshot, không trigger business logic
- `toSnapshot()` — export ra plain object cho persistence layer
- Bounded Context: tenant / knowledge / discovery / credit / reputation — NO cross-domain FK trong schema

### #10 · NestJS + Fastify: tại sao không dùng Express mặc định?
**Góc:** Framework choice
- Fastify nhanh hơn Express nhờ schema-based JSON serialization, lower overhead per request
- NestJS Fastify adapter: `@nestjs/platform-fastify`, cần register `fastifyCookie`, `fastifyHelmet`, `fastifyCompress`
- Zod validation: `ZodValidationPipe` + `fastify-type-provider-zod` — type-safe từ schema đến handler
- `app.useLogger()`, `app.setGlobalPrefix()`, `app.enableShutdownHooks()` — bootstrap checklist

### #11 · Prisma v7: cấu hình đúng cách trong Monorepo
**Góc:** ORM & Database
- `prisma.config.ts` thay vì DATABASE_URL trong schema — inject adapter lúc runtime (`PrismaPg` + connection pool)
- UUID PK (không autoincrement), camelCase code → `@map("snake_case")` DB
- Soft delete: `deletedAt DateTime?` — filter thủ công trong repository layer (`findFirst({ where: { deletedAt: null } })`), KHÔNG dùng `$extends` global (tránh side effect ẩn cho query cần include deleted)
- Không FK chéo domain (phục vụ tách Microservices sau)

---

## 📨 SERIES 4 — CQRS & DI (5 bài)

### #12 · CQRS là gì và tại sao đọc/ghi tách biệt lại quan trọng?
**Góc:** Pattern explanation từ bài toán thực
- Bài toán: dashboard leaderboard query 1000x vs ghi 1x — dùng chung DB model → index hell
- CQRS: CommandBus (write) ↔ QueryBus (read) → optimize riêng từng hướng
- Read query chạy trên Materialized View / Redis cache, không bao giờ đụng Event Store

### #13 · CQRS Middleware Pipeline trong NestJS — Logging, Retry, Transaction
**Góc:** Implementation deep-dive
- `commandBus.use(loggingMiddleware, retryMiddleware, transactionMiddleware)`
- Middleware chain: AOP-style, mỗi middleware wrap handler bằng try/catch/finally
- TransactionMiddleware: tự wrap mọi Command trong Prisma `$transaction`
- RetryMiddleware: detect `isPrismaTransientError()` (deadlock, pool timeout) → exponential backoff

### #14 · DiscoveryModule: cách NestJS auto-discover Handler mà không cần đăng ký thủ công
**Góc:** NestJS internals / DI deep-dive
- `DiscoveryService.getProviders()` trả về tất cả providers từ `ModulesContainer` (root registry toàn App)
- `Reflect.getMetadata(COMMAND_HANDLER_METADATA, metatype)` → biết handler nào xử lý Command nào
- Kết quả: `commandBus.register(command.name, instance)` tự động — không cần list thủ công
- Tại sao dùng `@Global()` CqrsModule: CommandBus dùng được ở mọi module không cần `imports: [CqrsModule]`

### #15 · 4 cách Dependency Injection trong NestJS — useClass, useValue, useFactory, Symbol token
**Góc:** NestJS DI patterns
- `useClass`: class có `@Injectable()`, NestJS tự new và quản lý lifecycle
- `useValue`: inject instance đã tạo sẵn — dùng khi class không có `@Injectable()` (vd: `new CommandBus()` từ shared-kernel)
- `useFactory`: inject với dependencies runtime (`new LoggingMiddleware(logger)`, `inject: [PinoLogger]`)
- Symbol token: `SPACE_REPOSITORY = Symbol('ISpaceRepository')` — tránh collision tên string, dùng cho Port interface

### #16 · Framework-agnostic shared-kernel: cùng CQRS bus, chạy trong NestJS lẫn Fastify thuần
**Góc:** Architecture design principle
- auth-service dùng Fastify thuần — không có NestJS, không có decorator, không DI container
- core-api dùng NestJS với DI đầy đủ
- **Cả 2 đều dùng cùng CommandBus / QueryBus / EventBus từ shared-kernel** — chứng minh shared-kernel không phụ thuộc framework
- auth-service: `buildApplication(infra)` — một function wiring tay, đăng ký handler thủ công
- core-api: `CqrsModule` + DiscoveryModule — auto-discover qua Reflect metadata
- Bài học: tách business logic ra khỏi framework ngay từ đầu → reuse được ở bất kỳ đâu

---

## 🔄 SERIES 5 — EVENT-DRIVEN ARCHITECTURE (5 bài)

### #17 · Event Sourcing — đừng nghĩ "bảng lịch sử", hãy nghĩ "sổ kế toán bất biến"
**Góc:** Concept từ ví dụ thực
- Sổ ngân hàng không xóa dòng, chỉ ghi thêm — Event Sourcing là y hệt vậy
- Balance = replay toàn bộ events (`CreditPurchased` − `CreditSpent` + `CreditRefunded`...)
- Lợi ích: audit đầy đủ, time-travel query, rebuild state bất kỳ lúc nào
- Tại sao không dùng cho tất cả? — chỉ dùng cho aggregate cần kiểm toán (credit, reputation)

### #18 · Tại sao Credit và Reputation có 2 bảng Event Store riêng?
**Góc:** Schema design decision
- Thiết kế ban đầu: 1 bảng `event_store` chung — vấn đề: index lớn, query lẫn nhau, semantics khác nhau
- Split: `credit_events` (`aggregateId` = orgId, đơn vị là org) + `reputation_events` (`aggregateId` = userId, thêm `orgId` vì reputation scoped per org)
- OCC per aggregate: `@@unique([aggregateId, version])` — chỉ 1 event được insert với version đó, chặn race condition

### #19 · Transactional Outbox Pattern — giải quyết vấn đề "ghi DB xong, publish Kafka bị crash"
**Góc:** Distributed systems
- Problem: save domain → crash trước publish → DB có data, Kafka không có event → inconsistency
- Solution: ghi `outbox_events` TRONG CÙNG TRANSACTION với domain write — cả 2 commit hoặc cả 2 rollback
- Polling Publisher: đọc PENDING → publish Kafka → update PROCESSED / FAILED_DLQ
- Không bao giờ xóa outbox row — là audit trail

### #20 · Kafka KRaft mode — chạy không cần Zookeeper
**Góc:** Infrastructure
- Kafka 3.x+ KRaft: metadata tự quản lý, không Zookeeper → giảm 1 service, đơn giản hơn
- Topics: `knowledge-events`, `credit-events`, `engagement-events`
- DLQ (Dead Letter Queue): message lỗi schema → DLQ topic → manual replay endpoint
- Consumer groups: search-service index ES + worker-service sinh embedding — cùng 1 event, 2 consumer độc lập

### #21 · EventBus nội bộ vs Kafka — khi nào dùng cái nào?
**Góc:** Architecture decision
- EventBus (in-process, shared-kernel): handler + subscriber trong cùng process, không persistent, không replay
- Kafka (inter-process): event bridge qua network, persistent, replay được, nhiều consumer độc lập
- Rule: domain events trong cùng bounded context → EventBus; cần cross-service hoặc async worker → Kafka qua Outbox

---

## 🤖 SERIES 6 — AI & HYBRID SEARCH (5 bài)

### #22 · RAG (Retrieval-Augmented Generation) — tại sao AI biết tri thức riêng của bạn?
**Góc:** AI/ML concept for engineers
- LLM biết thế giới nhưng không biết wiki nội bộ công ty bạn
- RAG: retrieve top-N đoạn liên quan từ KB → nạp vào prompt → AI trả lời DỰA TRÊN nguồn đó
- Citation bắt buộc: mỗi câu trả lời dẫn link document nguồn — chống hallucination, người dùng kiểm chứng được
- Cortex dùng Claude API cho cả embedding và generation

### #23 · Hybrid Search: pgvector + Elasticsearch + Reciprocal Rank Fusion
**Góc:** Search architecture
- Keyword search (BM25/Elasticsearch): mạnh khi nhớ đúng từ; yếu khi hỏi "cách xoay vòng khóa bí mật"
- Semantic search (pgvector cosine): mạnh về ngữ nghĩa; yếu khi cần filter/facet chính xác
- RRF (Reciprocal Rank Fusion): kết hợp rank từ 2 nguồn, không phụ thuộc score scale khác nhau
- AI Data Boundary: `WHERE org_id = ?` bắt buộc trong mọi vector retrieval — scoped per tenant

### #24 · Embedding Pipeline async — tại sao không sinh embedding synchronous khi publish?
**Góc:** System design trade-off
- Publish document → sinh embedding ngay → timeout? user chờ? API đắt → bad UX
- Async via Kafka: `DocumentPublished` → worker-service consume → call embedding API → lưu pgvector
- Content hash dedup: nếu body không đổi (`contentHash` giống), skip re-embed — idempotent, tiết kiệm token
- HNSW index trên pgvector: `USING hnsw (embedding vector_cosine_ops)` — raw SQL migration

### #25 · Circuit Breaker quanh AI Provider — graceful degradation khi Claude API down
**Góc:** Resilience pattern
- States: CLOSED (normal) → OPEN (fail fast, không gọi AI) → HALF-OPEN (probe xem recover chưa)
- Khi AI provider down: Circuit Breaker OPEN → fallback về keyword-only search (Elasticsearch)
- Người dùng vẫn search được, chỉ mất phần semantic — graceful degradation
- Kết hợp: Retry (transient 503) + Circuit Breaker (sustained failure) — không nhầm lẫn 2 pattern

### #26 · Rate Limiting (Token Bucket) cho AI query — vì gọi AI tốn tiền thật
**Góc:** Resource protection
- Token Bucket per org: mỗi org có `aiRateLimitPerMin` riêng trong DB (`Organization.aiRateLimitPerMin`)
- Redis-backed: `INCR ai_rate:{orgId}:{minuteKey}` + `EXPIRE 60` — atomic, không race condition
- auth-service dùng `@fastify/rate-limit` plugin trực tiếp cho Login/Register (5 req/5 min) — không qua NestJS ThrottlerModule
- Throttle vs Rate Limit vs Circuit Breaker — 3 pattern bảo vệ hệ thống ở 3 tầng khác nhau

---

## 💰 SERIES 7 — CREDIT ECONOMY & SAGA (3 bài)

### #27 · Thiết kế Credit Economy ảo — đủ rigor tài chính, không rủi ro pháp lý
**Góc:** Product + System Design
- Credit mua bằng tiền nhưng KHÔNG BAO GIỜ rút ra tiền mặt → không cần payment license
- Sources: mua credit pack (`CreditPurchasedEvent`), được thưởng khi đóng góp được verify/accept (`CreditAwardedEvent`)
- Sinks: gọi AI RAG (`CreditSpentEvent`), stake bounty (`CreditStakedEvent`)
- Compensation: AI fail → `CreditRefundedEvent` / bounty hủy → `CreditRefundedEvent`
- Credit flow nội bộ org → incentivize đóng góp tri thức

### #28 · Saga Pattern — giải quyết Distributed Transaction không có 2PC
**Góc:** Pattern deep-dive
- Vấn đề: Reserve credit → gọi RAG → nếu RAG timeout → credit bị mất?
- Saga: chuỗi bước có **compensation** — bước fail → chạy ngược compensation về trạng thái ban đầu
- AI-Query Saga: Reserve → RAG call → Commit | timeout → Compensate: `CreditRefundedEvent` + notify user
- Bounty Saga: stake → answer accepted → award credit + reputation + badge + notify; fail bất kỳ bước → compensate toàn bộ

### #29 · Idempotency Key — chống double-charge khi client retry
**Góc:** API design
- Bấm "Hỏi AI" 2 lần do lag → 2 request cùng vào server → trừ credit 2 lần
- Client gửi `X-Idempotency-Key: <uuid>` → server check `idempotency_records` table → trả response cũ nếu đã xử lý
- NestJS Interceptor pattern; TTL 24h; KHÔNG đăng ký global — chỉ cho mutation tốn kém (AI call, credit spend)
- Kết hợp với Saga: idempotency key check trước khi bắt đầu saga

---

## 📊 SERIES 8 — READ MODEL & CACHING (3 bài)

### #30 · CQRS Projection & Materialized View — tại sao Read không bao giờ đụng Event Store
**Góc:** CQRS advanced
- Event Store là Write Model — chỉ append, không bao giờ query trực tiếp cho read
- Projection: consume events → build Read Model (`FeedTimeline`, `ReputationSummary`, `CreditBalanceSummary`)
- Rebuild: replay toàn bộ events → projection → Read Model mới hoàn toàn đúng
- Trade-off: eventual consistency vs real-time read

### #31 · Cache + Stampede Prevention — khi 500 người cùng search 1 từ hot
**Góc:** Caching strategy
- Thundering Herd: hot key expire → 500 request cùng query DB → DB quá tải
- Distributed Lock (Redis SETNX): chỉ 1 request rebuild cache, còn lại chờ hoặc trả stale data
- Cache invalidation: Kafka event → invalidate cache đúng lúc (publish doc → feed mới < 1s)
- Leaderboard & digest: đọc từ `ReputationSummary` Read Model + Redis cache — không bao giờ query Event Store

### #32 · Gamification & Reputation — cách làm người dùng muốn document
**Góc:** Product + Engineering
- B2B problem: không ai muốn viết tài liệu vì "viết xong chẳng ai đọc"
- Reputation Events (append-only): `PointsEarned`, `PointsDeducted`, `BadgeAwarded`, `BadgeRevoked` → audit + rebuild được
- Badges: First Contribution, Knowledge Streak, Trusted Expert, Pathfinder — cron `worker-service` tính định kỳ
- Reputation mở khóa đặc quyền: đủ points → Verify content của người khác, edit wiki không cần duyệt

---

## 🚀 SERIES 9 — MICROSERVICE MIGRATION & DEVOPS (5 bài)

### #33 · Strangler Fig Pattern — tách Microservice Zero-Downtime (không down 1 giây)
**Góc:** Migration strategy
- Vấn đề: không thể Big Bang rewrite — quá rủi ro, service down = revenue loss
- Strangler Fig: xây service mới song song → routing dần qua → cutover → xóa code cũ
- Phase 7: tách `discovery-service` (AI workload cần scale riêng) khỏi core-api — 4 giai đoạn: Build → Route → Dual-run → Cutover
- Dual-run period: so sánh kết quả service mới vs cũ (relevance regression test trước khi cutover)

### #34 · CDC (Change Data Capture) — rebuild data cho Microservice mới mà không down
**Góc:** Data migration
- Khi tách `discovery-service`: nó cần toàn bộ embeddings đang có trong core-api DB
- Replay `knowledge-events` Kafka → rebuild embeddings trong service mới — không cần downtime
- Verify: kết quả search service mới = service cũ trước khi cutover (relevance regression test)
- Debezium (CDC Connector) vs Polling Publisher — trade-off

### #35 · Observability: Distributed Tracing + Metrics + Structured Logging
**Góc:** Production readiness
- Distributed Tracing: OpenTelemetry → Jaeger — trace 1 request xuyên qua core-api → worker-service → Elasticsearch
- Metrics: Prometheus + Grafana — alert rules: DLQ depth, Circuit Breaker state, AI cost spike, high latency
- Structured Logging: Pino (JSON) → ELK Stack — correlation-id theo từng request
- Tại sao cần cả 3? Metrics: "what is broken", Tracing: "where is slow", Logs: "why did it fail"

### #36 · Load Testing với K6 — test những gì QUAN TRỌNG nhất
**Góc:** Quality engineering
- OCC test: 10 concurrent edit cùng 1 doc → chỉ 1 thành công (9 cái 409 Conflict)
- Search throughput: 1000 concurrent → P99 < 500ms
- AI rate-limit: vượt `aiRateLimitPerMin` → bị chặn đúng, KHÔNG trừ credit
- Credit: 100 concurrent spend cùng 1 Idempotency Key → chỉ 1 lần trừ (no double-spend)
- Tenant isolation: user org A query → không thấy 1 row nào của org B

### #37 · AI Agent Workflow — cách tôi dùng Claude Code để code cùng AI không mất kiểm soát
**Góc:** AI-assisted development process
- 3-layer architecture: Directive (SOP .md) → Agent (Claude) → Execution (Python scripts trong `execution/`)
- Directives: SOP cho từng domain (CQRS, Event Sourcing, Multi-tenancy, RAG...) — AI đọc trước khi code
- Memory buffer: `.ai/memory/*.jsonl` lưu gotchas, architecture decisions, lessons learned — persist qua sessions
- Session Start Protocol: đọc `KNOWLEDGE_INDEX.md` → memory → directive → code — không bao giờ code mù

---

## 📌 THỨ TỰ ĐỀ XUẤT ĐĂNG

Đăng theo thứ tự Phase thực thi để tạo narrative liền mạch:

| Tuần | Bài | Lý do |
|------|-----|-------|
| 1 | #1, #2, #3 | Hook: tại sao dự án này + big picture |
| 2 | #8, #9 | Foundation: Clean Architecture + DDD |
| 3 | #10, #11 | Framework + DB setup |
| 4 | #4, #5, #6, #7 | Auth & Security |
| 5 | #12, #13, #14 | CQRS deep-dive |
| 6 | #15, #16 | DI patterns + framework-agnostic design |
| 7 | #17, #18, #19 | Event Sourcing + Outbox |
| 8 | #20, #21 | Kafka |
| 9 | #22, #23, #24 | AI/RAG highlight |
| 10 | #25, #26 | Resilience (AI) |
| 11 | #27, #28, #29 | Credit Economy + Saga |
| 12 | #30, #31, #32 | Read Model + Cache + Gamification |
| 13 | #33, #34 | Migration |
| 14 | #35, #36, #37 | Production + AI Workflow |
