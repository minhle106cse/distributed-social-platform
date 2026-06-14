# 🗄️ LƯỢC ĐỒ CƠ SỞ DỮ LIỆU (DATABASE SCHEMA)

> 📖 **[English Version](./en/04_database_schema.md)**

Tài liệu định nghĩa cấu trúc cơ sở dữ liệu cho **TeamFin**. Lược đồ được thiết kế bằng **Prisma ORM**, áp dụng triết lý **Modular Monolith** kết hợp **Event Sourcing**, **CQRS Read Model**, **Optimistic Concurrency Control (OCC)**, và **Idempotency**.

---

## 1. Môi trường & Quy chuẩn

- **Database Engine:** PostgreSQL 15+
- **ORM:** Prisma
- **Kiến trúc:** Phân tách logic theo Domain Context. Tuyệt đối KHÔNG gài Foreign Key chéo giữa các Domain để phục vụ tách Microservices trong tương lai.
- **Đơn vị tiền:** Lưu bằng **đơn vị nhỏ nhất** (VND: đồng, USD: cent). VD: 50 USD = 5000 cents. Tránh lỗi floating point.

---

## 2. Lược đồ Dữ liệu Chi tiết

### 🟢 2.1. Module Identity & Auth (auth-service DB — Cách ly)

```prisma
model User {
  id             String       @id @default(uuid())
  email          String       @unique
  username       String
  avatarUrl      String?
  status         UserStatus   @default(ACTIVE)

  authIdentities AuthIdentity[]

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model AuthIdentity {
  id             String       @id @default(uuid())
  userId         String
  provider       AuthProvider @default(LOCAL)
  passwordHash   String?
  refreshToken   String?

  user           User         @relation(fields: [userId], references: [id])
}

enum UserStatus {
  ACTIVE
  BANNED
}

enum AuthProvider {
  LOCAL
  GOOGLE
}
```

---

### 🔵 2.2. Module Group (core-api DB)

Quản lý nhóm tài chính và thành viên.

```prisma
model FinanceGroup {
  id             String       @id @default(uuid())
  name           String
  description    String?
  type           GroupType    @default(PERSISTENT)
  status         GroupStatus  @default(ACTIVE)
  baseCurrency   String       @default("VND") // ISO 4217
  startDate      DateTime?    @db.Date
  endDate        DateTime?    @db.Date

  // OCC: Version field chống concurrent update
  version        Int          @default(0)

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  members        GroupMember[]
  invites        GroupInvite[]
}

model GroupMember {
  id             String       @id @default(uuid())
  userId         String       // Loose ref — NO FK to User table
  groupId        String
  role           GroupRole    @default(MEMBER)

  joinedAt       DateTime     @default(now())

  group          FinanceGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([userId, groupId]) // 1 user chỉ join 1 lần trong 1 nhóm
}

model GroupInvite {
  id             String       @id @default(uuid())
  groupId        String
  inviteCode     String       @unique
  invitedByUserId String      // Loose ref
  expiresAt      DateTime

  group          FinanceGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
}

enum GroupType {
  PERSISTENT   // Nhóm dài hạn (ở chung nhà, quỹ team)
  TRIP         // Nhóm sự kiện (du lịch, tiệc)
  QUICK_SPLIT  // Chia nhanh 1 lần
}

enum GroupStatus {
  ACTIVE       // Đang hoạt động
  SETTLED      // Tất cả balance = 0
  ARCHIVED     // Đã lưu trữ (read-only)
}

enum GroupRole {
  OWNER        // Tạo nhóm, toàn quyền
  ADMIN        // Quản lý members, sửa/xóa expense của người khác
  MEMBER       // Tạo/sửa/xóa expense của mình
  VIEWER       // Chỉ xem (cho kế toán/giám sát)
}
```

---

### 🟡 2.3. Module Expense — Write Model (core-api DB)

Ghi nhận chi phí. Cấu trúc hỗ trợ multi-payer, multi-split, multi-currency.

```prisma
model Expense {
  id                String       @id @default(uuid())
  groupId           String       // Loose ref
  description       String
  totalAmount       Int          // Đơn vị nhỏ nhất (VND = đồng, USD = cents)
  currency          String       // ISO 4217: VND, USD, EUR...
  exchangeRate      Decimal?     @db.Decimal(12, 6) // Tỷ giá tại thời điểm tạo
  convertedAmount   Int?         // Quy đổi về base currency của nhóm
  splitMethod       SplitMethod
  category          ExpenseCategory @default(OTHER)
  noteText          String?
  receiptUrl        String?
  expenseDate       DateTime     @db.Date // Ngày xảy ra (có thể khác createdAt)

  isDeleted         Boolean      @default(false) // Soft delete

  // OCC: Chống race condition khi 2 người sửa cùng lúc
  version           Int          @default(0)

  createdByUserId   String       // Loose ref
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  payers            ExpensePayer[]
  splits            ExpenseSplit[]
}

// Ai đã trả tiền? (Hỗ trợ multi-payer)
model ExpensePayer {
  id                String       @id @default(uuid())
  expenseId         String
  userId            String       // Loose ref
  amount            Int          // Số tiền người này đã bỏ ra

  expense           Expense      @relation(fields: [expenseId], references: [id], onDelete: Cascade)

  @@unique([expenseId, userId]) // Mỗi user chỉ là payer 1 lần trong 1 expense
}

// Ai nợ bao nhiêu?
model ExpenseSplit {
  id                String       @id @default(uuid())
  expenseId         String
  userId            String       // Loose ref
  amount            Int          // Số tiền người này nợ
  percentage        Decimal?     @db.Decimal(5, 2) // Nếu PERCENTAGE split
  shares            Int?         // Nếu SHARES split

  expense           Expense      @relation(fields: [expenseId], references: [id], onDelete: Cascade)

  @@unique([expenseId, userId])
}

enum SplitMethod {
  EQUAL            // Chia đều
  EXACT            // Số tiền chính xác
  PERCENTAGE       // Theo phần trăm
  SHARES           // Theo số phần
}

enum ExpenseCategory {
  FOOD
  TRANSPORT
  ACCOMMODATION
  ENTERTAINMENT
  UTILITIES
  SHOPPING
  HEALTH
  EDUCATION
  OTHER
}
```

---

### 🔴 2.4. Module Settlement (core-api DB)

Ghi nhận thanh toán nợ giữa các thành viên.

```prisma
model Settlement {
  id                String       @id @default(uuid())
  groupId           String       // Loose ref
  fromUserId        String       // Loose ref — Người trả nợ
  toUserId          String       // Loose ref — Người nhận tiền
  amount            Int          // Đơn vị nhỏ nhất
  currency          String       // Tiền tệ settle (có thể khác base currency)
  exchangeRate      Decimal?     @db.Decimal(12, 6)
  convertedAmount   Int?         // Quy đổi về base currency
  type              SettlementType
  noteText          String?

  createdByUserId   String       // Loose ref
  createdAt         DateTime     @default(now())
}

enum SettlementType {
  FULL             // Trả hết nợ cho 1 người
  PARTIAL          // Trả một phần
  RECORD_ONLY      // Chỉ ghi nhận (tiền mặt ngoài app)
}
```

---

### 🟣 2.5. Event Store (Event Sourcing — core-api DB)

Sổ cái bất biến. Mọi thay đổi tài chính đều được ghi nhận ở đây.

```prisma
model EventStore {
  id                String       @id @default(uuid())
  aggregateType     String       // "Expense", "Settlement", "Group"
  aggregateId       String       // ID của entity liên quan
  eventType         String       // "ExpenseCreated", "ExpenseUpdated", "SettlementCreated"...
  version           Int          // Version per aggregate (tăng dần)
  payload           Json         // Nội dung event chi tiết

  userId            String       // Ai đã trigger event này
  createdAt         DateTime     @default(now())

  // Composite index cho replay performance
  @@index([aggregateType, aggregateId, version])
  // Index cho ledger integrity check
  @@index([aggregateType, createdAt])
}
```

**Event Types:**
| Event | Trigger | Payload chính |
|-------|---------|--------------|
| `ExpenseCreated` | Tạo expense mới | Full expense data + splits |
| `ExpenseUpdated` | Sửa expense | Delta changes (old → new values) |
| `ExpenseDeleted` | Xóa expense (soft) | expenseId, deletedBy |
| `SettlementCreated` | Thanh toán nợ | fromUser, toUser, amount |
| `SettlementFailed` | Saga rollback | reason, compensatedEventId |
| `GroupCreated` | Tạo nhóm | Full group data |
| `MemberJoined` | Thành viên vào nhóm | userId, role |
| `MemberLeft` | Thành viên rời nhóm | userId, reason |

---

### 🟢 2.6. Balance — Read Model (CQRS — core-api DB)

Bảng denormalized lưu kết quả tính toán "Ai nợ ai bao nhiêu". Được rebuild từ Event Store.

```prisma
// Ma trận nợ pairwise: Mỗi cặp (fromUser, toUser) trong 1 nhóm
model BalanceSummary {
  id                String       @id @default(uuid())
  groupId           String       // Loose ref
  fromUserId        String       // Người nợ
  toUserId          String       // Người được nợ
  balance           Int          // > 0 means fromUser owes toUser
  currency          String       // Base currency of group

  updatedAt         DateTime     @updatedAt

  @@unique([groupId, fromUserId, toUserId])
  @@index([groupId])
  @@index([fromUserId])
}

// Tổng hợp chi tiêu theo danh mục (cho Analytics dashboard)
model SpendingByCategory {
  id                String       @id @default(uuid())
  groupId           String
  category          ExpenseCategory
  totalAmount       Int          // Tổng chi tiêu trong category này
  month             DateTime     @db.Date // Tháng (YYYY-MM-01)

  @@unique([groupId, category, month])
}

// Budget tracking
model GroupBudget {
  id                String       @id @default(uuid())
  groupId           String       @unique
  monthlyLimit      Int          // Ngân sách tháng (đơn vị nhỏ nhất)
  currency          String

  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
}
```

---

### ⚙️ 2.7. Infrastructure Tables (core-api DB)

```prisma
// Outbox Pattern: Đảm bảo ghi DB + publish event là atomic
model OutboxEvent {
  id                String       @id @default(uuid())
  aggregateType     String       // "Expense", "Settlement"
  aggregateId       String
  eventType         String       // "ExpenseCreated", "SettlementCreated"
  payload           Json
  status            OutboxStatus @default(PENDING)

  createdAt         DateTime     @default(now())
  processedAt       DateTime?

  @@index([status, createdAt]) // Polling Publisher query
}

// Idempotency: Chống double-submit cho financial operations
model IdempotencyRecord {
  key               String       @id // X-Idempotency-Key header value
  response          Json         // Cached response
  statusCode        Int          // HTTP status code

  createdAt         DateTime     @default(now())
  expiresAt         DateTime     // Auto-cleanup expired records

  @@index([expiresAt]) // TTL cleanup job
}

// Exchange Rate Cache (persisted fallback for Circuit Breaker)
model ExchangeRateCache {
  id                String       @id @default(uuid())
  fromCurrency      String       // "USD"
  toCurrency        String       // "VND"
  rate              Decimal      @db.Decimal(12, 6) // 25000.000000
  source            String       // "fixer.io", "exchangerate-api"

  fetchedAt         DateTime     @default(now())

  @@unique([fromCurrency, toCurrency])
  @@index([fetchedAt])
}

enum OutboxStatus {
  PENDING
  PROCESSED
  FAILED_DLQ
}
```

---

## 3. Lý giải Kiến trúc Nâng cao

### 3.1. Không Foreign Key Xuyên Domain

Các ID như `userId` trong `Expense`, `GroupMember`, `Settlement` chỉ lưu dưới dạng `String` thuần túy. Tính toàn vẹn duy trì qua Logic Code + Event Store. Khi tách Microservice (Phase 7), chỉ cần move table + đổi connection string, không cần migration FK.

### 3.2. Event Sourcing: Tại sao cần EventStore?

```
Traditional:  UPDATE wallet SET balance = 800  (Mất dữ liệu lịch sử!)
Event Store:  Event 1: ExpenseCreated  +1000
              Event 2: SettlementCreated  -200
              Current Balance = replay(events) = 800
```

- **Audit:** Biết chính xác ai sửa gì, khi nào.
- **Rebuild:** Xóa hết Read Model, replay events → Balance chính xác 100%.
- **Debug:** Replay events đến thời điểm X để tái hiện bug.

### 3.3. OCC (Optimistic Concurrency Control)

Trường `version` ở `Expense` và `FinanceGroup`:

```sql
UPDATE expenses
SET amount = 600000, version = version + 1
WHERE id = 'xxx' AND version = 3;
-- 0 rows affected = version conflict → HTTP 409
```

### 3.4. Đơn vị Tiền: Tại sao lưu Integer (cents)?

```
KHÔNG: amount = 50.50  (Float — bị lỗi precision: 50.50000000001)
CÓ:    amount = 5050   (Integer cents — chính xác tuyệt đối)
```

Quy tắc: `amount_display = amount_stored / 100` (cho USD, EUR). VND: `amount_stored = amount_display` (VND không có cents).

### 3.5. BalanceSummary: Tại sao denormalize?

Query "Ai nợ ai bao nhiêu" từ Event Store mỗi lần cần đọc N events → chậm. BalanceSummary là **Materialized View** — đã tính sẵn, chỉ cần `SELECT * WHERE groupId = X` → instant response.
