# 📡 ĐẶC TẢ API (API CONTRACTS)

> 📖 **[English Version](./en/06_api_contracts.md)**

Đặc tả các endpoint giữa **Web Client (Vite + React SPA)** và **Backend (auth-service Fastify / core-api NestJS)**. RESTful API, JSON format.

---

## 1. GIAO THỨC CHUNG

- **Auth Service Base URL:** `/auth` (Fastify, port 3001)
- **Core API Base URL:** `/api/v1` (NestJS, port 3000)
- **Authentication:** Bearer Token trong header `Authorization`.
- **Idempotency:** Mọi POST/PUT thay đổi tài chính PHẢI gửi `X-Idempotency-Key` header.
- **OCC:** Mọi PUT (update) PHẢI gửi `version` trong body.
- **Response Format:**
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null,
    "meta": { "version": 1, "timestamp": "2026-06-09T14:30:00Z" }
  }
  ```
- **Error Format:**
  ```json
  {
    "success": false,
    "data": null,
    "error": {
      "code": "CONFLICT",
      "message": "Version mismatch. Current version: 4",
      "details": { "currentVersion": 4, "currentState": { ... } }
    }
  }
  ```

---

## 2. AUTH SERVICE ENDPOINTS

### 2.1. Đăng ký (Register)
- **`POST /auth/register`**
- **Payload:** `{ "email": "user@example.com", "username": "Minh", "password": "Str0ngP@ss" }`
- **Response (201):**
  ```json
  "data": { "userId": "uuid", "username": "Minh", "accessToken": "jwt", "expiresIn": 900 }
  ```
- **Note:** `refreshToken` set qua HTTP-Only Cookie.

### 2.2. Đăng nhập (Login)
- **`POST /auth/login`**
- **Payload:** `{ "email": "user@example.com", "password": "Str0ngP@ss" }`
- **Response (200):** Tương tự Register.
- **Rate Limit:** 5 req / 5 phút / IP.

### 2.3. Refresh Token
- **`POST /auth/refresh`**
- **Response (200):** `"data": { "accessToken": "new-jwt", "expiresIn": 900 }`
- **Note:** Refresh Token Rotation — token cũ bị vô hiệu hóa.

### 2.4. Logout
- **`POST /auth/logout`**
- **Response (200):** `{ "success": true, "data": null }`

### 2.5. Profile (Me)
- **`GET /auth/me`**
- **Header:** `Authorization: Bearer <accessToken>`
- **Response (200):** `"data": { "userId": "uuid", "email": "...", "username": "Minh", "status": "ACTIVE" }`

---

## 3. GROUP ENDPOINTS

### 3.1. Danh sách nhóm
- **`GET /api/v1/groups`**
- **Response (200):**
  ```json
  "data": [
    {
      "id": "group-uuid",
      "name": "Du lịch Đà Lạt",
      "type": "TRIP",
      "status": "ACTIVE",
      "baseCurrency": "VND",
      "memberCount": 5,
      "myBalance": -350000,
      "lastActivityAt": "2026-06-09T14:00:00Z"
    }
  ]
  ```

### 3.2. Tạo nhóm
- **`POST /api/v1/groups`**
- **Payload:**
  ```json
  {
    "name": "Du lịch Đà Lạt",
    "type": "TRIP",
    "baseCurrency": "VND",
    "startDate": "2026-07-01",
    "endDate": "2026-07-05"
  }
  ```
- **Response (201):** Full group object + invite link.

### 3.3. Chi tiết nhóm
- **`GET /api/v1/groups/:id`**
- **Response (200):**
  ```json
  "data": {
    "id": "group-uuid",
    "name": "Du lịch Đà Lạt",
    "type": "TRIP",
    "status": "ACTIVE",
    "baseCurrency": "VND",
    "startDate": "2026-07-01",
    "endDate": "2026-07-05",
    "members": [
      { "userId": "uuid-a", "username": "Minh", "role": "OWNER", "avatarUrl": "..." },
      { "userId": "uuid-b", "username": "Lan", "role": "MEMBER", "avatarUrl": "..." }
    ],
    "totalSpending": 5000000,
    "version": 1
  }
  ```

### 3.4. Tạo Invite Link
- **`POST /api/v1/groups/:id/invites`**
- **Response (201):**
  ```json
  "data": {
    "inviteCode": "TF-XYZ123",
    "inviteUrl": "https://teamfin.app/join/TF-XYZ123",
    "expiresAt": "2026-06-10T14:00:00Z"
  }
  ```

### 3.5. Join nhóm qua Invite
- **`POST /api/v1/groups/join`**
- **Payload:** `{ "inviteCode": "TF-XYZ123" }`
- **Response (200):** Full group object.

---

## 4. EXPENSE ENDPOINTS

### 4.1. Danh sách expenses
- **`GET /api/v1/groups/:id/expenses`**
- **Query Params:** `?page=1&limit=20&category=FOOD&from=2026-06-01&to=2026-06-30&search=ăn`
- **Response (200):**
  ```json
  "data": [
    {
      "id": "exp-uuid",
      "description": "Ăn trưa",
      "totalAmount": 800000,
      "currency": "VND",
      "convertedAmount": 800000,
      "splitMethod": "EQUAL",
      "category": "FOOD",
      "expenseDate": "2026-06-09",
      "payers": [{ "userId": "uuid-a", "username": "Minh", "amount": 800000 }],
      "splits": [
        { "userId": "uuid-a", "username": "Minh", "amount": 200000 },
        { "userId": "uuid-b", "username": "Lan", "amount": 200000 },
        { "userId": "uuid-c", "username": "Hùng", "amount": 200000 },
        { "userId": "uuid-d", "username": "Mai", "amount": 200000 }
      ],
      "myShare": 200000,
      "isDeleted": false,
      "version": 1,
      "createdByUserId": "uuid-a",
      "createdAt": "2026-06-09T14:30:00Z"
    }
  ],
  "meta": { "total": 45, "page": 1, "limit": 20 }
  ```

### 4.2. Tạo expense
- **`POST /api/v1/groups/:id/expenses`**
- **Header:** `X-Idempotency-Key: exp-create-uuid-789`
- **Payload:**
  ```json
  {
    "description": "Ăn trưa",
    "totalAmount": 800000,
    "currency": "VND",
    "splitMethod": "EQUAL",
    "category": "FOOD",
    "expenseDate": "2026-06-09",
    "payers": [{ "userId": "uuid-a", "amount": 800000 }],
    "excludeUserIds": [],
    "splits": []
  }
  ```
- **Response (201):** Full expense object.
- **Lưu ý:**
  - Nếu `splitMethod = EQUAL`: `splits` tự tính, không cần gửi.
  - Nếu `splitMethod = EXACT`: `splits` bắt buộc, sum phải = totalAmount.
  - Nếu `splitMethod = PERCENTAGE`: `splits` bắt buộc, sum phải = 100%.
  - Nếu `splitMethod = SHARES`: `splits` bắt buộc, hệ thống tự tính amount.

### 4.3. Sửa expense (OCC)
- **`PUT /api/v1/groups/:groupId/expenses/:id`**
- **Header:** `X-Idempotency-Key: exp-edit-uuid-101`
- **Payload:**
  ```json
  {
    "description": "Ăn trưa (đã sửa)",
    "totalAmount": 600000,
    "version": 1
  }
  ```
- **Response (200):** Updated expense object with `version: 2`.
- **Error (409):** OCC conflict — `{ "error": { "code": "CONFLICT", "details": { "currentVersion": 2 } } }`

### 4.4. Xóa expense (Soft Delete)
- **`DELETE /api/v1/groups/:groupId/expenses/:id`**
- **Response (200):** `"data": { "deleted": true, "balanceUpdated": true }`

---

## 5. SETTLEMENT ENDPOINTS

### 5.1. Settle nợ
- **`POST /api/v1/groups/:id/settlements`**
- **Header:** `X-Idempotency-Key: settle-uuid-456`
- **Payload:**
  ```json
  {
    "toUserId": "uuid-a",
    "amount": 200000,
    "currency": "VND",
    "type": "FULL",
    "note": "Chuyển qua MoMo"
  }
  ```
- **Response (200):**
  ```json
  "data": {
    "id": "settle-uuid",
    "fromUserId": "uuid-b",
    "toUserId": "uuid-a",
    "amount": 200000,
    "type": "FULL",
    "balanceAfter": 0,
    "message": "Bạn đã trả 200,000₫ cho Minh"
  }
  ```
- **Error (400):** `INSUFFICIENT_BALANCE` — Nợ không đủ.
- **Error (409):** Idempotency key đã xử lý — trả response cached.

### 5.2. Gợi ý tối ưu nợ
- **`GET /api/v1/groups/:id/simplify-debts`**
- **Response (200):**
  ```json
  "data": {
    "currentTransactions": 8,
    "optimizedTransactions": 3,
    "suggestions": [
      { "from": { "userId": "uuid-b", "username": "Lan" }, "to": { "userId": "uuid-a", "username": "Minh" }, "amount": 200000 },
      { "from": { "userId": "uuid-d", "username": "Mai" }, "to": { "userId": "uuid-a", "username": "Minh" }, "amount": 150000 },
      { "from": { "userId": "uuid-c", "username": "Hùng" }, "to": { "userId": "uuid-e", "username": "Tú" }, "amount": 100000 }
    ]
  }
  ```

### 5.3. Danh sách settlements
- **`GET /api/v1/groups/:id/settlements`**
- **Response (200):** Array of settlement records.

---

## 6. BALANCE & ANALYTICS ENDPOINTS

### 6.1. Balance summary (Ma trận nợ)
- **`GET /api/v1/groups/:id/balances`**
- **Response (200):**
  ```json
  "data": {
    "myBalance": -350000,
    "balances": [
      { "fromUserId": "uuid-b", "fromUsername": "Lan", "toUserId": "uuid-a", "toUsername": "Minh", "amount": 200000 },
      { "fromUserId": "uuid-b", "fromUsername": "Lan", "toUserId": "uuid-c", "toUsername": "Hùng", "amount": 150000 }
    ]
  }
  ```

### 6.2. Spending by Category
- **`GET /api/v1/groups/:id/analytics/by-category`**
- **Query:** `?from=2026-06-01&to=2026-06-30`
- **Response (200):**
  ```json
  "data": [
    { "category": "FOOD", "amount": 3000000, "percentage": 60 },
    { "category": "TRANSPORT", "amount": 1000000, "percentage": 20 },
    { "category": "ACCOMMODATION", "amount": 750000, "percentage": 15 },
    { "category": "OTHER", "amount": 250000, "percentage": 5 }
  ]
  ```

### 6.3. Monthly Trend
- **`GET /api/v1/groups/:id/analytics/monthly`**
- **Response (200):**
  ```json
  "data": [
    { "month": "2026-04", "amount": 4500000 },
    { "month": "2026-05", "amount": 5200000 },
    { "month": "2026-06", "amount": 3800000 }
  ]
  ```

### 6.4. Activity Log (Audit Trail)
- **`GET /api/v1/groups/:id/activity`**
- **Query:** `?page=1&limit=50`
- **Response (200):**
  ```json
  "data": [
    {
      "eventType": "ExpenseCreated",
      "description": "Minh thêm 'Ăn trưa' — 800,000₫",
      "userId": "uuid-a",
      "username": "Minh",
      "timestamp": "2026-06-09T14:30:00Z",
      "details": { "expenseId": "exp-uuid", "amount": 800000 }
    },
    {
      "eventType": "SettlementCreated",
      "description": "Lan trả Minh 200,000₫",
      "userId": "uuid-b",
      "username": "Lan",
      "timestamp": "2026-06-09T15:00:00Z",
      "details": { "settlementId": "settle-uuid", "amount": 200000 }
    }
  ]
  ```

---

## 7. EXCHANGE RATE ENDPOINT

### 7.1. Lấy tỷ giá
- **`GET /api/v1/exchange-rates?from=USD&to=VND`**
- **Response (200):**
  ```json
  "data": {
    "from": "USD",
    "to": "VND",
    "rate": 25000.000000,
    "source": "fixer.io",
    "cached": false,
    "fetchedAt": "2026-06-09T14:00:00Z"
  }
  ```
- **Note:** `cached: true` khi Circuit Breaker OPEN và dùng fallback cache.

---

## 8. NOTIFICATION ENDPOINTS

### 8.1. Danh sách notifications
- **`GET /api/v1/notifications`**
- **Query:** `?unreadOnly=true&page=1&limit=20`
- **Response (200):**
  ```json
  "data": [
    {
      "id": "notif-uuid",
      "type": "EXPENSE_CREATED",
      "title": "Chi phí mới",
      "body": "Minh thêm 'Ăn trưa' — Bạn nợ 200,000₫",
      "groupId": "group-uuid",
      "read": false,
      "createdAt": "2026-06-09T14:30:00Z"
    }
  ]
  ```

### 8.2. Đánh dấu đã đọc
- **`PUT /api/v1/notifications/:id/read`**

### 8.3. Nhắc nợ (Remind)
- **`POST /api/v1/groups/:id/remind`**
- **Payload:** `{ "toUserId": "uuid-b" }`
- **Response (200):** `"data": { "sent": true }`
- **Rate Limit:** 1 reminder / 24h cho cùng 1 cặp.

---

## 9. WEBSOCKET EVENTS

### Connection
```javascript
const socket = io('wss://teamfin.app/ws', {
  auth: { token: accessToken }
});
```

### Events (Server → Client)

| Event | Payload | Trigger |
|-------|---------|---------|
| `expense:created` | `{ expenseId, groupId, description, amount, yourShare }` | Expense mới trong nhóm |
| `expense:updated` | `{ expenseId, groupId, changes }` | Expense bị sửa |
| `expense:deleted` | `{ expenseId, groupId }` | Expense bị xóa |
| `settlement:created` | `{ settlementId, groupId, from, to, amount }` | Ai đó settle nợ |
| `balance:updated` | `{ groupId, myBalance }` | Balance thay đổi |
| `member:joined` | `{ groupId, userId, username }` | Thành viên mới |
| `reminder:received` | `{ groupId, fromUsername, amount }` | Bị nhắc nợ |
