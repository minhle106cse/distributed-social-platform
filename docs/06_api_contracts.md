# 📡 ĐẶC TẢ API (API CONTRACTS)


Đặc tả các endpoint giữa **Web Client (Vite + React SPA)** và **Backend** — auth-service (Fastify), core-api / notification-service / search-service (NestJS) — cho **Cortex**. RESTful API, JSON. Không có WebSocket/realtime endpoint nào tồn tại trong code hiện tại — mọi mục "WS /ws/*" ở tài liệu cũ là aspirational, chưa build (xem §8).

---

## 1. GIAO THỨC CHUNG

- **Auth Service Base URL:** `/api/v1` (Fastify, port 4001)
- **Core API Base URL:** `/api/v1` (NestJS, port 4002)
- **Notification Service Base URL:** `/api/v1` (NestJS, port 4003)
- **Search Service Base URL:** `/api/v1` (NestJS, port 4004)
- **Authentication:** Access Token trong HTTP-Only Cookie `accessToken`, RS256. JWT payload **chỉ mang identity hệ thống** (`sub`, `email`, `roles`, `permissions`) — **KHÔNG có `orgId`/`orgRole`** (xem `docs/10` §1.1).
- **Tenant scope:** mọi request core-api/search-service/notification-service scope theo header **`X-Org-Id`** (nguồn DUY NHẤT của org context — không phải token). core-api dùng `OrgGuard` (query `Membership` DB); search-service dùng `RemoteOrgMembershipGuard` (verify `X-Org-Id` qua gRPC sang core-api, vì search-service không có bảng `Membership` local).
- **Idempotency:** mọi POST tốn credit hoặc blast-radius cao (grant/spend credit, provision org) PHẢI gửi `X-Idempotency-Key`.
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
| POST | `/api/v1/auth/register` | Đăng ký (rate-limited 5/5m) |
| POST | `/api/v1/auth/login` | Đăng nhập (rate-limited 5/5m) |
| POST | `/api/v1/auth/refresh` | Refresh token rotation (rate-limited 10/1m) |
| POST | `/api/v1/auth/logout` | Thu hồi refresh token |
| GET  | `/api/v1/users/me` | Thông tin user hiện tại |
| PUT  | `/api/v1/users/me/profile` | Cập nhật hồ sơ (firstName/lastName/displayName/avatarUrl/phoneNumber) |
| GET  | `/api/v1/.well-known/jwks.json` | JWKS công khai (verify RS256 chéo service) |
| GET, POST, DELETE | `/api/v1/roles`, `/api/v1/roles/assign`, `/api/v1/roles/:code`, `/api/v1/roles/:code/permissions` | System RBAC — tạo/xoá/gán role, gán/thu hồi permission cho role (đủ CRUD, cần `SystemPermission.RBAC_ALL`) |
| GET  | `/api/v1/permissions` | Đọc catalog permission cố định (KHÔNG có POST — permission là closed catalog định nghĩa ở code `shared-kernel`, không tạo runtime được, chỉ Role tạo tự do) |

> **Đính chính:** danh sách trước đây ("GET/POST /roles, /permissions") là tóm tắt quá đơn giản — thực tế `roles` có đủ CRUD + `/assign` + `/:code/permissions`, còn `permissions` chỉ có GET.

---

## 3. CORE API — TENANT & PLATFORM ADMIN

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/v1/admin/orgs` | **Tạo organization — CHỈ System Admin** (`SystemPermission.ORG_CREATE`, `SystemPermissionGuard`, không phải `OrgGuard`). Provision cả owner user (gRPC sang auth-service) + org trong 1 saga, idempotent (`X-Idempotency-Key`). |
| GET  | `/api/v1/admin/orgs` | Danh sách toàn bộ org (System Admin, `SystemPermission.ORG_READ`) |
| GET  | `/api/v1/orgs/{id}/members` | Danh sách thành viên |
| PATCH| `/api/v1/orgs/{id}/members/{userId}` | Đổi role |
| POST | `/api/v1/orgs/{id}/invites` | Tạo invite link |
| POST | `/api/v1/invites/accept` | Chấp nhận lời mời |
| GET  | `/api/v1/orgs/{id}/role-permissions` | Xem mapping role→permission của org |
| PATCH| `/api/v1/orgs/{id}/role-permissions/{role}` | Sửa mapping role→permission (OWNER) |
| POST | `/api/v1/spaces` | Tạo space |

> **Đính chính quan trọng:** `POST /api/v1/orgs` self-service (ai đăng nhập cũng tạo được org) đã **BỊ XOÁ HẲN** (2026-07-07) — org giờ chỉ được tạo bởi System Admin qua `POST admin/orgs` (saga gRPC, không còn self-service). Đây là thay đổi business model, không phải tài liệu thiếu sót.

---

## 4. CORE API — KNOWLEDGE

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/v1/knowledge` | Tạo item (DOCUMENT/QUESTION/ANSWER/RUNBOOK/ADR — ANSWER tạo qua endpoint này với `parentId`, không có route `/answers` riêng) |
| GET  | `/api/v1/knowledge` | Danh sách item |
| GET  | `/api/v1/knowledge/{id}` | Chi tiết item |
| PATCH| `/api/v1/knowledge/{id}` | Cập nhật (yêu cầu `version` — OCC) |
| POST | `/api/v1/knowledge/{id}/publish` | Publish (DRAFT → PUBLISHED, phát `KnowledgePublished` event) |
| POST | `/api/v1/knowledge/{id}/verify` | Đánh dấu Verified (cần quyền) |
| DELETE | `/api/v1/knowledge/{id}` | Soft delete |
| GET  | `/api/v1/knowledge/{id}/revisions` | Lịch sử phiên bản |

> **Đính chính:** method thật là **`PATCH`** (không phải `PUT` như tài liệu cũ ghi). Không có `POST /knowledge/{id}/answers` hay `POST /answers/{id}/accept` riêng — trả lời = tạo `KnowledgeItem` type ANSWER với `parentId`; accept answer nằm ở module `engagement` (§4b).

**Ví dụ OCC conflict:**
```http
PATCH /api/v1/knowledge/abc {"body":"...","version":3}
→ 409 { "errorCode":"OCC_CONFLICT", "data":{ "currentVersion":4 } }
```

---

## 4b. CORE API — ENGAGEMENT (Vote / Bookmark / Accept Answer / Follow)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| PUT    | `/api/v1/knowledge/{id}/vote` | Vote (+1/-1), upsert |
| DELETE | `/api/v1/knowledge/{id}/vote` | Gỡ vote |
| GET    | `/api/v1/knowledge/{id}/vote-summary` | Tổng điểm vote |
| PUT    | `/api/v1/knowledge/{id}/bookmark` | Bookmark item |
| DELETE | `/api/v1/knowledge/{id}/bookmark` | Gỡ bookmark |
| GET    | `/api/v1/bookmarks` | Danh sách bookmark của tôi |
| POST   | `/api/v1/knowledge/{id}/accept-answer` | Accept 1 answer cho question |
| DELETE | `/api/v1/knowledge/{id}/accept-answer` | Bỏ accept |
| PUT    | `/api/v1/follows` | Follow (DOCUMENT hoặc SPACE) |
| DELETE | `/api/v1/follows` | Unfollow |
| GET    | `/api/v1/follows` | Danh sách đang follow |

---

## 5. SEARCH-SERVICE — DISCOVERY (Search + RAG, service riêng, port 4004)

> **Đính chính lớn:** search **KHÔNG** nằm trong core-api — search-service là **microservice riêng**, own `search_db`, có guard riêng (`RemoteOrgMembershipGuard` — verify `X-Org-Id` qua gRPC sang core-api vì không có `Membership` local). Endpoint là **`POST`** (không phải `GET`), và KHÔNG tách "search thường" khỏi "ask AI" — **1 endpoint duy nhất** làm cả semantic + hybrid (RRF) + RAG summary tuỳ tham số `summarize`. Không có `POST /api/v1/ai/ask` nào tồn tại.

```http
POST /api/v1/search
X-Org-Id: <orgId>
{ "query": "làm sao rotate JWT secret khi deploy?", "topK": 20, "summarize": true }

→ 200 {
  "data": {
    "results": [
      { "itemId":"...", "title":"Deploy Guide", "score":0.91, "source":"hybrid" }
    ],
    "summary": "Để rotate JWT secret khi deploy…"   // null nếu summarize=false hoặc Circuit Breaker OPEN
  }
}
```
- Backend chạy **Hybrid Retrieval** (Elasticsearch BM25 per-tenant index + pgvector `knowledge_chunks`) → **RRF** (k=60, item-level).
- RAG summary qua `ClaudeSummarizer`, bảo vệ bằng **Circuit Breaker** (5 fail liên tiếp → OPEN → fail-fast, degrade `summary:null` thay vì 500).
- ES down → degrade còn semantic-only (pgvector), vẫn 200 chứ không 500.
- Throttled 20 req/phút/org (đắt hơn CRUD thường — chạm Elasticsearch + có thể cả Claude).
- **Không tốn credit hiện tại** — mục "Ask AI tốn credit / X-Idempotency-Key / 402 INSUFFICIENT_CREDIT" của tài liệu cũ là thiết kế cho Phase 5b (AI-Query Saga: reserve→RAG→commit/compensate) — **CHƯA triển khai**, chưa có wiring credit↔search nào trong code. Credit ledger (§6) hiện độc lập với search.
- Không có `WS /ws/ai-chat` — không có WebSocket/streaming nào trong code.

---

## 6. CORE API — CREDIT

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET  | `/api/v1/credits/wallet` | Balance + ledger gần nhất — **fold trực tiếp từ `credit_events`** (không có bảng summary, xem `docs/04` §2.7) |
| POST | `/api/v1/credits/grant` | Cấp credit cho thành viên (nguồn: org phân phối gói đã mua). Idempotent (`X-Idempotency-Key`), cần `credit:grant` |
| POST | `/api/v1/credits/spend` | Trừ credit của chính mình (sink). Idempotent (`X-Idempotency-Key`) + OCC. Cần `credit:spend` |

> **Đính chính:** trước đây tài liệu ghi `GET /credits/balance`, `GET /credits/ledger`, `POST /credits/purchase` — các path này **không tồn tại**. Endpoint thật (shipped 2026-07-03) là `wallet`/`grant`/`spend` như trên. `POST /questions/{id}/bounty` (stake credit) **chưa triển khai** — thuộc Phase 5c (bounty + reputation), chưa bắt đầu.

---

## 7. CORE API — FEED & REPUTATION

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/v1/feed` | Timeline "Mới trong Spaces của bạn" — **fan-out-on-read**, query thẳng `follows`×`knowledge_items`, KHÔNG có bảng `feed_timeline` (xem `docs/04` §2.7) |

> **Reputation chưa có endpoint nào.** `reputation_events` (ledger) đã có trong schema nhưng Phase 5c (bounty + reputation) chưa triển khai — `GET /reputation/me` và `GET /reputation/leaderboard` là aspirational, chưa build.

---

## 8. NOTIFICATION-SERVICE (REST, KHÔNG phải WebSocket — port 4003)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET   | `/api/v1/notifications` | Danh sách notification của tôi (JWT-only, không `OrgGuard` — service không có bảng `Membership`, lọc theo `recipientUserId` tự nhiên tenant-safe) |
| PATCH | `/api/v1/notifications/{id}/read` | Đánh dấu đã đọc (idempotent — no-op nếu đã đọc) |

> **Đính chính lớn:** notification-service là **REST polling**, không phải WebSocket/push. `WS /ws/notifications`, `WS /ws/ai-chat`, `WS /ws/presence` — **KHÔNG có endpoint WebSocket nào trong toàn bộ codebase** (grep xác nhận 0 `@WebSocketGateway`). `chat-service` (thư mục rỗng trong `apps/`, không phải submodule, không có code) không tồn tại như service thật — AI Assistant hiện là REST `POST /search` (§5), không realtime/streaming.

---

## 9. Idempotency & OCC — Tóm tắt quy tắc

1. **Idempotency** bắt buộc cho mutation blast-radius cao/non-idempotent-tự-nhiên (credit grant/spend, provision org) → server lưu `IdempotencyRecord` (kèm `requestHash` chống tái dùng key cho request khác), trả cached nếu trùng key.
2. **OCC** bắt buộc cho update wiki → `version` mismatch ⇒ 409.
3. **Tenant guard** áp ở mọi endpoint core-api/search-service/notification-service scoped-theo-org → cross-org ⇒ 403 `FORBIDDEN_TENANT`.
