# 🏗️ SYSTEM ARCHITECTURE & TECHNICAL SPECIFICATIONS (GrowthGarden V2)

Tài liệu này biểu diễn Luồng Dữ liệu (Data Flow) và Sơ đồ CSDL (Physical Schema) dựa trên kiến trúc Web-First, Modular Monolith và Event-Driven.

---

## 1. CORE ENTITY RELATIONSHIP DIAGRAM (ERD)

Mô tả sự cô lập dữ liệu theo các Context đã định nghĩa trong lược đồ Prisma. Tuyệt đối không có Foreign Key xuyên Domain để phục vụ tách Microservices trong tương lai.

```mermaid
erDiagram
    %% Identity Context
    User {
        uuid id PK
        string email
        string username
        enum status "ACTIVE, BANNED"
    }
    AuthIdentity {
        uuid id PK
        string userId "Loose ref"
        enum provider "LOCAL, GOOGLE, APPLE"
        string passwordHash
        string refreshToken
    }

    %% Economy Context (wallet-module -> economy-module)
    Wallet {
        uuid id PK
        string userId "Loose ref (no FK)"
        int karmaBalance
        int stardustBalance
        int version "OCC - chống Double Spending"
    }
    InventoryItem {
        uuid id PK
        string userId "Loose ref"
        enum itemType "DECORATION, GACHA_BOX, KEY, KEY_FRAGMENT"
        enum rarity "COMMON, RARE, EPIC, LEGENDARY"
        json metadata "Số lượng mảnh vỡ, asset URL..."
    }

    %% Productivity Context
    PlantGuardian {
        uuid id PK
        string userId "Loose ref"
        enum state "SEED, GROWING, HIBERNATING, DEAD, ANCIENT"
        int currentStreak
        int highestStreak
        int activeCheckinDays "Ngày điểm danh thực tế - chống lách luật"
        int version "OCC - chống Race Condition khi tưới hộ offline"
    }
    EmotionCheckin {
        uuid id PK
        string plantId FK
        date checkinDate
        enum emotionGrade "A, B, C, D, E, F"
    }

    %% Social Context
    Neighborhood {
        uuid id PK
        string name
        int vibeScore
        int monumentEnergy
    }
    NeighborhoodMember {
        string userId "Loose ref"
        string neighborhoodId FK
        enum role "MAYOR, DEPUTY_MAYOR, CITIZEN"
        int currentCycleContribution "Phải > 0 mới nhận Rương Co-op"
    }
    Friendship {
        string userId1 "Loose ref"
        string userId2 "Loose ref"
        enum status "PENDING, ACCEPTED"
    }

    %% Event Sourcing
    OutboxEvent {
        uuid id PK
        string aggregateType "Wallet, PlantGuardian, Neighborhood..."
        string aggregateId
        string eventType "CheckinCompleted, CoopChestRewarded..."
        json payload
        enum status "PENDING, PROCESSED, FAILED_DLQ"
    }

    %% Relationships
    User ||--o{ AuthIdentity : "authenticates via"
    User ||--o| Wallet : "has wallet"
    User ||--o{ InventoryItem : "owns items"
    User ||--o| PlantGuardian : "grows plant"
    PlantGuardian ||--o{ EmotionCheckin : "records checkins"
    User ||--o{ NeighborhoodMember : "lives in"
    Neighborhood ||--o{ NeighborhoodMember : "has members"
```

---

## 2. SEQUENCE DIAGRAMS (LUỒNG DỮ LIỆU CẤP THẤP)

### Luồng 1: Điểm danh Cảm xúc & Cách ly Dữ liệu Text (Outbox + Storage Isolation)
Bảo vệ Transaction Core, đồng thời tách rời Note văn bản sang NoSQL để chống Text Bloat.

```mermaid
sequenceDiagram
    actor User as Web Client (Optimistic UI)
    participant SW as Service Worker (IndexedDB)
    participant API as core-api (Productivity Module)
    participant DB as Postgres (PlantGuardian + EmotionCheckin)
    participant Outbox as Postgres (OutboxEvent)
    participant Kafka as Kafka (core-events)
    participant Worker as Worker Service
    participant NoSQL as NoSQL DB (EmotionNotes)

    User->>SW: Click Check-in (Emotion + Note)
    SW-->>User: Optimistic UI: Cây lấp lánh ngay lập tức (không cần chờ API)
    SW->>API: POST /api/v1/checkin (Background Sync khi online)

    Note over API: Start DB Transaction
    API->>DB: UPDATE PlantGuardian (streak++, activeCheckinDays++, version++)
    API->>DB: INSERT EmotionCheckin (date, grade)
    API->>DB: UPDATE Wallet (karmaBalance + X)
    API->>Outbox: INSERT OutboxEvent {type: "CheckinCompleted"}
    Note over API: Commit Transaction

    API-->>User: HTTP 200 OK {expGained, karmaEarned, newStreak}

    %% Async: Note text vào NoSQL
    alt User đã nhập Note
        API->>Kafka: Publish NOTE_TEXT_EVENT {checkinId, noteText}
        Kafka-->>Worker: Consume event
        Worker->>NoSQL: INSERT EmotionNote {checkinId, userId, noteText}
    end

    %% Async: Kafka event cho các service khác
    Outbox-->>Kafka: CDC Connector streams CheckinCompleted
    Kafka-->>Worker: Cập nhật Neighborhood Monument Energy
```

---

### Luồng 2: Gacha & Pity System (Chống Double-Spending + Chống RNG Xui Xẻo)
Luồng mua vật phẩm kết hợp Optimistic Locking, Seed-based RNG và tích lũy Pity Fragment.

```mermaid
sequenceDiagram
    actor User as Web Client
    participant API as core-api (Economy Module)
    participant WalletDB as Postgres (Wallet)
    participant InvDB as Postgres (InventoryItem)
    participant Outbox as Postgres (OutboxEvent)

    User->>API: POST /api/v1/economy/gacha/roll {seed}

    Note over API: Seed-based RNG — Server xác thực seed Client gửi lên
    API->>WalletDB: UPDATE Wallet SET stardustBalance = stardustBalance - X, version = N+1 WHERE version = N AND stardustBalance >= X

    alt Optimistic Lock Fail (version mismatch / không đủ tiền)
        WalletDB-->>API: 0 rows affected
        API-->>User: HTTP 400 INSUFFICIENT_FUNDS
    else Lock Success
        Note over API: Tính kết quả Gacha (Server-side, dùng Seed)

        alt Kết quả ra KEY
            API->>InvDB: INSERT InventoryItem {itemType: KEY}
        else Kết quả KHÔNG ra KEY (Pity Trigger)
            API->>InvDB: INSERT InventoryItem {vật phẩm thường}
            API->>InvDB: UPDATE InventoryItem (metadata.keyFragments++) "Cộng Mảnh Vỡ"
        end

        API->>Outbox: INSERT OutboxEvent {type: "GachaRolled"}
        API-->>User: HTTP 200 OK {reward, keyFragmentsTotal}
    end
```

---

### Luồng 3: OCC khi Đồng bộ Offline (Tưới hộ vs. Self Check-in)
Xử lý xung đột dữ liệu khi bạn bè tưới cây lúc User đang Offline.

```mermaid
sequenceDiagram
    actor UserA as User A (Offline)
    actor UserB as User B (Online)
    participant SW as Service Worker A
    participant API as core-api
    participant DB as Postgres (PlantGuardian)

    Note over UserA: A đang offline, tưới cây của mình
    UserA->>SW: Check-in (Optimistic UI cập nhật local, version=5)

    Note over UserB: B online, tưới hộ cây của A
    UserB->>API: POST /social/neighbors/{a_id}/water
    API->>DB: UPDATE PlantGuardian SET state=GROWING, version=6 WHERE id=plant_a AND version=5
    DB-->>API: Success

    Note over UserA: A có mạng trở lại, Background Sync chạy
    SW->>API: POST /sync (plantVersion: 5)
    API->>DB: UPDATE PlantGuardian WHERE id=plant_a AND version=5
    DB-->>API: 0 rows (version đã là 6 — xung đột!)

    API-->>SW: HTTP 409 Conflict {latestState, karmaRefunded: 10}
    SW-->>UserA: UI đồng bộ state mới, pop-up "Karma dư đã vào Pending Stash"
```

---

### Luồng 4: Auto-Transfer Quyền Thị Trưởng (Mayor Auto-Transfer)
Tự động chuyển giao quyền lực khi Thị trưởng offline quá 14 ngày.

```mermaid
sequenceDiagram
    participant Cronjob as Nightly Cronjob
    participant Kafka as Kafka (core-events)
    participant Worker as Worker Service
    participant DB as Postgres (NeighborhoodMember)
    participant NotifSvc as Notification Service

    Cronjob->>Kafka: Publish CHECK_MAYOR_ACTIVITY
    Kafka-->>Worker: Consume event
    Worker->>DB: Query Neighborhoods có Mayor offline > 14 ngày

    alt Mayor offline > 14 ngày
        Note over Worker: Thuật toán chọn Tân Thị trưởng:
        Note over Worker: 1. Phó Thị trưởng (DEPUTY_MAYOR) nếu có
        Note over Worker: 2. Cao nhất currentCycleContribution
        Note over Worker: 3. Online gần nhất
        Worker->>DB: UPDATE NeighborhoodMember SET role=CITIZEN (Mayor cũ)
        Worker->>DB: UPDATE NeighborhoodMember SET role=MAYOR (Tân Thị trưởng)
        Worker->>NotifSvc: Push thông báo cho Tân Thị trưởng
    end
```

---

### Luồng 5: Chống Ký sinh — Phân phối Rương Co-op (Monument Chest)
Đảm bảo chỉ thành viên có đóng góp mới được nhận Rương khi Monument đầy năng lượng.

```mermaid
sequenceDiagram
    participant Worker as Worker Service
    participant DB as Postgres (Neighborhood + NeighborhoodMember)
    participant InvDB as Postgres (InventoryItem)
    participant NotifSvc as Notification Service

    Note over Worker: Detect: Neighborhood X đã đầy Monument Energy
    Worker->>DB: SELECT members WHERE neighborhoodId=X AND currentCycleContribution > 0
    Note over Worker: Chỉ lấy những người có contribution > 0

    loop Với mỗi thành viên hợp lệ
        Worker->>InvDB: INSERT InventoryItem {itemType: GACHA_BOX, rarity: RARE}
        Worker->>NotifSvc: Push thông báo "Bạn nhận được Rương Co-op!"
    end

    Worker->>DB: UPDATE Neighborhood SET monumentEnergy=0
    Worker->>DB: UPDATE NeighborhoodMember SET currentCycleContribution=0 (Reset chu kỳ)
```
