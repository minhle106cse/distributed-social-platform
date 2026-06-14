# 🏗️ KIẾN TRÚC HỆ THỐNG & SƠ ĐỒ LUỒNG DỮ LIỆU

> 📖 **[English Version](./en/03_system_architecture_diagrams.md)**

Tài liệu biểu diễn Entity Relationship, Data Flow và Sequence Diagrams cho kiến trúc Modular Monolith + Event-Driven.

---

## 1. CORE ENTITY RELATIONSHIP DIAGRAM (ERD)

```mermaid
erDiagram
    %% Identity Context (auth-service DB)
    User {
        uuid id PK
        string email
        string username
        string avatarUrl
        enum status "ACTIVE, BANNED"
    }
    AuthIdentity {
        uuid id PK
        string userId "Loose ref"
        enum provider "LOCAL, GOOGLE"
        string passwordHash
        string refreshToken
    }

    %% Group Context
    FinanceGroup {
        uuid id PK
        string name
        string description
        enum type "PERSISTENT, TRIP, QUICK_SPLIT"
        enum status "ACTIVE, SETTLED, ARCHIVED"
        string baseCurrency "VND, USD, EUR..."
        date startDate
        date endDate
        int version "OCC"
    }
    GroupMember {
        uuid id PK
        string userId "Loose ref - no FK"
        string groupId FK
        enum role "OWNER, ADMIN, MEMBER, VIEWER"
        datetime joinedAt
    }
    GroupInvite {
        uuid id PK
        string groupId FK
        string inviteCode "UNIQUE"
        string invitedByUserId
        datetime expiresAt
    }

    %% Expense Context (Write Model)
    Expense {
        uuid id PK
        string groupId "Loose ref"
        string description
        int totalAmount "Stored in smallest unit"
        string currency
        decimal exchangeRate "Pinned at creation"
        int convertedAmount "In base currency"
        enum splitMethod "EQUAL, EXACT, PERCENTAGE, SHARES"
        enum category "FOOD, TRANSPORT..."
        string noteText
        string receiptUrl
        date expenseDate
        boolean isDeleted "Soft delete"
        int version "OCC"
        datetime createdAt
        string createdByUserId "Loose ref"
    }
    ExpensePayer {
        uuid id PK
        string expenseId FK
        string userId "Loose ref"
        int amount "Amount this payer paid"
    }
    ExpenseSplit {
        uuid id PK
        string expenseId FK
        string userId "Loose ref"
        int amount "Amount this user owes"
        decimal percentage "If PERCENTAGE split"
        int shares "If SHARES split"
    }

    %% Settlement Context
    Settlement {
        uuid id PK
        string groupId "Loose ref"
        string fromUserId "Loose ref - person paying"
        string toUserId "Loose ref - person receiving"
        int amount
        string currency
        decimal exchangeRate
        int convertedAmount
        enum type "FULL, PARTIAL, RECORD_ONLY"
        datetime createdAt
        string createdByUserId
    }

    %% Event Store (Event Sourcing)
    EventStore {
        uuid id PK
        string aggregateType "Expense, Settlement, Group"
        string aggregateId
        string eventType "ExpenseCreated, SettlementCreated..."
        int version "Per aggregate"
        json payload
        string userId "Who triggered"
        datetime createdAt
    }

    %% Balance Read Model (CQRS)
    BalanceSummary {
        uuid id PK
        string groupId "Loose ref"
        string fromUserId "Person who owes"
        string toUserId "Person who is owed"
        int balance "Positive = fromUser owes toUser"
        string currency "Base currency of group"
        datetime updatedAt
    }

    %% Infrastructure
    OutboxEvent {
        uuid id PK
        string aggregateType
        string aggregateId
        string eventType
        json payload
        enum status "PENDING, PROCESSED, FAILED_DLQ"
        datetime createdAt
        datetime processedAt
    }
    IdempotencyRecord {
        string key PK "X-Idempotency-Key"
        json response "Cached response"
        datetime createdAt
        datetime expiresAt
    }

    %% Relationships
    User ||--o{ AuthIdentity : "authenticates via"
    User ||--o{ GroupMember : "belongs to groups"
    FinanceGroup ||--o{ GroupMember : "has members"
    FinanceGroup ||--o{ GroupInvite : "has invites"
    Expense ||--o{ ExpensePayer : "paid by"
    Expense ||--o{ ExpenseSplit : "split among"
```

---

## 2. SEQUENCE DIAGRAMS

### Luồng 1: Tạo Expense (Outbox + Event Sourcing + Notification)

```mermaid
sequenceDiagram
    actor User as Web Client
    participant API as core-api (Expense Module)
    participant ES as Postgres (EventStore)
    participant DB as Postgres (Expense + Splits)
    participant RM as Postgres (BalanceSummary)
    participant Outbox as Postgres (OutboxEvent)
    participant Kafka as Kafka
    participant Notif as Notification Service
    participant WS as WebSocket (Online Members)

    User->>API: POST /api/v1/groups/{id}/expenses<br/>X-Idempotency-Key: uuid-123

    Note over API: Check Idempotency Key
    API->>DB: SELECT FROM idempotency_records WHERE key = 'uuid-123'
    alt Key exists
        DB-->>API: Cached response
        API-->>User: HTTP 200 (cached)
    else Key not found
        Note over API: BEGIN TRANSACTION
        API->>ES: INSERT EventStore {type: ExpenseCreated, payload: {...}}
        API->>DB: INSERT Expense + ExpensePayers + ExpenseSplits
        API->>RM: UPDATE BalanceSummary (recalculate pairwise balances)
        API->>Outbox: INSERT OutboxEvent {type: ExpenseCreated}
        API->>DB: INSERT IdempotencyRecord {key: uuid-123, response: {...}}
        Note over API: COMMIT TRANSACTION

        API-->>User: HTTP 201 Created

        Note over Outbox: CDC / Polling Publisher
        Outbox-->>Kafka: Publish ExpenseCreated event
        Kafka-->>Notif: Consume event
        Notif->>WS: Push to online members
        Notif->>Notif: Queue push notification for offline members
    end
```

---

### Luồng 2: Settlement — Saga Pattern + Idempotency

```mermaid
sequenceDiagram
    actor UserB as User B (Debtor)
    participant API as core-api (Settlement Module)
    participant Idem as IdempotencyRecord Table
    participant ES as EventStore
    participant DB as Settlement Table
    participant RM as BalanceSummary
    participant Outbox as OutboxEvent
    participant Kafka as Kafka
    participant Notif as Notification Service

    UserB->>API: POST /api/v1/settlements<br/>X-Idempotency-Key: settle-456<br/>{toUserId: A, amount: 200000}

    API->>Idem: CHECK key 'settle-456'
    Note over API: Key not found — proceed

    Note over API: Saga Step 1: Validate
    API->>RM: SELECT balance WHERE from=B, to=A, group=X
    RM-->>API: balance = 200000 ✅ (B owes A 200k)

    Note over API: Saga Step 2: Create Settlement Event
    Note over API: BEGIN TRANSACTION
    API->>ES: INSERT EventStore {type: SettlementCreated}
    API->>DB: INSERT Settlement {from: B, to: A, amount: 200000}

    Note over API: Saga Step 3: Update Read Model
    API->>RM: UPDATE BalanceSummary SET balance = balance - 200000

    alt Step 3 Success
        API->>Outbox: INSERT OutboxEvent {type: SettlementCreated}
        API->>Idem: INSERT IdempotencyRecord {key: settle-456}
        Note over API: COMMIT TRANSACTION
        API-->>UserB: HTTP 200 OK {settled: true}

        Outbox-->>Kafka: Publish SettlementCreated
        Kafka-->>Notif: Notify User A "B vừa trả bạn 200k!"
    else Step 3 Fails (DB Error)
        Note over API: ROLLBACK TRANSACTION
        Note over API: Compensating: Nothing persisted (transaction rollback)
        API-->>UserB: HTTP 500 "Settlement failed, please retry"
    end
```

---

### Luồng 3: OCC — Xung đột Sửa Expense Đồng thời

```mermaid
sequenceDiagram
    actor UserA as User A
    actor UserB as User B
    participant API as core-api
    participant DB as Postgres (Expense)
    participant ES as EventStore

    Note over UserA,UserB: Cả 2 đang mở form Edit cho Expense "Ăn trưa" (version = 3)

    UserA->>API: PUT /expenses/{id}<br/>{amount: 600000, version: 3}
    Note over API: BEGIN TRANSACTION
    API->>DB: UPDATE expense SET amount=600000, version=4<br/>WHERE id=X AND version=3
    DB-->>API: 1 row affected ✅
    API->>ES: INSERT EventStore {type: ExpenseUpdated, version: 4}
    Note over API: COMMIT
    API-->>UserA: HTTP 200 OK {version: 4}

    UserB->>API: PUT /expenses/{id}<br/>{note: "thêm đồ uống", version: 3}
    Note over API: BEGIN TRANSACTION
    API->>DB: UPDATE expense SET note='...', version=4<br/>WHERE id=X AND version=3
    DB-->>API: 0 rows affected ❌ (version already 4)
    Note over API: ROLLBACK
    API-->>UserB: HTTP 409 Conflict<br/>{currentVersion: 4, currentState: {amount: 600000}}

    Note over UserB: User B sees diff, retries with version: 4
```

---

### Luồng 4: Circuit Breaker — Exchange Rate API

```mermaid
sequenceDiagram
    participant API as core-api (Currency Module)
    participant CB as Circuit Breaker
    participant Cache as Redis (Exchange Rate Cache)
    participant ExtAPI as External API (Fixer.io)

    Note over CB: State: CLOSED (normal)

    API->>CB: getRate(JPY, VND)
    CB->>Cache: GET rate:JPY:VND
    alt Cache HIT (< 1 hour old)
        Cache-->>CB: 175.0
        CB-->>API: 175.0 (cached)
    else Cache MISS
        CB->>ExtAPI: GET /latest?base=JPY&symbols=VND
        alt API Success
            ExtAPI-->>CB: {rate: 176.2}
            CB->>Cache: SET rate:JPY:VND = 176.2 TTL 3600s
            CB-->>API: 176.2
        else API Failure (5th consecutive)
            Note over CB: State: CLOSED → OPEN
            CB->>Cache: GET rate:JPY:VND (stale cache)
            Cache-->>CB: 175.0 (2 hours old)
            CB-->>API: 175.0 (fallback) + warning flag

            Note over CB: After 30 seconds → HALF-OPEN
            CB->>ExtAPI: Test 1 request
            alt Test Success
                Note over CB: HALF-OPEN → CLOSED
            else Test Failure
                Note over CB: HALF-OPEN → OPEN (reset timer)
            end
        end
    end
```

---

### Luồng 5: Debt Simplification Algorithm

```mermaid
sequenceDiagram
    actor User as User A
    participant API as core-api
    participant Worker as Worker Service
    participant DB as Postgres (BalanceSummary)

    User->>API: POST /api/v1/groups/{id}/simplify-debts
    API->>Worker: Queue SimplifyDebtsCommand via Kafka

    Worker->>DB: SELECT all pairwise balances for group

    Note over Worker: Step 1: Calculate Net Balance
    Note over Worker: A: +350k, B: -200k, C: +100k, D: -150k, E: -100k

    Note over Worker: Step 2: Separate Debtors and Creditors
    Note over Worker: Debtors: [B: -200k, D: -150k, E: -100k]
    Note over Worker: Creditors: [A: +350k, C: +100k]

    Note over Worker: Step 3: Greedy Matching (sort by absolute value)
    Note over Worker: Match B(-200k) → A(+350k): B pays A 200k. A remaining: +150k
    Note over Worker: Match D(-150k) → A(+150k): D pays A 150k. A remaining: 0
    Note over Worker: Match E(-100k) → C(+100k): E pays C 100k. Both done.

    Worker-->>API: Suggested Settlements
    API-->>User: HTTP 200<br/>[{from:B, to:A, amount:200k},<br/>{from:D, to:A, amount:150k},<br/>{from:E, to:C, amount:100k}]

    Note over User: 3 transactions instead of up to 10!
    Note over User: User confirms each one individually
```

---

### Luồng 6: Event Sourcing — Rebuild Balance (Replay)

```mermaid
sequenceDiagram
    participant Admin as Admin Trigger
    participant Worker as Worker Service
    participant ES as EventStore
    participant RM as BalanceSummary (Read Model)

    Admin->>Worker: POST /admin/groups/{id}/rebuild-balance

    Worker->>RM: DELETE all BalanceSummary WHERE groupId = X
    Note over Worker: Read Model wiped clean

    Worker->>ES: SELECT * FROM event_store<br/>WHERE aggregateType IN ('Expense','Settlement')<br/>AND groupId = X<br/>ORDER BY createdAt ASC

    loop For each event in chronological order
        alt ExpenseCreatedEvent
            Worker->>RM: Add pairwise balances from splits
        else ExpenseUpdatedEvent
            Worker->>RM: Apply delta (old splits → new splits)
        else ExpenseDeletedEvent
            Worker->>RM: Reverse all splits
        else SettlementCreatedEvent
            Worker->>RM: Reduce balance between payer↔receiver
        end
    end

    Worker-->>Admin: Rebuild complete. Verified: new == old ✅
```

---

## 3. HIGH-LEVEL ARCHITECTURE DIAGRAM

```
┌──────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  React SPA (Vite)                                   │     │
│  │  ├── Dashboard (Charts, Balances)                   │     │
│  │  ├── Expense Forms (Create/Edit)                    │     │
│  │  ├── Settlement Flow                                │     │
│  │  ├── Group Management                               │     │
│  │  └── WebSocket Client (Real-time updates)           │     │
│  └─────────────────────────────────────────────────────┘     │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTPS + WebSocket
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                 API GATEWAY / INGRESS                        │
│  ├── /auth/*        → auth-service (Fastify :3001)           │
│  ├── /api/v1/*      → core-api (NestJS :3000)                │
│  ├── /ws/*          → notification-service (:3004)           │
│  └── /exchange/*    → exchange-rate-service (:3005)           │
└───────────────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────────┐
        ▼               ▼                   ▼
┌──────────────┐ ┌──────────────────┐ ┌─────────────────┐
│ auth-service │ │    core-api      │ │ exchange-rate    │
│  (Fastify)   │ │   (NestJS)       │ │   -service       │
│              │ │                  │ │                  │
│ • JWT Auth   │ │ ┌──────────────┐ │ │ • Circuit Breaker│
│ • Refresh    │ │ │ group-module │ │ │ • Rate Caching   │
│   Rotation   │ │ ├──────────────┤ │ │ • Fallback       │
│ • Rate Limit │ │ │expense-module│ │ └──────┬──────────┘
└──────┬───────┘ │ ├──────────────┤ │        │
       │         │ │settle-module │ │        ▼
       ▼         │ ├──────────────┤ │  ┌──────────────┐
┌──────────────┐ │ │balance-module│ │  │ Fixer.io /   │
│  PostgreSQL  │ │ │ (Read Model) │ │  │ ExchangeRate │
│  (Auth DB)   │ │ ├──────────────┤ │  │  (3rd-party) │
└──────────────┘ │ │currency-mod  │ │  └──────────────┘
                 │ └──────────────┘ │
                 └────────┬─────────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
   ┌──────────────┐ ┌──────────┐  ┌──────────────┐
   │  PostgreSQL  │ │  Redis   │  │   Outbox      │
   │  (Core DB)   │ │ (Cache)  │  │   Table       │
   │              │ │          │  └──────┬────────┘
   │ • EventStore │ │ • Balance│         │ CDC/Polling
   │ • Expenses   │ │   Cache  │         ▼
   │ • Settlements│ │ • Rate   │  ┌──────────────┐
   │ • Balances   │ │   Cache  │  │    KAFKA      │
   │ • Idempotency│ │ • Pub/Sub│  │              │
   └──────────────┘ └──────────┘  │ Topics:      │
                                  │ • expense-*  │
                                  │ • settle-*   │
                                  │ • group-*    │
                                  │ • *-dlq      │
                                  └──┬───┬───┬───┘
                                     │   │   │
                     ┌───────────────┘   │   └────────────┐
                     ▼                   ▼                ▼
              ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
              │ worker-svc   │  │ notif-svc    │  │ search-svc   │
              │              │  │              │  │              │
              │ • Debt Simplify│ │ • WebSocket  │  │ • ES Index   │
              │ • Ledger Check│  │ • Push Notif │  │ • Full-text  │
              │ • Export PDF  │  │ • Redis PubSub│ │   Search     │
              │ • Auto-Archive│  │              │  │              │
              └──────────────┘  └──────────────┘  └──────────────┘
```
