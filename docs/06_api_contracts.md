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

## 2. PRODUCTIVITY — EMOTION CHECK-IN & PLANT GUARDIAN

### 2.1. Lấy trạng thái Cây hôm nay
- **Endpoint:** `GET /productivity/plant`
- **Mô tả:** Lấy trạng thái Cây Vệ Thần và thông tin Check-in hôm nay.
- **Header:** `Timezone-Offset` (phục vụ đối soát giờ địa phương).
- **Response (200 OK):**
  ```json
  "data": {
    "plantId": "uuid-plant",
    "state": "GROWING",
    "currentStreak": 14,
    "highestStreak": 21,
    "activeCheckinDays": 14,
    "hasCheckedInToday": false,
    "nextMilestone": { "days": 21, "reward": "STARDUST" }
  }
  ```

### 2.2. Điểm danh Cảm xúc hằng ngày (Core Check-in)
- **Endpoint:** `POST /productivity/checkin`
- **Mô tả:** Hành động cốt lõi duy nhất mỗi ngày. Cập nhật streak, PlantGuardian, Wallet. Text Note được tách riêng sang Kafka/NoSQL.
- **Payload:**
  ```json
  {
    "emotionGrade": "B",
    "note": "Hôm nay tôi cảm thấy khá hơn" // Optional
  }
  ```
- **Response (200 OK):**
  ```json
  "data": {
    "expGained": 15,
    "karmaEarned": 20,
    "newStreak": 15,
    "activeCheckinDays": 15,
    "plantState": "GROWING",
    "milestoneReached": null
  }
  ```
- **Lưu ý:** `karmaEarned` trả về 0 nếu đã chạm Daily Cap. Nếu `activeCheckinDays` đạt mốc 7/21/66, `milestoneReached` sẽ có giá trị và Bụi Sao được cộng.

### 2.3. Rã đông Cây (Unfreeze / Hibernation Recovery)
- **Endpoint:** `POST /productivity/plant/unfreeze`
- **Mô tả:** Dùng Karma để rã đông Cây đang ở trạng thái `HIBERNATING`. Sau khi rã đông, Cây vào Hibernation Cooldown. Chi phí tăng theo Streak nhưng có Cap trần.
- **Response (200 OK):**
  ```json
  "data": {
    "karmaSpent": 80,
    "plantState": "GROWING",
    "cooldownActive": true,
    "message": "Cây đang Dưỡng thương. Đừng bỏ điểm danh 3 ngày tới nhé!"
  }
  ```

---

## 3. KINH TẾ (Economy — Wallet, Gacha, Crafting)

### 3.1. Lấy thông tin Ví
- **Endpoint:** `GET /economy/wallet`
- **Response (200 OK):**
  ```json
  "data": {
    "karmaBalance": 1250,
    "stardustBalance": 40,
    "pendingStash": 0
  }
  ```

### 3.2. Refresh Thương Nhân Thần Bí (Spend Karma)
- **Endpoint:** `POST /economy/merchant/refresh`
- **Mô tả:** Dùng Karma để làm mới danh sách hàng của Thương nhân.
- **Response (200 OK):**
  ```json
  "data": {
    "karmaSpent": 50,
    "newInventory": [
      { "itemType": "GACHA_BOX", "rarity": "RARE", "price": { "currency": "STARDUST", "amount": 30 } },
      { "itemType": "DECORATION", "rarity": "COMMON", "price": { "currency": "STARDUST", "amount": 10 } }
    ]
  }
  ```

### 3.3. Mua vật phẩm từ Thương Nhân (Spend Stardust)
- **Endpoint:** `POST /economy/merchant/purchase`
- **Mô tả:** Dùng Bụi Sao để mua. Chạy Saga Pattern với Optimistic Locking. Nếu kết quả không ra Key, tự động cộng 1 Mảnh Vỡ Không gian (Pity System).
- **Payload:** `{ "itemId": "merchant-slot-uuid" }`
- **Response (200 OK):**
  ```json
  "data": {
    "stardustSpent": 30,
    "reward": { "itemType": "GACHA_BOX", "rarity": "RARE" },
    "pity": { "keyFragmentsEarned": 1, "totalKeyFragments": 47 }
  }
  ```

### 3.4. Mở Rương Gacha
- **Endpoint:** `POST /economy/gacha/open`
- **Mô tả:** Mở Rương Gacha từ Inventory. Seed-based RNG: Client gửi `seed` đã nhận trước từ Server để animation chạy ngay lập tức.
- **Payload:** `{ "inventoryItemId": "gacha-box-uuid", "seed": "cryptographic-seed-hash" }`
- **Response (200 OK):**
  ```json
  "data": {
    "reward": { "itemType": "KEY", "rarity": "LEGENDARY" },
    "pity": { "keyFragmentsEarned": 0, "totalKeyFragments": 47 }
  }
  ```

### 3.5. Lò Rèn — Đúc vật phẩm (Crafting/Merging)
- **Endpoint:** `POST /economy/forge`
- **Mô tả:** Online-Only. Đốt 5 vật phẩm Common + Karma/Stardust để rèn ra 1 Epic. Hoặc đúc 100 Key Fragment thành 1 Key.
- **Payload:**
  ```json
  {
    "recipeType": "MERGE_COMMON_TO_EPIC",
    "ingredientIds": ["uuid-1", "uuid-2", "uuid-3", "uuid-4", "uuid-5"]
  }
  ```
- **Response (200 OK):**
  ```json
  "data": {
    "consumed": 5,
    "result": { "itemType": "DECORATION", "rarity": "EPIC", "name": "Đèn Lồng Huyền Ảo" }
  }
  ```

### 3.6. Mở khóa Vùng Đất Mới (Legendary Gate)
- **Endpoint:** `POST /economy/unlock-area`
- **Mô tả:** Dùng số Key cần thiết để mở khóa một vùng đất mới.
- **Payload:** `{ "areaId": "snow-greenhouse" }`
- **Response (200 OK):**
  ```json
  "data": {
    "keysSpent": 3,
    "areaUnlocked": { "id": "snow-greenhouse", "name": "Nhà Kính Tuyết", "theme": "SNOW" }
  }
  ```

---

## 4. SOCIAL — NEIGHBORHOOD & FRIENDS

### 4.1. Lấy thông tin Khu phố
- **Endpoint:** `GET /social/neighborhood`
- **Response (200 OK):**
  ```json
  "data": {
    "id": "neighborhood-uuid",
    "name": "Vườn Hoa Mộng",
    "vibeScore": 850,
    "monumentEnergy": 72,
    "members": [
      { "userId": "uuid-a", "username": "Minh", "role": "MAYOR", "contribution": 20, "lastOnline": "2026-06-02" },
      { "userId": "uuid-b", "username": "Lan", "role": "CITIZEN", "contribution": 15, "lastOnline": "2026-06-02" }
    ]
  }
  ```

### 4.2. Tưới hộ cây bạn (Empathetic Watering)
- **Endpoint:** `POST /social/neighbors/{neighbor_id}/water`
- **Response (200 OK):**
  ```json
  "data": {
    "karmaRewarded": 5,
    "message": "Bạn đã giúp cây của Lan thoát khỏi đóng băng!"
  }
  ```

### 4.3. Bảo lãnh Streak bạn bè (Karma Bailout)
- **Endpoint:** `POST /social/friends/{friend_id}/bailout`
- **Mô tả:** Trích Karma của mình để rã đông Streak cho bạn. Chạy qua Saga Pattern (trừ Karma người bảo lãnh, cứu Streak người được bảo lãnh).
- **Payload:** `{ "karmaAmount": 100 }`
- **Response (200 OK):**
  ```json
  "data": {
    "karmaSpent": 100,
    "friendStreakRestored": true,
    "message": "Bạn đã cứu được chuỗi điểm danh của Lan!"
  }
  ```

### 4.4. Tặng quà Cảm xúc (Emotional Gift)
- **Endpoint:** `POST /social/neighbors/{neighbor_id}/gift`
- **Payload:** `{ "inventoryItemId": "wind-chime-uuid" }`
- **Response (200 OK):**
  ```json
  "data": {
    "giftSent": true,
    "message": "Chuông gió đã được gửi đến vườn của Lan."
  }
  ```

### 4.5. Tạo Link Kết bạn (Invite-only)
- **Endpoint:** `POST /social/friends/invite`
- **Response (200 OK):**
  ```json
  "data": {
    "inviteCode": "GROW-XYZ123",
    "qrCodeUrl": "/api/v1/social/friends/invite/qr/GROW-XYZ123",
    "expiresIn": 86400
  }
  ```

### 4.6. Gửi Thư mời Định cư Khu phố (Neighborhood Invite)
- **Endpoint:** `POST /social/neighborhood/invite`
- **Payload:** `{ "friendId": "uuid-b" }`
- **Response (200 OK):** Xác nhận thư mời đã được gửi.

### 4.7. Đuổi Thành viên (Mayor Eviction)
- **Endpoint:** `DELETE /social/neighborhood/members/{member_id}`
- **Mô tả:** Chỉ Thị trưởng (MAYOR) được phép gọi. Thành viên bị đuổi mất trắng `currentCycleContribution` (Sunk Cost, không hoàn trả).
- **Response (200 OK):**
  ```json
  "data": {
    "evicted": true,
    "contributionForfeited": 35
  }
  ```

---

## 5. OFFLINE SYNC

### 5.1. Đồng bộ Hàng đợi Cục bộ (Offline Queue Sync)
- **Endpoint:** `POST /sync/offline-queue`
- **Mô tả:** Nhận mảng các actions đã thực hiện khi offline và xử lý theo lô. OCC kiểm tra version — nếu xung đột, Karma được hoàn vào Pending Stash.
- **Payload:**
  ```json
  {
    "actions": [
      {
        "type": "EMOTION_CHECKIN",
        "plantVersion": 5,
        "payload": { "emotionGrade": "C", "note": "Check-in trên tàu điện ngầm" },
        "timestamp": "2026-06-02T08:30:00Z",
        "idempotencyKey": "uuid-action-1"
      }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  "data": {
    "processedCount": 1,
    "failedCount": 0,
    "conflicts": [],
    "pendingStashAdded": 0
  }
  ```
