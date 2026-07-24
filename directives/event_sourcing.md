# SOP: Event Sourcing Standard

> [!NOTE]
> Directive này áp dụng cho các module dùng Event Sourcing trong Cortex: **Credit Economy** và **Reputation**.
> Các module CRUD thông thường (KnowledgeItem, Tenant...) KHÔNG cần Event Sourcing.

> [!IMPORTANT]
> **Không có folder `domain/aggregates/` riêng.** Class event-sourced (vd `CreditAccount`) nằm
> chung `domain/entities/` như mọi domain object khác, chỉ khác ở **hậu tố file** (`.aggregate.ts`).
> Lý do: "aggregate root" là một **vai trò** (consistency boundary, cửa duy nhất để mutate) — mọi
> entity ở đây đều là aggregate root theo nghĩa đó, kể cả `Organization`/`Membership` không
> event-sourced. Event sourcing chỉ là **cơ chế lưu trữ** (state = fold từ event thay vì đọc trực
> tiếp 1 row) — một trục hoàn toàn khác, không phải một "loại aggregate root" khác. Tách riêng
> folder theo tên "aggregates" từng gán nhầm trục này; xem `domain_modeling.md §0.1` để đọc đầy đủ
> 2 trục + bảng so sánh method-shape.

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

> [!IMPORTANT]
> **Quyết định 2026-07-03 (Phase 5a Credit) — override cho credit wallet: FOLD-ON-READ, KHÔNG summary table.**
> Dự án đã rollback read-model (2026-06-30): schema chỉ chứa source-of-truth, projection defer tới Phase 3. Áp cho credit:
> `CreditAccount` fold balance từ stream `credit_events` mỗi lần load/query — KHÔNG có `CreditBalanceSummary`.
> Ưu điểm: `Sum(events) == balance` hiển nhiên đúng (không có bảng thứ 2 để lệch), không cần giữ đồng bộ trong tx.
> Chi phí: mỗi spend load lại stream — chấp nhận được ở scale nhỏ; **snapshot (§5) khi stream > 500 event**.
> Phần "summary trong cùng transaction" bên dưới GIỮ như tham khảo cho tương lai (khi read-path Phase 3 cần O(1) balance),
> nhưng 5a KHÔNG dùng. OCC vẫn ép qua `@@unique([aggregateId, version])` trên chính event ledger.

Không bao giờ query EventStore trực tiếp cho read operations (khi đã có read model). Nếu chọn read model,
maintain một **denormalized read model** được cập nhật sau mỗi event.

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

> ⚠️ **Trạng thái thật (2026-07-23): CHƯA implement.** `CreditAccount.loadOrOpen()` (`apps/core-api/src/modules/credit/infrastructure/repositories/prisma-credit-event.repository.ts`) hiện luôn replay **toàn bộ** event stream từ version 1, mỗi lần đọc. Không có bảng `creditSnapshot`, không có `fromSnapshot()`/`applyFromStore()` — code bên dưới là thiết kế tham khảo, không phải code đang chạy. Đừng đọc nhầm là "đã có sẵn".
>
> **Tripwire — chỉ làm khi có bằng chứng đo được, không đoán trước:** đây là việc của **bước 6 (Load test → tìm bottleneck → Optimize)** trong roadmap, không phải bây giờ. Điều kiện quay lại làm: load test 1 ví với số event tăng dần, đo `loadOrOpen()` latency thật — nếu vượt SLA (chưa định nghĩa số cụ thể, định nghĩa lúc load test) ở ngưỡng event/ví nào đó, quay lại section này chọn kỹ thuật. Lý do hoãn: chưa có traffic thật để biết ngưỡng, build trước là đoán mò — cùng loại lỗi đã tự sửa ở `Organization.aiRateLimitPerMin` (config/cơ chế không ai đọc/dùng thật).

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
