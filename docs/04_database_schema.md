# 🗄️ LƯỢC ĐỒ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA)


Tài liệu định nghĩa cấu trúc cơ sở dữ liệu cho **Cortex**. Lược đồ thiết kế bằng **Prisma v7**, áp dụng **Modular Monolith** + **Event Sourcing** (credit) + **CQRS Read Model** + **OCC** + **Idempotency** + **pgvector** (semantic search).

---

## 1. Môi trường & Quy chuẩn

- **Database Engine:** PostgreSQL 16 (image `pgvector/pgvector:pg16`) — port `15432`.
- **4 logical DB, mỗi service sở hữu DB riêng** (own-data pattern, KHÔNG cross-DB join): `auth_db` (auth-service), `core_db` (core-api), `notification_db` (notification-service), `search_db` (search-service) — tạo qua `docker-init/init-dbs.sql`. `worker-service` KHÔNG có DB riêng — schema của nó là bản mirror type-gen **read-only** trỏ vào `core_db` (không `db:push`).
- **Extension:** `CREATE EXTENSION IF NOT EXISTS vector;` bật trên cả `core_db` (hiện không có model dùng — vestigial) và `search_db` (nơi pgvector thực sự được dùng, xem §2.4).
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
  isActive      Boolean  @default(true)
  emailVerified Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime? // Soft delete

  authIdentities AuthIdentity[]
  refreshTokens  RefreshToken[]
  roles          UserRole[]
  profile        UserProfile?
  @@map("users")
}

/// Hồ sơ hiển thị, tách khỏi User (identity) — 1-1.
model UserProfile {
  id          String   @id @default(uuid())
  userId      String   @unique
  firstName   String?
  lastName    String?
  displayName String?
  avatarUrl   String?
  phoneNumber String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("user_profiles")
}

enum AuthProvider { LOCAL GOOGLE APPLE }

model AuthIdentity {
  id           String       @id @default(uuid())
  userId       String
  provider     AuthProvider @default(LOCAL)
  passwordHash String?
  providerId   String?      // Google/Apple external id
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])
  @@unique([provider, providerId])
  @@map("auth_identities")
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiredAt DateTime
  usedAt    DateTime? // rotation / reuse detection
  revokedAt DateTime?
  ipAddress String?
  userAgent String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("refresh_tokens")
}
```

> **System RBAC (Role/UserRole) là model thật trong `auth_db`,** không chỉ khái niệm ở tầng code:
> ```prisma
> model Role {
>   id          String   @id @default(uuid())
>   code        String   @unique // "SUPER_ADMIN", "CONTENT_MODERATOR"... — xem SystemRole
>   name        String
>   description String?
>   isActive    Boolean  @default(true)
>   // Permission catalog đóng, định nghĩa ở code (SystemPermission, shared-kernel)
>   // — cột string[] chứ KHÔNG có bảng Permission/RolePermission riêng.
>   permissions String[] @default([])
>   users       UserRole[]
>   @@map("roles")
> }
> model UserRole {
>   userId String
>   roleId String
>   user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
>   role   Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
>   @@id([userId, roleId])
>   @@map("user_roles")
> }
> ```
> Đây là **System RBAC** (platform-wide, KHÔNG org-scoped). Org-scoped role sống ở `core_db` (`Membership.role` + `OrgRolePermission`, xem §2.2). Token KHÔNG mang `orgId` — xem `docs/10`.

---

### 🟦 2.2. Tenant Context (`core_db`)

```prisma
model Organization {
  id          String    @id @default(uuid())
  name        String
  slug        String    // unique CHỈ trong org chưa xóa-mềm (partial index `WHERE deleted_at IS NULL`) — slug nhả lại khi org bị soft-delete
  seatLimit   Int       @default(10)
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?

  spaces          Space[]
  memberships     Membership[]
  rolePermissions OrgRolePermission[]
  invites         OrgInvite[]
  @@map("organizations")
}
```
> **Lưu ý:** `aiRateLimitPerMin` từng được đặc tả ở đây nhưng KHÔNG có trong schema thật — rate-limiting AI hiện chưa implement (xem `docs/10` §4, đang aspirational). Nếu build tính năng này, field sẽ thêm vào `Organization` lúc đó.
```prisma

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

/// Org RBAC động: mapping role → permission, per-org, OWNER chỉnh runtime.
/// Catalog permission do code định nghĩa (OrgPermission const); bảng này chỉ
/// lưu "role nào có permission nào" trong từng org. Seed default khi tạo org.
/// OWNER KHÔNG cần row ở đây — OrgGuard coi OWNER có toàn bộ quyền (implicit).
model OrgRolePermission {
  id         String   @id @default(uuid())
  orgId      String
  role       OrgRole
  permission String   // khớp giá trị trong OrgPermission catalog (vd: "knowledge:write")
  createdAt  DateTime @default(now())
  org        Organization @relation(fields: [orgId], references: [id])

  @@unique([orgId, role, permission])
  @@index([orgId, role])
  @@map("org_role_permissions")
}

model OrgInvite {
  id        String    @id @default(uuid())
  token     String    @unique           // 32-byte hex, single-use
  orgId     String
  role      OrgRole   @default(MEMBER)  // role được cấp khi accept
  createdBy String                      // loose ref userId (auth_db)
  expiresAt DateTime                    // TTL 1–168h, default 72h
  usedAt    DateTime?                   // null = chưa dùng
  usedBy    String?                     // userId đã accept

  org Organization @relation(fields: [orgId], references: [id])

  @@index([orgId])
  @@map("org_invites")
}
```

> **Org RBAC động:** Catalog (danh sách permission tồn tại) ở **code**; Mapping (role↔permission per-org) ở **DB**. OWNER quản lý qua API `PATCH /orgs/:id/role-permissions/:role`. Chi tiết: `docs/10` §2.2.
>
> **Invite flow:** `POST /orgs/:id/invites` (ADMIN+) → token hex 64 ký tự → share link → `POST /invites/accept` → tạo `Membership` + đánh dấu invite used trong cùng 1 transaction.

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
  acceptedAnswerId String? // QUESTION -> answer đã accept
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

### 🟪 2.4. Discovery Context (pgvector) — `search_db`, service riêng (`search-service`)

> **KHÔNG còn ở `core_db`.** Model `Embedding` từng đặc tả trong `core_db` đã bị gỡ trong đợt rollback read-model (2026-06-30, trước Phase 4). Khi Phase 4 (RAG/AI Search) triển khai thật (2026-07-02), embedding được xây lại như **service riêng** (`search-service`, own `search_db`) — consume `KnowledgePublished` (Kafka), snapshot `body` vào chunk, KHÔNG cross-DB join vào `core_db`. Đơn vị lưu là **chunk**, không phải nguyên `KnowledgeItem`.

```prisma
// search_db — apps/search-service/prisma/schema.prisma
model KnowledgeChunk {
  id              String   @id @default(uuid())
  knowledgeItemId String   // loose ref tới core_db.knowledge_items.id
  orgId           String   // AI Data Boundary: retrieval luôn lọc theo org
  spaceId         String
  chunkIndex      Int
  content         String
  titleSnapshot   String   // snapshot, không join core_db lúc render
  // pgvector dim 768 (self-hosted Ollama nomic-embed-text — Claude KHÔNG có
  // embeddings API). Prisma không có type vector gốc → Unsupported, đọc/ghi
  // qua raw SQL. Index HNSW tạo bằng raw migration.
  embedding       Unsupported("vector(768)")?
  createdAt       DateTime @default(now())

  @@unique([knowledgeItemId, chunkIndex])
  @@index([orgId])
  @@map("knowledge_chunks")
}
```

```sql
-- Raw migration: HNSW index cho cosine distance
CREATE INDEX knowledge_chunks_vector_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

**Hybrid Retrieval query (minh hoạ):**
```sql
-- Semantic: top-K theo cosine similarity, SCOPED theo org
SELECT knowledge_item_id, 1 - (embedding <=> $queryVec) AS score
FROM knowledge_chunks
WHERE org_id = $orgId
ORDER BY embedding <=> $queryVec
LIMIT 20;
```
→ Hợp nhất với kết quả BM25 từ Elasticsearch (per-tenant index riêng) bằng **Reciprocal Rank Fusion** (k=60, item-level). Circuit Breaker bảo vệ bước RAG summary (Claude); ES down → degrade còn semantic-only, không 500.

---

### 🟨 2.5. Engagement Context

```prisma
model Vote {
  id        String   @id @default(uuid())
  orgId     String
  itemId    String
  userId    String
  value     Int      // +1 upvote / -1 downvote
  createdAt DateTime @default(now())
  item      KnowledgeItem @relation(fields: [itemId], references: [id])

  @@unique([itemId, userId])
  @@index([orgId, itemId])
  @@map("votes")
}

model Bookmark {
  id        String   @id @default(uuid())
  orgId     String
  userId    String
  itemId    String
  createdAt DateTime @default(now())
  @@unique([userId, itemId])
  @@index([orgId, userId])
  @@map("bookmarks")
}

/// Follow — DOCUMENT hoặc SPACE. Nguồn cho fan-out (feed §2.7 cũ đã rollback,
/// notification-service fan-out qua SpaceFollower projection riêng của nó) +
/// GET /feed (fan-out-on-read, query trực tiếp source-of-truth, không có bảng
/// riêng cho feed — xem §2.7).
model Follow {
  id         String           @id @default(uuid())
  orgId      String
  userId     String
  targetType FollowTargetType
  targetId   String
  createdAt  DateTime         @default(now())

  @@unique([userId, targetType, targetId])
  @@index([orgId, userId])
  @@map("follows")
}

enum FollowTargetType { DOCUMENT SPACE }
```

---

### 🟧 2.6. Credit + Reputation Context (Event Sourcing — Write Model)

Mỗi aggregate có bảng riêng để index nhỏ hơn và query không lẫn nhau.

```prisma
/// Append-only credit event ledger. KHÔNG BAO GIỜ update/delete row.
/// eventType: CreditPurchased | CreditAwarded | CreditRefunded (+)
///            CreditSpent | CreditStaked | CreditReserved (−)
model CreditEvent {
  id          String   @id @default(uuid())
  aggregateId String   // CreditAccount id = orgId
  eventType   String
  version     Int      // per-aggregate sequence cho OCC
  payload     Json
  userId      String?
  createdAt   DateTime @default(now())

  @@unique([aggregateId, version])
  @@index([aggregateId])
  @@map("credit_events")
}

/// Append-only reputation event ledger. KHÔNG BAO GIỜ update/delete row.
/// eventType: PointsEarned | PointsDeducted | BadgeAwarded | BadgeRevoked
model ReputationEvent {
  id          String   @id @default(uuid())
  aggregateId String   // userId (reputation per user per org)
  eventType   String
  version     Int      // per-aggregate sequence cho OCC
  payload     Json
  orgId       String   // reputation scoped per org
  createdAt   DateTime @default(now())

  @@unique([aggregateId, version])
  @@index([aggregateId])
  @@index([orgId])
  @@map("reputation_events")
}
```

**Credit event types:** `CreditPurchased`, `CreditAwarded`, `CreditRefunded` (+) · `CreditSpent`, `CreditStaked`, `CreditReserved` (−).
**Reputation event types:** `PointsEarned`, `PointsDeducted`, `BadgeAwarded`, `BadgeRevoked`.

---

### 🟫 2.7. Read Models (CQRS — Projection) — ⛔ ROLLED BACK, hiện KHÔNG tồn tại trong schema

> **Quyết định 2026-06-30 (`.ai/CHANGELOG.md`):** `CreditBalanceSummary`, `FeedTimeline`, `ReputationSummary`, và `UserProfile`-as-projection (bản sao tối giản danh tính trong `core_db`) từng được đặc tả ở đây đã bị **gỡ khỏi schema thật** trước khi bất kỳ đường đọc nào dùng tới — quy tắc mới: *schema chỉ chứa source-of-truth; read model/projection để dành tới read phase (Phase 3, hiện chưa bắt đầu)*. Các model này **không tồn tại** trong `core_db` hiện tại — đây KHÔNG phải thiếu sót của tài liệu, mà là trạng thái thật, cố ý.
>
> **Query hiện tại đi thẳng source-of-truth (fold-on-read), không qua projection:**
> - **Credit balance:** `GET /credits/wallet` fold trực tiếp từ `credit_events` (§2.6) lúc request tới, KHÔNG có bảng `credit_balance_summary`.
> - **Feed:** `GET /feed` là fan-out-on-read — query thẳng `follows` (targetType=SPACE) × `knowledge_items` (status=PUBLISHED), KHÔNG có bảng `feed_timeline`.
> - **Reputation:** ledger `reputation_events` (§2.6) đã có, nhưng Phase 5c (bounty + reputation, kể cả mọi HTTP endpoint đọc điểm) **chưa triển khai** — không có bảng `reputation_summary` lẫn endpoint `GET /reputation/*`.
> - **Danh tính tác giả (User Identity Projection):** core_db vẫn chỉ giữ `userId` (loose ref, không FK). Chưa có đồng bộ `user_profiles` qua event trong `core_db` — nếu cần hiển thị tên/avatar, phải gọi chéo sang auth-service hoặc chấp nhận chỉ hiển thị `userId` ở thời điểm hiện tại. (Lưu ý: `auth_db` CÓ bảng `user_profiles` riêng — xem §2.1 — nhưng đó là **profile của chính user**, không phải projection phục vụ core-api.)
>
> Nếu build read phase (Phase 3) sau này, các model trên là điểm khởi đầu hợp lý — nhưng phải thêm lại có chủ đích, kèm cơ chế rebuild từ Event Store/Kafka, không phục hồi nguyên trạng cũ.

---

### ⚙️ 2.8. Infrastructure (Outbox + Idempotency)

```prisma
model OutboxEvent {
  id            String       @id @default(uuid())
  aggregateType String
  aggregateId   String
  eventType     String
  // Denormalized từ tenant context của command sinh event (mirror CreditEvent/
  // ReputationEvent) — CloudEvents `orgid` extension build TỪ cột này lúc
  // publish, không đào từ payload nữa (single source of truth, fix 2026-07-03).
  orgId         String
  payload       Json
  status        OutboxStatus @default(PENDING)
  attempts      Int          @default(0)
  lastError     String?
  createdAt     DateTime     @default(now())
  processedAt   DateTime?
  // Set khi poller claim row (PENDING → INFLIGHT, FOR UPDATE SKIP LOCKED) —
  // Reaper reset row bị orphan (claim rồi crash trước khi publish xong).
  claimedAt     DateTime?
  // W3C traceparent của command sinh ra row này (capture từ trace-context ALS
  // lúc append() — không cần sửa call site nào), copy sang CloudEvent
  // `traceparent` extension lúc publish (resilience_patterns.md §7, 2026-07-21).
  traceparent   String?

  @@index([status, createdAt])
  @@index([orgId])
  @@map("outbox_events")
}

enum OutboxStatus { PENDING INFLIGHT PROCESSED FAILED_DLQ }

model IdempotencyRecord {
  key         String   @id // X-Idempotency-Key
  // sha256(method+url+body) claim dưới key này — bắt hazard kiểu Stripe: client
  // tái dùng cùng key cho request THỰC SỰ khác (bug/copy-paste key) → reject
  // thay vì replay nhầm response cũ.
  requestHash String
  // NULL = key vừa claim, handler đang chạy (concurrent-request guard). Điền
  // khi handler xong.
  response    Json?
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  @@index([expiresAt])
  @@map("idempotency_records")
}
```

---

## 3. Sơ đồ phụ thuộc Module ↔ Bảng

**`core_db` (core-api):**

| Module | Bảng chính | Vai trò |
|--------|-----------|---------|
| `tenant` | organizations, memberships, spaces, org_role_permissions, org_invites | Multi-tenancy + Org RBAC động |
| `knowledge` | knowledge_items, revisions, tags | Write + OCC + versioning |
| `engagement` | votes, bookmarks, follows | Tương tác + follow (nguồn cho feed/fan-out) |
| `credit` | credit_events | Event Sourcing ledger — balance fold-on-read, KHÔNG có summary table (§2.7) |
| `reputation` | reputation_events | Event Sourcing ledger — chưa có endpoint đọc (Phase 5c chưa làm) |
| `feed` | (không có bảng riêng) | Query-side thuần: fan-out-on-read trên follows × knowledge_items |
| (infra) | outbox_events, idempotency_records | Outbox + Idempotency |

**Service khác, mỗi service 1 DB riêng, không cross-DB join:**

| Service | DB | Bảng chính | Vai trò |
|---|---|---|---|
| auth-service | `auth_db` | users, user_profiles, auth_identities, refresh_tokens, roles, user_roles | Identity + System RBAC |
| notification-service | `notification_db` | notifications, space_followers | Fan-out notify + local follow projection |
| search-service | `search_db` | knowledge_chunks (pgvector) | Semantic + hybrid (RRF) search / RAG |
| worker-service | (không có DB riêng) | mirror type-gen `follows` từ `core_db`, read-only | Scaffold — chưa có consumer thật |

---

## 4. Quy tắc Bất biến (Invariants)

1. **Append-only Event Store:** không UPDATE/DELETE — chỉ INSERT event mới (`credit_events`, `reputation_events`).
2. **Tenant isolation:** mọi query nội dung BẮT BUỘC có `WHERE org_id = ?`.
3. **AI Data Boundary:** retrieval `knowledge_chunks` (search_db) luôn scope `orgId`.
4. **OCC:** mọi update wiki kiểm tra `version`.
5. **Outbox atomicity:** domain write + outbox insert trong **cùng 1 transaction**.
6. **Ledger Integrity:** `Sum(credit events theo aggregateId) == balance` — verify được bằng fold-on-read, không phải cron đối chiếu với summary table (không còn tồn tại, §2.7). Smoke test đã xác nhận sống trên DB thật (2026-07-03).
