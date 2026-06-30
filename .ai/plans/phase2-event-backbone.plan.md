# PLAN — Phase 2: Event Backbone (Transactional Outbox → Kafka)

> **Đối tượng thực thi:** session mới (Sonnet). Plan TỰ ĐỦ.
> **Scope đã chốt (quyết định 2026-06-28):** học Kafka qua **Transactional Outbox** trong monolith, KHÔNG tách core modules thành service. Consumer thật đầu tiên = `worker-service` (pure consumer).
> **Cắt gọn so với readme.phases.md Phase 2:** KHÔNG làm credit Event-Sourcing (để Phase 5), KHÔNG làm embedding/re-index (Phase 4), KHÔNG idempotency-cho-credit (Phase 5). Phase 2 chỉ = Outbox + Kafka publish + 1 consumer + 1 projection.
> **Chia 2 nửa (đã chốt):** **2a** = Outbox + Polling Publisher → Kafka (chỉ core-api, verify bằng Kafka UI). **2b** = `worker-service` consume → FeedTimeline projection. Làm xong + verify 2a rồi mới sang 2b.

---

## 0. ĐỌC TRƯỚC (bắt buộc)

1. `.ai/KNOWLEDGE_INDEX.md` §4 (Critical Rules) + §5 (gotchas).
2. `directives/folder_structure_sop.md` §Enforcement (lint biên tầng).
3. `directives/multi_tenancy.md` §2–3 (tenant context).
4. Plan này + đối chiếu code mẫu:
   - TransactionMiddleware: `packages/shared-kernel/src/cqrs/middleware/transaction.middleware.ts` (command `transactional:true` → chạy trong `transactionManager.run()`).
   - Write repo dùng `getTx()`: `apps/core-api/src/modules/knowledge/infrastructure/repositories/prisma-knowledge-item.repository.ts` (pattern `getTx<Prisma.TransactionClient>() ?? this.prisma.client`).
   - Schema `OutboxEvent` (đã có sẵn, CHƯA dùng): `apps/core-api/prisma/schema.prisma` §INFRASTRUCTURE.
   - publish-knowledge command/handler: `apps/core-api/src/modules/knowledge/application/commands/publish-knowledge/`.
   - Config: `apps/core-api/src/config/{env.validation.ts,env.config.ts}`.

---

## 🔑 NGUYÊN LÝ CỐT LÕI (vì sao Outbox)

Vấn đề **dual-write**: nếu handler `await db.save(item)` rồi `await kafka.publish(event)` — giữa 2 lệnh process chết → DB có data nhưng Kafka MẤT event (hoặc ngược lại). Không atomic.

**Outbox giải quyết:** ghi domain row + outbox row trong **CÙNG 1 DB transaction** (atomic, nhờ `getTx()` AsyncLocalStorage). Sau đó 1 tiến trình riêng (Polling Publisher) đọc outbox đẩy lên Kafka. Nếu publish lỗi → row vẫn PENDING → retry. **At-least-once delivery** → consumer (2b) PHẢI idempotent.

```
[publish-knowledge handler, transactional:true]
  ├─ itemRepo.update(item)            ─┐ cùng 1
  └─ outboxRepo.append(event)         ─┘ transaction (atomic)

[PollingPublisher @Interval, tiến trình tách]
  PENDING rows → kafka.publish(topic) → mark PROCESSED
                                      → lỗi: attempts++, >=MAX → FAILED_DLQ
```

---

# ════════ PHASE 2a — OUTBOX + POLLING PUBLISHER → KAFKA ════════

## 2a.1 LUẬT BẮT BUỘC (vi phạm = sai)

- **Atomic**: outbox row PHẢI ghi trong cùng transaction với domain write → command `transactional: true`, outbox repo dùng `getTx() ?? this.prisma.client` (KHÔNG mở client riêng).
- **Event payload bất biến**: snapshot dữ liệu tại thời điểm phát (không ref live). Payload là `Json` thuần, không chứa entity.
- **Event contract ở shared-kernel** (`packages/shared-kernel/src/events/`) để cả core-api (producer) và worker-service (consumer) cùng import — single source of truth. KHÔNG định nghĩa shape event 2 nơi.
- **No `console.log`**: Polling Publisher + Kafka producer log qua Pino logger (DI child logger, KHÔNG `createLogger` ad-hoc). Lưu ý: `EventBus` shared-kernel là in-process emitter riêng — KHÔNG dùng cho Kafka. (Cập nhật 2026-06-28: EventBus `console.error` đã được thay bằng `ILogger` inject + `context: EventBus`; xem `directives/logging_standard.md`.)
- **Tenant**: payload luôn mang `orgId` (downstream cần để scope). Producer KHÔNG cần `requireTenantId()` ở polling (chạy ngoài request context) — đọc `orgId` từ outbox row.
- **Layer boundary**: Kafka client (`kafkajs`) là infra → chỉ ở `infrastructure/`. Application/domain KHÔNG import kafkajs. Handler chỉ gọi `IOutboxRepository.append()` (interface ở domain).
- **Gate**: `npm run check` (core-api) xanh.

## 2a.2 TASKS

### T0 — Deps + Env + Config
**(a)** `cd apps/core-api && npm i kafkajs @nestjs/schedule`
**(b)** `.env` (root) — thêm dưới block KAFKA:
```
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=core-api
```
> Host process nối `localhost:9092` (port map trong docker-compose). Code chạy TRONG docker mới dùng `kafka:29092`.
**(c)** `src/config/env.validation.ts` — thêm vào `envValidationSchema`:
```ts
KAFKA_BROKERS: z.string().default('localhost:9092'),
KAFKA_CLIENT_ID: z.string().default('core-api'),
```
**(d)** `src/config/env.config.ts` — thêm:
```ts
kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'core-api',
```

### T1 — Event Contracts (shared-kernel)
Tạo `packages/shared-kernel/src/events/`:
- `topics.ts`:
  ```ts
  export const KafkaTopic = {
    KNOWLEDGE_EVENTS: 'knowledge-events',
  } as const
  export type KafkaTopicValue = (typeof KafkaTopic)[keyof typeof KafkaTopic]
  ```
- `event-types.ts`:
  ```ts
  export const EventType = {
    KNOWLEDGE_PUBLISHED: 'KnowledgePublished',
  } as const
  ```
- `domain-event.ts` — envelope chuẩn (mọi event Kafka theo shape này):
  ```ts
  export interface DomainEventEnvelope<TPayload = unknown> {
    eventId: string          // = outbox row id (UUID v7) — consumer dùng để dedup
    eventType: string        // EventType.*
    aggregateType: string    // 'KnowledgeItem'
    aggregateId: string
    orgId: string
    occurredAt: string       // ISO string
    payload: TPayload
  }
  ```
- `payloads/knowledge-published.payload.ts`:
  ```ts
  export interface KnowledgePublishedPayload {
    itemId: string
    orgId: string
    spaceId: string
    type: string
    title: string
    createdByUserId: string
  }
  ```
- Re-export tất cả qua `packages/shared-kernel/src/events/index.ts`, và thêm `export * from './events/index.js'` vào `packages/shared-kernel/src/index.ts`.
- **Build shared-kernel**: `npx turbo run build --filter=@distributed-social-platform/shared-kernel` (để core-api thấy type mới).

### T2 — Schema: Outbox attempts/error + generate
`apps/core-api/prisma/schema.prisma` — model `OutboxEvent` đã có; THÊM 2 cột cho retry/DLQ:
```prisma
attempts    Int       @default(0)
lastError   String?   @map("last_error")
```
(giữ nguyên `status OutboxStatus @default(PENDING)`, index `[status, createdAt]`.)
→ `npm run db:generate`. (DB push để T5 smoke: `npm run db:push` khi có Docker.)
> KHÔNG thêm OutboxEvent vào `modelsWithSoftDelete` (nó là infra log, hard data).

### T3 — Outbox domain + infra (core-api)
- `src/modules/outbox/domain/outbox.repository.ts`:
  ```ts
  export interface OutboxAppendInput {
    eventType: string
    aggregateType: string
    aggregateId: string
    orgId: string
    payload: unknown
  }
  export interface IOutboxRepository {
    append(input: OutboxAppendInput): Promise<void>   // dùng getTx — atomic với domain write
  }
  export const OUTBOX_REPOSITORY = Symbol('IOutboxRepository')
  ```
- `src/modules/outbox/infrastructure/prisma-outbox.repository.ts`:
  - `client` getter = `getTx<Prisma.TransactionClient>() ?? this.prisma.client` (BẮT BUỘC getTx để nằm trong tx của command).
  - `append()` → `this.client.outboxEvent.create({ data: { aggregateType, aggregateId, eventType, payload: input.payload as Prisma.InputJsonValue, ...orgId LƯU TRONG payload, status mặc định PENDING } })`.
  - ⚠️ `OutboxEvent` schema KHÔNG có cột `orgId` riêng → `orgId` nằm trong `payload` (và trong envelope khi publish). Đủ cho downstream.

### T4 — Wire vào publish-knowledge
- `publish-knowledge.command.ts`: đổi `options` → `{ transactional: true, retryable: false }` (để outbox + update atomic).
- `publish-knowledge.handler.ts`: sau `item.publish()` + `itemRepo.update(item)`, gọi:
  ```ts
  await this.outboxRepo.append({
    eventType: EventType.KNOWLEDGE_PUBLISHED,
    aggregateType: 'KnowledgeItem',
    aggregateId: item.id,
    orgId: item.orgId,
    payload: { itemId: item.id, orgId: item.orgId, spaceId: item.spaceId,
               type: item.type, title: item.title, createdByUserId: item.createdByUserId },
  })
  ```
  Inject `@Inject(OUTBOX_REPOSITORY)`. Import `EventType` từ shared-kernel.
- `KnowledgeModule`: thêm provider bind `OUTBOX_REPOSITORY` → `PrismaOutboxRepository` (hoặc tạo `OutboxModule` exports OUTBOX_REPOSITORY rồi `imports`). **Khuyến nghị:** tạo `OutboxModule` (vì Polling Publisher T5 cũng ở đó) và export `OUTBOX_REPOSITORY`; `KnowledgeModule` `imports: [OutboxModule]`.

### T5 — Kafka producer + Polling Publisher
- `src/modules/outbox/infrastructure/kafka-producer.service.ts`:
  - `@Injectable()`, dùng `kafkajs`. `onModuleInit` → `kafka.producer().connect()`; `onModuleDestroy` → `disconnect()`.
  - `publish(topic, key, value: DomainEventEnvelope)` → `producer.send({ topic, messages: [{ key, value: JSON.stringify(value) }] })`. `key = aggregateId` (đảm bảo ordering theo aggregate trong partition).
  - Brokers/clientId từ ConfigService (`env.kafkaBrokers`, `env.kafkaClientId`).
- `src/modules/outbox/infrastructure/polling-publisher.service.ts`:
  - `@Injectable()`, `@nestjs/schedule` `@Interval(2000)` (2s) — hoặc cấu hình.
  - Mỗi tick: `findMany({ where:{ status:'PENDING' }, orderBy:{ createdAt:'asc' }, take: 50 })`.
  - Với mỗi row: build `DomainEventEnvelope` (eventId = row.id, occurredAt = row.createdAt.toISOString(), payload = row.payload), `kafkaProducer.publish(topicFor(eventType), row.aggregateId, envelope)`.
    - `topicFor`: map eventType/aggregateType → topic. Hiện chỉ `KnowledgeItem → KNOWLEDGE_EVENTS`.
  - Thành công → `update({ status:'PROCESSED', processedAt: new Date() })`.
  - Lỗi → `update({ attempts: { increment: 1 }, lastError: String(err) })`; nếu `attempts+1 >= MAX (5)` → `status: 'FAILED_DLQ'`.
  - **Tránh chồng tick**: cờ `private running = false` (nếu tick trước chưa xong thì bỏ tick này). Single instance — không cần lock DB ở 2a (ghi chú: multi-instance cần `FOR UPDATE SKIP LOCKED`, để Phase 8).
  - Log qua Pino, KHÔNG console.
- `src/modules/outbox/outbox.module.ts`: providers [PrismaOutboxRepository binding, KafkaProducerService, PollingPublisherService]; exports [OUTBOX_REPOSITORY]. Import `ScheduleModule.forRoot()` (ở AppModule hoặc OutboxModule).
- `app.module.ts`: thêm `ScheduleModule.forRoot()` + `OutboxModule`.

### T6 — Gate + Smoke (2a)
1. `npm run lint:fix && npm run format` (core-api) → `npx turbo run typecheck lint format:check --filter=@distributed-social-platform/core-api` xanh.
2. **Smoke** (cần Docker): `docker compose up -d kafka kafka-ui postgres` → `npm run db:push` → chạy core-api (`npm run dev`).
   - Tạo org → space → tạo KnowledgeItem (DRAFT) → `POST /knowledge/:id/publish`.
   - Kiểm DB: `outbox_events` có 1 row, status chuyển `PENDING → PROCESSED` sau ≤2s.
   - **Kafka UI** (`localhost:8080`): topic `knowledge-events` có 1 message, value = envelope JSON đúng shape.
   - Test retry: tắt Kafka → publish → row PENDING, attempts tăng; bật lại Kafka → row PROCESSED.

## 2a — DEFINITION OF DONE
- [ ] Publish knowledge → outbox row ghi ATOMIC trong cùng tx (rollback domain → không có outbox row).
- [ ] Polling Publisher đẩy PENDING → Kafka, mark PROCESSED; message thấy trên Kafka UI đúng envelope.
- [ ] Kafka down → row PENDING + attempts++; Kafka up lại → PROCESSED (at-least-once).
- [ ] attempts >= 5 → FAILED_DLQ (không retry vô hạn).
- [ ] Không `console.log`, không import kafkajs ngoài `infrastructure/`, `npm run check` xanh.

---

# ════════ PHASE 2b — WORKER-SERVICE CONSUMER → FEEDTIMELINE ════════

> Chỉ làm SAU khi 2a verify xong. Đây là OUTLINE — sẽ chi tiết hoá thành plan riêng khi bắt đầu 2b.

## 2b — Mục tiêu
`worker-service` (NestJS) consume `knowledge-events`, build read-model `feed_timeline` ("mới trong Space của bạn"). Đây là consumer thật đầu tiên + chạm nhẹ Phase 3 (projection).

## 2b — Quyết định cần chốt khi vào chi tiết
- **Fan-out rule:** `KnowledgePublished` ở space X → ghi `feed_timeline` cho ai? Đề xuất: **followers của space** (dùng bảng `Follow` targetType=SPACE đã làm ở engagement) → fan-out-on-write. Fallback đơn giản hơn: mọi member của org. (Chốt khi vào 2b.)
- **DB ownership:** worker-service có Prisma schema riêng scope các bảng read-model (`FeedTimeline`, `processed_events`) trỏ cùng `core_db` (projector pattern). KHÔNG ghi vào bảng write-model của core-api.
- **Consumer transport:** `@nestjs/microservices` Kafka transport (đã chọn stack NestJS) HOẶC kafkajs consumer thuần. Chốt khi vào 2b.

## 2b — Tasks (outline)
- **T0** Scaffold `apps/worker-service`: NestJS app (package.json, tsconfig kế thừa root, main.ts), thêm vào turbo workspace. Quyết định: submodule riêng hay workspace package thường (auth-service/core-api là submodule; worker có thể để package thường trước, tách submodule sau).
- **T1** Prisma cho worker: schema tối thiểu (`FeedTimeline`, `ProcessedEvent {eventId @id, processedAt}`) trỏ `core_db`; generate.
- **T2** Kafka consumer: subscribe `knowledge-events`, consumer group `worker-feed`. Parse envelope.
- **T3** Idempotency: trước khi xử lý, check `ProcessedEvent` theo `eventId`; đã có → skip (ack). Xử lý xong → ghi `ProcessedEvent` (cùng tx với projection).
- **T4** Projection: `KnowledgePublished` → resolve followers (Follow targetType=SPACE, targetId=spaceId) → upsert `feed_timeline` rows (reason='new_in_space'). Atomic với ProcessedEvent.
- **T5** Error handling: parse lỗi / handler lỗi → retry policy; quá ngưỡng → DLQ topic `knowledge-events.DLQ` (để Phase 5 mở rộng). Không crash worker.
- **T6** Gate + smoke: publish knowledge ở core-api → trong ≤vài giây `feed_timeline` có row cho followers; gửi lặp cùng eventId → không nhân đôi (idempotent).

## 2b — DoD (outline)
- [ ] Publish knowledge (core-api) → worker consume → `feed_timeline` có entry cho space followers.
- [ ] Cùng eventId xử lý 2 lần → chỉ 1 feed row (idempotent qua ProcessedEvent).
- [ ] Worker không crash khi gặp message lỗi (vào DLQ / log).
- [ ] `npm run check` (worker-service) xanh.

---

## 3. SAU KHI XONG (After-Task Protocol)
- `.ai/PROJECT_STATUS.md`: Phase 2 → 🟡/✅; cập nhật Next.
- Log lesson `.ai/memory/*.jsonl`: pattern Transactional Outbox (atomic qua getTx), Polling Publisher at-least-once, consumer idempotency.
- `directives/`: cân nhắc thêm `event_driven_sop.md` (outbox rules, envelope shape, idempotency).
- Surgical edit `.ai/KNOWLEDGE_INDEX.md` mục kiến trúc event.

## 4. ⛔ DO NOT
- ❌ `await db.save()` rồi `await kafka.publish()` ngoài transaction (dual-write — đúng cái Outbox chống).
- ❌ Mở Prisma client riêng trong outbox.append (mất tính atomic) — PHẢI `getTx()`.
- ❌ Định nghĩa shape event ở core-api riêng + worker riêng — dùng contract shared-kernel.
- ❌ Dùng `EventBus` (EventEmitter in-process) cũ làm Kafka — nó khác mục đích.
- ❌ Consumer xử lý không idempotent (at-least-once → sẽ nhân đôi).
- ❌ `console.log` trong publisher/producer — dùng Pino.
- ❌ Kéo credit Event-Sourcing (Phase 5) / embedding (Phase 4) vào Phase 2.
