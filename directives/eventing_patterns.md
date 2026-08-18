# SOP: Eventing & Messaging Patterns

> The reference architecture for everything event-driven in Cortex: domain event (in-process) vs integration event (cross-service), the CloudEvents envelope, transport routing (Kafka + queue), inbound dispatch.
> Read this file BEFORE adding any new event, new consumer, or new transport.
>
> The philosophy: **learn the named pattern first, don't invent your own.** Every component below maps 1-to-1 onto a proven pattern (EIP by Hohpe & Woolf, DDD/eShop by Microsoft, CloudEvents by the CNCF, the binder from Spring Cloud Stream). Sources are listed at the end.

---

## 📌 When to read this directive

| Task | Section to read |
|---|---|
| A side effect between aggregates WITHIN one service | §1 Domain event |
| Emitting an event for another service (via Kafka/queue) | §1 Integration event + §2 + §3 |
| Adding a new event type | §2 (definition) + §3 (routing) |
| Writing a new consumer / handler | §4 Inbound |
| Adding a new transport (BullMQ, SQS, …) | §3 Transport + binder |

---

## 1. Domain event vs Integration event — do NOT conflate them

These are two **different** artifacts with different designs (Microsoft eShop, Fowler). Merging them loses both freedom and stability.

| | **Domain event** | **Integration event** |
|---|---|---|
| Scope | within one bounded context, in-process | cross-service, via a broker |
| Synchronous? | sync/async, immediate | always async |
| Content | full domain detail | a flat payload, stable IDs, versioned |
| Transport | the in-memory `EventBus` (shared-kernel/cqrs) | CloudEvents over Kafka/queue |
| Evolution | change freely | change slowly and carefully (many consumers depend on it) |
| Code | `IEvent { name }` + `IEventHandler` | `CloudEvent<T>` + `IIntegrationEventHandler` |

**The canonical flow (eShop):** `command handler → (raise a domain event) → domain handler → create an integration event → outbox`. Cortex currently goes straight from `command handler → outbox` (a conscious simplification at this scale). When credits/sagas arrive (Phase 5), split out the intermediate domain-event layer.

**Rules:**
- Use a domain event to enforce a rule between aggregates in the same service → use the `EventBus`.
- Use an integration event to notify another service → through the outbox → CloudEvents. NEVER publish a raw entity/domain object to Kafka.

---

## 2. Event definition — a typed factory, one source

Every integration event has one definition file at `shared-kernel/src/messaging/events/definitions/<event>.event.ts`, holding **the payload type + the factory** together (a co-located contract). This is "construction as safe as a command" — a forgotten field or a wrong shape is a compile error.

```typescript
// shared-kernel/src/messaging/events/definitions/knowledge-published.event.ts
export interface KnowledgePublishedPayload { itemId: string; orgId: string; /* ... */ }

export const KnowledgePublishedEvent = defineEvent<KnowledgePublishedPayload>({
  eventType: EventType.KNOWLEDGE_PUBLISHED,
  aggregateType: 'KnowledgeItem',
})
```

A producer only calls `.create()` — `eventType`/`aggregateType` are fixed, and the payload is typed:
```typescript
await this.outboxRepo.append(
  KnowledgePublishedEvent.create({ aggregateId, orgId, payload }),
)
```

**Rules:**
- Every event type is declared in the `EventType` const (one source; no magic strings scattered around).
- `EventType` values are named in the **past tense** (`KnowledgePublished`, not `PublishKnowledge`).
- Every event MUST have a definition file + `defineEvent`. Never append to the outbox with a raw object literal.

---

## 3. The wire contract = CloudEvents 1.0 + transport routing

### 3.1 Envelope — CloudEvents 1.0 (CNCF)

The wire format is **CloudEvents 1.0**, NOT a bespoke struct. The reason: without a standard, every team invents its own field names → you need a translator to talk to any external tool. CloudEvents is protocol-agnostic, has a ready-made Kafka binding, and interoperates with Knative/Argo/Event Grid.

```typescript
interface CloudEvent<TData> {
  specversion: '1.0'
  id: string          // the outbox row id (UUID v7) — the consumer's dedup key
  source: string      // '/cortex/core-api/KnowledgeItem' (the producing context)
  type: string        // EventType.* — the routing key (topic + transport + handler)
  time: string        // RFC3339
  subject?: string    // the aggregate id (the resource within source)
  datacontenttype?: string  // 'application/json'
  data: TData         // the payload
  orgid: string       // extension — multi-tenancy (the name MUST be lowercase)
  partitionkey: string // extension — the Kafka message key (= the aggregate id), preserving ordering
}
```

**Important:** the outbox table (the producer's internal storage) keeps its own columns (`eventType`, `aggregateId`, …); the CloudEvent is **mapped from the outbox row at publish time** (PollingPublisher). The storage schema ≠ the public contract — don't leak the DB schema onto the wire.

### 3.2 Transport selection — the "binder" pattern (Spring Cloud Stream)

Kafka and the queue **coexist**. Each event declares which transport it takes in `EVENT_TRANSPORT_MAP` (like Spring Cloud Stream's "binder per binding"). `CompositeMessagePublisher` fans out according to the map. Change one line of the map to switch/add a transport — producer code doesn't change.

```typescript
EVENT_TRANSPORT_MAP[EventType.KNOWLEDGE_PUBLISHED] = [Transport.KAFKA]
// change to [Transport.KAFKA, Transport.QUEUE] to fan out to both
```

Kafka topics are looked up via `EVENT_TOPIC_MAP` (both maps live in `shared-kernel/src/messaging/routing/maps.ts`). Both are `Record<EventTypeValue, …>` → adding an event and forgetting the map is a compile error.

**Rules:**
- A new adapter = implement `ITransportPublisher` (with a `.transport`) + add it to `MessagingModule`'s providers. Do NOT modify PollingPublisher.
- Every adapter lives in one place (`MessagingModule`); `KafkaModule` holds only the raw client.
- The Kafka key is ALWAYS `partitionkey` (= the aggregate id) to preserve per-aggregate ordering.

---

## 4. Inbound — outbox, idempotency, dispatch

### 4.1 Producer reliability
- **Transactional Outbox** (Guaranteed Delivery): write the business change + the outbox row in the same DB transaction. See `resilience_patterns.md §2`.
- **PollingPublisher** on an `@Interval`: at-least-once. Failure → retry → `FAILED_DLQ` after N attempts (`OUTBOX_MAX_ATTEMPTS`).
- **Observability (2026-07-31):** previously the only way to see the PENDING/INFLIGHT/FAILED_DLQ backlog was opening the DB, and a row landing permanently in `FAILED_DLQ` logged on the SAME line as an ordinary retry. Now split out: `core_api_outbox_dead_letter_total{eventType}`
  (a Counter, incremented only when a row GENUINELY exhausts `maxAttempts`) + `core_api_outbox_backlog{status}` (a Gauge; `OutboxMetricsReporter`
  snapshots counts by status on a 30s `@Interval`) — both surface on `GET /metrics` automatically (the prom-client default registry). The recording rule
  `outbox:dead_letter_rate5m` (`docker-init/prometheus/rules.yml`) + the alert `Outbox Dead-Letter Rate Above Zero`
  (`docker-init/grafana/provisioning/alerting/rules.yaml`) follow the same shape as `notification:dlq_rate5m`/`search:dlq_rate5m`.
- **Cleanup (2026-07-31):** Postgres does NOT expire rows by itself the way Kafka topic retention does — `OutboxCleanupService`
  (`@Cron('0 3 * * *')`, the same shape as `IdempotencyCleanupService` — `resilience_patterns.md §1`) deletes
  `PROCESSED` rows older than `OUTBOX_PURGE_RETENTION_DAYS` (30 days by default) every night. **NEVER touch
  `FAILED_DLQ`** — those rows need human triage first, and deleting them automatically destroys the evidence of the failure. Saga compensation
  has an equivalent `SagaCompensationCleanupService`, deleting `DONE` rows according to `SAGA_COMPENSATION_PURGE_RETENTION_DAYS`.
- **HA-safe claim (competing consumers):** the poll does NOT use a bare `findMany(PENDING)` — two replicas would publish duplicates. Claim atomically with `UPDATE … SET status='INFLIGHT' … WHERE id IN (SELECT id … WHERE status='PENDING' … FOR UPDATE SKIP LOCKED) RETURNING id`. Each replica skips rows another replica has already locked → no treading on each other. **Publish OUTSIDE the transaction** (don't hold a row lock across Kafka network I/O). A crash between claim and publish leaves an `INFLIGHT` row → the **Reaper** (`@Interval`) resets `INFLIGHT` rows older than `OUTBOX_CLAIM_TIMEOUT_MS` back to `PENDING` (the redelivery is absorbed by the idempotent receiver). The `running`/`reaping` flags only prevent overlap within one process — they are not a mutual-exclusion mechanism (that's SKIP LOCKED's job).
- **Idempotent producer**: `producer({ idempotent: true })` (kafkajs sets `acks=all` itself; `maxInFlightRequests≤5` must be set explicitly — see the correction in `resilience_patterns.md §1.4`) — preventing duplicates caused by kafkajs retrying at the broker. Combined with the Idempotent Receiver (§4.2) → at-least-once delivery with an exactly-once result.
- **The partition key is a stable aggregate identity, NOT a row id.** If two events for the same aggregate are keyed differently → they land on different partitions → ordering is lost (e.g. an unfollow processed before its follow → a ghost follower). FollowCreated/FollowRemoved are both keyed by `Follow.streamKey(userId, targetType, targetId)`, NOT by `follow.id` (an unfollow has no row id). This matches the projection's PK `[spaceId, userId]` on the consumer side.
- **A checklist for choosing `aggregateId` for a new event** — ask two questions before writing `.create({ aggregateId: ... })`:
  1. Does the aggregate have **one DB row that survives every event** in its lifetime (including after updates/soft-deletes)? → Use `row.id` directly (the `KnowledgeItem` case — Published/Archived/MarkedStale all update the same row).
  2. Is it possible that **the original row no longer exists** when a later event fires (an N-N relation hard-deleted like Follow, or a purely event-sourced aggregate with no durable row, like `CreditAccount`)? → You MUST use a **deterministic key** composed from stable business fields — computable **without querying the DB first**, and **identical** for every event of that "logical" aggregate. E.g. `Follow.streamKey(userId, targetType, targetId)`, `CreditAccount.aggregateId = orgId:userId`.
  The quick decision question: *"For two events about this same 'thing', does order matter, and can a later event fire after the earlier event's row has disappeared?"* — a yes to either → deterministic key, never `row.id`.

### 4.2 Consumer

> ✅ **STATUS: LIVE in notification-service (Milestone B2 + hardening, 2026-07-01).** `NotificationEventsConsumer` (group `notification-service-group`) subscribes to **both** `knowledge-events` and `engagement-events` → one `EventRouter` registers 3 handlers: `ItemPublishedHandler` (fan-out NEW_IN_SPACE to space followers, excluding the author) + `FollowCreatedHandler` (upsert the `space_followers` projection) + `FollowRemovedHandler` (delete from the projection). `space_followers` is a local projection inside `notification_db`, NOT a join against `core_db`. FollowCreated/Removed come from `core-api/engagement` (`EngagementModule` imports `OutboxModule`; the follow/unfollow handlers append the event via `OUTBOX_REPOSITORY`, `transactional:true`). Idempotent via `@@unique([recipientUserId, sourceEventId])` + `createMany skipDuplicates`. **DLQ LIVE:** a poison pill (parse failure) → `DeadLetterProducer` pushes to `<topic>.DLQ` IMMEDIATELY + commits; a handler error → bounded retry (`KAFKA_CONSUMER_MAX_RETRIES`, linear backoff) → on budget exhaustion, DLQ + commit. The consumer ALWAYS commits (after success / after DLQ) → it **never blocks the partition head-of-line**.
- **Polling Consumer** (raw kafkajs, NOT NestJS `@EventPattern`) — actively controlling offset commits + idempotency, avoiding the req-reply coupling of the NestJS transport.
- **EventRouter** (a Message Dispatcher / a hand-written `@EventPattern`): maps `type → handler`, **1:1** within one consumer group. The adapter only parses + `router.route(event)`, with no hand-written switch. `register()` throws on a duplicate type — that is a guard, not a missing feature.
- **Fanning one event out to N concerns = N consumer GROUPS**, NOT N handlers in one router. Each concern (feed/search/notify) is its own consumer group (with its own group id per concern, e.g. `KAFKA_FEED_CONSUMER_GROUP`); Kafka delivers a copy of the event to each group → independent failure/scaling. ⚠️ NEVER let two consumers share one group id (they would split partitions instead of fanning out).
- **Idempotent Receiver**: the handler checks `ProcessedEvent` by `event.id`. See `resilience_patterns.md §1`.
- **Retry → DLQ**: a handler error → bounded retry (`CONSUMER_MAX_RETRIES`, linear backoff); on exhaustion → `DeadLetterProducer.send()` pushes to `<topic>.DLQ` (the `deadLetterTopic()` helper). A poison pill (parse failure) → dead-letter IMMEDIATELY (retrying is pointless). A failing message is **isolated, not lost, and doesn't block the partition**.

### 4.2a DLQ Replay — the next step after a message lands in `.DLQ`

> ✅ **STATUS: LIVE in notification-service + search-service (ADR-0001 review, 2026-07-30).** Before this version, `.DLQ` was a **durable store with no reprocessor** — messages sat there, and "triage" meant a human reading Kafka UI by hand, indefinitely. `DlqReplayConsumer` (shared-kernel) closes that gap.
>
> **2026-08-04 — full-jitter exponential backoff (it was previously a FIXED 60s delay).** The user asked exactly the right question: the main consumer has already retried and failed, so if DLQ replay hits again after a fixed 60s, how is that different from just retrying — if the cause is an overloaded downstream at peak, 60s without backoff isn't enough for it to recover, and every message that died during one outage will replay in phase and hammer the downstream simultaneously (a thundering herd). Fixed: delay = `random(0, min(maxReplayDelayMs, baseReplayDelayMs·2^replayCount))` — **exactly the same** full-jitter formula already defined for `RetryMiddleware` in `resilience_patterns.md §Retry`, not a newly invented mechanism. This is still NOT an active load-regulation mechanism (it doesn't measure downstream lag/CPU, and has no circuit breaker) — only a delayed retry that spaces out more sensibly over time, with jitter to break phase alignment. Genuine active load shedding (watching the error rate/lag and pausing replay entirely) would need a circuit breaker; not done.

**The full flow — 2 consumer groups that NEVER mix:**
```
original topic ──► ResilientEventConsumer (group: <service>-group)
                │ retries exhausted
                ▼
           DeadLetterProducer.send() ──► topic.DLQ
                                            │
                                            ▼
                              DlqReplayConsumer (group: <service>-dlq-replay-group)
                                 waits delay = random(0, min(maxReplayDelayMs,
                                       baseReplayDelayMs·2^replayCount))
                                       (defaults base=60s, cap=5 minutes — full jitter)
                                 reads x-dlq-replay-count from the header
                                 replayCount >= maxReplays (default 3)?
                                   ├─ YES → log + commit, leave it in topic.DLQ (manual triage)
                                   └─ NO  → republish the RAW BYTES to the original topic
                                              (incrementing x-dlq-replay-count, NOT re-parsing
                                              the CloudEvent — it may still be a poison pill)
                                              → back to the top of the loop above
```

**File locations (when tracing this flow next time, read them in this order):**
1. `infrastructure/kafka/kafka.module.ts` (`@Global`) — holds only `KafkaClientService` (the raw `Kafka` client) + `DeadLetterProducer` (implementing `IDeadLetterProducer`, used by the main consumer).
2. `infrastructure/kafka/kafka-client.service.ts` — **everywhere this service touches Kafka to satisfy `MinimalConsumer<T>`/`MinimalProducer` (shared-kernel) goes through exactly two methods in this file**: `createConsumer<T>(config)` and `createProducer()`. (2026-07-31: there used to be two separate adapter classes explicitly `implements`ing them for "landmark" purposes; on 2026-08-01 it was found the adapters added no behaviour — the raw kafkajs Consumer/Producer already satisfy the structural type — so they collapsed into one `as unknown as` cast per method, dropping both classes. `MinimalDlqProducer` was renamed `MinimalProducer` at the same time — its shape has nothing DLQ-specific about it, exactly like `MinimalConsumer`, shared by both flows.)
3. `modules/<domain>/infrastructure/consumers/<domain>-events.consumer.ts` (or `knowledge-indexer.consumer.ts` in search-service) — the **main consumer**'s wiring: `EventRouter` + `ResilientEventConsumer`, group `<service>-group`.
4. `modules/<domain>/infrastructure/consumers/dlq-replay.consumer.ts` — the **replay consumer**'s wiring: `SharedDlqReplayConsumer`, its own group `<service>-dlq-replay-group` (registered in `<domain>.module.ts`, NOT in `KafkaModule` — this is domain-specific wiring, not app-wide shared infrastructure).

**Rules:**
- The 2 consumers MUST have different group ids (the §4.2 fan-out rule applies here too, for a different reason: replay operates on a scale of minutes and the main consumer on milliseconds — two different tuning knobs; merging groups would make replay compete for offsets with the main consumer).
- The replay count lives IN the message header (`x-dlq-replay-count`), not in an auxiliary DB table — stateless across service restarts.
- On exhausting `maxReplays` → **no further escalation anywhere**, the message stays in `.DLQ` for a human to triage — not a bug, a deliberate stopping point.

### 4.3 Handler — like MediatR's `INotificationHandler<T>`
```typescript
class ItemPublishedHandler implements IIntegrationEventHandler<KnowledgePublishedPayload> {
  readonly eventType = EventType.KNOWLEDGE_PUBLISHED         // subscription declaration
  // Safe under redelivery: dedup lives RIGHT IN the write statement — createMany({ skipDuplicates })
  // over @@unique([recipientUserId, sourceEventId]), with no separate check-then-write.
  async handle(event: CloudEvent<KnowledgePublishedPayload>) {
    await this.notificationRepo.insertMany(rows)
  }
}
```

**Rules:**
- A handler is a **subscriber** → it declares its own `readonly eventType` (events are 1:N, unlike commands, which are 1:1). Registration: `router.register(handler)`.
- **Every handler MUST be safe under at-least-once delivery** (redeliverable, never double-applying) — but
  this is NO LONGER a compiler-enforced `readonly idempotency: 'natural-key'|'dedup-constraint'|'none'`
  field (removed 2026-07-30): the framework has no way to cross-check the declared label against what `handle()`
  actually does — a handler declaring `'natural-key'` while writing a plain `create()` still compiles cleanly, still
  double-applies on redelivery, and nobody knows until it breaks. An unverifiable label isn't worth keeping
  as a type. Instead: write one comment line right above `handle()` explaining WHY it is safe (see the example
  above) — the concrete techniques (a natural-key upsert/delete by PK, a dedup constraint on event.id) are still
  the right techniques to use; see `resilience_patterns.md §1.0` for the full taxonomy. It is only that nobody
  can enforce it beyond code review.
- Dedup must be **atomic within the write statement** (`ON CONFLICT`/upsert/delete by PK), NOT a separate check-then-write (a crash window), and needs no central inbox table when the side effect is a DB write in the same database.
- Handlers do NOT import Prisma. To write to several repositories in **the same DB**, inject `@Inject(TX_RUNNER) ITxRunner`
  and `run(SCOPE, tx => ...)` — the repos come FROM the scope, and the handler holds no repo of its own (ADR-0001).
  ```typescript
  await this.txRunner.run(NOTIFICATION_TX_SCOPE, async (tx: NotificationTxScope) => {
    const followerIds = await tx.spaceFollowers.findFollowerIds(orgId, spaceId)   // read
    await tx.notifications.insertMany(rows)                                        // write — the same transaction
  })
  ```
  - **`ITxRunner` does NOT belong to CQRS** — it is an independent port in shared-kernel. The CommandBus is merely *one*
    caller; an event handler calling it directly is legitimate (it's an interface, not Prisma).
  - `EventRouter.route()` **deliberately does NOT** wrap a transaction automatically the way the CommandBus does: the premise "every write is
    local-DB" holds for Commands but is FALSE for event handlers (`IndexKnowledgeHandler` writes to pgvector +
    Elasticsearch — wrapping automatically would create false safety).
  - A read-then-write must live INSIDE the same `run()`: the follower list must not change between reading it and
    fanning out over it.
- For writes **across stores/services** (Postgres + Elasticsearch, or another service's DB) a transaction is impossible —
  use idempotency + retry/DLQ, do NOT try to wrap a transaction (see `IndexKnowledgeHandler`).
- Errors inside a handler are thrown out to the adapter (the adapter decides retry/DLQ) — never swallow them silently.

---

## 5. Anti-patterns (already encountered — don't repeat them)

- ❌ A dead guard `if (event.type !== X) return` in a handler — the router already routed by type, so this check is unreachable and swallows bugs.
- ❌ Magic-string event names scattered around — use the `EventType` const.
- ❌ A hand-written `switch (eventType)` in a consumer — use `EventRouter`.
- ❌ `new Kafka()` in each consumer — use the `KafkaClientService` singleton.
- ❌ Publishing a raw entity/domain object to Kafka — it must go through CloudEvents + a flat payload.
- ❌ `payload: unknown` at the call site — use the `defineEvent` typed factory.
- ❌ Swallowing a failing message in the consumer (logging then `return`) — it must be bounded-retry → dead-letter, otherwise events are lost silently.
- ❌ Dead-lettering on the first failure — retry first (to filter out transient errors); only a poison pill goes straight to the DLQ.

---

## 🔗 Related
- `resilience_patterns.md` — Outbox, Idempotency, Retry, DLQ in detail
- `event_sourcing.md` — EventStore, projections, aggregates
- `cqrs_pattern.md` — the command/query bus, the middleware pipeline
- `domain_modeling.md` — entity factories, transaction boundaries (getTx)

## 📚 Sources (learning from other engineers)
- [Domain Events vs Integration Events — Microsoft .NET / eShop](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation)
- [CloudEvents 1.0 — CNCF spec](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) + [Kafka binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/kafka-protocol-binding.md)
- [Spring Cloud Stream — Binder abstraction](https://docs.spring.io/spring-cloud-stream/docs/Brooklyn.RELEASE/reference/htmlsingle/index.html)
- [NestJS — @MessagePattern vs @EventPattern](https://docs.nestjs.com/microservices/kafka)
- [Kafka Idempotent Consumer & Transactional Outbox — Lydtech](https://www.lydtechconsulting.com/blog/kafka-idempotent-consumer-transactional-outbox)
- [A better domain events pattern — Jimmy Bogard](https://lostechies.com/jimmybogard/2014/05/13/a-better-domain-events-pattern/)
- Hohpe & Woolf — *Enterprise Integration Patterns* (Message Router, Dispatcher, Idempotent Receiver, Guaranteed Delivery)
