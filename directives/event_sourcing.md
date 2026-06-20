# SOP: Event Sourcing Standard

> [!NOTE]
> Directive này áp dụng cho các module dùng Event Sourcing trong Cortex: **Credit Economy** và **Reputation**.
> Các module CRUD thông thường (KnowledgeItem, Tenant...) KHÔNG cần Event Sourcing.

---

## 🎯 When to Use

| Module | Pattern |
|---|---|
| CreditLedger, CreditBalance | ✅ Event Sourcing (EventStore + Projection) |
| ReputationSummary | ✅ Event Sourcing (append-only ledger) |
| KnowledgeItem, Revision, Vote | ❌ Standard CRUD + OCC (Optimistic Concurrency Control) |
| Tenant, Membership, Space | ❌ Standard CRUD |

---

## 📜 Core Concepts

### 1. EventStore Schema

```prisma
model DomainEvent {
  id            String   @id @default(uuid())
  aggregateId   String   @map("aggregate_id")    // e.g. userId hoặc creditAccountId
  aggregateType String   @map("aggregate_type")  // e.g. "CreditAccount"
  eventType     String   @map("event_type")       // e.g. "CreditsEarned"
  payload       Json                               // event data (immutable)
  version       Int                                // monotonic per aggregate
  orgId         String   @map("org_id")
  occurredAt    DateTime @default(now()) @map("occurred_at")

  @@unique([aggregateId, version])               // OCC constraint
  @@index([aggregateId, aggregateType])
  @@index([orgId, eventType])
  @@map("domain_events")
}
```

> `@@unique([aggregateId, version])` là **OCC lock** — concurrent writes với cùng version sẽ throw Prisma unique constraint error. Catch và convert thành `OptimisticLockError`.

---

### 2. Read Model (Projection / Summary)

Không bao giờ query EventStore trực tiếp cho read operations. Maintain một **denormalized read model** được cập nhật sau mỗi event.

```prisma
model CreditBalanceSummary {
  id          String   @id @default(uuid())
  userId      String   @unique @map("user_id")   // 1 summary per user
  orgId       String   @map("org_id")
  balance     Int      @default(0)                // current balance
  totalEarned Int      @default(0) @map("total_earned")
  totalSpent  Int      @default(0) @map("total_spent")
  version     Int      @default(0)               // latest applied event version
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([orgId])
  @@map("credit_balance_summaries")
}
```

---

### 3. Aggregate Pattern

```typescript
// modules/credit/domain/aggregates/credit-account.aggregate.ts
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

### 4. Repository — Load & Save Pattern

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

### 5. Snapshot Pattern (khi event stream > 500 events)

```typescript
// Thay vì load toàn bộ events từ đầu:
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

  // Apply only new events on top of snapshot
  for (const event of events) {
    account.applyFromStore(event)
  }
  return account
}
```

> Tạo snapshot sau mỗi 100 events (background job / Kafka consumer).

---

## ⚠️ Gotchas

- **OCC**: Catch Prisma P2002 (unique constraint) khi saving events → throw `OptimisticLockError`, không throw 500.
- **Projection lag**: Read model (CreditBalanceSummary) có thể chậm hơn EventStore nếu update async. Với credit economy, update **synchronously trong cùng transaction** để đảm bảo consistency.
- **Event payload immutability**: Không bao giờ thay đổi payload của event đã stored. Nếu cần fix data, append correction event.
- **Version starts at 1**: Version 0 nghĩa là "chưa có event nào" — không phải event đầu tiên.

---

## 🔗 Liên quan

- `directives/cqrs_pattern.md` — TransactionMiddleware + AsyncLocalStorage
- `directives/database_standard.md` — Prisma schema conventions
- `directives/multi_tenancy.md` — `orgId` bắt buộc trên mọi event
