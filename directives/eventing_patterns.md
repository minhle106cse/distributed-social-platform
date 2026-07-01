# SOP: Eventing & Messaging Patterns

> Reference architecture cho toàn bộ event-driven của Cortex: domain event (in-process) vs integration event (cross-service), CloudEvents envelope, transport routing (Kafka + queue), inbound dispatch.
> Đọc file này TRƯỚC khi thêm bất kỳ event mới, consumer mới, hay transport mới.
>
> Triết lý: **học pattern có tên trước, đừng tự chế.** Mỗi component dưới đây ánh xạ 1-1 vào một pattern đã được chứng minh (EIP của Hohpe & Woolf, DDD/eShop của Microsoft, CloudEvents của CNCF, binder của Spring Cloud Stream). Tên nguồn ghi ở cuối.

---

## 📌 Khi nào đọc directive này

| Task | Mục cần đọc |
|---|---|
| Side-effect giữa các aggregate TRONG 1 service | §1 Domain event |
| Phát event cho service khác (qua Kafka/queue) | §1 Integration event + §2 + §3 |
| Thêm 1 event type mới | §2 (định nghĩa) + §3 (routing) |
| Viết consumer / handler mới | §4 Inbound |
| Thêm transport mới (BullMQ, SQS…) | §3 Transport + binder |

---

## 1. Domain event vs Integration event — KHÔNG trộn

Đây là 2 artifact **khác nhau**, thiết kế khác nhau (Microsoft eShop, Fowler). Trộn 1 cái là mất cả tự do lẫn ổn định.

| | **Domain event** | **Integration event** |
|---|---|---|
| Phạm vi | trong 1 bounded context, in-process | cross-service, qua broker |
| Đồng bộ? | sync/async, ngay lập tức | luôn async |
| Nội dung | đầy đủ chi tiết domain | payload phẳng, ID ổn định, versioned |
| Transport | `EventBus` in-memory (shared-kernel/cqrs) | CloudEvents qua Kafka/queue |
| Evolution | tự do đổi | đổi chậm, thận trọng (nhiều consumer phụ thuộc) |
| Code | `IEvent { name }` + `IEventHandler` | `CloudEvent<T>` + `IIntegrationEventHandler` |

**Luồng canonical (eShop):** `command handler → (raise domain event) → domain handler → tạo integration event → outbox`. Hiện tại Cortex đi thẳng `command handler → outbox` (đơn giản hoá có ý thức cho scale này). Khi credit/saga vào (Phase 5), tách tầng domain-event trung gian.

**Rule:**
- Domain event để enforce rule giữa aggregate trong cùng service → dùng `EventBus`.
- Integration event để báo cho service khác → đi qua outbox → CloudEvents. KHÔNG bao giờ publish entity/domain object thô ra Kafka.

---

## 2. Event definition — typed factory, một nguồn

Mỗi integration event có 1 file định nghĩa ở `shared-kernel/src/events/definitions/<event>.event.ts`, gom **payload type + factory** (co-locate contract). Đây là "construct an toàn như command" — quên field / sai shape = compile error.

```typescript
// shared-kernel/src/events/definitions/knowledge-published.event.ts
export interface KnowledgePublishedPayload { itemId: string; orgId: string; /* ... */ }

export const KnowledgePublishedEvent = defineEvent<KnowledgePublishedPayload>({
  eventType: EventType.KNOWLEDGE_PUBLISHED,
  aggregateType: 'KnowledgeItem',
})
```

Producer chỉ gọi `.create()` — `eventType`/`aggregateType` cố định, payload typed:
```typescript
await this.outboxRepo.append(
  KnowledgePublishedEvent.create({ aggregateId, orgId, payload }),
)
```

**Rules:**
- Mọi event type khai trong `EventType` const (1 nguồn, không magic string rải rác).
- `EventType` value đặt theo **past-tense** (`KnowledgePublished`, không `PublishKnowledge`).
- Mỗi event PHẢI có file definition + `defineEvent`. Không append outbox bằng object literal thô.

---

## 3. Wire contract = CloudEvents 1.0 + transport routing

### 3.1 Envelope — CloudEvents 1.0 (CNCF)

Wire format là **CloudEvents 1.0**, KHÔNG phải struct tự chế. Lý do: không có chuẩn thì mỗi team tự đặt tên field → cần translator để nói chuyện với tool ngoài. CloudEvents protocol-agnostic, có Kafka binding sẵn, interop với Knative/Argo/Event Grid.

```typescript
interface CloudEvent<TData> {
  specversion: '1.0'
  id: string          // outbox row id (UUID v7) — dedup key của consumer
  source: string      // '/cortex/core-api/KnowledgeItem' (producing context)
  type: string        // EventType.* — khóa routing (topic + transport + handler)
  time: string        // RFC3339
  subject?: string    // aggregate id (resource trong source)
  datacontenttype?: string  // 'application/json'
  data: TData         // payload
  orgid: string       // extension — multi-tenancy (tên MUST lowercase)
  partitionkey: string // extension — Kafka message key (= aggregate id), giữ ordering
}
```

**Quan trọng:** outbox table (storage nội bộ producer) giữ column riêng (`eventType`, `aggregateId`…); CloudEvent được **map từ outbox row lúc publish** (PollingPublisher). Storage schema ≠ public contract — đừng leak DB schema ra wire.

### 3.2 Transport selection — "binder" pattern (Spring Cloud Stream)

Kafka và queue **sống chung**. Mỗi event khai đi transport nào trong `EVENT_TRANSPORT_MAP` (giống "binder per binding" của Spring Cloud Stream). `CompositeMessagePublisher` fan-out theo map. Đổi 1 dòng map để chuyển/ thêm transport — producer code không đổi.

```typescript
EVENT_TRANSPORT_MAP[EventType.KNOWLEDGE_PUBLISHED] = [Transport.KAFKA]
// đổi thành [Transport.KAFKA, Transport.QUEUE] để fan ra cả 2
```

Topic Kafka tra qua `EVENT_TOPIC_MAP` (cả 2 map ở `shared-kernel/src/messaging/routing/maps.ts`). Cả 2 là `Record<EventTypeValue, …>` → thêm event mà quên map = compile error.

**Rules:**
- Adapter mới = implement `ITransportPublisher` (có `.transport`) + thêm vào providers của `MessagingModule`. KHÔNG sửa PollingPublisher.
- Mọi adapter sống chung 1 chỗ (`MessagingModule`); `KafkaModule` chỉ giữ raw client.
- Kafka key LUÔN là `partitionkey` (= aggregate id) để giữ per-aggregate ordering.

---

## 4. Inbound — outbox, idempotency, dispatch

### 4.1 Producer reliability
- **Transactional Outbox** (Guaranteed Delivery): ghi business + outbox trong cùng 1 DB tx. Xem `resilience_patterns.md §2`.
- **PollingPublisher** @Interval: at-least-once. Fail → retry → `FAILED_DLQ` sau N attempts (`OUTBOX_MAX_ATTEMPTS`).
- **HA-safe claim (competing consumers):** poll KHÔNG `findMany(PENDING)` trần — hai replica sẽ publish trùng. Claim atomically bằng `UPDATE … SET status='INFLIGHT' … WHERE id IN (SELECT id … WHERE status='PENDING' … FOR UPDATE SKIP LOCKED) RETURNING id`. Mỗi replica bỏ qua row replica khác đã khoá → không giẫm chân. **Publish NGOÀI transaction** (không giữ row-lock qua Kafka network I/O). Crash giữa claim↔publish để lại row `INFLIGHT` → **Reaper** @Interval reset `INFLIGHT` quá `OUTBOX_CLAIM_TIMEOUT_MS` về `PENDING` (redeliver được idempotent receiver nuốt). Cờ `running`/`reaping` chỉ chống overlap trong 1 process — không phải cơ chế mutual-exclusion (đó là việc của SKIP LOCKED).
- **Idempotent producer**: `producer({ idempotent: true })` (kafkajs tự set `acks=all`, `maxInFlightRequests≤5`) — chặn trùng do kafkajs retry ở broker. Kết hợp với Idempotent Receiver (§4.2) → at-least-once nhưng kết quả như exactly-once.
- **Partition key = danh tính aggregate ổn định, KHÔNG phải row id.** Nếu 2 event của cùng 1 aggregate keyed khác nhau → lạc partition → mất thứ tự (vd unfollow xử lý trước follow → ghost follower). FollowCreated/FollowRemoved đều key bằng `Follow.streamKey(userId, targetType, targetId)`, KHÔNG bằng `follow.id` (unfollow không có row id). Khớp đúng PK projection `[spaceId, userId]` phía consumer.

### 4.2 Consumer

> ✅ **TRẠNG THÁI: LIVE ở notification-service (Milestone B2 + hardening, 2026-07-01).** `NotificationEventsConsumer` (group `notification-service-group`) subscribe **cả** `knowledge-events` + `engagement-events` → 1 `EventRouter` register 3 handlers: `ItemPublishedHandler` (fan-out NEW_IN_SPACE to space followers, exclude author) + `FollowCreatedHandler` (upsert `space_followers` projection) + `FollowRemovedHandler` (delete from projection). `space_followers` = local projection trong `notification_db`, KHÔNG join `core_db`. FollowCreated/Removed từ `core-api/engagement` (`EngagementModule` import `OutboxModule`; follow/unfollow handlers append event qua `OUTBOX_REPOSITORY`, `transactional:true`). Idempotent via `@@unique([recipientUserId, sourceEventId])` + `createMany skipDuplicates`. **DLQ LIVE:** poison pill (parse fail) → `DeadLetterProducer` đẩy `<topic>.DLQ` NGAY + commit; handler error → bounded retry (`KAFKA_CONSUMER_MAX_RETRIES`, linear backoff) → hết budget thì DLQ + commit. Consumer LUÔN commit (sau success / sau DLQ) → **không bao giờ block partition head-of-line**.
- **Polling Consumer** (kafkajs raw, KHÔNG NestJS `@EventPattern`) — chủ động kiểm soát offset commit + idempotency, tránh coupling req-reply của NestJS transport.
- **EventRouter** (Message Dispatcher / `@EventPattern` viết tay): map `type → handler`, **1:1** trong 1 consumer group. Adapter chỉ parse + `router.route(event)`, không switch tay. `register()` ném khi trùng type — guard, không phải thiếu tính năng.
- **Fan-out 1 event → N concern = N consumer GROUP**, KHÔNG phải N handler trong 1 router. Mỗi concern (feed/search/notify) là 1 consumer group riêng (group id riêng theo concern, vd `KAFKA_FEED_CONSUMER_GROUP`); Kafka giao bản sao event cho từng group → fail/scale độc lập. ⚠️ KHÔNG cho 2 consumer dùng chung 1 group id (sẽ chia partition thay vì fan-out).
- **Idempotent Receiver**: handler check `ProcessedEvent` theo `event.id`. Xem `resilience_patterns.md §1`.
- **Retry → DLQ**: handler lỗi → retry bounded (`CONSUMER_MAX_RETRIES`, backoff tuyến tính), hết retry → `DeadLetterProducer.send()` đẩy sang `<topic>.DLQ` (helper `deadLetterTopic()`). Poison pill (parse fail) → dead-letter NGAY (retry vô nghĩa). Message lỗi được **cô lập, không mất, không block partition**.

### 4.3 Handler — giống MediatR `INotificationHandler<T>`
```typescript
class KnowledgePublishedHandler implements IIntegrationEventHandler<KnowledgePublishedPayload> {
  readonly eventType = EventType.KNOWLEDGE_PUBLISHED   // subscription declaration
  async handle(event: CloudEvent<KnowledgePublishedPayload>) {
    if (await this.feedRepo.isEventProcessed(event.id)) return  // idempotent
    await this.txManager.run(async () => { /* nhiều repo write atomic */ })
  }
}
```

**Rules:**
- Handler là **subscriber** → tự khai `readonly eventType` (event = 1:N, khác command 1:1). Đăng ký: `router.register(handler)`.
- Handler KHÔNG import Prisma. Phối hợp nhiều repo qua `ITransactionManager.run()` (xem `domain_modeling.md` + getTx pattern).
- Idempotency check theo `event.id` là **bắt buộc** với mọi handler có side-effect ghi DB.
- Lỗi trong handler ném ra cho adapter (adapter quyết retry/DLQ) — đừng nuốt im lặng.

---

## 5. Anti-patterns (đã gặp, đừng lặp)

- ❌ Guard chết `if (event.type !== X) return` trong handler — router đã route theo type, check này unreachable, nuốt bug.
- ❌ Magic string event name rải nhiều chỗ — dùng `EventType` const.
- ❌ `switch (eventType)` tay trong consumer — dùng `EventRouter`.
- ❌ `new Kafka()` trong từng consumer — dùng `KafkaClientService` singleton.
- ❌ Publish entity/domain object thô ra Kafka — phải qua CloudEvents + payload phẳng.
- ❌ `payload: unknown` ở call site — dùng `defineEvent` typed factory.
- ❌ Nuốt message lỗi ở consumer (log rồi `return`) — phải retry-bounded → dead-letter, nếu không sẽ mất event âm thầm.
- ❌ Dead-letter ngay lần lỗi đầu — phải retry trước (lọc lỗi transient), chỉ poison pill mới DLQ tức thì.

---

## 🔗 Liên quan
- `resilience_patterns.md` — Outbox, Idempotency, Retry, DLQ chi tiết
- `event_sourcing.md` — EventStore, projection, aggregate
- `cqrs_pattern.md` — command/query bus, middleware pipeline
- `domain_modeling.md` — entity factory, transaction boundary (getTx)

## 📚 Nguồn (học từ kỹ sư khác)
- [Domain Events vs Integration Events — Microsoft .NET / eShop](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation)
- [CloudEvents 1.0 — CNCF spec](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) + [Kafka binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/kafka-protocol-binding.md)
- [Spring Cloud Stream — Binder abstraction](https://docs.spring.io/spring-cloud-stream/docs/Brooklyn.RELEASE/reference/htmlsingle/index.html)
- [NestJS — @MessagePattern vs @EventPattern](https://docs.nestjs.com/microservices/kafka)
- [Kafka Idempotent Consumer & Transactional Outbox — Lydtech](https://www.lydtechconsulting.com/blog/kafka-idempotent-consumer-transactional-outbox)
- [A better domain events pattern — Jimmy Bogard](https://lostechies.com/jimmybogard/2014/05/13/a-better-domain-events-pattern/)
- Hohpe & Woolf — *Enterprise Integration Patterns* (Message Router, Dispatcher, Idempotent Receiver, Guaranteed Delivery)
