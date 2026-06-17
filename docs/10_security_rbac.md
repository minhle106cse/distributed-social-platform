# 🛡️ BẢO MẬT & PHÂN QUYỀN (SECURITY & ACCESS CONTROL)

> 📖 **[English Version](./en/10_security_rbac.md)**

Bảo mật là ưu tiên hàng đầu khi hệ thống xử lý **dữ liệu tài chính**. Tài liệu này đặc tả toàn bộ chiến lược bảo mật cho **TeamFin**.

---

## 1. Xác thực (Authentication)

### 1.1. JWT Token Strategy

| Token | Lifetime | Lưu trữ | Mục đích |
|-------|----------|---------|----------|
| **Access Token** | 15 phút | Memory (JS variable) | Authenticate API requests |
| **Refresh Token** | 7 ngày | HTTP-Only Secure Cookie | Renew Access Token |

- **Refresh Token Rotation:** Mỗi lần sử dụng Refresh Token, server cấp token mới và vô hiệu hóa token cũ. Nếu token cũ bị sử dụng lại → **Revoke toàn bộ token family** (phát hiện theft).
- **KHÔNG LƯU token trong LocalStorage** — chống XSS.

### 1.2. CORS Policy
```
Allowed Origins: https://teamfin.app (production), http://localhost:5173 (dev)
Allowed Methods: GET, POST, PUT, DELETE, OPTIONS
Allowed Headers: Content-Type, X-Idempotency-Key
Credentials: true (cho Cookie)
```

### 1.3. API Security Headers
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
```

---

## 2. Phân quyền (Authorization — Group RBAC)

### 2.1. Role Matrix

| Action | OWNER | ADMIN | MEMBER | VIEWER |
|--------|-------|-------|--------|--------|
| Xem dashboard/expenses | ✅ | ✅ | ✅ | ✅ |
| Tạo expense | ✅ | ✅ | ✅ | ❌ |
| Sửa expense **của mình** | ✅ | ✅ | ✅ | ❌ |
| Sửa expense **của người khác** | ✅ | ✅ | ❌ | ❌ |
| Xóa expense **của mình** | ✅ | ✅ | ✅ | ❌ |
| Xóa expense **của người khác** | ✅ | ✅ | ❌ | ❌ |
| Settle nợ | ✅ | ✅ | ✅ | ❌ |
| Mời thành viên | ✅ | ✅ | ❌ | ❌ |
| Kick thành viên | ✅ | ❌ | ❌ | ❌ |
| Đổi role thành viên | ✅ | ❌ | ❌ | ❌ |
| Sửa thông tin nhóm | ✅ | ✅ | ❌ | ❌ |
| Xóa/Archive nhóm | ✅ | ❌ | ❌ | ❌ |
| Export PDF | ✅ | ✅ | ❌ | ❌ |
| Xem Activity Log | ✅ | ✅ | ✅ | ✅ |

### 2.2. Enforcement Rules

- **Backend BUỘC kiểm tra role.** KHÔNG tin tưởng Frontend validation.
- Mọi endpoint Group/Expense/Settlement phải:
  1. Verify user là member của nhóm.
  2. Verify user có role đủ quyền cho action đó.
  3. Nếu thiếu quyền → **HTTP 403 Forbidden**.
- **Enforcement Patterns (Đa kiến trúc / Polyglot):**
  - **System RBAC (`auth-service` / Fastify):** Sử dụng `preHandler: [fastify.authenticate, fastify.requirePermissions(['RBAC:*'])]` để verify Fat JWT (Không cần gọi DB).
  - **Group RBAC (`core-api` / NestJS):** Sử dụng Custom `@Roles(GroupRole.ADMIN)` decorator + Guard (NestJS Interceptor) để kiểm tra role của user trong một context nhóm cụ thể.

---

## 3. Rate Limiting (Chống Spam)

Sử dụng **Redis-backed Token Bucket** algorithm.

| Endpoint | Limit | Window | Mục đích |
|----------|-------|--------|----------|
| `POST /auth/login` | 5 req | 5 phút / IP | Chống brute force |
| `POST /auth/register` | 3 req | 10 phút / IP | Chống spam accounts |
| `POST /expenses` | 30 req | 1 phút / User | Chống spam expense |
| `POST /settlements` | 10 req | 1 phút / User | Chống spam settlement |
| `POST /remind` | 1 req | 24h / (User, Target) pair | Chống spam nhắc nợ |
| `POST /groups/:id/invites` | 10 req | 1 giờ / User | Chống spam invite |
| `GET /api/v1/*` (general) | 100 req | 1 phút / User | Chống DoS |

### Response khi bị Rate Limit
```json
HTTP 429 Too Many Requests
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again in 45 seconds.",
    "retryAfter": 45
  }
}
```

---

## 4. Bảo vệ Dữ liệu Tài chính (Financial Data Protection)

### 4.1. Encryption

| Data | At Rest | In Transit |
|------|---------|------------|
| Passwords | bcrypt (12 rounds) | HTTPS/TLS 1.3 |
| Financial amounts | PostgreSQL native | HTTPS/TLS 1.3 |
| Refresh Tokens | Encrypted in DB | HTTP-Only Secure Cookie |
| Exchange Rate API Key | Environment variable | HTTPS |

### 4.2. Data Integrity

- **Event Store là IMMUTABLE.** Không ai (kể cả Admin) có quyền DELETE hoặc UPDATE event records.
- Database user cho application chỉ có quyền `INSERT` trên `event_store` table — không có `UPDATE` hoặc `DELETE`.
- **Ledger Integrity Check:** Nightly cron verify `Sum(events) == Current Balance`. Drift → Alert.

### 4.3. Audit Trail

- Mọi action tài chính ghi vào EventStore với `userId` + `timestamp`.
- Activity Log API cho phép xem lịch sử thay đổi.
- Export audit trail cho compliance (nếu cần).

---

## 5. Idempotency Security

### 5.1. Key Validation
- `X-Idempotency-Key` phải là UUID v4 format.
- Reject key không đúng format → **HTTP 400**.
- Key có TTL 24 giờ — sau đó tự động xóa.

### 5.2. Scope Isolation
- Idempotency Key scoped theo **UserId + Key**. User A không thể dùng key của User B.
- Prevent cross-user replay attacks.

---

## 6. WebSocket Security

### 6.1. Authentication
```javascript
// Client
const socket = io('wss://teamfin.app/ws', {
  auth: { token: accessToken }
});

// Server: Verify JWT on connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Authentication error'));
  }
});
```

### 6.2. Room Isolation
- User chỉ join rooms của nhóm mà họ là member.
- Server-side verify trước khi join room: `socket.join(\`group:${groupId}\`)`.
- User rời nhóm → Tự động leave room.

### 6.3. Rate Limiting
- WebSocket messages cũng bị rate limit: 60 messages / phút / connection.
- Prevent flooding attacks.

---

## 7. Input Validation & Sanitization

### 7.1. Schema Validation
- **Zod** (backend) — Validate mọi request payload tại controller layer.
- Reject trước khi đụng đến business logic.

### 7.2. Financial Input Rules
| Field | Validation |
|-------|-----------|
| `amount` | Integer > 0, max 999,999,999,999 (tránh overflow) |
| `currency` | Enum whitelist: VND, USD, EUR, JPY, THB |
| `splitMethod` | Enum whitelist: EQUAL, EXACT, PERCENTAGE, SHARES |
| `percentage` | 0 < x ≤ 100, sum = 100% |
| `shares` | Integer > 0 |
| `noteText` | Max 1000 characters, sanitized (strip HTML tags) |
| `description` | Max 200 characters, sanitized |
| `groupName` | 1-100 characters, sanitized |

### 7.3. SQL Injection Prevention
- **Prisma ORM** — Parameterized queries by default. Không raw SQL.
- Nếu cần raw query (performance) → dùng `$queryRawUnsafe` TUYỆT ĐỐI KHÔNG được truyền user input trực tiếp.
