### 📊 Curated Status — _cập nhật thủ công sau mỗi task (After-Task Protocol)_

> Last curated: **2026-06-30**
> Đây là nguồn chủ quan (phase %, focus). Phần auto-detect bên dưới mới là ground truth — nếu lệch nhau thì file này stale.

**Overall:** ~72% · **Phase đang làm:** Phase 1 feed endpoint ✅ Done (query SoT) · **Next:** Phase 3 — CQRS Read Model (hoặc taxonomy)

> ✅ **Feed read endpoint (2026-06-30, committed):** `GET /feed` — fan-out-on-read, query thẳng SoT. Module `feed` mới trong core-api (chỉ query side): `GetFeedQuery → GetFeedHandler → PrismaFeedQueryRepository`. Logic: `follows(targetType=SPACE)` → `knowledge_items(spaceId IN, status=PUBLISHED, deletedAt IS NULL)` DESC createdAt. Guard: `OrgGuard + KNOWLEDGE_READ`. KHÔNG có bảng mới. Schema: `Embedding` model gỡ (defer Phase 4). `prisma db push` đã drop bảng cũ. `turbo run build typecheck lint` = 12/12 xanh.

> ✅ **Phase 2 refactor/hardening (2026-06-30, committed):** lớp messaging làm lại bài bản theo pattern chuẩn —
> `KafkaClientService` singleton; `CompositeMessagePublisher` + `EVENT_TRANSPORT_MAP` (binder pattern, Kafka+queue coexist, queue stub sẵn); `EventRouter` (Message Dispatcher, thay switch tay); `defineEvent` typed factory (vá `payload: unknown`); **envelope đổi sang CloudEvents 1.0** (`CloudEvent<T>`: id/source/type/time/data + orgid/partitionkey ext); worker có `PrismaTransactionManager` + `getTx()` (handler không chạm Prisma). Cấu trúc shared-kernel: `events/` (vocabulary) vs `messaging/routing|ports` (plumbing).
> 📄 **Directive mới:** `directives/eventing_patterns.md` — reference architecture cho toàn bộ event-driven (domain vs integration event, CloudEvents, binder, dispatcher, idempotent receiver) + cite nguồn.
> ✅ **Reliability hardening (2026-06-30, đợt 2):** Idempotent producer (`producer({ idempotent: true })`) + Consumer DLQ (`DeadLetterProducer` → `<topic>.DLQ`, retry bounded `CONSUMER_MAX_RETRIES` → poison pill dead-letter ngay). Cấu trúc: outbox module chia subfolder theo role (`repositories/`, `publishers/`); worker `application/events/<name>/` (bộ ba commands/queries/events); handler gom vào mảng `INTEGRATION_HANDLERS` (thêm handler = 1 dòng).
> 🧭 **Quyết định eventing (2026-06-30):** EventRouter **1:1** trong 1 consumer group; fan-out 1 event → N concern = **N consumer GROUP riêng** (group id theo concern, vd `KAFKA_FEED_CONSUMER_GROUP`), KHÔNG nhồi N handler vào 1 router. EventRouter scope **per-module** (rẻ, là Map in-mem), KHÔNG global — khác `KafkaClientService` singleton (giữ connection).
> ⛔ **ROLLBACK read model (2026-06-30):** Gỡ **`feed_timeline` (read model) + ProcessedEvent + toàn bộ worker feed projection** (handler, consumer, repo, DLQ, consumer env). Lý do: read model là optimization làm SỚM — app chưa xong, chưa có đường đọc nào dùng tới (bảng write-only). **Quy tắc mới:** schema chỉ chứa **source of truth**; query đi thẳng source of truth; read model/projection để dành tới **read phase** (Phase 3). GIỮ backbone: core-api outbox/Kafka vẫn emit, shared-kernel messaging, `Follow`. Worker = scaffold consumer rỗng (KafkaClientService inert), chờ consumer thật. ⚠️ DB vẫn còn bảng cũ tới khi chạy `prisma db push`.
> ⛔ **Gỡ NỐT read model trong schema (2026-06-30):** xoá cả section `// READ MODELS — CQRS Projections` ở core-api schema — `CreditBalanceSummary`, `ReputationSummary`, `UserProfile` (cả 3 unused trong code). Schema giờ **chỉ source of truth**: giữ event ledger nguồn sự thật `CreditEvent` + `ReputationEvent` (append-only), gỡ projection của chúng → dựng lại ở read phase. `Embedding` đã **gỡ** (defer Phase 4, quyết 2026-06-30).

> ✅ **Phase 2a hoàn thành + smoke test Docker:** Transactional Outbox + Polling Publisher → Kafka. Resilience (Kafka down→up) OK.
> ✅ **Phase 2b hoàn thành + smoke test:** worker-service consume knowledge-events → FeedTimeline fan-out + ProcessedEvent idempotency. `npm run check` xanh.
> ⚠️ **Chưa commit (hoãn tới khi sẵn sàng):** Phase 2a (outbox/kafka) + Phase 2b (worker-service) + logging refactor. Fix nhỏ: `envFilePath: '../../.env'` trong core-api config.module.ts.
> 🔧 **Fix nhỏ 2026-06-28:** `@@unique([userId, itemId])` thêm vào FeedTimeline (cả core-api + worker schema) để idempotent `createMany skipDuplicates`.
> 🔧 **Fix nhỏ 2026-06-28:** `ProcessedEvent` model đặt ở core-api schema (owns core_db); worker schema là type-gen only (không db:push).

| Phase | Mục tiêu | Trạng thái |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | ✅ Done (taxonomy deferred) |
| 2 | Event Backbone (Kafka + Outbox) | ✅ Done — 2a + 2b smoke tested |
| 3 | CQRS & Read Model | ⬜ Chưa bắt đầu |
| 4 | AI Search & Discovery (RAG) | ⬜ Chưa bắt đầu |
| 5 | Credit Economy & Saga | ⬜ Chưa bắt đầu |
| 6 | Realtime & Workers | ⬜ Chưa bắt đầu |
| 7 | The Great Migration | ⬜ Chưa bắt đầu |
| 8 | Production Hardening | ⬜ Chưa bắt đầu |

#### Phase 1 — chi tiết

| Hạng mục | Service | Trạng thái |
|---|---|---|
| auth (JWT RS256, refresh rotation) | auth-service | ✅ Done |
| system RBAC (role/permission, wildcard catalog) | auth-service | ✅ Done |
| user | auth-service | ✅ Done |
| tenant (Org, Space, Membership, Invite, OrgGuard) | core-api | ✅ Done |
| **knowledge** (KnowledgeItem CRUD + OCC versioning + Revision) | core-api | ✅ Done — 8 endpoints, OCC, soft-delete, Revision history |
| **engagement** (Vote + Bookmark + Accept Answer + Follow) | core-api | ✅ Done — 11 endpoints, hard-delete, cross-module repo sharing |
| **feed** (GET /feed — fan-out-on-read, query SoT) | core-api | ✅ Done — 1 endpoint, query follows×knowledge_items |
| taxonomy (Tag/Topic, Space subscribe) | core-api | ⬜ Deferred — sau Phase 3 |

#### Phase 2 — chi tiết

| Hạng mục | Service | Trạng thái |
|---|---|---|
| Transactional Outbox (OutboxModule, IOutboxRepository, PrismaOutboxRepository) | core-api | ✅ Done |
| Kafka Producer (KafkaProducerService, kafkajs) | core-api | ✅ Done |
| Polling Publisher (@Interval 2s, at-least-once, DLQ sau 5 attempts) | core-api | ✅ Done |
| Event contracts (shared-kernel: **CloudEvent 1.0**, EventType, defineEvent factory, KafkaTopic) | shared-kernel | ✅ Done — CloudEvents-aligned 2026-06-30 |
| Messaging layer (CompositeMessagePublisher+transport map, EventRouter, KafkaClientService) | shared-kernel + core + worker | ✅ Done (2026-06-30) |
| Worker transaction mgmt (PrismaTransactionManager + getTx) | worker-service | ⛔ Removed 2026-06-30 (theo projection) — PrismaModule scaffold giữ lại |
| publish-knowledge → outbox atomic (transactional:true) | core-api | ✅ Done |
| Smoke test Docker (kafka-ui, db:push, end-to-end, resilience) | — | ✅ Done (2026-06-28) |
| worker-service scaffold (NestJS ApplicationContext, no HTTP) | worker-service | ✅ Done — giờ là scaffold rỗng |
| ~~worker consumer + EventRouter + DLQ~~ | worker-service | ⛔ **Removed 2026-06-30** — read model rollback |
| ~~Idempotency (ProcessedEvent guard)~~ | worker-service | ⛔ **Removed 2026-06-30** |
| ~~FeedTimeline fan-out (read model projection)~~ | worker-service | ⛔ **Removed 2026-06-30** — defer tới read phase |
| ~~Smoke test 2b (feed_timeline)~~ | — | ⛔ N/A sau rollback |

**Quyết định kiến trúc đã chốt liên quan:**
- Org context truyền qua `x-org-id` header + `OrgGuard` (KHÔNG nhúng `orgId` vào JWT). System RBAC (auth) và Org RBAC (core) tách biệt hoàn toàn.
- **Clean-Arch boundaries của core-api đã lint-enforced** (`eslint.config.mjs`, `no-restricted-imports` per layer).
- **Microservices sequencing (2026-06-28):** taxonomy deferred; Phase 2 (Outbox+Kafka) TRƯỚC. worker-service = pure consumer, không tách submodule ở giai đoạn này.
- **Transactional Outbox pattern:** outboxRepo.append() dùng getTx() → atomic. PollingPublisher dùng `running` flag. orgId trong payload. Xem `directives/resilience_patterns.md`.
- **worker-service (2026-06-28):** kafkajs raw (không @nestjs/microservices); NestFactory.createApplicationContext (không HTTP); ProcessedEvent owned by core-api schema (worker type-gen only, không db:push); fan-out qua Follow targetType=SPACE; `@@unique([userId, itemId])` trên FeedTimeline.
- **Eventing reference architecture (2026-06-30):** wire contract = **CloudEvents 1.0** (`CloudEvent<T>`), outbox table giữ column riêng → map sang CloudEvent lúc publish (storage ≠ wire). Transport chọn qua `EVENT_TRANSPORT_MAP` (binder, Kafka+queue coexist); inbound qua `EventRouter` (dispatcher, thay switch). Mỗi event 1 file `events/definitions/*.event.ts` (payload+`defineEvent`). Handler = subscriber tự khai `readonly eventType` (≈ MediatR INotificationHandler). Toàn bộ chốt trong `directives/eventing_patterns.md`.
