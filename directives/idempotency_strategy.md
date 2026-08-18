# SOP: Idempotency Strategy for Event Consumers

> Delivery in this system is **at-least-once** (outbox republish, the reaper resetting INFLIGHT,
> redelivery when an offset commit fails). Every handler MUST be safe when the same event runs
> again. This directive settles *how* that is guaranteed, *where*, and *when* the approach must
> change.
>
> Read alongside `eventing_patterns.md` (§4 Inbound). Sources: Idempotent Receiver (EIP, Hohpe &
> Woolf); Inbox/Outbox (microservices.io).

---

## Decision (2026-07-02)

**Dedup lives at the DB write point — NO central inbox/ProcessedEvent table.**

Reasoning: every side effect today is *a DB write, in the same database as the effect*. Under that
constraint, `INSERT … ON CONFLICT DO NOTHING` (or an upsert/delete by PK) makes idempotency
**atomic by nature** — the dedup key and the effect are **one statement**, with no crash window. A
separate inbox table splits dedup from the effect into two statements → which then need a
transaction to rejoin them → more complexity, no more safety. This is the *strictest* form of
Idempotent Receiver, not a watered-down one.

> `Kafka exactly-once (EOS)` does NOT apply here: EOS only holds for read-process-write where the
> "write" goes back into Kafka. Our effects write to Postgres — a Kafka transaction cannot pull a
> Postgres write into itself. Idempotent writes are still required.

---

## 0. The Producer layer (client/send side) — a separate layer, which does NOT solve the consumer-side problem (2026-07-14)

This whole file (from here down) is about the **consumer**. But there is another, much narrower
idempotency layer on the **producer** side:

```typescript
// kafka-producer.service.ts, dead-letter.producer.ts — both
this.producer = kafkaClient.client.producer({ idempotent: true })
```

`idempotent: true` is a native Kafka feature (producer ID + per-partition sequence number) that
blocks **broker-level duplicates caused by the send protocol itself**: the producer sends a message,
the broker receives it successfully, but the ACK is lost on the way back, so the producer (not
knowing the ACK was lost) automatically retries → two identical copies in Kafka if this flag is off.
With it on, the broker recognises "I already have this message" via the sequence number and discards
the duplicate — the application code needs to know nothing further.

**The limitation — spelled out in a comment in `kafka-producer.service.ts`:**

```typescript
// acks=all + maxInFlightRequests≤5). Note delivery is still at-least-once overall
// (the outbox poll loop can re-publish after a crash), so any future consumer
// must be idempotent — the dedup guard lives on the consumer side, not here.
```

`idempotent: true` does **not** cover the case where `PollingPublisherService` crashes mid-way,
restarts, and republishes **that same outbox row** (from the producer's point of view that is a
completely "new" publish, not a network retry) — that duplication lives at the application layer,
and the producer flag knows nothing about it. The system as a whole remains **at-least-once**, not
exactly-once — which is exactly why the consumer-side sections below exist and are mandatory.

---

## Two approved patterns (this is not inconsistency)

A handler records which pattern it uses with **one comment line above `handle()`** (no longer an
enforceable field — see Enforcement):

| Pattern | When to use | Mechanism |
|---|---|---|
| `natural-key` | The effect is set-membership (by PK) | upsert / delete by PK → re-applying is naturally a no-op. Does NOT need `event.id`. |
| `dedup-constraint` | The effect is an **append** (not naturally idempotent) | A unique key on `event.id` (`sourceEventId`) + `ON CONFLICT DO NOTHING` → re-applying inserts 0 rows. |

There is no `none` row any more — a handler with a side effect that falls into neither pattern is a
bug to fix before merge (caught at code review), not a valid value to declare.

Current examples: `FollowCreated/Removed` = `natural-key` (upsert/delete `space_followers` by
`[spaceId,userId]`); `ItemPublished` fan-out = `dedup-constraint`
(`@@unique([recipientUserId, sourceEventId])`); `IndexKnowledge` (search-service) = `natural-key`
(pgvector `replaceForItem(itemId,...)` + ES `indexItem` upsert by `id`, both keyed on the business
key).

### Decision rule — when does a table need a `sourceEventId` column?

An audit of all 4 current handlers (2026-07-14): **exactly one table** (`notifications`) has a
`sourceEventId` column. The other 3 write sites (`space_followers` ×2, pgvector + Elasticsearch)
**don't need one**.

The deciding question: **"does one occurrence of the event create a NEW row (append), and if so, is
the business data alone enough to distinguish 'the first time' from 'a redelivery of that same
time'?"**

- The effect is an **upsert/set/delete on an existing business key** (a follow keyed by
  `[spaceId,userId]`, a chunk keyed by `itemId`) → that key is already naturally idempotent, a
  redelivery overwrites/replaces the same place → **no** `sourceEventId` needed.
- The effect is an **append** (creating N new rows, like fanning a notification out to N followers)
  and **no** combination of business fields can distinguish "this row came from the first
  processing" from "this row came from a redelivery" → you **MUST borrow `event.id`** (the only
  thing that differs between two genuine events and is identical between two redeliveries of one
  event) as part of an `@@unique`.

Adding `sourceEventId` "just to be safe" to a table that doesn't need it (like `space_followers`) is
redundant — the natural PK already solves it, and the extra column adds surface without adding
safety.

### `dedup-constraint` is easy to confuse with `unique-constraint` (CQRS, `resilience_patterns.md` §1.4) — same DB mechanism, different question

Both are `@@unique` + blocking a duplicate insert — but the key means something entirely different:

```prisma
// dedup-constraint (Kafka) — the key includes sourceEventId, identifying ONE OCCURRENCE OF AN EVENT
@@unique([recipientUserId, sourceEventId])

// unique-constraint (CQRS, e.g. Organization.slug) — the key is a BUSINESS ENTITY,
// with nothing to do with "which request/event"
@@unique([slug])
```

The distinguishing test: does that key identify **one specific occurrence** (an event/request
instance — two genuinely different events can NEVER collide on this key, because `event.id` always
differs), or a **business identity** (two entirely independent actions can coincidentally pick the
same value, like two admins both choosing `slug: "acme"`)? The first → idempotency (answering "is it
safe to run again?"). The second → concurrency (answering "what if two different things collide?").

### Why Kafka has no parallel "concurrency" axis the way CQRS does

`CommandSafety` (CQRS) has two axes because an HTTP request can come from anywhere and touch the same
data **genuinely concurrently** — so you must build OCC/unique-constraints yourself to block it.
Kafka is different, because of how the **partition key** is chosen:

```typescript
// follow.entity.ts
static streamKey(userId: string, targetType: FollowTargetType, targetId: string): string {
  return `${userId}:${targetType}:${targetId}`
}
// follow-target.handler.ts — used as the outbox event's aggregateId/partition key
aggregateId: Follow.streamKey(command.userId, command.targetType, command.targetId)
```

Every event about **the same business relationship** always routes to **the same partition**; within
a consumer group, one partition is processed by exactly one consumer at a time — so Kafka
**automatically serialises** the processing of same-key events, for free, purely from choosing the
partition key correctly. That is why `IIntegrationEventHandler` only needs to declare `idempotency`
and has no parallel concurrency field — what CQRS has to build by hand, the Kafka transport provides
already, *provided* the partition key is chosen along the business key (see `eventing_patterns.md`
§4.1 — the `aggregateId` selection checklist).

---

## Enforcement — type-level enforcement WAS TRIED and REMOVED (2026-07-30); the reasoning is kept so nobody redoes it

The real risk isn't today's handlers, it's a **future handler forgetting** to be idempotent (e.g.
`reputationRepo.increment(+10)` → redelivery → +20). That is still true — what changed is HOW that
risk is caught.

**There used to be two hard layers** (both deleted — see why):

1. ~~Compile-time: `IIntegrationEventHandler.idempotency` was a required field; omitting it →
   `error TS2420`.~~
2. ~~Boot-time: `EventRouter.register()` threw if `idempotency === 'none'`.~~

**Why they were removed — an audit against what they could actually enforce:**

The field enforced exactly **one real thing**: whether a declaration exists, plus blocking the
literal `'none'` at boot. It could **not** enforce the thing that matters more — **whether the
declaration is truthful**. A handler writing `readonly idempotency = 'natural-key' as const` and then
calling a plain `create()` (not an upsert) inside `handle()` still compiles cleanly, still boots
cleanly, and still double-applies on redelivery — failing at exactly what the field claims to
prevent, and failing silently in precisely the same way as if the field didn't exist. Contrast the
comparison case in `docs/adr/0001-transaction-retry-boundary.md` §9b (a saga's
`compensation: 'registered'|'not-needed'`): that field has one **cross-check against real runtime
behaviour** (`CommandBus` counts how many `onCompensate` calls were made, and logs an error if
`'registered'` was declared but the count is 0) — which does catch the "declared falsely" case. The
`idempotency` field has no equivalent cross-check: nothing in
`EventRouter`/`ResilientEventConsumer` ever inspected `handle()`'s real effect to compare it against
the declared label.

⇒ The field only retained value as a "forces you to answer the question while writing" (a forcing
function) and had **no** value as "catches a wrong answer" — quite unlike the `compensation` field
(saga) or `TxScope` validation (which cross-checks against the factory registry — a verifiable
TECHNICAL FACT, not a claim about business logic). The real risk (a future handler forgetting to be
idempotent) remains entirely — it's just that **the type system is the wrong tool for this class of
risk**, because whether "this write is idempotent" is true is business logic, not something a type
system can verify.

**How it's caught now:** one convention-mandated comment line (not compiler-enforced) directly above
`handle()`, explaining the pattern in use and why it's safe (see the patterns table above for the
two valid ones) — caught at **code review**, which is the same level of real assurance the old field
actually provided, only without pretending there is an extra compile-time layer that never existed.

**The lesson worth keeping:** before encoding an invariant in the type system, ask *"can this
compiler verify a FACT, or only verify that A DECLARATION EXISTS?"* — TxScope/compensation are the
former (cross-checkable against real runtime behaviour), idempotency strategy is the latter (a pure
claim, not cross-checkable). Same lesson as the §"CommandOptions.safety" case in
`resilience_patterns.md` §1.4, for a different reason: `safety` was removed because it forced equal
ceremony onto every command regardless of risk; `idempotency` was removed because the enforcement
mechanism itself wasn't real.

---

## Observability (making silent failure visible)

Dedup fails in two invisible ways: **false negatives** (duplicates slip through → data bloat) and
**false positives** (a genuine event is swallowed → a lost notification). The metrics live in
`notification-service` (`/metrics`, prom-client):

- `notification_dedup_skipped_total` — a spike means the producer is republishing wildly / the
  partition key is wrong; staying at ~0 forever after a deploy means dedup may not be running as
  assumed.
- `notification_dlq_total{reason}` — any rate > 0 needs triage.
- `notification_handler_retry_total{eventType}` — transient retries before hitting the DLQ.

---

## Tripwire — REVISIT this decision IMMEDIATELY when:

- a handler produces a side effect **against an external system** (email, mobile push, payment,
  calling another service), **or**
- a handler produces a side effect that is **not naturally idempotent** and has no dedup-constraint
  (a counter, a balance, an incrementing ledger).

At that point `ON CONFLICT` can't save you → an upgrade is required.

### The fallback (verified CHEAP — which is why choosing simple is defensible)

Add a Transactional Inbox as a **decorator wrapping `EventRouter`**, without touching a single line
of any handler:

```typescript
class IdempotentRouter {
  async route(event) {
    if (await this.inbox.seen(event.id)) return
    await this.txManager.run(async () => {
      await this.inner.route(event)      // the effect
      await this.inbox.mark(event.id)    // + the marker — SAME transaction, same DB
    })
  }
}
```

The condition for correctness: the handler's side effect and `inbox.mark` must be in the same DB
transaction. For a side effect against an external system → use an idempotency key on that call
itself, rather than an inbox.

### YAGNI — why NOT build the inbox now

There is no side effect outside the DB yet. Building an inbox now = an extra table (needing
TTL/pruning) + an extra write + an extra transaction, for a risk that doesn't exist — and it is
**less safe** than the single-statement `ON CONFLICT`. Choosing simple here is a disciplined
decision (the fallback has been proven cheap), not laziness.

---

## 🔗 Related

- `eventing_patterns.md` §4 — outbox, dispatch, retry→DLQ; §4.1 the checklist for choosing
  `aggregateId`/partition key (which also determines whether consumer-level "concurrent collisions"
  can happen at all)
- `resilience_patterns.md` §1 — the summary table of all 5 idempotency techniques (HTTP + Kafka) and
  when to pick which; `natural-key`/`dedup-constraint` here are two of them, while the HTTP
  idempotency-key (§1.1 there) is a technique specific to the HTTP layer. §1.4 covers
  `CommandConcurrency` (`occ`/`unique-constraint`/`none`) — an axis that does NOT exist in parallel
  in this file (see "Why Kafka has no parallel concurrency axis" above) for reasons quite different
  from CQRS; don't confuse `dedup-constraint` with `unique-constraint` despite both using `@@unique`
- `domain_modeling.md` — the "type over runtime guard" philosophy
