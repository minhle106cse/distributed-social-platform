# 🔌 API CONTRACTS (Web Client <-> Core API)

Tài liệu này đặc tả các endpoint giao tiếp chính giữa **Web Client (Next.js)** và **Backend (NestJS/Core API)**. Sử dụng chuẩn RESTful API và trao đổi dữ liệu dạng JSON.

---

## 1. GIAO THỨC CHUNG
- **Base URL:** `/api/v1`
- **Authentication:** Gửi Bearer Token trong header `Authorization`.
- **Response Format chuẩn:**
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null
  }
  ```

---

## 2. HABIT & GARDEN ENDPOINTS

### 2.1. Lấy danh sách Thói quen (kèm trạng thái mầm cây)
- **Endpoint:** `GET /habits/today`
- **Mô tả:** Lấy danh sách thói quen cần làm trong ngày. Backend sẽ tự động nội suy xem có đang trong "Grace Period" (Sleepy Mode) hay không dựa vào Timestamp của Server.
- **Header:** `Timezone-Offset` (Phục vụ đối soát giờ địa phương).
- **Response (200 OK):**
  ```json
  "data": [
    {
      "id": "uuid-1",
      "name": "Đọc sách 30 phút",
      "type": "BUILD",
      "plantState": "GROWING",
      "isSleepy": false, // Trả về true nếu đang trong Grace Period (00:00 - 10:00)
      "exp": 45,
      "isCompleted": false
    }
  ]
  ```

### 2.2. Check-in Thói quen
- **Endpoint:** `POST /habits/{habit_id}/check-in`
- **Payload:** `{ "note": "Hôm nay tôi đã đọc cuốn Sapiens" }` (Note là optional).
- **Response (200 OK):**
  ```json
  "data": {
    "expGained": 10,
    "karmaEarned": 10, // Sẽ trả về 0 nếu user đã chạm Daily Cap
    "currentState": "GROWING",
    "leveledUp": false
  }
  ```
- **Xử lý Grace Period:** Nếu Client gọi API này lúc 8:00 sáng (cho ngày hôm qua), Backend sẽ tự động xử lý Logic "Early Bird" (Đánh thức cây).

### 2.3. Báo cáo Phá giới (Quitting Habit Lapse)
- **Endpoint:** `POST /habits/{habit_id}/lapse`
- **Mô tả:** Dành riêng cho Habit `type: QUIT`. Chuyển trạng thái cây sang POISONED.
- **Response (200 OK):**
  ```json
  "data": {
    "currentState": "POISONED",
    "message": "Cây Vệ thần đã trúng độc. Hãy dùng Karma để giải độc nhé."
  }
  ```

### 2.4. Giải Độc Cây Vệ thần (Cure)
- **Endpoint:** `POST /habits/{habit_id}/cure`
- **Mô tả:** Tiêu hao Karma để đổi trạng thái POISONED về lại GROWING (Chạy qua Saga Pattern tương tự Gacha).
- **Response (200 OK):**
  ```json
  "data": {
    "karmaSpent": 50,
    "currentState": "GROWING"
  }
  ```

---

## 3. ISOMETRIC GARDEN (Bản đồ Khu vườn)

### 3.1. Lấy tọa độ khu vườn
- **Endpoint:** `GET /garden/layout`
- **Mô tả:** Lấy danh sách vật phẩm và tọa độ trên lưới CSS Grid 2D.
- **Response (200 OK):**
  ```json
  "data": {
    "weather": "SUNNY",
    "gridSize": { "x": 6, "y": 6 },
    "placements": [
      {
        "itemId": "item-uuid-1",
        "name": "Chậu Đất Nung",
        "x": 2,
        "y": 3,
        "layer": 0,
        "metadata": { "assetUrl": "/assets/pots/clay.png" } // Metadata từ InventoryItem
      }
    ]
  }
  ```

### 3.2. Cập nhật vị trí kéo thả (Drag & Drop)
- **Endpoint:** `PUT /garden/placement`
- **Payload:**
  ```json
  {
    "itemId": "item-uuid-1",
    "x": 4,
    "y": 1
  }
  ```
- **Response (200 OK):** Backend xác nhận vị trí lưu thành công. (Client đã tự check collision trước khi gọi).

---

## 4. KINH TẾ & GACHA (Economy)

### 4.1. Lấy thông tin Ví
- **Endpoint:** `GET /economy/wallet`
- **Response (200 OK):**
  ```json
  "data": {
    "karma": 1250,
    "stardustSpring": 40,
    "legacyStardust": 15
  }
  ```

### 4.2. Quay Gacha
- **Endpoint:** `POST /economy/gacha/roll`
- **Mô tả:** Giao dịch trừ Karma và sinh vật phẩm ngẫu nhiên (chạy qua Saga Pattern).
- **Payload:** `{ "banner_id": "spring-banner" }`
- **Response (200 OK):**
  ```json
  "data": {
    "karmaSpent": 100,
    "reward": {
      "itemId": "new-uuid",
      "rarity": "EPIC",
      "name": "Bonsai Khởi Nguyên"
    }
  }
  ```
- **Response (400 Bad Request):** `"error": "INSUFFICIENT_FUNDS"`

---

## 5. SOCIAL HEALING

### 5.1. Tưới hộ cây (Empathetic Watering)
- **Endpoint:** `POST /social/friends/{friend_id}/water`
- **Response (200 OK):**
  ```json
  "data": {
    "karmaRewarded": 5, // Trả về 0 nếu user đã chạm Daily Cap
    "message": "Bạn đã cứu cái cây của Alex khỏi héo úa!"
  }
  ```

### 5.2. Ghép cặp Ẩn danh (Match-making)
- **Endpoint:** `GET /social/friends/match`
- **Mô tả:** Hệ thống phân tích (Vector Search) tìm kiếm những user ẩn danh có cùng mục tiêu thói quen để đề xuất.
- **Response (200 OK):**
  ```json
  "data": [
    {
      "matchId": "uuid-match-1",
      "sharedHabit": "Không uống trà sữa",
      "message": "Một người bạn ẩn danh cũng đang cố gắng giống bạn."
    }
  ]
  ```

### 5.3. Tạo Link Kết bạn (Invite-only)
- **Endpoint:** `POST /social/friends/invite`
- **Response (200 OK):**
  ```json
  "data": {
    "inviteCode": "GROW-XYZ123",
    "expiresIn": 86400
  }
  ```

---

## 6. OFFLINE SYNC

### 6.1. Đồng bộ Hàng đợi Cục bộ (Offline Queue Sync)
- **Endpoint:** `POST /sync/offline-queue`
- **Mô tả:** Nhận một mảng các actions đã thực hiện khi offline (ví dụ: check-in thói quen) và xử lý theo lô (batch processing).
- **Payload:**
  ```json
  "data": {
    "actions": [
      {
        "type": "CHECK_IN",
        "habitId": "uuid-1",
        "timestamp": "2023-10-27T08:30:00Z",
        "note": "Check-in trên tàu điện ngầm"
      }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  "data": {
    "processedCount": 1,
    "failedCount": 0
  }
  ```
