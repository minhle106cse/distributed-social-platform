# 🏗️ SYSTEM ARCHITECTURE & TECHNICAL SPECIFICATIONS (GrowthGarden V2)

Tài liệu này biểu diễn Luồng Dữ liệu (Data Flow) và Sơ đồ CSDL (Physical Schema) dựa trên kiến trúc Web-First, Modular Monolith và Event-Driven.

---

## 1. CORE ENTITY RELATIONSHIP DIAGRAM (ERD)

Mô tả sự cô lập dữ liệu theo các Context đã định nghĩa trong lược đồ Prisma.

```mermaid
erDiagram
    %% Core & Habit Context
    User {
        uuid id PK
        string email
        string status "ACTIVE, HIBERNATING"
        string tier "FREE, PREMIUM"
    }
    Habit {
        uuid id PK
        uuid user_id FK
        string name
        string type "BUILD, QUIT"
        boolean is_keystone
        string plant_state "SEED, GROWING, WITHERED, GHOST, POISONED"
        int exp
        boolean is_deleted
        timestamp deleted_at
    }
    Garden {
        uuid id PK
        uuid user_id FK
        string weather "SUNNY, RAINY"
        string type "STANDARD, GREENHOUSE"
        boolean is_deleted
        timestamp deleted_at
    }
    
    %% Garden Grid (Isometric)
    Placement {
        uuid id PK
        uuid user_id FK
        uuid item_id FK
        int x
        int y
        int layer
        boolean is_deleted
        timestamp deleted_at
    }

    %% Economy & Inventory Context
    KarmaLedger {
        uuid id PK
        uuid user_id FK
        int amount
        string reason "Giao dịch (+/-)"
        string reference_id
        timestamp created_at
    }
    KarmaWallet {
        uuid user_id PK, FK
        int balanceKarma
        int dailyEarned
        timestamp lastEarnDate
        int stardustSpring
        int legacyStardust
        int version
    }
    InventoryItem {
        uuid id PK
        uuid user_id FK
        string rarity
        boolean isSoulbound
        jsonb metadata "Đa hình: Lưu chỉ số tùy biến"
    }

    %% Event Sourcing & AI
    EventOutbox {
        uuid id PK
        string event_type
        jsonb payload
        string status "PENDING, PROCESSED, FAILED_DLQ"
    }
    UserAuditLog {
        uuid id PK
        uuid user_id FK
        string action
        jsonb context
        timestamp time
    }

    %% Relationships
    User ||--o{ Habit : "tracks"
    User ||--o| Garden : "owns"
    User ||--o{ Placement : "configures"
    User ||--o| KarmaWallet : "has"
    User ||--o{ InventoryItem : "collects"
    User ||--o{ UserAuditLog : "generates"
```

---

## 2. SEQUENCE DIAGRAMS (LUỒNG DỮ LIỆU CẤP THẤP)

### Luồng 1: Hoàn thành Thói quen & Tách rời Dữ liệu AI (Outbox Pattern)
Bảo vệ Transaction của Habit, đồng thời cung cấp dữ liệu cho AI rảnh tay xử lý.

```mermaid
sequenceDiagram
    actor User as Web Client
    participant API as core-api (Habit Module)
    participant DB as Postgres (Habit Table)
    participant Outbox as Postgres (EventOutbox)
    participant Kafka as Kafka (core-events)
    participant AIAgent as AI RAG Worker
    participant AuditDB as Postgres (UserAuditLog)

    User->>API: POST /api/habits/{id}/check-in
    Note over API: Start DB Transaction
    API->>DB: Update Habit EXP & Plant State
    API->>Outbox: Insert EVENT_HABIT_COMPLETED
    Note over API: Commit DB Transaction
    API-->>User: HTTP 200 OK (UI Tưới cây)

    %% Async flow
    Outbox-->>Kafka: CDC Connector streams event
    Kafka-->>AIAgent: Consume EVENT_HABIT_COMPLETED
    AIAgent->>AuditDB: Insert into UserAuditLog (for future Vector querying)
```

---

### Luồng 2: Saga Pattern - Quay Gacha (Chống Double-Spending)
Luồng mua vật phẩm sử dụng Optimistic Locking và Saga Compensating Transaction.

```mermaid
sequenceDiagram
    actor User as Web Client
    participant API as core-api (Economy Module)
    participant WalletDB as Postgres (KarmaWallet)
    participant InvDB as Postgres (InventoryItem)
    
    User->>API: POST /api/gacha/roll (Cost: 100 Karma)
    
    %% Bước 1: Trừ tiền (Optimistic Locking)
    API->>WalletDB: UPDATE KarmaWallet SET balance = balance - 100, version = 2 WHERE version = 1 AND balance >= 100
    alt Update Fails (Version mismatch / No money)
        WalletDB-->>API: 0 rows affected
        API-->>User: HTTP 400 Bad Request
    else Update Success
        WalletDB-->>API: 1 row affected
        
        %% Bước 2: Sinh vật phẩm ngẫu nhiên
        Note over API: Random logic -> Gets "Epic Seed"
        API->>InvDB: INSERT INTO InventoryItem (metadata: {...})
        
        alt Insert Fails (e.g. DB Down)
            %% Compensating Transaction
            Note over API: Trigger Saga Compensation
            API->>WalletDB: UPDATE KarmaWallet SET balance = balance + 100 (Refund)
            API-->>User: HTTP 500 Internal Error (Refunded)
        else Insert Success
            API-->>User: HTTP 200 OK (Returns Epic Seed)
        end
    end
```

---

### Luồng 3: Cập nhật Tọa độ Isometric Garden
Web Client kéo thả HTML5 và gửi tọa độ để lưu vào DB.

```mermaid
sequenceDiagram
    actor User as Web Client
    participant UI as Web UI (CSS Grid)
    participant API as core-api (Garden Module)
    participant DB as Postgres (Placement Table)

    Note over UI: User kéo thả Item A sang tọa độ (X:2, Y:3)
    UI->>UI: Tính toán Collision (Va chạm) Local
    alt Collision Detected (Ô đã có vật phẩm)
        UI-->>User: Đẩy vật phẩm về chỗ cũ (Animation)
    else Path Clear
        UI->>API: PUT /api/garden/placement {itemId: A, x: 2, y: 3}
        API->>DB: UPDATE Placement SET x=2, y=3 WHERE item_id = A
        DB-->>API: Success
        API-->>UI: HTTP 200 OK
    end
```

---

### Luồng 4: Tính điểm Thói quen Từ bỏ (Quitting Habit) lúc 00:00
Cronjob chạy để thưởng cho user nếu không vi phạm (không gọi hàm Lapse) trong ngày.

```mermaid
sequenceDiagram
    participant Cronjob as Nightly Cronjob
    participant Kafka as Kafka (core-events)
    participant Worker as core-api Worker
    participant DB as Postgres (Habit Table)

    Cronjob->>Kafka: Publish EVALUATE_QUITTING_HABITS
    Kafka-->>Worker: Consume Event
    Note over Worker: Quét các Habit type=QUIT
    Worker->>DB: Check nếu không có LapseEvent hôm nay
    alt Không vi phạm
        Worker->>DB: Tăng EXP, sinh Khiên Năng Lượng cho Cây Vệ thần
    else Có vi phạm (Đã report Lapse trước đó)
        Worker->>DB: Bỏ qua (Đã chuyển sang POISONED từ lúc Report)
    end
```
