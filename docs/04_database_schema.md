# 🗄️ Cấu trúc Cơ sở dữ liệu (Database Schema)

Tài liệu này định nghĩa cấu trúc cơ sở dữ liệu cho dự án **GrowthGarden V2**. Lược đồ được thiết kế theo chuẩn Prisma ORM, áp dụng triết lý Modular Monolith với ranh giới Domain rõ ràng.

---

## 1. Môi trường & Quy chuẩn
- **Database Engine:** PostgreSQL
- **Format:** Prisma Schema
- **Design Pattern:** JSONB cho đa hình (Polymorphism), Event Sourcing cho dữ liệu lịch sử AI, Tách biệt Schema theo Context.

---

## 2. Lược đồ Dữ liệu Chi tiết (Prisma Schema)

### 2.1. Identity & Core Context
Quản lý thông tin định danh và cài đặt cơ bản của người dùng.

```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  primaryTimezone  String   @default("UTC") 
  status           UserStatus @default(ACTIVE)
  tier             UserTier   @default(FREE)
  
  // Relations
  karmaWallet      KarmaWallet?
  karmaLedgers     KarmaLedger[]
  gardens          Garden[]
  habits           Habit[]
  placements       Placement[]
  
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum UserStatus {
  ACTIVE
  HIBERNATING // Trạng thái Ngủ đông (Bỏ app > 7 ngày)
}

enum UserTier {
  FREE
  PREMIUM
}
```

### 2.2. Habit & Garden Context
Quản lý hệ thống Gamification: tiến trình thói quen, trạng thái mầm cây và không gian hiển thị (Garden Layout) theo lưới Isometric.

```prisma
model Habit {
  id          String     @id @default(uuid())
  userId      String
  name        String
  type        HabitType  @default(BUILD)
  isKeystone  Boolean    @default(false) // Thói quen cốt lõi dùng để rã đông
  
  // Trạng thái của Cây (Habit Pet)
  plantState  PlantState @default(SEED)
  exp         Int        @default(0)
  
  isDeleted   Boolean    @default(false)
  deletedAt   DateTime?
  
  user        User       @relation(fields: [userId], references: [id])
}

enum HabitType {
  BUILD
  QUIT
}

enum PlantState {
  SEED        // Hạt giống
  GROWING     // Đang lớn
  WITHERED    // Héo úa (Mất Loss Aversion)
  POISONED    // Trúng độc (Phá giới Quitting Habit)
  GHOST       // Nhánh tinh linh (Dead branch trong nhóm Co-op)
  MAX_LEVEL   // Đạt cấp tối đa
}

model Garden {
  id          String     @id @default(uuid())
  userId      String
  type        GardenType @default(STANDARD)
  weather     String     @default("SUNNY") // SUNNY, RAINY, GLOOMY (Dựa trên Emotion)
  
  isDeleted   Boolean    @default(false)
  deletedAt   DateTime?
  
  user        User       @relation(fields: [userId], references: [id])
}

enum GardenType {
  STANDARD
  GREENHOUSE
  CLOUD
}

// Bảng lưu tọa độ Isometric 2D cho các vật phẩm trong vườn
model Placement {
  id          String     @id @default(uuid())
  userId      String
  itemId      String     // Tham chiếu đến ID Vật phẩm trong Inventory
  
  x           Int        // Tọa độ X trên Grid (VD: Grid 6x6)
  y           Int        // Tọa độ Y trên Grid
  layer       Int        @default(0) // Ground=0, Object=1, Sky=2
  
  isDeleted   Boolean    @default(false)
  deletedAt   DateTime?
  
  user        User       @relation(fields: [userId], references: [id])
}
```

### 2.3. Economy & Inventory Context
Hệ thống tài chính nội bộ. Thiết kế này có Audit Log (Ledger) để dễ dàng kiểm toán trước khi tách thành Microservice độc lập (`economy-microservice`) trong Phase 5.

```prisma
// Bảng lưu vết kiểm toán kinh tế (Immutable Ledger)
model KarmaLedger {
  id             String    @id @default(uuid())
  userId         String
  amount         Int       // Số lượng Karma thay đổi (+/-)
  reason         String    // VD: CHECK_IN, GACHA_ROLL, CURE_POISON
  referenceId    String?   // ID tham chiếu (Habit ID, Item ID)
  
  createdAt      DateTime  @default(now())
  
  user           User      @relation(fields: [userId], references: [id])
  
  @@index([userId, createdAt])
}

model KarmaWallet {
  id             String    @id @default(uuid())
  userId         String    @unique
  balanceKarma   Int       @default(0)
  dailyEarned    Int       @default(0) // Track giới hạn Karma mỗi ngày
  lastEarnDate   DateTime? // Ngày cuối cùng nhận Karma
  stardustSpring Int       @default(0) // Bụi mùa giải (Tái chế)
  legacyStardust Int       @default(0) // Bụi di sản
  version        Int       @default(0) // Cho Optimistic Locking chống Double-spending
  
  user           User      @relation(fields: [userId], references: [id])
}

model InventoryItem {
  id          String     @id @default(uuid())
  userId      String
  itemRefId   String     // ID Catalog của vật phẩm hệ thống
  rarity      Rarity
  isSoulbound Boolean    @default(true) // 100% Khóa tài khoản, cấm Chợ đen
  
  // JSONB giải quyết bài toán Đa hình (Polymorphism)
  // Có thể lưu linh hoạt: { "glow_color": "blue", "water_capacity": 5 }
  metadata    Json?    
  
  createdAt   DateTime   @default(now())
}

enum Rarity {
  COMMON
  RARE
  EPIC
  LEGENDARY
  UNIQUE
}
```

### 2.4. Event Sourcing & AI Context
Đóng vai trò là xương sống (Backbone) cho kiến trúc phân tán và tạo nguồn dữ liệu siêu nhanh cho AI mà không gây "Data Bloat" lên các bảng nghiệp vụ.

```prisma
model EventOutbox {
  id             String      @id @default(uuid())
  eventType      String      // VD: "CheckHabitStatusEvent", "RefundKarmaEvent"
  
  // Dữ liệu event bắt buộc chứa targetDate và idempotencyKey để Replay DLQ an toàn
  payload        Json     
  status         EventStatus @default(PENDING)
  createdAt      DateTime    @default(now())
}

model UserAuditLog {
  id             String      @id @default(uuid())
  userId         String
  action         String      // Loại hoạt động (VD: EMOTION_LOGGED, HABIT_COMPLETED)
  
  // Dữ liệu bối cảnh cho RAG (AI truy xuất vector)
  context        Json     
  timestamp      DateTime    @default(now())
  
  @@index([userId, timestamp]) // Index tối ưu cho truy xuất chuỗi thời gian của AI
}

enum EventStatus {
  PENDING
  PROCESSED
  FAILED_DLQ // Event lỗi (VD: Schema drift) sẽ bị giam vào đây để kỹ sư xử lý
}
```

---

## 3. Rủi ro & Lưu ý Kỹ thuật
- **Saga Pattern:** Các tương tác giữa `KarmaWallet` và các bảng khác (VD mua vật phẩm thêm vào `InventoryItem`) phải được gói trong logic Saga. Bất kỳ lỗi nào xảy ra ở Consumer cũng phải kích hoạt Event `RefundKarmaEvent` đẩy vào `EventOutbox`.
- **UI Grid Render:** Web Client (Next.js/React) cần chịu trách nhiệm khóa Grid (VD chỉ cho kéo thả trong vùng tọa độ 0-5) bằng kỹ thuật CSS Grid hoặc thao tác kéo thả HTML5, và tính toán va chạm (Collision) trước khi gọi API cập nhật bảng `Placement`.
