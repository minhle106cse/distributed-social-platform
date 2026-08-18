# SOP: Event Sourcing Standard

> [!NOTE]
> This directive applies to the modules using Event Sourcing in Cortex: **Credit Economy** and **Reputation**.
> Ordinary CRUD modules (KnowledgeItem, Tenant, …) do NOT need Event Sourcing.

> [!IMPORTANT]
> **There is no separate `domain/aggregates/` folder.** An event-sourced class (e.g. `CreditAccount`) lives
> in `domain/entities/` alongside every other domain object, differing only in its **file suffix** (`.aggregate.ts`).
> The reason: "aggregate root" is a **role** (a consistency boundary, the single door for mutation) — every
> entity here is an aggregate root in that sense, including the non-event-sourced `Organization`/`Membership`.
> Event sourcing is merely a **storage mechanism** (state = folded from events rather than reading one row
> directly) — a completely different axis, not a different "kind of aggregate root". A separate folder named
> "aggregates" conflated these two axes; see `domain_modeling.md §0.1` for the full two-axis treatment plus
> the method-shape comparison table.

---

## 🎯 When to Use

| Module | Pattern |
|---|---|
| CreditLedger, CreditBalance | ✅ Event Sourcing (EventStore + Projection) |
| ReputationSummary | ✅ Event Sourcing (an append-only ledger) |
| KnowledgeItem, Revision, Vote | ❌ Standard CRUD + OCC (Optimistic Concurrency Control) |
| Tenant, Membership, Space | ❌ Standard CRUD |

---

## 📜 Core Concepts

### 1. EventStore schema

```prisma
model DomainEvent {
  id            String   @id @default(uuid())
  aggregateId   String   @map("aggregate_id")    // e.g. a userId or creditAccountId
  aggregateType String   @map("aggregate_type")  // e.g. "CreditAccount"
  eventType     String   @map("event_type")       // e.g. "CreditsEarned"
  payload       Json                               // event data (immutable)
  version       Int                                // monotonic per aggregate
  orgId         String   @map("org_id")
  occurredAt    DateTime @default(now()) @map("occurred_at")

  @@unique([aggregateId, version])               // the OCC constraint
  @@index([aggregateId, aggregateType])
  @@index([orgId, eventType])
  @@map("domain_events")
}
```

> `@@unique([aggregateId, version])` is the **OCC lock** — concurrent writes with the same version throw a Prisma unique-constraint error. Catch it and convert it into an `OptimisticLockError`.

---

### 2. Read model (projection / summary)

> [!IMPORTANT]
> **Decision 2026-07-03 (Phase 5a Credit) — an override for the credit wallet: FOLD-ON-READ, NO summary table.**
> The project rolled back read models (2026-06-30): the schema holds only the source of truth, with projections deferred to Phase 3. Applied to credit:
> `CreditAccount` folds the balance from the `credit_events` stream on every load/query — there is NO `CreditBalanceSummary`.
> The advantage: `Sum(events) == balance` is obviously true (there is no second table to drift), with nothing to keep in sync within a transaction.
> The cost: every spend reloads the stream — acceptable at small scale; **snapshot (§5) once a stream exceeds 500 events**.
> The "summary in the same transaction" material below is KEPT as a reference for the future (when the Phase 3 read path needs an O(1) balance),
> but 5a does NOT use it. OCC is still enforced via `@@unique([aggregateId, version])` on the event ledger itself.

Never query the EventStore directly for read operations (once a read model exists). If you do adopt a read model,
maintain a **denormalized read model** updated after every event.

```prisma
model CreditBalanceSummary {
  id          String   @id @default(uuid())
  userId      String   @unique @map("user_id")   // 1 summary per user
  orgId       String   @map("org_id")
  balance     Int      @default(0)                // current balance
  totalEarned Int      @default(0) @map("total_earned")
  totalSpent  Int      @default(0) @map("total_spent")
  version     Int      @default(0)               // the latest applied event version
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([orgId])
  @@map("credit_balance_summaries")
}
```

---

### 3. Aggregate pattern

```typescript
// modules/credit/domain/entities/credit-account.aggregate.ts
export class CreditAccount {
  private readonly uncommittedEvents: DomainEvent[] = []

  private constructor(
    private readonly id: string,
    private readonly orgId: string,
    private readonly userId: string,
    private version: number,
    private balance: number,
  ) {}

  static rehydrate(events: StoredEvent[]): CreditAccount {
    const account = new CreditAccount(
      events[0].aggregateId, events[0].orgId,
      events[0].payload.userId, 0, 0,
    )
    for (const event of events) {
      account.apply(event)
    }
    return account
  }

  earnCredits(amount: number, reason: string): void {
    if (amount <= 0) throw new DomainError('Amount must be positive')
    this.raise({ type: 'CreditsEarned', payload: { amount, reason } })
  }

  spendCredits(amount: number, reason: string): void {
    if (amount > this.balance) throw new DomainError('Insufficient credits')
    this.raise({ type: 'CreditsSpent', payload: { amount, reason } })
  }

  private raise(event: { type: string; payload: object }): void {
    const domainEvent = {
      aggregateId: this.id, aggregateType: 'CreditAccount',
      eventType: event.type, payload: event.payload,
      version: this.version + 1, orgId: this.orgId,
    }
    this.apply(domainEvent)
    this.uncommittedEvents.push(domainEvent)
  }

  private apply(event: { eventType: string; payload: any; version: number }): void {
    this.version = event.version
    if (event.eventType === 'CreditsEarned') this.balance += event.payload.amount
    if (event.eventType === 'CreditsSpent') this.balance -= event.payload.amount
  }

  getUncommittedEvents() { return [...this.uncommittedEvents] }
  getVersion() { return this.version }
  getBalance() { return this.balance }
}
```

---

### 4. Repository — the load & save pattern

```typescript
// modules/credit/infrastructure/repositories/prisma-credit-event.repository.ts
export class PrismaCreditEventRepository implements CreditEventRepository {
  async load(aggregateId: string): Promise<CreditAccount> {
    const orgId = getTenantId()
    const events = await this.prisma.domainEvent.findMany({
      where: { aggregateId, orgId, aggregateType: 'CreditAccount' },
      orderBy: { version: 'asc' },
    })
    if (!events.length) throw new NotFoundError('CreditAccount not found')
    return CreditAccount.rehydrate(events)
  }

  async save(account: CreditAccount): Promise<void> {
    const events = account.getUncommittedEvents()
    if (!events.length) return

    try {
      await this.prisma.$transaction(async (tx) => {
        // Append events (OCC enforced by @@unique([aggregateId, version]))
        await tx.domainEvent.createMany({ data: events })

        // Update read model projection inline
        await tx.creditBalanceSummary.upsert({
          where: { userId: events[0].payload.userId },
          create: {
            userId: events[0].payload.userId, orgId: events[0].orgId,
            balance: account.getBalance(), version: account.getVersion(),
          },
          update: {
            balance: account.getBalance(), version: account.getVersion(),
          },
        })
      })
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        throw new OptimisticLockError('CreditAccount was modified concurrently')
      }
      throw err
    }
  }
}
```

---

### 5. Snapshot pattern (once an event stream exceeds 500 events)

> ⚠️ **The real status (2026-07-23): NOT implemented.** `CreditAccount.loadOrOpen()` (`apps/core-api/src/modules/credit/infrastructure/repositories/prisma-credit-event.repository.ts`) currently always replays the **entire** event stream from version 1, on every read. There is no `creditSnapshot` table and no `fromSnapshot()`/`applyFromStore()` — the code below is a reference design, not running code. Don't misread it as "already in place".
>
> **Tripwire — only build this on measured evidence, never on a guess:** this belongs to **step 6 (load test → find the bottleneck → optimise)** in the roadmap, not now. The condition for returning to it: load-test one wallet with a growing number of events and measure real `loadOrOpen()` latency — if it exceeds the SLA (no specific number defined yet; define it at load-test time) at some events-per-wallet threshold, come back to this section and pick a technique. The reason for deferring: without real traffic there is no way to know the threshold, so building first is guesswork — the same class of mistake already self-corrected with `Organization.aiRateLimitPerMin` (a config/mechanism nobody actually read or used).

```typescript
// Instead of loading every event from the beginning:
async load(aggregateId: string): Promise<CreditAccount> {
  const snapshot = await this.prisma.creditSnapshot.findFirst({
    where: { aggregateId }, orderBy: { version: 'desc' },
  })

  const fromVersion = snapshot?.version ?? 0
  const events = await this.prisma.domainEvent.findMany({
    where: { aggregateId, version: { gt: fromVersion } },
    orderBy: { version: 'asc' },
  })

  const account = snapshot
    ? CreditAccount.fromSnapshot(snapshot)
    : CreditAccount.rehydrate(events)

  // Apply only new events on top of the snapshot
  for (const event of events) {
    account.applyFromStore(event)
  }
  return account
}
```

> Create a snapshot every 100 events (a background job / Kafka consumer).

---

## ⚠️ Gotchas

- **OCC**: catch Prisma P2002 (unique constraint) when saving events → throw `OptimisticLockError`, not a 500.
- **Projection lag**: the read model (CreditBalanceSummary) can trail the EventStore if updated asynchronously. For the credit economy, update it **synchronously in the same transaction** to guarantee consistency.
- **Event payload immutability**: never modify the payload of a stored event. If data needs fixing, append a correction event.
- **Version starts at 1**: version 0 means "no events yet" — it is not the first event.

---

## 🔗 Related

- `directives/cqrs_pattern.md` — TransactionMiddleware + AsyncLocalStorage
- `directives/database_standard.md` — Prisma schema conventions
- `directives/multi_tenancy.md` — `orgId` mandatory on every event
