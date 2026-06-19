# 🛡️ BẢO MẬT & PHÂN QUYỀN (SECURITY & ACCESS CONTROL)

> 📖 **[English Version](./en/10_security_rbac.md)**

Cortex là **B2B SaaS đa tổ chức** — bảo mật ưu tiên hàng đầu là **cô lập dữ liệu giữa các tenant** và **ranh giới dữ liệu cho AI (AI Data Boundary)**. Tài liệu đặc tả toàn bộ chiến lược bảo mật cho **Cortex**.

---

## 1. Xác thực (Authentication)

### 1.1. JWT Token Strategy

| Token | Lifetime | Lưu trữ | Mục đích |
|-------|----------|---------|----------|
| **Access Token** | 15 phút | HTTP-Only Cookie | Authenticate API requests |
| **Refresh Token** | 30 ngày | HTTP-Only Secure Cookie | Renew Access Token |

- **Access Token payload:** `sub` (userId), `orgId`, `role` (trong org), `jti`.
- **Refresh Token Rotation:** mỗi lần dùng → cấp token mới + vô hiệu token cũ. Token cũ bị tái sử dụng → **revoke toàn bộ token family** (phát hiện theft).
- **KHÔNG** lưu token trong LocalStorage (chống XSS).

### 1.2. Multi-Org Login
- Một user có thể thuộc nhiều org. Access Token gắn `orgId` hiện tại; chuyển org → cấp lại token với `orgId` mới (re-scope).

---

## 2. Phân quyền (Authorization) — RBAC ĐA TỔ CHỨC

### 2.1. Hai tầng quyền

| Tầng | Phạm vi | Ví dụ |
|------|---------|-------|
| **System RBAC** (auth-service) | Toàn hệ thống | superadmin, vận hành |
| **Org RBAC** (per-tenant) | Trong 1 organization | OWNER/ADMIN/MEMBER/GUEST |

### 2.2. Org Roles & Quyền

| Quyền | OWNER | ADMIN | MEMBER | GUEST |
|------|:----:|:----:|:----:|:----:|
| Đọc nội dung space được phép | ✅ | ✅ | ✅ | ✅ (chỉ space được mời) |
| Tạo/sửa knowledge | ✅ | ✅ | ✅ | ❌ |
| Hỏi AI (tốn credit) | ✅ | ✅ | ✅ | ❌ |
| Verify nội dung | ✅ | ✅ | ⚠️ (đủ reputation) | ❌ |
| Quản lý thành viên & space | ✅ | ✅ | ❌ | ❌ |
| Quản lý credit/billing | ✅ | ❌ | ❌ | ❌ |

> Một số quyền (Verify, edit wiki không cần duyệt) còn mở khóa theo **reputation** (gamification) — xem `docs/01` Trụ Cột 4.

### 2.3. Privilege theo Reputation (tham khảo)
| Ngưỡng | Mở khóa |
|--------|---------|
| 50 | Vote |
| 200 | Edit wiki người khác không cần duyệt |
| 500 | Verify nội dung |
| 1000 | Moderation (gỡ flag, đóng câu hỏi trùng) |

---

## 3. 🔒 Tenant Isolation (BẤT BIẾN QUAN TRỌNG NHẤT)

> **RULE: Mọi truy vấn core-api BẮT BUỘC scope theo `orgId`. Không có ngoại lệ.**

- **Query guard:** middleware/interceptor inject `orgId` từ token vào mọi repository query (`WHERE org_id = ?`).
- **Cross-org access** → HTTP 403 `FORBIDDEN_TENANT`.
- **Defense in depth:** cân nhắc Postgres Row-Level Security (RLS) như lớp bảo vệ thứ hai (Phase 8).
- **Test bắt buộc:** mỗi endpoint phải có test "user org A không thấy data org B" (xem `docs/08`).

### 3.1. AI Data Boundary (đặc thù RAG)
- Embedding mang `orgId`; **retrieval luôn lọc theo org** → ngữ cảnh RAG của org A **không bao giờ** chứa dữ liệu org B.
- Prompt gửi tới Claude chỉ chứa nội dung thuộc đúng org của người hỏi.
- Không log nội dung nhạy cảm ra hệ thống dùng chung; redact PII trong log.

---

## 4. Rate Limiting & Quota (chống lạm dụng + noisy-neighbor)

| Đối tượng | Giới hạn | Cơ chế |
|-----------|----------|--------|
| Login/Register | 5 req / 5 phút / IP | auth-service |
| AI query (đắt) | `aiRateLimitPerMin` / user / org | **Token Bucket (Redis)** |
| Ghi nội dung | N req / phút / user | Redis |
| Credit | chặn khi balance < cost | Ledger check |

- Quota **per tenant** đảm bảo org này không làm cạn tài nguyên org khác.

---

## 5. Bảo mật Dữ liệu & Hạ tầng

- **Encryption in transit:** TLS toàn bộ; cookie `Secure` + `SameSite=Lax/Strict`.
- **Secrets:** `JWT_*`, `ANTHROPIC_API_KEY` qua env/secret manager; rotation định kỳ.
- **CORS:** whitelist từ env, **TUYỆT ĐỐI KHÔNG** `['*']` (xem memory gotcha #cũ).
- **Headers:** `@fastify/helmet` (auth-service) + tương đương core-api; `compress`, `rate-limit`.
- **Input validation:** Zod là single source of truth (xem `directives/zod_validation.md`).
- **Audit:** mọi thay đổi credit/knowledge có `userId` + timestamp (Event Store + revisions).

---

## 6. Threat Model (tóm tắt)

| Mối đe dọa | Phòng thủ |
|-----------|-----------|
| Cross-tenant data leak | Query guard `orgId` + RLS + test |
| Prompt injection / data exfil qua RAG | AI Data Boundary + retrieval filter + output citation |
| Credit fraud / double-spend | Idempotency + Event Sourcing + ledger integrity cron |
| Token theft | Refresh rotation + family revoke + HTTP-only cookie |
| AI cost abuse | Rate limit token-bucket + per-org quota |
| XSS | No token in LocalStorage, sanitize markdown render |
