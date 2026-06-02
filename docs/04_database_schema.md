# 🗄️ Lược đồ Cơ sở dữ liệu (Database Schema)

Tài liệu này định nghĩa cấu trúc cơ sở dữ liệu cho dự án **GrowthGarden V2**. Lược đồ được thiết kế bằng **Prisma ORM**, áp dụng triết lý **Modular Monolith** kết hợp **Optimistic Concurrency Control (OCC)** và **Storage Isolation** để giải quyết các bài toán về Concurrency và Data Bloat.

---

## 1. Môi trường & Quy chuẩn
- **Database Engine:** PostgreSQL (Core) & MongoDB/DynamoDB (Dành cho Storage Isolation).
- **Format:** Prisma Schema (`schema.prisma`).
- **Kiến trúc:** Phân tách logic theo Schema Context. Tuyệt đối KHÔNG gài Foreign Key (Ràng buộc toàn vẹn) chéo giữa các Domain khác biệt để phục vụ tách Microservices trong tương lai.

---

## 2. Lược đồ Dữ liệu Chi tiết

### 🟢 2.1. Module Identity & Auth
Quản lý thông tin định danh và cài đặt cơ bản của người dùng.

```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  username         String
  status           UserStatus @default(ACTIVE)
  
  // Relations nội bộ Domain
  authIdentities   AuthIdentity[]
  
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model AuthIdentity {
  id               String   @id @default(uuid())
  userId           String
  provider         AuthProvider @default(LOCAL)
  passwordHash     String?
  refreshToken     String?
  
  user             User     @relation(fields: [userId], references: [id])
}

enum UserStatus {
  ACTIVE
  BANNED
}

enum AuthProvider {
  LOCAL
  GOOGLE
  APPLE
}
```

### 🟡 2.2. Module Economy & Inventory
Xử lý giao dịch Tiền tệ và Túi đồ vật phẩm. Chứa cơ chế OCC để bắt Race Condition.

```prisma
model Wallet {
  id               String   @id @default(uuid())
  userId           String   @unique // Không FK cứng đến User table
  
  karmaBalance     Int      @default(0) // Tiền mềm
  stardustBalance  Int      @default(0) // Tiền cứng
  
  // Cơ chế OCC: Cứ mỗi lần transaction (cộng/trừ), version tăng 1. 
  // Chặn đứng Double Spending và Xung đột khi Offline Sync.
  version          Int      @default(0) 
  
  updatedAt        DateTime @updatedAt
}

model InventoryItem {
  id               String   @id @default(uuid())
  userId           String   // Không FK cứng
  itemType         ItemType
  rarity           Rarity   @default(COMMON)
  
  // JSONB lưu các tính chất động (Ví dụ: Số lượng mảnh vỡ, Tên vật phẩm trang trí)
  metadata         Json?    
  
  createdAt        DateTime @default(now())
}

enum ItemType {
  DECORATION       // Vật trang trí
  GACHA_BOX        // Rương Gacha
  KEY              // Chìa khóa mở vùng đất
  KEY_FRAGMENT     // Mảnh vỡ Không gian (Pity System)
}

enum Rarity {
  COMMON
  RARE
  EPIC
  LEGENDARY
}
```

### 🔵 2.3. Module Productivity (Nhật ký Cảm xúc)
Quản lý tiến trình Cây Vệ Thần và Chuỗi (Streak) điểm danh. Cấu trúc này tối giản Text Bloat.

```prisma
model PlantGuardian {
  id               String   @id @default(uuid())
  userId           String   // Không FK cứng
  
  state            PlantState @default(SEED)
  
  // Tiến trình chuỗi (Streak)
  currentStreak    Int      @default(0)
  highestStreak    Int      @default(0)
  activeCheckinDays Int     @default(0) // Số ngày điểm danh THỰC TẾ (Ngăn lách luật ngủ đông)
  
  version          Int      @default(0) // OCC bắt xung đột khi bạn bè vừa tưới hộ lúc đang offline
  
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  
  checkins         EmotionCheckin[]
}

model EmotionCheckin {
  id               String   @id @default(uuid())
  plantId          String
  
  checkinDate      DateTime @db.Date // Chỉ lưu ngày lịch
  emotionGrade     EmotionGrade
  
  plant            PlantGuardian @relation(fields: [plantId], references: [id])
}

enum PlantState {
  SEED           // Hạt giống
  GROWING        // Đang lớn
  HIBERNATING    // Dưỡng thương / Rã đông
  DEAD           // Chết (Rạn nứt Khiên)
  ANCIENT        // Cổ thụ (Hoàn thành mốc lớn)
}

enum EmotionGrade {
  A
  B
  C
  D
  E
  F
}
```

#### 🛡️ Storage Isolation (Bên ngoài Prisma Core)
Note văn bản của Check-in không nằm trong PostgreSQL Prisma Schema trên để chặn hiện tượng Text Bloat. Hệ thống đẩy Text qua Kafka sang một Collection NoSQL (VD: MongoDB) hoặc bảng Partition riêng lẻ:
```json
// Cấu trúc NoSQL Collection: EmotionNotes
{
  "_id": "uuid",
  "checkinId": "UUID tham chiếu sang EmotionCheckin của Core DB",
  "userId": "UUID",
  "noteText": "Nội dung nhật ký dài hàng nghìn chữ...",
  "createdAt": "ISODate"
}
```

### 🔴 2.4. Module Social & Topology
Kết nối Khu phố, Bầu cử, và Chống Ký sinh.

```prisma
model Neighborhood {
  id               String   @id @default(uuid())
  name             String
  vibeScore        Int      @default(0) // Chỉ số thẩm mỹ tổng
  monumentEnergy   Int      @default(0) // Năng lượng sạc cho Công trình chung
  
  createdAt        DateTime @default(now())
  
  members          NeighborhoodMember[]
}

model NeighborhoodMember {
  userId           String   // Không FK cứng
  neighborhoodId   String
  
  role             NeighborhoodRole @default(CITIZEN)
  
  // Chống Lỗ hổng Ký sinh: Phải > 0 mới được chia rương Co-op khi Monument đầy năng lượng
  currentCycleContribution Int @default(0) 
  
  joinedAt         DateTime @default(now())
  
  neighborhood     Neighborhood @relation(fields: [neighborhoodId], references: [id], onDelete: Cascade)
  
  @@id([userId, neighborhoodId])
}

model Friendship {
  userId1          String
  userId2          String
  status           FriendshipStatus @default(PENDING)
  
  createdAt        DateTime @default(now())
  
  @@id([userId1, userId2])
}

enum NeighborhoodRole {
  MAYOR
  CITIZEN
}

enum FriendshipStatus {
  PENDING
  ACCEPTED
}
```

### ⚙️ 2.5. Module Event-Driven (Outbox)
Trái tim của hệ thống Phân tán và Sự kiện.

```prisma
model OutboxEvent {
  id               String      @id @default(uuid())
  aggregateType    String      // VD: "Wallet", "PlantGuardian", "Neighborhood"
  aggregateId      String      
  eventType        String      // VD: "CheckinCompleted", "CoopChestRewarded"
  
  payload          Json        // Nội dung event để Worker/Kafka đẩy đi
  status           EventStatus @default(PENDING)
  
  createdAt        DateTime    @default(now())
  processedAt      DateTime?
}

enum EventStatus {
  PENDING
  PROCESSED
  FAILED_DLQ // Giam vào Dead Letter Queue nếu Worker lỗi liên tục
}
```

---

## 3. Lý giải Kiến trúc Nâng cao

1. **Không Dùng Khóa Ngoại (Foreign Keys) Xuyên Domain:** 
   Các ID như `userId` trong `Wallet` hay `NeighborhoodMember` chỉ lưu dưới dạng `String` thuần túy ở tầng Database. Chúng ta duy trì tính toàn vẹn thông qua Logic Code (Saga Pattern) và `OutboxEvent`. Điều này giúp việc tách Database cho từng Microservice sau này diễn ra vô cùng êm ái.

2. **Cơ chế OCC (Optimistic Concurrency Control):**
   Trường `version` ở `Wallet` và `PlantGuardian` dùng để bắt xung đột. Ví dụ:
   - Client đang offline, điểm danh Cây, lúc có mạng Client gọi API Sync với Version = 5.
   - Cùng lúc đó ở Server, bạn bè vừa "Tưới hộ" và tăng Version của Cây lên 6.
   - Khi Client Sync lên, Prisma update query dạng `where: { id, version: 5 }` sẽ fail. Backend lập tức từ chối thao tác của Client, hoàn tiền Karma vào pending stash và ép Client đồng bộ lại State mới nhất.

3. **Chống Phình Data (Storage Isolation):**
   Nếu 1 triệu người viết nhật ký dài 500 chữ mỗi ngày, bảng `EmotionCheckin` sẽ sụp đổ về mặt Read/Write I/O do TOAST table của PostgreSQL. Việc tách riêng `EmotionNotes` sang một hệ lưu trữ Document-based (NoSQL) và nối bằng Kafka giúp Prisma Core mãi mãi nhỏ gọn và nhanh như chớp.
