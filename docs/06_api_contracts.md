# 📡 ĐẶC TẢ API (API CONTRACTS)

> 📖 **[English Version](./en/06_api_contracts.md)**

Đặc tả các endpoint giữa **Web Client (Vite + React SPA)** và **Backend (auth-service Fastify / core-api NestJS)** cho **Cortex**. RESTful API, JSON.

---

## 1. GIAO THỨC CHUNG

- **Auth Service Base URL:** `/api/v1` (Fastify, port 4001)
- **Core API Base URL:** `/api/v1` (NestJS, port 4002)
- **Authentication:** Access Token trong HTTP-Only Cookie `accessToken` (JWT mang `sub`, `orgId`, `role`).
- **Tenant scope:** mọi request core-api mặc định scope theo `orgId` trong token. Có thể override bằng header `X-Org-Id` (chỉ với user đa-org, được validate).
- **Idempotency:** mọi POST tốn credit (gọi AI, stake bounty) PHẢI gửi `X-Idempotency-Key`.
- **OCC:** mọi PUT update knowledge PHẢI gửi `version` trong body.
- **Pagination:** cursor-based — `?cursor=<opaque>&limit=20`.
- **Response Format:**
  ```json
  { "success": true, "message": "OK", "data": { }, "statusCode": 200 }
  ```
- **Error Format:**
  ```json
  { "success": false, "message": "Conflict", "errorCode": "OCC_CONFLICT", "statusCode": 409 }
  ```

### Mã lỗi chuẩn
| HTTP | errorCode | Khi nào |
|------|-----------|---------|
| 401 | `UNAUTHENTICATED` | Thiếu/expired token |
| 403 | `FORBIDDEN_TENANT` | Truy cập dữ liệu org khác |
| 409 | `OCC_CONFLICT` | Version đã đổi (wiki edit) |
| 422 | `VALIDATION_ERROR` | Zod schema fail |
| 429 | `RATE_LIMITED` | Vượt quota (AI/login) |
| 402 | `INSUFFICIENT_CREDIT` | Org hết credit |
| 503 | `AI_UNAVAILABLE` | Circuit Breaker OPEN (kèm fallback) |

---

## 2. AUTH SERVICE (`auth-service`)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/v1/auth/register` | Đăng ký |
| POST | `/api/v1/auth/login` | Đăng nhập (rate-limited 5/5m) |
| POST | `/api/v1/auth/refresh` | Refresh token rotation |
| POST | `/api/v1/auth/logout` | Thu hồi refresh token |
| GET  | `/api/v1/users/me` | Thông tin user + danh sách org |
| GET/POST | `/api/v1/roles`, `/api/v1/permissions` | RBAC management |

---

## 3. CORE API — TENANT

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/v1/orgs` | Tạo organization |
| POST | `/api/v1/orgs/{id}/invites` | Tạo invite link |
| POST | `/api/v1/orgs/invites/{code}/accept` | Chấp nhận lời mời |
| GET  | `/api/v1/orgs/{id}/members` | Danh sách thành viên |
| PATCH| `/api/v1/orgs/{id}/members/{userId}` | Đổi role |
| POST | `/api/v1/spaces` | Tạo space |

---

## 4. CORE API — KNOWLEDGE

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/v1/knowledge` | Tạo item (DOCUMENT/QUESTION/RUNBOOK/ADR) |
| GET  | `/api/v1/knowledge/{id}` | Chi tiết item |
| PUT  | `/api/v1/knowledge/{id}` | Cập nhật (yêu cầu `version` — OCC) |
| DELETE | `/api/v1/knowledge/{id}` | Soft delete |
| GET  | `/api/v1/knowledge/{id}/revisions` | Lịch sử phiên bản |
| POST | `/api/v1/knowledge/{id}/verify` | Đánh dấu Verified (cần quyền) |
| POST | `/api/v1/knowledge/{id}/answers` | Trả lời câu hỏi |
| POST | `/api/v1/answers/{id}/accept` | Accept answer |
| POST | `/api/v1/knowledge/{id}/votes` | Vote (+1/-1) |

**Ví dụ OCC conflict:**
```http
PUT /api/v1/knowledge/abc {"body":"...","version":3}
→ 409 { "errorCode":"OCC_CONFLICT", "data":{ "currentVersion":4 } }
```

---

## 5. CORE API — DISCOVERY (Search + AI)

### Search (không tốn credit)
```http
GET /api/v1/search?q=rotate+jwt+secret&type=DOCUMENT&verified=true&limit=20
→ 200 {
  "data": {
    "results": [
      { "itemId":"...", "title":"Deploy Guide", "score":0.91, "source":"hybrid", "highlight":"…" }
    ]
  }
}
```
Backend chạy **Hybrid Retrieval** (Elasticsearch BM25 + pgvector) → RRF.

### Ask AI / RAG (tốn credit)
```http
POST /api/v1/ai/ask
X-Idempotency-Key: ask-789
{ "query": "làm sao rotate JWT secret khi deploy?", "spaceId": "optional" }

→ 200 {
  "data": {
    "answer": "Để rotate JWT secret khi deploy…",
    "citations": [
      { "itemId":"...", "title":"Deploy Guide", "snippet":"…" }
    ],
    "creditCost": 5
  }
}
```
- **402** nếu org hết credit. **429** nếu vượt rate-limit. **503** `AI_UNAVAILABLE` → trả `keywordResults[]` fallback, **không trừ credit**.
- Gửi lại cùng `X-Idempotency-Key` → trả kết quả cached, không trừ credit lần 2.

### AI Chat (realtime, qua chat-service/WebSocket)
- `WS /ws/ai-chat` — stream câu trả lời từng token, mỗi message kèm `citations`.

---

## 6. CORE API — CREDIT & BOUNTY

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET  | `/api/v1/credits/balance` | Số dư credit org (Read Model) |
| GET  | `/api/v1/credits/ledger` | Lịch sử giao dịch (cursor) |
| POST | `/api/v1/credits/purchase` | Mua credit pack (Owner) |
| POST | `/api/v1/questions/{id}/bounty` | Stake credit (`X-Idempotency-Key`) |

---

## 7. CORE API — REPUTATION & FEED

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/v1/feed` | Timeline "Mới trong Spaces của bạn" |
| GET | `/api/v1/reputation/me` | Điểm + badges |
| GET | `/api/v1/reputation/leaderboard` | Bảng xếp hạng org/space |

---

## 8. REALTIME (notification-service / chat-service)

| Kênh | Mô tả |
|------|------|
| `WS /ws/notifications` | answered, doc-updated, @mention, digest |
| `WS /ws/ai-chat` | AI Assistant streaming + citations |
| `WS /ws/presence` | Ai đang xem doc / online (Redis-backed) |

---

## 9. Idempotency & OCC — Tóm tắt quy tắc

1. **Idempotency** bắt buộc cho mọi action tốn credit → server lưu `IdempotencyRecord`, trả cached nếu trùng key.
2. **OCC** bắt buộc cho update wiki → `version` mismatch ⇒ 409.
3. **Tenant guard** áp ở mọi endpoint core-api → cross-org ⇒ 403 `FORBIDDEN_TENANT`.
