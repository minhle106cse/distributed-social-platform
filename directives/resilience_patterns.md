# SOP: Resilience Patterns

> A guide to implementing the 4 patterns that protect the system: Idempotency, Transactional Outbox, Retry, Throttle.
> Read this file before writing any endpoint that handles an important mutation or calls an external service.

---

## 📌 When to read this directive

| Task | Pattern needed |
|---|---|
| A POST/PATCH endpoint a client might retry | Idempotency §1 |
| Writing a new Kafka consumer handler (receiving an event, not publishing) | `idempotency_strategy.md` (techniques #3/#4 in §1.0 below) |
| Needing to publish an event to Kafka after a DB save | Transactional Outbox |
| Calling an external service that can fail temporarily | Retry |
| Calling an external service on the hot path (a user is waiting for the response) — ES/Ollama/gRPC/AI | Circuit Breaker §3.1 |
| Writing a new route that needs a per-org limit (not just per-IP) | Rate Limiting §4.1 |
| Calling the Claude API / embedding for many items | Throttle |
| Writing a new `main.ts`/entrypoint for a service | Graceful Shutdown |
| Needing to trace one request across several services (HTTP→gRPC→Kafka) in the logs | Correlation-id §7 |

---

## 1. Idempotency

"Idempotency" is not one technique — it is a family of 5 techniques with quite different mechanisms and quite different costs. The most common mistake is jumping straight to the most expensive one (an idempotency key + its own table) when a cheaper one would already suffice.

### 1.0 Choosing a technique — always prefer the cheapest one that applies

| # | Technique | Mechanism | When to use | Cost |
|---|---|---|---|---|
| 1 | **Set-semantics** | Absolute overwrite (`status = 'X'`, `permissions = [...]`), never accumulation (`+= 1`) | State-machine transitions, config overwrites | 0 — natural |
| 2 | **Domain guard → a legitimate no-op** | The domain itself throws something like `AlreadyMemberError`/`InviteAlreadyUsedError`, and the caller treats it as success | Accept-invite, register (a unique constraint + catching the error in the domain) | 0 — just needs a correct domain model |
| 3 | **DB unique constraint (natural-key)** | `@@unique([...])` — the write and the dedup are **one statement** (`upsert`/`ON CONFLICT DO NOTHING`) | follow/vote/bookmark; a Kafka consumer whose effect is set-membership (see `idempotency_strategy.md`) | Low — one index, no auxiliary table |
| 4 | **Dedup by event id (dedup-constraint)** | A unique key on `sourceEventId` when there is no natural business key | A Kafka consumer whose effect is an **append** (see `idempotency_strategy.md`) | Low — still one atomic statement |
| 5 | **Idempotency-key header + a response-cache table** | The client sends `X-Idempotency-Key`, the server caches/replays the response | **Only when #1–4 cannot apply** — a genuinely new resource is created each time, there is no business key, and the consequence of duplication is genuinely expensive (money, AI compute, a cross-service saga) | Highest — its own table, an extra write, a TTL cron |

### ⚠️ The 5 techniques are NOT mutually exclusive at the level of code properties — choose by causal priority order, not as a checklist (2026-07-14)

> **Update (later the same day):** the section below describes a way of reasoning (read the code, find which mechanism decides first) — **the reasoning is still valid and useful when reading code yourself**, but the `safety.primaryReplayGuard` field it refers to has been **removed entirely** from `CommandOptions` (see §1.4 — a re-audit found this was not a pattern real senior engineers use, just something synthesised here). Read this section as a **thinking exercise** ("how do I read code to tell which mechanism is the decisive one"), not as a description of a field that still exists in the code.

The user was right: `set-semantics`/`domain-guard`/`natural-key` are **not** three mutually exclusive branches in code — a real handler can absolutely exhibit **several characteristics at once**. Take `AcceptInviteHandler`:
```typescript
if (invite.isUsed()) throw new InviteAlreadyUsedError()   // domain-guard characteristic: THROWS
if (existing) throw new AlreadyMemberError()               // domain-guard again

await this.membershipRepo.save(membership)   // upsert on (orgId,userId) — natural-key characteristic in itself
invite.accept(command.userId)                 // only assigns usedAt — set-semantics characteristic in itself
await this.inviteRepo.save(invite)
```
The `invite.accept()` line by itself **has** set-semantics characteristics, and the `membershipRepo.save()` line by itself **has** natural-key characteristics (an upsert on `orgId_userId`, taken straight from the input). If the 5 values were read as "which properties exist in this code", the correct answer for this command would be "all three" — contradicting `safety.primaryReplayGuard` accepting only one value.

**The resolution — change the question from "which characteristics DOES this code have" to "what is REALLY the reason a repeat call is safe — which one blocks FIRST, making everything after it irrelevant?"** Because execution is sequential, there is always exactly one answer when the question is asked this way. Walk the order below and stop at the FIRST match — but you must **read the whole** handler + repo before applying it, never stopping at the first sign you spot:

```
1. On a REPEAT call, is there a throw/early-return that blocks BEFORE
   touching any write, AND does that throw only fire when "this has
   already been done" (NOT on the first legitimate call)?  → domain-guard
2. Does the main write use upsert/updateMany/deleteMany on a key taken
   STRAIGHT from the input (not a self-generated v7()/uuid() id), AND
   are BOTH branches (doesn't exist yet / already exists) GENUINELY
   reachable (not with one branch pre-excluded by an earlier guard)?  → natural-key
3. Is the main write merely an "=" onto a record GUARANTEED to exist
   (via an earlier guard, or via a known surrogate key)?              → set-semantics
4. None of the above applies, and it must be blocked at the HTTP layer? → idempotency-key
5. Nothing protects it, but it is provably harmless?                   → none (+record why)
```

**Step 1 — distinguish a "replay-detection" throw from an "invalid input" throw:** not every `throw` counts as a domain guard. The test: does that throw fire **identically** on the first call (with valid input) and on a repeat call? If yes (e.g. `RoleNotFoundError` when `roleCode` is wrong — fires regardless of first or repeat) → that is validation and **does not count**. Only a throw that **only fires when this is definitely a repeat** (e.g. `InviteAlreadyUsedError` — false on the first call, true on a repeat) counts as a genuine domain guard.

**Step 2 — distinguish "the syntax is an upsert" from "both branches are genuinely alive":** seeing `.upsert()` in the code is not enough to conclude natural-key. For example `UpdateMemberRoleCommand` calls the **same** `membershipRepo.save()` (the same upsert as `accept-invite` above) — but a `MembershipNotFoundError` throws first, guaranteeing the record exists → the upsert's `create` branch is **completely dead, never reachable** along this command's path. An upsert with one dead branch is no longer "create-or-no-op"; it degenerates into a plain assignment → `set-semantics`, not `natural-key`, despite the `.upsert()` syntax. Conversely, `CreateInviteCommand` also calls `.upsert({where:{id}})` but `id` is a freshly generated `v7()` on every call — that key **cannot be regenerated** from the input, so two calls always produce two different `id`s and the `update` branch is never reached → also not `natural-key`, falling through to `none`.

**5 combinations verified to genuinely exist in the code (not hypothetical):**

| Combination | Command | Note |
|---|---|---|
| 1 only (domain-guard) | `register` | `UserAlreadyExistsError` (genuine replay detection) + a plain `create()` (self-generated id, not an upsert) |
| 2 only (natural-key) | `follow-target` | Throws nothing; `Follow.upsert()` on a key taken straight from the input, both branches alive |
| 1+3, not 2 | `refresh` | `RefreshTokenUsedError` (genuine replay detection) + `update({where:{id}})` set-semantics (surrogate key) — the repo has no `.upsert()` at all |
| 2+3, not 1 | `cast-vote` | `KnowledgeItemNotFoundError` is only validation (fires in both cases). The "already voted" branch both `changeValue()`s (3) and `upsert()`s (2) in the same block |
| All of 1+2+3 | `accept-invite` | The domain guard fires first, so the other two writes (natural-key + set-semantics) are never reached along the replay path |

This is the general rule for EVERY case that looks like it "matches several labels": whichever label blocks/decides FIRST in execution order wins — but you must run all 3 independent tests before concluding, never stopping early.

**Why the first 3 values weren't merged into one (considered, rejected):** all three (`set-semantics`/`domain-guard`/`natural-key`) are "just coding discipline" (unlike `idempotency-key`, which needs real infrastructure). But they have **different failure modes** when the code is later modified — that is the reason for keeping them separate, not padding the count:
- `natural-key` safety depends on **one line of SCHEMA** (`@@unique`) — if someone drops that index, the protection is silently lost, with no compile/runtime error. Suspect a break → look in `schema.prisma`.
- `domain-guard` safety depends on **domain code** — if someone deletes the `throw` in the entity, the protection is silently lost. Suspect a break → look in the entity/domain method.
- `set-semantics` depends on nothing — always correct as long as it's still `=`.

Separate labels preserve the **audit clue** ("where do I look if I suspect it broke") — merging them loses that information, even though they genuinely aren't "strategic choices" the way `idempotency-key` is.

**Considered once more: should the field be dropped entirely (or changed into a `Set<CommandIdempotency>` listing every property present) given the values aren't mutually exclusive — decision: NO, only RENAME the field.** Why the type isn't structurally wrong: it answers exactly one question with exactly one answer ("WHICH mechanism decides safety"), not "which properties are present" — exactly like an HTTP status code (`404` doesn't claim "no other fact is true", it reports the fact that DECIDED the response). Changing it to a `Set` would push the waterfall reasoning onto EVERY consumer (the drift test, `CommandSafetyMiddleware`) instead of one person (at labelling time, with full context) — more work, not "more honest". The real problem was only **the name**: the old field, called `idempotency`, read as "properties this command has" rather than "a prioritised conclusion". **The field was renamed `idempotency` → `primaryReplayGuard`** ("primary" signals immediately that other mechanisms may also be present, and that this field only records which one is load-bearing) — no structural/value change, only a name that states its own nature. This touched all 37 commands (key rename only, values unchanged) + `idempotency-label-drift.spec.ts` (regex) + `command-safety.middleware.spec.ts` (fixture). The JSDoc on `CommandIdempotency`/`CommandSafety` (shared-kernel) now carries the warning "NOT a list of properties" on its **very first line**, before anything else.

**Not idempotency, though often confused with it:** OCC/versioning (`@@unique([aggregateId, version])`) solves **lost updates under concurrent writes**, a completely different question from "has this already been done". The two mechanisms often work together on the same endpoint (see 1.3).

Techniques #3/#4 (the Kafka consumer layer) have their own directive: `idempotency_strategy.md`. These used to be enforced by a mandatory `idempotency: 'natural-key' | 'dedup-constraint' | 'none'` field on every `IIntegrationEventHandler` (compile-time + boot-time if `'none'`) — **removed 2026-07-30**: the field could only enforce "is there a declaration", and could not cross-check the declared label against `handle()`'s real effect, so a handler declaring falsely still compiled and booted cleanly. See `idempotency_strategy.md §Enforcement` for the full reasoning. It is now recorded in a comment above `handle()` and caught at code review. The sections below (1.1–1.3) cover only technique #5 — the HTTP layer.

### 1.1 Technique #5 — the HTTP idempotency key

**The problem:** a client sends `POST /credits/spend` → times out → retries → the server processes it twice, charging money twice.

**The solution:** the client sends an `X-Idempotency-Key: <uuid>` header. The server checks whether the key already exists — if so, it returns the previous response rather than processing again.

**⚠️ Fixed (2026-07-12) — the interceptor previously could NOT block two concurrent requests with the same key; now it can.** The first version used check-then-run: `findUnique` first, run the handler, `create` afterwards — two requests arriving at the same moment both saw "no such key" (the record was only written AFTER the handler completed) and **both ran the real handler**. This had been recorded as a "known limitation needing a separate second layer to compensate" — but on genuine verification (not just reasoning), by firing `POST /spaces` twice concurrently with the same key against a real Postgres, the **race was confirmed real**: two `Space` rows with duplicate names were created (`POST /spaces` has no second layer blocking it — correctly recorded in the "Deliberately NOT adding a second layer" table below, meaning this race was not compensated by any other mechanism for 2 of the 5 endpoints).

**The root fix — claim-before-execute** instead of check-then-run: write a row **BEFORE** running the handler, with `response: null` (in progress), relying on the `@id` unique constraint to make "claiming the right to process this key" atomic. A second request arriving later finds the row already exists (even with `response` still null) → immediately returns `409 Conflict` (fail fast, no polling) instead of running the handler a second time. If the handler errors, the claim row is deleted — so the key isn't "stuck" for the full 24h TTL, blocking a legitimate later retry.

### Schema (already exists)
```prisma
model IdempotencyRecord {
  key       String   @id               // X-Idempotency-Key header value
  response  Json?                      // NULL = claimed, handler still running
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")   // TTL 24h, a cron deletes expired rows

  @@index([expiresAt])
  @@map("idempotency_records")
}
```

### Implementation — a NestJS interceptor + a shared module

```typescript
// infrastructure/http/idempotency/idempotency.interceptor.ts
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const key = req.headers['x-idempotency-key'] as string | undefined

    if (!key || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next.handle()
    }

    const existing = await this.prisma.client.idempotencyRecord.findUnique({ where: { key } })
    if (existing) {
      if (existing.response !== null) return of(existing.response) // replay, do NOT re-run the handler
      throw new ConflictException('A request with this idempotency key is already in progress')
    }

    // Claim BEFORE running the handler — atomic thanks to the @id unique constraint.
    try {
      await this.prisma.client.idempotencyRecord.create({
        data: { key, response: Prisma.JsonNull, expiresAt: new Date(Date.now() + TTL_MS) },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A request with this idempotency key is already in progress')
      }
      throw err
    }

    return next.handle().pipe(
      tap((response) => {
        this.prisma.client.idempotencyRecord
          .update({ where: { key }, data: { response: response as Prisma.InputJsonValue } })
          .catch((err) => req.log.error({ err }, 'Failed to persist idempotency response'))
      }),
      catchError((err) =>
        // Handler failed → delete the claim so a legitimate later retry isn't stuck for the full TTL.
        from(this.prisma.client.idempotencyRecord.delete({ where: { key } }).catch(() => undefined)).pipe(
          switchMap(() => throwError(() => err)),
        ),
      ),
    )
  }
}
```

`IdempotencyInterceptor` + the TTL reaper (`IdempotencyCleanupService`) live in **`infrastructure/http/idempotency/idempotency.module.ts`**, exported via `HttpIdempotencyModule` (`@Global()`). Registered **exactly once** in `AppModule`, so every other controller can use `@UseInterceptors(IdempotencyInterceptor)` without re-importing the module — avoiding copy-pasting the provider into each consuming module (the lesson from the first attempt, which registered it only in `CreditModule` despite serving several other modules).

⚠️ **A client receiving `409` for a key already in progress must retry later; this is not a server-side bug to fix** — it is the correct behaviour.

### 1.2 Where it has been applied (core-api, audit 2026-07-10)

| Endpoint | Reason for adding it |
|---|---|
| `POST /credits/grant` | An append-only event ledger with nothing preventing a double write → real money granted twice |
| `POST /admin/orgs` | A saga across 2 services (gRPC creating a real user in `auth_db` + an org in `core_db`) — the largest blast radius in the system |
| `POST /knowledge` | No unique constraint preventing a duplicate document, and it triggers a Kafka fan-out costing real embedding compute |
| `POST /spaces` | No unique constraint preventing a duplicate space |
| `POST /knowledge/:id/publish` | The domain state is naturally safe (`publish()` sets unconditionally), but the outbox event is appended **unconditionally on every call** → a retry still wastes re-embedding unless blocked |

**Deliberately NOT added** — already safe via techniques #1–#3 present in the domain/schema, so adding the interceptor would be redundant: `follows`/`votes`/`bookmarks` (`@@unique` blocks at the DB), `accept-invite`/`register` (the domain throws), `update-member-role`/`update-role-permissions` (idempotent overwrite), the roles/permissions CRUD in auth-service (a unique constraint or an overwrite), `PATCH .../read` in notification-service (`markAsRead()` is already idempotent), `POST .../invites` (a duplicate token is harmless — no email is sent, it's pull-based via a link).

### 1.3 The canonical two-layer case — note that each layer's scope is different (updated 2026-07-12)

The interceptor (claim-before-execute) now blocks **two concurrent requests with the SAME idempotency key** by itself — no separate second layer is needed for that case any more. But the OCC/unique constraints below are still necessary because they protect a **completely different** case: two legitimate requests with **different** idempotency keys (two separate spends, two admins creating separate orgs at the same time) — that is business-level concurrency, which an idempotency key does not and should not touch (two requests with different keys are two genuinely different actions, not a retry).

- `POST /credits/spend`, `POST /credits/grant` → the business layer = **OCC** on the `CreditAccount` aggregate (`@@unique([aggregateId, version])`) — preventing two different concurrent spends from corrupting the balance
- `POST /admin/orgs` → the business layer = a **unique constraint on `slug`** in `CreateOrgCommand` — preventing two admins from creating orgs with the same slug
- `POST /knowledge`, `POST /spaces` → **no business layer yet** (no natural unique constraint applies to a duplicate document/space name) — acceptable, because this is a race between two **genuinely different** user actions (choosing the same name), quite unlike the race fixed above (two **identical** requests with the same key, now closed)

### ⛔ 1.4 `CommandOptions.safety` — BUILT AND REMOVED THE SAME DAY (2026-07-14) — unused; read this so it isn't repeated

**It once existed and has been deleted entirely from the code** (`CommandIdempotency`/`CommandConcurrency`/`CommandSafety`/the `safety` field/`CommandSafetyMiddleware`/`idempotency-label-drift.spec.ts`) after the user asked directly: *"do real senior engineers actually do this, or am I inventing it?"*

**What had been built (summarised so nobody rebuilds it):** a mandatory `safety: { primaryReplayGuard, concurrency }` field on every command (5+3 enum values), one runtime middleware checking `occ⟹transactional`, one static test verifying the `idempotency-key` label matched the interceptor, plus 4 rounds of taxonomy refinement (waterfall priority order, the field rename, worked examples) — about 8 conversation rounds in total.

**Why it was removed — an audit against real practice:**
- The 5 genuinely foundational idempotency patterns (Idempotency-key/Stripe, OCC/JPA `@Version`, Kafka Idempotent Receiver, the Kafka idempotent producer, Transactional Outbox) all have names, standard reference documentation, and are learnable by anyone — **these are kept, untouched**.
- But the *meta* layer laid on top (a mandatory field classifying 8 values + a formalised priority algorithm + a static regex-scanning test) is **not a named pattern, and no standard documentation describing this approach could be found** — it was synthesised here, not something real senior engineers do in day-to-day code review. A real senior handles an ambiguous case with a one-line comment in place, rather than casting it into a mandatory field + a 5-step algorithm applied to all 37 commands regardless of risk level.
- Forcing uniform ceremony onto **every** command (including `logout` and `create-invite` — low risk) contradicts how real seniors allocate rigour: only where risk is high (money, sagas) does it earn its cost.

**The decision — delete it outright, keeping no reduced version:** *"for things senior engineers don't do, delete them rather than inventing more"* (verbatim). The prose comments explaining why each command is safe (which already sat next to the old `safety` field) were **kept exactly as they were** on each command — that is the way a real senior records the decision: one comment in place, not a systematised type.

**In the same audit, 2 genuine deviations were found (pre-existing, not caused by this session) — both fixed:**
1. `IdempotencyInterceptor` lacked a request fingerprint (the real Stripe standard requires it: reusing a key with a different body must be rejected, never silently replaying the old cached response). Added a `requestHash` column (`sha256(method+url+body)`) to `IdempotencyRecord`, compared before replaying — a mismatch → `422`.
2. Comments in `kafka-producer.service.ts` and both `dead-letter.producer.ts` files asserted that `idempotent:true` automatically sets `maxInFlightRequests≤5` — verified directly in `node_modules/kafkajs/src`: **false**, the default is `null` (unlimited), and nowhere in the code ever set it. Explicitly set `maxInFlightRequests: 5` in all 3 producers (Kafka's recommended threshold for an idempotent producer to preserve ordering on retry).

**The lesson to keep:** before treating a mechanism as "best practice", ask *"does this have a name and standard reference documentation others also learn from, or am I synthesising it?"* — if the latter, stop and ask before type-ifying/enforcing it across the whole codebase.

### Rules (the idempotency-key interceptor — the remainder, still valid)
- ⛔ Do NOT register `IdempotencyInterceptor` globally via `APP_INTERCEPTOR` — apply it per-route with `@UseInterceptors()`, and only for mutations with genuinely expensive side effects (see the decision table in 1.0)
- ⛔ Do NOT apply it to GET
- The interceptor blocks races between two requests with the **same key** by itself (claim-before-execute) — you must still consider a business layer (OCC/unique constraint) for a race between two legitimate requests with **different keys** (1.3)
- Reusing a key with a different request (`requestHash` mismatch) → `422`, never a silent replay of the old response (the Stripe standard, added 2026-07-14)
- A protected handler must return a body — not `void`
- A 24h TTL is standard, and can be lowered to 1h for less important endpoints
- The cleanup cron (`IdempotencyCleanupService`, `@Cron('0 3 * * *')`) runs exactly once via `HttpIdempotencyModule` — don't register it again in another module

---

## 2. Transactional Outbox

### The problem
```
1. Save the domain object to the DB ✅
2. Publish the event to Kafka ❌ (server crashes)
→ the DB has the data but Kafka has no event → inconsistency
```

### The solution
Instead of publishing straight to Kafka, INSERT into an `outbox_events` table **in the same transaction** as the domain write. A polling service reads the outbox and publishes to Kafka.

### Schema (already exists)
```prisma
model OutboxEvent {
  id            String       @id @default(uuid())
  aggregateType String       // "KnowledgeItem" | "CreditAccount"
  aggregateId   String
  eventType     String       // "DocumentPublished" | "CreditSpent"
  payload       Json
  status        OutboxStatus @default(PENDING)
  createdAt     DateTime     @default(now())
  processedAt   DateTime?
  @@index([status, createdAt])  // the polling query uses this index
}
enum OutboxStatus { PENDING  PROCESSED  FAILED_DLQ }
```

### Implementation — writing the outbox in the same transaction
```typescript
// In the command handler, using TransactionManager
async execute(command: PublishDocumentCommand): Promise<void> {
  await this.transactionManager.run(async () => {
    // 1. Domain write
    const item = await this.knowledgeRepo.findById(command.itemId)
    item.publish()
    await this.knowledgeRepo.save(item)

    // 2. Outbox write — the SAME transaction, never split apart
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: 'KnowledgeItem',
        aggregateId: item.id,
        eventType: 'DocumentPublished',
        payload: { itemId: item.id, orgId: item.orgId, spaceId: item.spaceId },
      },
    })
    // If the transaction fails → both roll back → no inconsistency
  })
}
```

### Polling Publisher (Phase 2 — once Kafka exists)
```typescript
// infrastructure/outbox/outbox-publisher.service.ts
@Injectable()
export class OutboxPublisherService {
  // Runs every second, picks up PENDING rows and publishes them to Kafka
  @Interval(1000)
  async poll(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    for (const event of events) {
      try {
        await this.kafka.publish(event.eventType, event.payload)
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        })
      } catch {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'FAILED_DLQ' },
        })
      }
    }
  }
}
```

### Rules
- ⛔ Do NOT publish to Kafka directly in a handler — always via the outbox
- ⛔ The domain write and the outbox write must be in the same transaction
- PENDING → PROCESSED or FAILED_DLQ; never delete the row (audit trail)

---

## 3. Retry

> **[ADR-0001, 2026-07-29] SUPERSEDED — `RetryMiddleware`/`TransactionMiddleware`/`commandBus.use()`
> no longer exist.** Everything below in §3 describes the OLD architecture — kept as-is as a
> historical marker in the decision chain (not silently edited, following the same convention as
> `docs/adr/README.md`), but it does NOT describe the current code. The current architecture: retry
> and transaction live in ONE fixed method body of `CommandBus` (`withRetry` wrapping
> `runTransactional`), and the transaction is a `TxScope` Unit-of-Work inferred from the handler's
> signature rather than from a `command.options?.transactional` flag. **Two decisions argued
> carefully here are STILL CORRECT and were ported verbatim into the new code:** (1) retry only
> `P2034`, excluding `P2028` to avoid a retry storm when the pool is exhausted
> (`isPrismaTransientError`, now in `packages/shared-kernel/src/resilience/prisma-transient-error.ts`,
> shared across all 3 services instead of copy-pasted); (2) full-jitter backoff.
> See `docs/adr/0001-transaction-retry-boundary.md`.

### Already in place — RetryMiddleware in the CQRS pipeline (HISTORICAL — see the SUPERSEDED note above)
```typescript
// shared-kernel/src/cqrs/middleware/retry.middleware.ts
// Automatically retries when isPrismaTransientError() returns true
// (connection reset, deadlock, pool timeout)
this.commandBus.use(this.loggingMiddleware, this.retryMiddleware, this.transactionMiddleware)
```

### When manual retry is needed (outside CQRS)
Calling an external HTTP service (the Claude API, Elasticsearch):
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      // Exponential backoff: 500ms, 1000ms, 2000ms
      await new Promise(r => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)))
    }
  }
  throw new Error('unreachable')
}

// Usage
const result = await withRetry(() => this.claudeClient.complete(prompt))
```

### ⚠️ Self-critique (2026-07-14) — P2028 removed from the transient set, plus an observation metric

The user asked exactly 3 questions that forced a re-audit of `isPrismaTransientError`, rather than trusting the old comment ("connection reset, deadlock, pool timeout" — one lumped-together phrase, and wrong in places):

1. **"So network errors can't be reported back to the frontend?"** — First, clarify the scope: `RetryMiddleware` only retries 2 Prisma codes (`P2034`, `P2028`) — **internal DB errors, not outbound call errors** (gRPC/HTTP go through the Circuit Breaker, and do report real errors back to the client, not through this middleware). The premise doesn't apply to the network part — but the question is still valid for the DB part, and it led to finding #2.
2. **"Is it heavy on the system?"** — Yes, and this was a genuine design bug: `P2034` (deadlock) is safe to retry (Postgres aborts the losing transaction itself, usually resolving in milliseconds — exactly as the Prisma docs recommend). But `P2028` (a transaction/connection API error) **can be a sign of pool exhaustion** — auto-retrying it means asking **the very pool that is exhausted** for another connection: no recovery benefit, and it piles on load exactly when the system needs to shed it (the retry-storm antipattern). These two codes had previously been lumped into one policy — wrong.
3. **"Few commands use it — is it worth anything?"** — Only 6 of 37 commands had `retryable: true` (5 in auth-service: login/register/refresh/provision-user/cancel-provisioned-user — the high-frequency identity path; 1 in core-api: `update-role-permissions`). That distribution is reasonable (high-frequency OLTP is what makes deadlock retries worthwhile), but it also means core-api gains almost nothing from this middleware despite registering it globally — acceptable, since the registration cost is near zero (one `if (!retryable) return next()` branch).

**Fixed — `isPrismaTransientError` now matches only `P2034`:**
```typescript
export function isPrismaTransientError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034'
  }
  return false
}
```
`P2028` now fails fast, returning a real error to the client instead of blindly retrying server-side. The trade-off: losing self-recovery for some genuinely transient short connection blips (not pool exhaustion) — acceptable, prioritising not making the system heavier while the DB is under stress.

**Added an observation metric** so this decision can rest on real data rather than perpetual guessing: `RetryMiddleware` gained a final `onError?: (error, willRetry) => void` param — **deliberately kept ORM-agnostic** (it receives only the raw error + a pre-computed boolean), with the Prisma-aware part living at the composition root (`recordDbTransientErrorObservation`, sitting next to `isPrismaTransientError`). The counter `{service}_db_transient_error_total{code, retried}` observes **both P2028 and P2034**, including P2028 even though it is no longer retried, so that "was excluding P2028 correct?" can be answered by real frequency rather than a one-time guess.

### ⚠️ Pivot (2026-07-14) — dropped the `retryable` field; P2034 is now retried automatically for EVERY transactional command

Immediately after the P2028 finding above, auditing the follow-up question "is this middleware worth keeping, so few commands use it" exposed a deeper problem: grepping `transactional: true` across all 3 services found **18 commands**, but only **6** had `retryable: true`. **The other 12 transactional commands — `create-org`, `spend-credits`, `grant-credits`, `refund-credits`, `publish-knowledge`, `update-knowledge`, `follow-target`, `unfollow-target`, `accept-invite`, `accept-answer`, `delete-role`, `update-profile` — failed outright on a deadlock (P2034) with no retry at all**, even though each was verified to satisfy the safety conditions (every side effect inside the transaction, no external call mid-handler).

This was not a deliberate protect-only-the-high-risk choice — it was a **historical asymmetry**: the first 6 commands (auth-service's login/register path) were flagged early, and nobody went back for the rest. `retryable` was an opt-in flag restating exactly the condition `transactional: true` already guarantees (side effects roll back cleanly) — splitting it into its own field only created somewhere to forget, adding nothing.

**Fixed — the `retryable` field was removed from `CommandOptions` entirely.** `RetryMiddleware` now gates on `command.options?.transactional` directly — **every `transactional: true` command is automatically retried on P2034**, with no separate opt-in:
```typescript
// shared-kernel/src/cqrs/middleware/retry.middleware.ts
async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
  if (!command.options?.transactional) {
    return next()
  }
  // ... the retry loop as before, unchanged backoff/jitter/onError
}
```
The result: protection rose from 6 → 18 commands, with no command changed beyond deleting the field. A command that must be **excluded** from retry despite being transactional (e.g. one making an external call mid-handler) must instead be `transactional: false` + an explicit compensating saga — see `ProvisionOrgCommand` as the model, with an in-place comment explaining why.

> **Update (later the same day):** `CommandSafetyMiddleware` (mentioned in the paragraph below) was **deleted entirely** later that same day — not just losing one invariant; the whole middleware no longer exists (see §1.4). The reason: it was part of the "invented here" layer removed once a re-audit found it didn't match real senior practice. The paragraph below is kept unchanged as a historical marker in the decision chain; it does not describe the current code.

**The consequence for `CommandSafetyMiddleware` (HISTORICAL — this middleware has been deleted, see the update immediately above):** the `retryable ⟹ transactional` invariant (added in §1.4 the previous day) was removed along with it — not "no longer enforced", but **no longer having a field to contradict** (structurally impossible, stronger than any runtime check). Only the `concurrency:'occ' ⟹ transactional` invariant remains, entirely independent of the retry decision, and still valuable.

**The safety condition for retry** (unchanged, now applying to all 18 rather than 6): it is only safe when every side effect is inside the transaction that rolls back. Never retry a command that publishes to Kafka / makes a direct external call mid-handler — which is why the Outbox (§2) is a prerequisite for being retry-safe once events are involved.

### Rules
- Retry only **transient errors** (timeout, 503, connection reset)
- Do NOT retry **4xx errors** (validation, auth, not found) — retrying those is meaningless
- Max 3 attempts, exponential backoff
- Always put a Circuit Breaker outside Retry (see `rag_ai_integration.md`)
- ⛔ Only retry errors with evidence of resolving quickly AND not accumulating load while the system is stressed (P2034 qualifies, P2028 doesn't — see "Self-critique" above). Adding a new error code to the transient set → ask "does retrying this while the system is already weak make it weaker?" before adding it
- ⛔ Do NOT add a separate `retryable`/opt-in field for retry — `transactional: true` IS already the necessary and sufficient condition for retry safety; a command that must NOT be retried despite being transactional is a sign it shouldn't be `transactional: true` (split it into a saga, see `ProvisionOrgCommand`), not a reason to add a new field

### Update (2026-06-22)
- **Jitter**: `RetryMiddleware` uses *full jitter* — `delay = random(0, min(maxDelayMs, base·2^(n-1)))` instead of fixed backoff, so deadlock victims (P2034) don't retry in phase and collide again. The manual `withRetry` helper above is an illustrative example with **no real call site in the code yet** — if it is ever used for a real external call, apply jitter the same way.
- **Extension seam**: the middleware does NOT know "which errors are transient" — it receives the `isPrismaTransientError` predicate injected at the composition root (`cqrs.module.ts`). Adding a new retryable error type → compose the predicate there, do NOT edit the middleware (keeping it ORM-agnostic).

### ⚠️ Correction (2026-07-12) — OCC is NOT auto-retried by this middleware, contrary to what an older version of this section said

**[PARTIALLY SUPERSEDED by the 2026-07-14 pivot above]** — the text below describes the `retryable` field (which existed at the time) and which has since been **removed entirely** — every `transactional: true` command now retries P2034 automatically, with no per-command opt-in. It is kept verbatim because the reasoning about OCC conflicts (P2002) not being treated as transient by `isPrismaTransientError` (which only matches P2034) **remains correct and unchanged** — `SpendCreditsCommand`/`GrantCreditsCommand` now DO get automatic retry (being `transactional: true`), but that retry only matches P2034 (deadlock), NOT P2002 (an OCC conflict) — a 409 `CREDIT_CONCURRENCY_CONFLICT` still goes straight back to the client as described below, with nothing changed in this part.

The previous version recorded "a GAP to close when doing OCC" as though auto-retrying OCC conflicts was something to be done through `RetryMiddleware`. Re-auditing the real code (the `retryable` option on **every** `*.command.ts` in core-api) showed **the real decision was quite different**, and was not a gap but a deliberate choice:

- `RetryMiddleware.execute()` (`shared-kernel`) checks `command.options?.retryable` **first** — if false it `return next()`s immediately, never entering the retry loop, regardless of whether the `isPrismaTransientError` predicate would match.
- Grepping every `retryable` in `apps/core-api/src/modules/**/*.command.ts` (2026-07-12): **exactly 1 command** has `retryable: true` (`UpdateRolePermissionsCommand` — an idempotent overwrite with no external side effect, absolutely safe to repeat). **All 23 remaining commands** — including `SpendCreditsCommand`/`GrantCreditsCommand` (the 2 with real OCC) and `ProvisionOrgCommand` (which makes an outbound gRPC call) — are `retryable: false`.
- The consequence: when an OCC conflict genuinely occurs in `spend-credits` (smoke-tested: 12 concurrent requests → 9 ok + 3 `CREDIT_CONCURRENCY_CONFLICT`), **`RetryMiddleware` does not retry** — the error goes straight to the client as a 409, and the client decides whether to call again (not automatically and silently). This is SAFER than blind auto-retry (especially true for `ProvisionOrgCommand`, where the comment in `provision-org.command.ts` states: *"retrying blindly would double-provision the owner"*).
- **`RetryMiddleware` is still registered globally** on the `CommandBus` (every command passes through it), but because the `retryable` gate blocks at the top, it **only actually retries 1 of 24 commands**. Not dead code (it runs, and does work for that one command), but its scope is far narrower than "registered globally" suggests — reading any single command isn't enough to know whether this middleware applies; you must check the `options.retryable` field on that command.

**The rule when adding a new command**: default to `retryable: false`. Only set `true` when certain that (a) every side effect is inside one transaction that rolls back cleanly on retry, AND (b) no external call (Kafka publish, gRPC, HTTP) runs mid-handler without being naturally idempotent. Neither an OCC conflict (P2025) nor an external side effect (gRPC) satisfies this in the current design — a client-visible error plus a retry decided by the caller is the right choice for both.
- **The safety condition for retry**: it is only safe when every side effect is inside the transaction that rolls back. Never retry a command that publishes to Kafka / makes a direct external call mid-handler — which is why the Outbox (§2) is a prerequisite for being retry-safe once events are involved.

### 3.1 Circuit Breaker — extended beyond AI (2026-07-12)

`CircuitBreaker` is **no longer** a search-service-private class (it used to live at `search-service/infrastructure/ai/circuit-breaker.ts`, tied to AI). It moved into **`@distributed-social-platform/shared-kernel`** (`src/resilience/circuit-breaker.ts`) for a reason quite unlike `OrgAwareThrottlerGuard` (§4.1.1) — this is a **pure, framework-independent algorithm** (its constructor only needs `ILogger`, an interface already in `shared-kernel/logger`), and it now has **two real consumers in two independent services** (search-service: AI/ES/Ollama; core-api: gRPC) — unlike `ThrottlerGuard`, which only NestJS needs and which each NestJS service uses locally.

**Audit gap (2026-07-11, before doing this item):** only the Claude/Gemini summarisers had a breaker. Three other external calls on the hot path had neither a timeout nor a breaker:

| Call | Location | The problem before the patch |
|---|---|---|
| Ollama embedding | `search-service` `HttpEmbeddingService.embedSlice()` | `fetch()` with no time limit (if Ollama hangs, the request hangs forever); no breaker; **and** `SearchKnowledgeService.search()` didn't `catch` embedding errors — one failing dependency killed the whole search (asymmetric with the ES branch, which already had `.catch(() => [])`) |
| Elasticsearch search | `search-service` `ElasticsearchKeywordRepository.search()` | The client's default `requestTimeout` is 30s — far too long for a hot path; no breaker |
| gRPC provisioning | `core-api` `AuthProvisioningClient` | Had a `deadline` (5s) bounding one call, but NO breaker — a real auth-service outage still meant every provision attempt waited the full 5s before failing, with no fail-fast |

**All 3 patched** (timeout + breaker, following the same discipline as Claude/Gemini — the breaker syntax below uses the SRP caller class, see §3.1.2; the first patch used a manual `new CircuitBreaker()` in the constructor, then tried a `@CircuitBreak` decorator, and finally settled on the SRP caller class after discussing discoverability):
```typescript
// Ollama — timeout via AbortSignal (Node 18+ native, no polyfill needed) + breaker via OllamaEmbeddingCaller
private async embedSlice(texts: string[]) {
  const res = await this.caller.call(() =>
    fetch(url, { ..., signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  )
  ...
}

// Elasticsearch — requestTimeout at the Client layer (applying to every call through this client) + breaker via ElasticsearchSearchCaller
new Client({ ..., requestTimeout: REQUEST_TIMEOUT_MS })
async search(orgId: string, query: string, limit: number) {
  return this.caller.call(async () => { ... })
}

// gRPC — the deadline already existed, breaker via AuthProvisioningGrpcCaller
async provisionUser(email: string) {
  return this.caller.call(() => new Promise(...))
}
```

**What the 2026-07-11 audit missed — "Claude/Gemini already have a breaker" does NOT mean they have a timeout (2026-08-04, found by the user auditing further after the `fetch()`/breaker bug above):**

| Call | The problem |
|---|---|
| `GeminiSummarizer` (raw `fetch()`) | **No timeout at all** — not even the `AbortSignal.timeout` Ollama already had. If Gemini hangs, the request hangs until Node/undici's default limit, far longer than any other call in the system |
| `ClaudeSummarizer` (`new Anthropic({...})`) | Using the SDK defaults: `timeout` 10 minutes, `maxRetries` 2 — the SDK silently retries INSIDE a single `caller.call()`, both stretching hot-path latency far beyond every other call (3-5s) and hiding real failures from the breaker's failure count (one failure the breaker sees = up to 3 real failed requests) |

Why it was missed: the 2026-07-11 audit only listed "has a breaker or not", without going on to check "is a single call's latency bounded" for the two that already had breakers — two independent rules (breaker + timeout); having one does not automatically give you the other, the same lesson as the business-outcome/layering split below.

**Both patched**, sharing `REQUEST_TIMEOUT_MS = 5000` (matching the value already used by Ollama/ES):
```typescript
// Gemini — add a signal to fetch(), exactly like Ollama
fetch(url, { ..., signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

// Claude — override both SDK defaults
new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 })
// maxRetries: 0 because ClaudeApiCaller/CircuitBreaker is already the system's
// retry/circuit-break layer — the SDK retrying too is two overlapping mechanisms
// with different semantics (same reason we do NOT wrap a breaker around
// indexItem(), which already has retry→DLQ at another layer)
```

**⚠️ An unexpected error class (business outcome ≠ fault) — separate it before it reaches the breaker:** both ES (404 = "this org hasn't been indexed", normal) and gRPC (`ALREADY_EXISTS` = the email already exists, normal) have an error branch that is NOT an infrastructure fault. If that branch `throw`s/`reject`s **inside** `breaker.execute()`, the breaker counts it as a real failure — burning through `threshold` on legitimate traffic alone (many users trying to create an org with a duplicate email → the breaker trips even though auth-service is perfectly healthy). The correct handling — catch that "normal" error and `return`/`resolve` a value (never `throw`) from inside the wrapped function, then map it back into a business exception **after** `breaker.execute()` returns (see `AuthProvisioningClient.provisionUser` — resolving a tagged `{ alreadyExists: true }`, unwrapped after the breaker). This mistake was nearly made while writing `provisionUser` — the first version had `reject(new OwnerEmailAlreadyExistsError())` right inside the executor wrapped by the breaker; caught and fixed before committing.

> **2026-08-04 — one remaining layering error fixed after that audit, found by user review:** despite correctly separating `ALREADY_EXISTS` from the breaker, `provisionUser` STILL threw `new OwnerEmailAlreadyExistsError()` inside `AuthProvisioningClient` (an infra/gRPC adapter) before returning to the handler — an `ApplicationError` thrown from the infra layer, INCONSISTENT with how every other `*AlreadyExists*Error`/`*AlreadyTaken*Error` in the repo is thrown (`CreateOrgHandler`/`AcceptInviteHandler`: infra only returns `existing` — raw data — and the handler at the APPLICATION layer does `if (existing) throw ...`). Fixed: `provisionUser` now returns a tagged union (`ProvisionedOwner | OwnerEmailAlreadyExists`, no throw), and `ProvisionOrgHandler.execute()` does `if ('alreadyExists' in provisioned) throw new OwnerEmailAlreadyExistsError()` — the right layer, the same place as the other two handlers. The lesson: "a business outcome must not trip the breaker" and "an adapter must not decide application errors" are two separate rules — fixing the first doesn't automatically fix the second, and it's easy to think you're done when you're only halfway.

**One real bug fixed alongside the audit — asymmetric graceful degradation:** `SearchKnowledgeService.search()` runs semantic (embedding + pgvector) and keyword (Elasticsearch) in parallel; the keyword branch already had `.catch(() => [])` but the semantic branch did NOT — an embedding failure (now failing *faster* thanks to the breaker/timeout, but still a failure) used to kill the entire query. Wrapped `embedBatch()` + `chunkRepo.semanticSearch()` into a private `semanticSearch()` method with its own `.catch()` — both branches are now symmetric, and search only comes back genuinely empty when **both** dependencies are down.

**Deliberately NOT wrapping a breaker around `ElasticsearchKeywordRepository.indexItem()`** (only `search()`): indexing runs inside a Kafka consumer and is already safely retry→DLQ at the message layer (`eventing_patterns.md` §4) — adding a breaker here would stack two safety mechanisms with different semantics, adding no real protection and only complexity.

### 3.1.1 Two further upgrades after re-auditing `CircuitBreaker` itself (2026-07-12, same day)

**A. A HALF-OPEN race condition — several concurrent callers each considering themselves the probe.** The first version only checked `if (this.state === 'open')` on entering `execute()`. If N requests arrive exactly as `timeoutMs` expires, the first changes state to `half-open` **before** `await fn()` — but since that is the first `await` point, the other N-1 requests (which already called `execute()` in the same synchronous tick) carry on with the state already `half-open`, no longer matching `=== 'open'` → **they all get through**, all calling the real `fn()` — dumping a whole burst of requests onto a dependency that has only just (weakly) recovered, potentially knocking it over again, defeating the circuit breaker's entire purpose.

The fix uses `state === 'half-open'` itself as the mutex (with no extra `probing` field — an added `probing: boolean` field was tried first and found still wrong, because the `state==='open'` check doesn't catch those other N-1 requests, so the field was dropped and the logic merged into one `if (this.state === 'half-open') throw` placed BEFORE the `state === 'open'` check):
```typescript
async execute<T>(fn: () => Promise<T>): Promise<T> {
  if (this.state === 'half-open') throw new Error('Circuit open') // a probe is already running
  if (this.state === 'open') {
    if (Date.now() - this.lastFailureTime <= this.timeoutMs) throw new Error('Circuit open')
    this.setState('half-open') // claim the probe slot — synchronously, before the first await
  }
  // ...await fn()...
}
```
This is safe because the whole check-and-change-state block runs **synchronously** (with no `await` in between) — in Node (single-threaded, event loop), a synchronous block can never be interleaved with another call, so no real lock/atomic is needed.

The test for this case (`circuit-breaker.spec.ts`): one slow probe (not yet resolved) + 3 concurrent callers → assert that **only 1** of the 4 actually calls `fn()`, with the other 3 failing fast with `'Circuit open'`.

**B. Not externally observable — added Prometheus metrics.** Previously it only logged via pino (`warn`/`error`) — finding out which breaker was `open` meant reading logs by hand, with no possibility of alerting. Added 2 module-level metrics (following the `search.metrics.ts`/`notification.metrics.ts` convention — a Counter/Gauge singleton, surfacing automatically via the existing `GET /metrics`), labelled by `name` to distinguish breakers (each consumer passes its own name at `new CircuitBreaker(name, logger, ...)` — a NEW, mandatory, leading parameter):

```typescript
const stateGauge = new Gauge({
  name: 'circuit_breaker_state', // 0=closed, 1=half-open, 2=open
  labelNames: ['name'],
})
const transitionsCounter = new Counter({
  name: 'circuit_breaker_transitions_total',
  labelNames: ['name', 'state'],
})
```

The 5 current consumers each have their own label: `claude-summarizer`, `gemini-summarizer`, `ollama-embedding`, `elasticsearch-search`, `auth-provisioning-grpc`. `circuit_breaker_state{name="ollama-embedding"} 2` → you immediately know which breaker is open, without reading logs.

### 3.1.2 The SRP caller class — replacing `new CircuitBreaker()` scattered through adapters (2026-07-12)

**A problem found through discussion, not a bug:** `new CircuitBreaker(...)` sat in the adapter's constructor (`AuthProvisioningClient`, `ClaudeSummarizer`, …) — looking at `ProvisionOrgHandler` or the controller calling it, there was **no way to tell** whether a breaker existed; you had to dig all the way down into the adapter. Compare with the Kafka consumer: `KnowledgeIndexerConsumer` (`.../consumers/knowledge-indexer.consumer.ts`) wraps `ResilientEventConsumer` and is very obvious about it — but digging in, `ResilientEventConsumer` is also merely `new`ed in the **constructor body**, exactly like the old Circuit Breaker mechanism, **not via dependency injection**. What actually made it "visible" were two other things: **(a)** the whole `KnowledgeIndexerConsumer` file does exactly one thing (wrapping the resilient consumer), with nothing else competing for attention, and **(b)** the class name describes itself (`Resilient...`, `...Indexer...`). This is the main lesson: **visibility doesn't come from DI, it comes from "one file/class doing exactly one thing + a self-describing name".**

**A `@CircuitBreak` decorator was tried first, and dropped:** it worked correctly (it built, tests were green), but it required `experimentalDecorators`/`emitDecoratorMetadata` newly enabled for `shared-kernel` (never needed before), fought TypeScript over generic variance (`TypedPropertyDescriptor<T>`) and private-field nominal typing (`this.logger`) — real friction, and it **only applies to OOP/class-style code** (it can't attach to plain Fastify — a decorator can only bind to a class method, and `auth-service` is written in a functional style with no class to attach to).

**The settled solution — an SRP caller class, following the formula already proven by `ResilientEventConsumer`:** extract "calling the external service through a breaker" into **its own small class doing exactly one thing, named after the dependency it protects** — then inject it into the business class as an ordinary dependency.

```typescript
// claude-api.caller.ts — does ONE thing, with nothing else in the file
@Injectable()
export class ClaudeApiCaller {
  private readonly breaker: CircuitBreaker
  constructor(@InjectPinoLogger(ClaudeApiCaller.name) logger: PinoLogger) {
    this.breaker = new CircuitBreaker('claude-summarizer', logger)
  }
  call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(fn)
  }
}

// claude-summarizer.ts — keeps its business logic (building the prompt, parsing the response), injects the caller
constructor(config: ConfigService, private readonly caller: ClaudeApiCaller) {}
async summarize(query, context) {
  const response = await this.caller.call(() => this.client.messages.create({ ... }))
  ...
}
```

Five caller classes for five external calls: `ClaudeApiCaller`, `GeminiApiCaller`, `OllamaEmbeddingCaller`, `ElasticsearchSearchCaller` (search-service), `AuthProvisioningGrpcCaller` (core-api). `AuthProvisioningClient.provisionUser`/`cancelProvisionedUser` inject the same `AuthProvisioningGrpcCaller` instance → sharing exactly one breaker, identical to the previous behaviour.

**Three benefits, in the priority order that mattered at design time:**
1. **Visible at the point of use, following the Consumer formula** — `grep -rl "CircuitBreaker(" apps/*/src/**/*.caller.ts` (or simply `ls *.caller.ts`) lists every dependency with a breaker; one file per dependency, with the filename stating its reason to exist.
2. **Zero TS decorator friction** — no `experimentalDecorators`, no fighting generic variance/private-field typing. It works for both a functional style (Fastify) and OOP (NestJS) — only the "shell" changes (class method vs closure), while the `CircuitBreaker` core stays in one place.
3. **Correct Clean Architecture / Hexagonal** — the caller class is a genuine adapter, injected into the business class like any other dependency (a repository, another service) — not a bare `const` floating outside the composition root.

**An acceptable trade-off:** more files (+5, each very small and nearly boilerplate — deliberately, traded for clarity, not genuine duplication needing DRYing) compared with the decorator (0 extra files) or a manual `new CircuitBreaker()` (0 extra files but completely hidden).

**The decision to "change approach after already building and testing the decorator" was deliberate, not wasted effort:** during the build/development phase (unlike a real running production system), a better design takes priority over "the tests are green so leave it alone to save rework" — see also the agreed working principles applied across this whole curriculum.

**⚠️ The opposite error, found 2026-08-04 (the user auditing every `*.caller.ts`) — `fetch()` doesn't reject on an error HTTP status, so the breaker can't see it:** `GeminiSummarizer`/`HttpEmbeddingService` (Ollama) passed `() => fetch(url, opts)` straight into `caller.call()`, and then checked `if (!res.ok) throw` **OUTSIDE**, after `caller.call()` had already returned. `fetch()` only rejects on a genuine network error (DNS/connection/abort) — a 4xx/5xx still resolves normally with `res.ok = false`. The result: the breaker saw a resolved promise → counted it as `onSuccess()`, resetting `failureCount = 0` — so even if Gemini/Ollama returned 500 for EVERY consecutive request, the breaker would **never open**. This is the INVERSE of the `ALREADY_EXISTS` case (2026-07-11: a normal outcome wrongly counted as an error) — here a REAL error wasn't counted as one. Compare with `ElasticsearchKeywordRepository.search()`/`ClaudeSummarizer`, which do it correctly: both use an SDK/client that `throw`s on non-2xx (the ES client, the Anthropic SDK), with the whole try/catch INSIDE the closure passed to `caller.call()`. Fix: move `if (!res.ok) throw` inside the closure (`caller.call(async () => { const r = await fetch(...); if (!r.ok) throw ...; return r })`). Extra tests in both specs: grab `wrappedFn = mockCaller.call.mock.calls[0][0]` directly and assert `wrappedFn()` itself rejects — asserting only that `summarize()`/`embed()` rejects at the outer layer is NOT enough to catch this bug, because a throw outside `caller.call()` makes the outer function reject identically, masking the fact that the breaker was bypassed.

### Rules (Circuit Breaker)
- Every external call needing protection → its own SRP caller class (`XCaller`), named after the exact dependency, containing only a `CircuitBreaker` + a `call<T>(fn) => Promise<T>` method — no business logic in the caller class
- Inject the caller class into the business class via the constructor (NestJS DI, or a manual composition root as in `auth-service`) — do NOT declare a bare module-scope `const` with a logger "from somewhere"
- Two methods protecting the same dependency (like `provisionUser`/`cancelProvisionedUser`) → inject the SAME caller instance, sharing the breaker — deliberate, not a mistake
- Wrap **synchronous/hot-path calls** (where a user is waiting for the response) — do not wrap calls already made safe by another mechanism (Kafka retry→DLQ, background jobs)
- Ordinary business errors (a 404 index-not-found, `ALREADY_EXISTS`, …) must be caught and returned **inside** the function passed to `caller.call(fn)`, never allowed to escape as a failure — otherwise the breaker trips on legitimate traffic
- If using raw `fetch()` (rather than an SDK/client that throws on non-2xx) — the `res.ok` check and the `throw` MUST be **inside** the closure passed to `caller.call(fn)`, not after it returns — otherwise the breaker never sees real HTTP-status errors, only network errors
- The default threshold/timeout (5 consecutive failures / 60s) is adequate for every current consumer — change it only for a specific, measured reason, never a guess

---

## 4. Rate Limiting & Throttle

### 4.1 HTTP rate limiting — per-route + per-org

**There are 2 axes to distinguish, not 1:**

| Axis | Mechanism | Status |
|---|---|---|
| **Per-route** — sensitive routes (login, creating an org, spending credits) need a tighter limit than ordinary CRUD | `@Throttle({ default: { ttl, limit } })` per method, overriding `ThrottlerModule.forRoot()`'s default | Already in place — see `org.controller.ts`, `knowledge.controller.ts`, `credit.controller.ts`, `engagement.controller.ts`, `platform-admin.controller.ts` |
| **Per-org** — requests from org A must not consume org B's quota | The tracking key (bucket) must be `orgId`, not the IP | ⛔ Missing — `ThrottlerGuard` tracks by IP by default, so every org behind a shared corporate NAT/proxy shares one bucket, and conversely one org can't be isolated from another's traffic |

**The per-org fix: `OrgAwareThrottlerGuard`** (`infrastructure/http/guards/org-aware-throttler.guard.ts`) — overriding `getTracker()`:
```typescript
protected async getTracker(req: FastifyRequest): Promise<string> {
  const orgId = req.headers['x-org-id']
  if (typeof orgId === 'string' && orgId.length > 0) return `org:${orgId}:ip:${req.ip}`
  return `ip:${req.ip}`  // routes without an org yet (login/register) → fall back to IP as before
}
```
Registered in place of `ThrottlerGuard` at `APP_GUARD` in `app.module.ts`.

**On the mechanism:** `getTracker()` is **not** the function deciding pass/fail (that's `canActivate()`, which we do not override). It is only a hook that the inherited `canActivate()` (unchanged) calls to obtain a `tracker: string`; `generateKey(context, tracker, throttlerName)` then appends `ClassName-MethodName` to the key and hashes it — meaning **per-route and per-org combine automatically**, with no need to splice the route into the tracker yourself. `handleRequest()` is where the counter is actually incremented in storage and compared against `limit` to decide on a 429. Two requests producing the same `getTracker()` string → the same key → sharing one quota bucket.

**⚠️ Why reading the raw `X-Org-Id` (before membership has been authenticated) is still correct:** `ThrottlerGuard` is an `APP_GUARD` — it runs **before** every controller-level guard (`JwtAuthGuard`, `OrgGuard`), so `request.user`/`request.org` (set after authentication) don't exist yet at this point. That is a real constraint of Nest's guard ordering (a global guard always runs before route-level guards), not an oversight. It is acceptable because the purpose of rate limiting is **fairness/abuse prevention**, not authorization — a request with a forged `X-Org-Id` header is still blocked by the later layer (the membership check, or the domain logic itself); the worst consequence of tracking on an unauthenticated header is a wrong bucket, not a data leak. Several routes read this same header raw to obtain `orgId` for queries (search-service/notification-service have no `OrgGuard` and read `@Headers('x-org-id')` directly) — the same trust boundary already present in the codebase, not a new one.

**⚠️ A real risk found and patched (2026-07-11) — griefing a specific tenant with a forged header:** because `ThrottlerGuard` runs before `JwtAuthGuard`, a request **without a valid token** still consumes quota. An anonymous attacker sending a flood of requests with `X-Org-Id: <victim-org>` to any route could deliberately burn that org's quota even though the requests are subsequently 401'd — real users of that org get an unfair 429. This isn't a theoretical risk, because before `OrgAwareThrottlerGuard` existed a similar attack couldn't target one specific org (only an IP). **Patched by adding the IP to the tracker: `org:{orgId}:ip:{ip}`** instead of just `org:{orgId}`. Not an absolute block (an attacker can still rotate IPs) but it raises the attack cost considerably — each IP can only burn its own bucket, rather than accumulating against one shared bucket for the whole org.

**Deliberately NOT done yet — configurable per-org limits** (different requests-per-minute per org, a tier/pricing model): every org currently shares the same numeric threshold (per-route), differing only in *bucket* (isolated from each other), not in the *number*. Adding a configurable per-org limit column is its own feature (reading from the DB on every request, or caching) — there is no real need yet (no differentiated tier/pricing), so YAGNI until there is. **Don't repeat the `aiRateLimitPerMin` lesson** (deleted 2026-07-12 — the field existed for months but nothing anywhere enforced it) — if it is built, the DB field and the enforcing code must land together, never a field added "for the future" first.

**The fallback for horizontal scaling (several instances of one service):** `ThrottlerStorageService` is in-memory by default — correct for one process. With more than one replica, buckets aren't shared between instances → the effective limit is multiplied by the replica count. At that point, switch to `ThrottlerStorageRedisService` (which needs Redis, **not currently deployed** in this project — see `docker-compose.yml`). Tripwire: revisit when any service genuinely runs more than 1 instance (a K8s replica count > 1, or PM2 cluster mode).

#### 4.1.1 Project-wide audit (2026-07-11) — which services are compliant, and which the pattern doesn't apply to

Rate limiting is not one shared mechanism — each service has a different transport/trust model, and applying it mechanically everywhere would be wrong:

| Service | Mechanism | Per-route | Per-org | Status |
|---|---|---|---|---|
| `auth-service` | Plain Fastify + `@fastify/rate-limit` (NOT NestJS) | ✅ present (`login` 5/5min, `register` 5/5min, `refresh` 10/1min) | N/A — being IP-based is **correct**, because auth-service handles requests **before any identity/org exists** (it is what creates identity) | ✅ Compliant, no change |
| `core-api` | NestJS `@nestjs/throttler` | ✅ present (5 controllers) | ✅ `OrgAwareThrottlerGuard` | ✅ Compliant |
| `search-service` | NestJS `@nestjs/throttler` | ✅ added `@Throttle` 20/60s for `POST /search` (hits Elasticsearch and may summarise via Claude — more expensive than CRUD) | ✅ `OrgAwareThrottlerGuard` | ✅ Compliant (patched in the same pass as per-org) |
| `notification-service` | NestJS `@nestjs/throttler` | Not added — its routes are lightweight CRUD (list/mark-read) with no AI/external cost, so the global 100/60s is enough | ✅ `OrgAwareThrottlerGuard` | ✅ Compliant |
| `worker-service` | `NestFactory.createApplicationContext` — **no HTTP server**, only consumes Kafka | N/A | N/A | ✅ Correct by nature, doesn't apply |
| `chat-service` | `src/` doesn't exist yet — not built | N/A | N/A | Not yet reached, doesn't apply |

`OrgAwareThrottlerGuard` was deliberately **not** moved into `shared-kernel` despite being duplicated 3 times (core-api/search-service/notification-service) — `shared-kernel` is framework-agnostic (it doesn't depend on `@nestjs/*` and is shared with `auth-service`, which is plain Fastify), and adding a NestJS dependency there would break that boundary just to save 10 duplicated lines. Each NestJS service keeps its own copy in `infrastructure/http/guards/`, matching the existing convention (`health.controller.ts` + `@SkipThrottle()` is duplicated identically across all 3 services too).

### 4.2 Throttle (AI / embedding workload)

### The problem
A user uploads 500 documents at once → 500 embedding requests → pgvector / the Claude API is overwhelmed.

### The solution — process in batches with a delay
```typescript
// infrastructure/ai/throttled-embedder.ts
@Injectable()
export class ThrottledEmbedder {
  private readonly BATCH_SIZE = 10
  private readonly DELAY_MS = 100  // 100ms between batches = 100 embeddings/second max

  async embedMany(items: { id: string; text: string }[]): Promise<void> {
    const batches = chunk(items, this.BATCH_SIZE)

    for (const batch of batches) {
      await Promise.all(batch.map(item => this.embedOne(item)))
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(r => setTimeout(r, this.DELAY_MS))
      }
    }
  }
}
```

### ⛔ Per-org AI rate limit — DELETED (2026-07-12); don't rebuild this pattern without a real need

There used to be an `Organization.aiRateLimitPerMin` (a DB column + domain field, default 20) intended to be enforced like the old sample code here. A project-wide audit found: the field existed but **nothing anywhere read or enforced it** — it was configurable, but changing the value had no real effect. The field was deleted from the schema/domain/mapper/repository (migration `prisma db push --accept-data-loss`; 8 orgs had old values, unimportant since they never had any effect).

**Tripwire — only rebuild it when there is a real need** (differentiated tier/pricing per org for AI usage): at that point you need both the DB field **and** a real enforcement point (e.g. a Redis counter as in the old sample code, though Redis is not currently deployed in this project — see the similar tripwire in `§4.1`). Don't add a configuration field before there is code using it — the lesson from this very field.

### Rules
- Throttle applies to: embedding generation, Claude RAG calls, re-indexing jobs
- Do NOT throttle CRUD operations — AI workloads only
- Use it together with the Circuit Breaker (`rag_ai_integration.md`) — Throttle controls rate, the Circuit Breaker controls health

---

## 5. Graceful Shutdown

### The problem
A process stopped abruptly (a new deploy, a container restart, an autoscale scale-down, `docker stop`) while work is in flight:
- An in-flight HTTP request is cut off → the client gets a connection reset instead of a response.
- An in-flight gRPC call is cut off mid-way — **more dangerous than plain HTTP** when that RPC is one step of a cross-service saga: e.g. `ProvisionUser` (see `microservice_architecture.md`/the org-provisioning saga) may have finished creating the user in `auth_db` while the response hadn't yet reached core-api — core-api treats it as a failure and runs compensation, but the just-created user may have "made it" before the process died → a rare but real race.
- The Postgres connection pool is severed abruptly instead of closing cleanly (Prisma never gets to `$disconnect()`).

### The solution
Catch the stop signal (`SIGTERM`/`SIGINT`) → **stop accepting new work** on every transport (HTTP, gRPC, …) but **let in-flight work finish** (bounded by a timeout) → only then close the DB connection → exit the process cleanly.

### Implementation — a real example from `auth-service/src/main.ts`
```typescript
const SHUTDOWN_TIMEOUT_MS = 10_000

async function bootstrap() {
  // ...composition root + app.listen() + startGrpcServer()...
  const grpcServer = startGrpcServer(application.CommandBus, logger)

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`)

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref() // this timer must not keep the process alive if shutdown finishes early

    Promise.all([
      app.close(),                                                       // 1. stop accepting new HTTP, wait for in-flight requests
      new Promise<void>((resolve) => grpcServer.tryShutdown(() => resolve())), // 2. the same for gRPC
    ])
      .then(() => prismaService.disconnect())                            // 3. ONLY close the DB after both transports have closed cleanly
      .then(() => {
        clearTimeout(forceExit)
        logger.info('Shutdown complete')
        process.exit(0)
      })
      .catch((err) => {
        logger.error({ err }, 'Error during shutdown')
        process.exit(1)
      })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
```

### ⚠️ Windows gotcha (dev machine, not a code bug)
Windows has **no real POSIX signals**. `SIGTERM`/`SIGINT` on Node-Windows are only emulated via the console-control-handler, and **only work when you press Ctrl+C yourself in the exact terminal** running that process. Sending a signal externally (`taskkill` without `/F`, or `process.kill(otherPid, 'SIGINT')` from another process) on Windows almost always behaves like a hard kill (bypassing the registered handler) — genuinely verified: neither method triggered the `"...shutting down gracefully"` log. To see this code run on Windows yourself: open a terminal, `npm run dev`, and press Ctrl+C. In Docker/Linux (where this code genuinely serves its purpose), `docker stop`/Kubernetes sends a real POSIX `SIGTERM` and the handler runs exactly as designed — that is this pattern's real target, not the Windows dev loop.

### Rules
- ⛔ Do NOT close the DB before closing the transports — in-flight requests/RPCs would crash mid-way instead of completing
- Register the handler **in exactly one place** (the composition root in `main.ts`, see the Composition Root section of `microservice_architecture.md`) — never scattered around the app
- The forced timeout (`forceExit`) is mandatory — if a request/RPC hangs indefinitely (a deadlock, an external call without a timeout), graceful shutdown must have a hard exit after N seconds rather than waiting forever
- `forceExit.unref()` — if shutdown finishes before the timeout, that timer must not keep the process alive
- Other entry points (`main.lambda.ts`, cron jobs, worker consumers, …) have quite different process lifecycles (serverless has no "long-lived process" to shut down gracefully) — this pattern applies only to long-running services, and must not be applied mechanically to every entrypoint

---

## 6. Background Jobs — a central index

**✅ 2026-07-31: the tripwire has been hit (7 job classes, 8 `@Cron`/`@Interval` registrations) — `infrastructure/scheduled-jobs/` was built** (`ScheduledJobRegistry`) instead of continuing to rely on the manual table below. Each job `register()`s itself in its own constructor (`register()` throws on a duplicate name — the same guard style as `EventRouter.register()`).

**Revised twice the same day after design flaws were caught:**
1. The first version stored BOTH live health (last run/last error, consecutive failure count) in the registry's RAM, readable through a dedicated `GET /jobs` REST endpoint. Wrong on two counts — (a) this app already assumes multiple replicas running in parallel (see "HA-safe claim" below, `FOR UPDATE SKIP LOCKED`), so per-process RAM state gives a different answer depending on which replica serves the request, rather than a shared truth; (b) health was only visible when someone ACTIVELY called the API — nothing scraped or alerted automatically, returning to exactly the "you have to remember to check" problem this whole piece of work existed to solve.
2. Then a further realisation: `GET /jobs` (the version with static metadata split out from live health in step 1) **was still a REST endpoint nobody called automatically** — Prometheus only scrapes `/metrics` and doesn't discover arbitrary JSON routes; and a human has no reason to call it by hand when the code/doc table is right there. `ScheduledJobsController` + `GET /jobs` were dropped entirely. Replaced by an **info metric** `core_api_scheduled_job_info{job,schedule,file,purpose}` (value always = 1, set once in `register()`) — the same pattern as `kube_pod_info`/`node_uname_info` in common Prometheus exporters. Now "which jobs exist" lives in the same place as health (`core_api_scheduled_job_last_success_timestamp_seconds`/`..._last_failure_timestamp_seconds`/`..._failures_total`, in `scheduled-jobs.metrics.ts` — the same mechanism as `outbox.metrics.ts`), joinable in a single Grafana query rather than being two separate systems.

The table below (metadata) is kept as narrative documentation for offline reading; if it diverges from `core_api_scheduled_job_info` on `/metrics`, fix the table to match, not the other way round.

⚠️ **Known gap, unresolved:** a job that NEVER runs (a misconfigured `@Cron`, a wiring error at boot) increments neither success nor failure — completely silent, and not caught by the "failure rate > 0" alert above. Catching that case needs a "last-success-timestamp is too old" alert (a dead man's switch), but each job's period differs by up to 3 orders of magnitude (2s vs daily), so a single shared threshold doesn't fit — not done, recorded so it isn't forgotten.

Why the jobs' code is still NOT moved into one physical `jobs/` directory (only registration is centralised, not the code): each job still needs the domain knowledge of the module it belongs to (outbox needs `OutboxStatus`, the saga needs claim/INFLIGHT semantics, …) — moving the code into a neutral directory only adds indirection without reducing real coupling. Central registration (knowing "what is running") and central code (where the code lives) are two different things — the former is worth doing, the latter isn't.

| Job | Schedule | File |
|---|---|---|
| `PollingPublisherService` | `@Interval(2000)` | `infrastructure/outbox/polling-publisher.service.ts` |
| `OutboxReaperService` | `@Interval(30000)` | `infrastructure/outbox/outbox-reaper.service.ts` |
| `OutboxMetricsReporter` | `@Interval(30000)` | `infrastructure/outbox/outbox-metrics-reporter.service.ts` |
| `OutboxCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/outbox/outbox-cleanup.service.ts` |
| `SagaCompensationReaperService` (2 jobs: `.poll` + `.reapStaleClaims`) | `@Interval(5000)` + `@Interval(30000)` | `infrastructure/saga-compensation/saga-compensation-reaper.service.ts` |
| `SagaCompensationCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/saga-compensation/saga-compensation-cleanup.service.ts` |
| `IdempotencyCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/http/idempotency/idempotency-cleanup.service.ts` |

**A silent bug fixed at the same time:** previously `PollingPublisherService.poll()` and `SagaCompensationReaperService.poll()` had only `try/finally`, with NO outer `catch` — if `claimPendingBatch` itself threw (e.g. a DB blip), the error drifted off as an unhandled rejection, unlogged, with nobody knowing the job had just "died quietly" for a tick. All 7 jobs now have an outer `catch`: recording `jobRegistry.recordFailure()` + logging the error clearly, then **swallowing** it (not rethrowing) — one background job failing for one tick must not crash the whole process; the next tick runs normally.

**2026-07-31 (earlier the same day):** `modules/outbox/` → `infrastructure/outbox/` — the outbox has no real domain layer (no entity, no business rule) and had been misplaced in `modules/` from before the "business module vs pure infra" boundary was as clear as it is for `saga-compensation` (written later, correctly placed from the start). See `folder_structure_sop.md`: `modules/` = "business logic per domain" — the outbox doesn't match that definition. During the move, the `domain/repositories/` + `infrastructure/{cleanup,publishers,reapers,reporters,repositories}/` substructure was preserved — **wrong, corrected immediately afterwards the same day**: once it was established that the outbox is not a business module, there was no longer any reason to keep the nested `domain/`+`infrastructure/` shape (which only means something for a module with real DDD layers) while `saga-compensation` — the same kind of thing, written later — is completely flat. `infrastructure/outbox/` was flattened to 8 sibling files, matching `saga-compensation` 100%; the filenames (`outbox-cleanup.service.ts`, `prisma-outbox.repository.ts`, …) are already self-describing and need no extra classifying subfolders.

### 6.1 When port-ifying the driven side is worth it, and when it's ceremony

The two outbox jobs above (`poll()`, `reapStaleClaims()`) previously called `PrismaService.$queryRaw`/`$executeRaw` directly — violating the existing rule in `cqrs_pattern.md` ("the Application layer uses a Domain Repository through an interface and knows nothing about the ORM"). Fixed: `IOutboxRepository` (already present for `append()`) gained `claimPendingBatch`/`markProcessed`/`markFailed`/`reapStaleInflight` — the HA-safe algorithm (`FOR UPDATE SKIP LOCKED`) now sits behind a named interface, so swapping ORMs forces a complete reimplementation (TypeScript enforces it, rather than relying on memory).

**One mistake made during that same pass, recorded so it isn't repeated:** the identical pattern was applied to `IdempotencyCleanupService`/`IdempotencyInterceptor` — creating an `IIdempotencyRepository` port. Wrong, because a prerequisite was missing: `IOutboxRepository` genuinely is a port because it lives in `domain/repositories/` and is injected by **real command handlers in the Application layer** (`publish-knowledge.handler.ts` and several others) — the dependency runs from Application into Domain, with Infrastructure implementing it. For `IIdempotencyRepository`, the interface + implementation + its only 2 consumers **all live inside `infrastructure/`** — no Application layer depends on it, and no architectural boundary is crossed. That is infra calling infra through a layer of indirection, not a Hexagonal port — it was reverted.

**The self-check question before port-ifying something:** *"Is the other side of this interface genuinely the Application/Domain layer, or is it also Infrastructure?"* If both ends are Infrastructure → no interface needed, call it directly. A secondary question: *"Is the logic behind it hard enough and worth protecting enough to justify port-ifying it?"* (`FOR UPDATE SKIP LOCKED` is; a one-line `deleteMany` isn't.)

---

## 7. Correlation-id — W3C Trace Context across HTTP/gRPC/Kafka (2026-07-21)

### The problem
`requestId` previously lived only within one service and one HTTP request (Fastify's `req.id` / nestjs-pino's per-request child logger). A request fanning out to gRPC (core-api → auth-service) or Kafka (outbox → consumer) lost correlation entirely — there was no way to stitch three services' logs into one logical request when debugging.

### The solution — W3C Trace Context (`traceparent`), NOT the full OpenTelemetry SDK
The user chose the real standard (`00-{traceId}-{spanId}-{flags}`) over inventing a bespoke `requestId` field — the reasoning: if a real OTel SDK/APM is needed later, only the propagation layer changes, rather than renaming a log field everywhere. **Deliberately NOT** pulling in `@opentelemetry/api`/the SDK/an exporter — only the header format + one ALS carrying `{traceId, spanId}`, serving the single purpose of stitching logs together, with no need yet for real span timing/exporters.

`packages/shared-kernel/src/tracing/trace-context.ts` — the public API is only 4 functions + 1 type (after auditing who actually imports what before deciding what to export, 2026-07-21): `runWithTraceContext`/`startTraceContext(inbound?)`/`getCurrentTraceparent()`/`traceLogFields(ctx?)` + the `TraceContext` type. The rest (`generateTraceId`/`generateSpanId`/`formatTraceparent`/`parseInboundTraceparent`/`getTraceContext`) are internal helpers, deliberately **not exported** — external code must not call them directly; for example calling `generateTraceId()` at a SEND boundary would break the RECEIVE/SEND invariant below.

### ⚠️ The core rule — RECEIVE always generates, SEND never generates

Every boundary plays exactly one of two roles, never both in the same call:

| Role | Function to use | When the input is missing/broken |
|---|---|---|
| **RECEIVE** (HTTP middleware, gRPC server handler, Kafka consumer) | `startTraceContext(inbound)` | **Always generates a new trace** — never let downstream run without a `trace_id` |
| **SEND** (attaching to an outbound gRPC call, writing to the outbox for later Kafka publication) | `getCurrentTraceparent()` | Returns `undefined` — **never invents a new trace**, leaving the RECEIVE side to decide |

**An easy misunderstanding:** the boundary is NOT "HTTP = a real entry point, gRPC/Kafka = intermediate so no fallback needed" — all 4 RECEIVE points (including the gRPC server and the Kafka consumer, which are not real system entry points) use `startTraceContext` and **all generate a new trace when one is missing**. This is deliberate defensive design: a request/event arriving at any RECEIVE boundary is guaranteed a usable `trace_id`, even when the caller forgot to attach one (a bug) or an old Kafka row (from before the `traceparent` column existed) has no value. Conversely, the SEND side never generates one, because inventing a trace at send time is meaningless — only the place that GENUINELY initiates work has a trace worth propagating.

The 4 current RECEIVE points: `TraceContextMiddleware` (core-api HTTP), the `onRequest` hook (auth-service HTTP), `auth-provisioning.grpc-service.ts` (the auth-service gRPC server), and `resilient-consumer.ts` (the Kafka consumer, in shared-kernel). The 2 SEND points: `auth-provisioning.client.ts.metadata()` (the gRPC client) and `prisma-outbox.repository.ts.append()` (writing the DB column).

### ⚠️ `parentSpanId` — why it was added back after deliberately being dropped

The first version of `TraceContext` had only `{traceId, spanId}` — the `spanId` field parsed from the inbound header (whose correct W3C name is "parent-id", explained below) was discarded entirely once `traceId` had been extracted. The reasoning at the time: the system only needed "do these log lines belong to the same request?" (answerable with `trace_id`), not yet "which span called which".

**The question that forced a revisit:** if one request has core-api calling BOTH auth-service AND search-service, both log the same `trace_id` — but nothing in the logs reveals "both were spawned by the same single call from core-api, independently of each other" unless the parent-child relationship is preserved. The `serviceContext` field (already present, `logging_standard.md`) answers "which service is this log line from", but NOT "in what order/relationship" — two different questions.

**The solution — `TraceContext` gains `parentSpanId?: string`:**
```ts
export interface TraceContext {
  traceId: string
  spanId: string          // THIS service's own span
  parentSpanId?: string   // the caller's span — the same bits as "parent-id" in the header,
                           // renamed from the local point of view; undefined for a root span (nobody called us)
}
```
`startTraceContext` parses both `traceId` and `parentSpanId` from the inbound header (via the internal `parseInboundTraceparent`), generates a NEW `spanId` for itself as before (unchanged), and sets `parentSpanId` to the parsed value. `traceLogFields` adds `parent_span_id` to its output when present (omitting it for a root span, so no empty field is logged).

**Why one bit position has two names ("parent-id" in the spec, `spanId`/`parentSpanId` in the code):** the `traceparent` wire format has only one 16-hex slot in the middle. When a service SENDS, it puts ITS OWN `spanId` there — from the sender's perspective this is "introducing myself". When the next service RECEIVES that same string, the same value now means "this is the id of whoever called me" — from the receiver's perspective this is the "parent-id". Not two different values, just a name that changes with the send/receive perspective. The code names them `spanId` (its own) and `parentSpanId` (the caller's) as two SEPARATE fields in the same object, reflecting the fact that both roles exist simultaneously in one `TraceContext`.

**Still NOT a real OTel SDK:** there is no "span" object with duration/start-end times, and nothing is exported to any collector — only one extra field on a log line, so a tool (Kibana/ES) or a later script can reconstruct the relationship tree from raw log data if needed. The accepted downside: you still have to write that tree-building logic yourself, with no ready-made visualisation UI like Jaeger.

### The 3 touchpoints

| Boundary | How it propagates |
|---|---|
| **HTTP entry** | `TraceContextMiddleware` (core-api, registered BEFORE `TenantContextMiddleware` in `app.module.ts`) / the `onRequest` hook registered first in `auth-service/bootstrap/server.ts` (before `setupFastify()`) — reads the inbound `traceparent` header (if present) or generates a new trace |
| **gRPC** | `shared-kernel/grpc/trace-propagation.ts` (`attachTraceparent`/`readTraceparent`, following the same convention as `internal-grpc-auth.ts`) — the client (`AuthProvisioningClient.metadata()`) attaches it to the metadata, the server (`auth-provisioning.grpc-service.ts`) reads it and wraps the handler in `runWithTraceContext` |
| **Kafka** | **Not** using kafkajs message headers — using the official CloudEvents extension attribute `traceparent` (the CloudEvents Distributed Tracing Extension) directly on the envelope, since the CloudEvent is already serialised in structured mode into the message value, so there's no need to touch `MinimalKafkaMessage`/kafkajs headers. `OutboxEvent.traceparent` (a nullable column) is captured from the ALS inside `PrismaOutboxRepository.append()` (requiring no change at any `append()` call site) → `PollingPublisherService` copies it onto the CloudEvent → `ResilientEventConsumer.eachMessage` reads it back and wraps `routeWithRetry()` in `runWithTraceContext` per message |

### Rules
- ⛔ Do NOT use a bespoke field (a bare `requestId` string) for new cross-service correlation — use `traceparent` (the standard W3C format) via the helpers above
- Every hop ALWAYS mints a new `spanId` (`startTraceContext`) while preserving `traceId` — never reuse the caller's `spanId`
- A new RECEIVE boundary (a new gRPC server / consumer) → always use `startTraceContext(inbound)`, never hand-write "skip the trace if it's missing" logic — that breaks the "downstream always has a trace_id" guarantee
- A new SEND boundary (a new outbound call) → use `getCurrentTraceparent()`, never generate a new trace here however convenient — generating one in the wrong place severs the link with the real original trace
- Don't add a real OTel SDK (spans/exporters) unless there is a genuine APM need — the tripwire is needing to visualise a distributed trace, not merely stitch logs together

---

## Summary — which pattern, when

```
A user sends a request that might be retried → Idempotency
A route needing a per-org limit rather than one shared IP bucket → Rate Limiting (§4.1)
Another service must be notified after a domain write → Transactional Outbox
An external service fails temporarily → Retry (+ Circuit Breaker)
Processing many AI items at once → Throttle
An external service fails continuously → Circuit Breaker (see rag_ai_integration.md)
A long-running service must stop cleanly (deploy/restart/scale-down) → Graceful Shutdown
Stitching one request's logs across HTTP/gRPC/Kafka → Correlation-id (§7, W3C traceparent)
```
