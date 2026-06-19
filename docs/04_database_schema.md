# 🗄️ LƯỢC ĐỒ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA)

> 📖 **[English Version](./en/04_database_schema.md)**

Tài liệu định nghĩa cấu trúc cơ sở dữ liệu cho **Cortex**. Lược đồ thiết kế bằng **Prisma v7**, áp dụng **Modular Monolith** + **Event Sourcing** (credit) + **CQRS Read Model** + **OCC** + **Idempotency** + **pgvector** (semantic search).

---

## 1. Môi trường & Quy chuẩn

- **Database Engine:** PostgreSQL 16 (image `pgvector/pgvector:pg16`) — port `15432`.
- **2 logical DB:** `auth_db` (auth-service) và `core_db` (core-api), tạo qua `docker-init/init-dbs.sql`.
- **Extension:** `CREATE EXTENSION IF NOT EXISTS vector;` trên `core_db`.
- **ORM:** Prisma v7 — KHÔNG `url` trong `schema.prisma`, dùng `prisma.config.ts` (xem `directives/database_standard.md`).
- **Primary key:** UUID (`@default(uuid())`), KHÔNG dùng `autoincrement()`.
- **Naming:** camelCase trong code, `@map("snake_case")` trong DB.
- **Soft delete:** `deletedAt DateTime?` cho model quan trọng; `isActive` cho disable tạm.
- **Tenant scope:** mọi bảng nội dung mang `orgId` — KHÔNG FK chéo Domain (phục vụ tách Microservices sau).

---

## 2. Lược đồ Dữ liệu Chi tiết

### 🟢 2.1. Identity & Auth (`auth_db` — cách ly)

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  username      String?
  avatarUrl     String?
  isActive      Boolean  @default(true)
  emailVerified Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  authMethods   AuthMethod[]
  @@map("users")
}

model AuthMethod {
  id           String   @id @default(uuid())
  userId       String
  provider     String   // LOCAL, GOOGLE...
  passwordHash String?
  user         User     @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
  @@map("auth_methods")
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String
  expiresAt DateTime
  revokedAt DateTime?
  @@map("refresh_tokens")
}
```

> RBAC (Role, Permission) đã có trong auth-service; bổ sung khái niệm **org-scoped role** (token mang `orgId`) — xem `docs/10`.

---

### 🟦 2.2. Tenant Context (`core_db`)

```prisma
model Organization {
  id              String   @id @default(uuid())
  name            String
  slug            String   @unique
  seatLimit       Int      @default(10)
  aiRateLimitPerMin Int    @default(20)
  createdAt       DateTime @default(now())
  deletedAt       DateTime?

  spaces          Space[]
  memberships     Membership[]
  @@map("organizations")
}

model Membership {
  id        String   @id @default(uuid())
  orgId     String
  userId    String   // loose ref to auth_db user
  role      OrgRole  @default(MEMBER)
  joinedAt  DateTime @default(now())
  org       Organization @relation(fields: [orgId], references: [id])

  @@unique([orgId, userId])
  @@index([orgId])
  @@map("memberships")
}

enum OrgRole { OWNER ADMIN MEMBER GUEST }

model Space {
  id         String   @id @default(uuid())
  orgId      String
  name       String
  visibility SpaceVisibility @default(ORG)
  deletedAt  DateTime?
  org        Organization @relation(fields: [orgId], references: [id])

  @@index([orgId])
  @@map("spaces")
}

enum SpaceVisibility { ORG PRIVATE }
```

---

### 🟩 2.3. Knowledge Context (Write Model + OCC + Versioning)

```prisma
model KnowledgeItem {
  id           String   @id @default(uuid())
  orgId        String   // tenant scope
  spaceId      String
  type         KnowledgeType
  title        String
  body         String   @db.Text
  parentId     String?  // ANSWER -> QUESTION
  status       KnowledgeStatus @default(DRAFT)
  isVerified   Boolean  @default(false)
  version      Int      @default(1)   // OCC
  contentHash  String?  // re-embed dedup
  createdByUserId String
  updatedByUserId String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?

  revisions    Revision[]
  votes        Vote[]
  embedding    Embedding?

  @@index([orgId, spaceId])
  @@index([orgId, status])
  @@map("knowledge_items")
}

enum KnowledgeType { DOCUMENT QUESTION ANSWER RUNBOOK ADR }
enum KnowledgeStatus { DRAFT PUBLISHED ARCHIVED STALE }

model Revision {
  id           String   @id @default(uuid())
  itemId       String
  version      Int
  bodySnapshot String   @db.Text
  editedByUserId String
  createdAt    DateTime @default(now())
  item         KnowledgeItem @relation(fields: [itemId], references: [id])

  @@unique([itemId, version])
  @@map("revisions")
}

model Tag {
  id     String @id @default(uuid())
  orgId  String
  name   String
  @@unique([orgId, name])
  @@map("tags")
}
```

> **OCC:** `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?` → 0 rows affected ⇒ HTTP 409 Conflict.

---

### 🟪 2.4. Discovery Context (pgvector)

```prisma
/// Cột vector dùng pgvector. Trong Prisma v7 khai báo qua Unsupported type
/// và tạo index HNSW bằng raw migration.
model Embedding {
  id          String   @id @default(uuid())
  itemId      String   @unique
  orgId       String   // AI Data Boundary: retrieval luôn lọc theo org
  embedding   Unsupported("vector(1024)")
  contentHash String
  createdAt   DateTime @default(now())
  item        KnowledgeItem @relation(fields: [itemId], references: [id])

  @@index([orgId])
  @@map("embeddings")
}
```

```sql
-- Raw migration: HNSW index cho cosine distance
CREATE INDEX embeddings_vector_hnsw
  ON embeddings USING hnsw (embedding vector_cosine_ops);
```

**Hybrid Retrieval query (minh hoạ):**
```sql
-- Semantic: top-K theo cosine similarity, SCOPED theo org
SELECT item_id, 1 - (embedding <=> $queryVec) AS score
FROM embeddings
WHERE org_id = $orgId
ORDER BY embedding <=> $queryVec
LIMIT 20;
```
→ Hợp nhất với kết quả BM25 từ Elasticsearch bằng **Reciprocal Rank Fusion**.

---

### 🟨 2.5. Engagement Context

```prisma
model Vote {
  id      String @id @default(uuid())
  itemId  String
  userId  String
  value   Int    // +1 / -1
  item    KnowledgeItem @relation(fields: [itemId], references: [id])

  @@unique([itemId, userId])
  @@map("votes")
}

model Bookmark {
  id      String @id @default(uuid())
  userId  String
  itemId  String
  @@unique([userId, itemId])
  @@map("bookmarks")
}
```

---

### 🟧 2.6. Credit Context (Event Sourcing — Write Model)

```prisma
/// Append-only. KHÔNG BAO GIỜ update/delete row.
model EventStore {
  id            String   @id @default(uuid())
  aggregateType String   // "CreditAccount", "Reputation"
  aggregateId   String   // orgId hoặc userId
  eventType     String   // "CreditSpent", "CreditAwarded"...
  version       Int      // per-aggregate sequence
  payload       Json
  userId        String?
  createdAt     DateTime @default(now())

  @@unique([aggregateType, aggregateId, version])
  @@index([aggregateType, aggregateId])
  @@map("event_store")
}
```

**Credit event types:** `CreditPurchased`, `CreditAwarded`, `CreditRefunded` (+) · `CreditSpent`, `CreditStaked`, `CreditReserved` (−).

---

### 🟫 2.7. Read Models (CQRS — Projection)

```prisma
model CreditBalanceSummary {
  orgId     String   @id
  balance   Int      @default(0)
  reserved  Int      @default(0) // locked bởi saga đang chạy
  updatedAt DateTime @updatedAt
  @@map("credit_balance_summary")
}

model FeedTimeline {
  id        String   @id @default(uuid())
  orgId     String
  userId    String   // người nhận feed
  itemId    String
  reason    String   // "new_in_space", "followed_author"
  createdAt DateTime @default(now())
  @@index([orgId, userId, createdAt])
  @@map("feed_timeline")
}

model ReputationSummary {
  userId    String   @id
  orgId     String
  points    Int      @default(0)
  badges    Json     @default("[]")
  updatedAt DateTime @updatedAt
  @@map("reputation_summary")
}
```

> Read Models có thể **rebuild** bất cứ lúc nào bằng replay Event Store + projection từ Kafka.

---

### ⚙️ 2.8. Infrastructure (Outbox + Idempotency)

```prisma
model OutboxEvent {
  id            String   @id @default(uuid())
  aggregateType String
  aggregateId   String
  eventType     String
  payload       Json
  status        OutboxStatus @default(PENDING)
  createdAt     DateTime @default(now())
  processedAt   DateTime?
  @@index([status, createdAt])
  @@map("outbox_events")
}

enum OutboxStatus { PENDING PROCESSED FAILED_DLQ }

model IdempotencyRecord {
  key       String   @id // X-Idempotency-Key
  response  Json
  createdAt DateTime @default(now())
  expiresAt DateTime
  @@index([expiresAt])
  @@map("idempotency_records")
}
```

---

## 3. Sơ đồ phụ thuộc Module ↔ Bảng

| Module | Bảng chính | Vai trò |
|--------|-----------|---------|
| `tenant` | organizations, memberships, spaces | Multi-tenancy |
| `knowledge` | knowledge_items, revisions, tags | Write + OCC + versioning |
| `discovery` | embeddings (pgvector) | Semantic search / RAG |
| `engagement` | votes, bookmarks | Tương tác |
| `credit` | event_store, credit_balance_summary | Event Sourcing ledger |
| `reputation` | reputation_summary | Gamification (Read Model) |
| `feed` | feed_timeline | CQRS Read Model |
| (infra) | outbox_events, idempotency_records | Outbox + Idempotency |

---

## 4. Quy tắc Bất biến (Invariants)

1. **Append-only Event Store:** không UPDATE/DELETE — chỉ INSERT event mới.
2. **Tenant isolation:** mọi query nội dung BẮT BUỘC có `WHERE org_id = ?`.
3. **AI Data Boundary:** retrieval embeddings luôn scope `orgId`.
4. **OCC:** mọi update wiki kiểm tra `version`.
5. **Outbox atomicity:** domain write + outbox insert trong **cùng 1 transaction**.
6. **Ledger Integrity:** `Sum(credit events) == CreditBalanceSummary.balance` (cron đêm verify).
