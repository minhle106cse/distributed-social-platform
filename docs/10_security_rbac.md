# 🛡️ BẢO MẬT & PHÂN QUYỀN (SECURITY & ACCESS CONTROL)

> 📖 **[English Version](./en/10_security_rbac.md)**

Cortex là **B2B SaaS đa tổ chức** — bảo mật ưu tiên hàng đầu là **cô lập dữ liệu giữa các tenant** và **ranh giới dữ liệu cho AI (AI Data Boundary)**. Tài liệu đặc tả toàn bộ chiến lược bảo mật cho **Cortex**.

---

## 1. Xác thực (Authentication)

### 1.1. JWT Token Strategy

| Token | Lifetime | Lưu trữ | Thuật toán | Mục đích |
|-------|----------|---------|-----------|----------|
| **Access Token** | 15 phút | HTTP-Only Cookie | RS256 (asymmetric) | Authenticate API requests |
| **Refresh Token** | 30 ngày | HTTP-Only Secure Cookie | HS256 (symmetric) | Renew Access Token |

- **Access Token payload (chỉ identity hệ thống):**
  ```jsonc
  {
    "sub":         "userId",        // ai
    "email":       "user@acme.com",
    "roles":       ["user"],        // SYSTEM roles (superadmin/support/user)
    "permissions": []               // SYSTEM permissions (platform-level)
  }
  ```
  > ⚠️ **KHÔNG có `orgId` / `orgRole` trong token.** Một user thuộc nhiều org; org context được xác định **per-request** qua header `X-Org-Id` (xem §1.2 và §2.3). Token chỉ trả lời "bạn là ai trên platform", không trả lời "bạn là gì trong org nào".
- **RS256 (Access):** auth-service ký bằng `privateKey`, core-api verify bằng `publicKey` — không chia sẻ secret giữa service.
- **HS256 (Refresh):** chỉ auth-service tự ký & tự verify → không cần asymmetric.
- **Refresh Token Rotation:** mỗi lần dùng → cấp token mới + vô hiệu token cũ. Token cũ bị tái sử dụng → **revoke toàn bộ token family** (phát hiện theft).
- **KHÔNG** lưu token trong LocalStorage (chống XSS).

### 1.2. Multi-Org Access (qua header, không re-scope token)
- Một user có thể thuộc nhiều org với role khác nhau ở mỗi org (OWNER ở org A, GUEST ở org B).
- Client gửi header **`X-Org-Id: <orgId>`** trên mỗi request tới core-api.
- core-api `OrgGuard` verify user có là thành viên của org đó không (query `Membership`), rồi resolve role + permissions cho org đó.
- **Ưu điểm so với nhét orgId vào token:** không phải cấp lại token khi đổi org; revoke membership có hiệu lực tức thì (không phải chờ token hết hạn); token nhỏ gọn, thuần identity.

---

## 2. Phân quyền (Authorization) — RBAC HAI TẦNG ĐỘC LẬP

> **Nguyên tắc nền tảng:** Identity (bạn là ai) và Authorization-trong-business (bạn làm được gì ở đâu) là **hai bài toán khác nhau** → hai hệ thống RBAC độc lập, không merge. Đây là pattern chuẩn enterprise (Keycloak: *realm roles* vs *client roles*; Auth0: *global roles* vs *organization roles*).

### 2.0. Bức tranh tổng thể

```
Platform (do bạn — nhà vận hành — sở hữu)
│
├── TẦNG 1 — System RBAC  (auth-service / auth_db)
│   Câu hỏi: "User này được làm gì với HẠ TẦNG platform?"
│   ├── superadmin → xử lý report, monitor tài nguyên hệ thống, quản trị platform
│   ├── support    → xem report, hỗ trợ, read-only monitor
│   └── user       → chỉ dùng sản phẩm (DEFAULT khi đăng ký)
│   → Gán role 1 lần, TOÀN CỤC. Nằm trong JWT (`roles`, `permissions`).
│   → Do nhà vận hành (bạn) quản lý.
│
└── TẦNG 2 — Org RBAC  (core-api / core_db)
    Câu hỏi: "User này được làm gì với TÀI NGUYÊN của org NÀY?"
    ├── Org A: OWNER=Minh, ADMIN=John, MEMBER=...
    ├── Org B: OWNER=Sarah, MEMBER=Minh, GUEST=...
    └── ...
    → Gán role THEO TỪNG ORG. KHÔNG nằm trong JWT (resolve qua X-Org-Id).
    → Do Org OWNER tự quản lý (dynamic, không cần deploy).
```

**Cùng một con người, hai context:** `userId` là cùng một UUID ở cả hai tầng. `Membership.userId` (core_db) là **loose reference** tới `User.id` (auth_db) — KHÔNG có FK chéo DB. Hai tầng không ràng buộc nhau: một user có thể là `user` thường ở System nhưng là `OWNER` trong org của họ; ngược lại bạn hoàn toàn có thể nâng một user bất kỳ thành `superadmin` mà không ảnh hưởng role org của họ.

### 2.1. Tầng 1 — System RBAC (auth-service)

- **Mô hình:** `Role` ──< `RolePermission` >── `Permission`; `User` ──< `UserRole`. (Đã có sẵn trong auth-service.)
- **Permission catalog:** định nghĩa trong `src/common/rbac/system-permissions.ts` (`SystemPermission` const). Format `resource:action` lowercase — đồng nhất với Org RBAC.
- **Permission ví dụ:** `report:read`, `report:resolve`, `report:dismiss`, `system:monitor`, `system:resource_manage`, `user:ban`, `user:unban`, `org:suspend`, `billing:manage`, `rbac:*`.
- **System Roles:** `SUPER_ADMIN` (implicit-all), `SUPPORT_AGENT`, `CONTENT_MODERATOR`, `SYSTEM_ENGINEER`, `BILLING_ADMIN`.
- **Wildcard matching** (AWS IAM style) trong `requirePermissions([...])`:
  - `'*'` → pass mọi thứ
  - `'rbac:*'` → pass mọi action trên resource `rbac` (ví dụ: `rbac:read`, `rbac:create`)
  - `'rbac:read'` → exact match
- **Enforce:** auth-service routes dùng `fastify.requirePermissions(['rbac:*'])`; core-api endpoint admin đọc `permissions` từ JWT payload.
- **Đặc tính:** ít thay đổi, gắn với vận hành platform, không biết gì về domain org.

### 2.2. Tầng 2 — Org RBAC (core-api) — **ĐỘNG, do OWNER quản lý**

**Vấn đề cần tránh:** hardcode "ADMIN được làm X" trong code → muốn đổi quyền phải sửa code + deploy. Không chấp nhận được với SaaS đa tổ chức (mỗi org có nhu cầu khác nhau).

**Thiết kế: tách Catalog (code) khỏi Mapping (DB).**

| Thành phần | Nguồn sự thật | Lý do |
|---|---|---|
| **Permission Catalog** (danh sách action tồn tại) | **Code** (`OrgPermission` const) | Mỗi permission gắn với một endpoint/feature cụ thể → chỉ thêm khi có code mới. Không cho phép "phát minh" permission rỗng nghĩa. |
| **Role → Permission Mapping** (role nào có quyền gì) | **DB** (`org_role_permissions`, per-org) | Đây là **business config** — OWNER chỉnh runtime qua API, KHÔNG cần deploy. |

**Org Permission Catalog (code-defined):**

| Permission | Ý nghĩa |
|---|---|
| `knowledge:read` | Đọc nội dung trong space được phép |
| `knowledge:write` | Tạo/sửa knowledge item |
| `knowledge:verify` | Đánh dấu nội dung `VERIFIED` |
| `ai:query` | Hỏi AI (tốn credit) |
| `org:manage_members` | Mời/đổi role/xóa thành viên |
| `org:manage_spaces` | Tạo/sửa/xóa space |
| `org:manage_billing` | Mua credit, quản lý gói |
| `org:manage_roles` | **Meta-permission:** chỉnh mapping role→permission của org |

**Default Mapping (seed khi tạo org — OWNER chỉnh sau):**

| Permission | OWNER | ADMIN | MEMBER | GUEST |
|---|:---:|:---:|:---:|:---:|
| `knowledge:read`     | ✅ | ✅ | ✅ | ✅ |
| `knowledge:write`    | ✅ | ✅ | ✅ | ❌ |
| `knowledge:verify`   | ✅ | ✅ | ⚠️ reputation | ❌ |
| `ai:query`           | ✅ | ✅ | ✅ | ❌ |
| `org:manage_members` | ✅ | ✅ | ❌ | ❌ |
| `org:manage_spaces`  | ✅ | ✅ | ❌ | ❌ |
| `org:manage_billing` | ✅ | ❌ | ❌ | ❌ |
| `org:manage_roles`   | ✅ | ❌ | ❌ | ❌ |

> Đây chỉ là **giá trị khởi tạo**. Sau khi org được tạo, mapping nằm trong `org_role_permissions` và OWNER có thể thêm/gỡ quyền cho bất kỳ role nào qua API.

**Guardrail bắt buộc — chống tự khóa (lock-out):**
- **OWNER luôn có toàn bộ permission**, KHÔNG cho gỡ. OrgGuard coi OWNER là "có mọi quyền" theo mặc định (implicit), bất kể bảng mapping → tránh trường hợp org không còn ai quản lý được.
- Chỉ permission của ADMIN/MEMBER/GUEST là chỉnh được.
- Không cho hạ role của OWNER cuối cùng / không cho org tồn tại với 0 OWNER.

### 2.3. Luồng enforce (per-request)

```
Request + Cookie(accessToken) + Header(X-Org-Id: orgId)
  │
  ├─ JwtAuthGuard      verify RS256 → request.user = { sub, email, roles, permissions }
  │
  ├─ OrgGuard          (chỉ cho route org-scoped)
  │   1. orgId = header['x-org-id']         (thiếu → 403)
  │   2. membership = find(orgId, user.sub) (không phải member → 403)
  │   3. orgRole = membership.role
  │   4. permissions = resolveOrgPermissions(orgId, orgRole)
  │                    ├─ OWNER → toàn bộ catalog (implicit)
  │                    └─ khác  → query org_role_permissions (cache Redis 5')
  │   5. request.org = { orgId, orgRole, permissions }
  │   6. nếu route có @RequireOrgPermission(p) và p ∉ permissions → 403
  │
  └─ TenantInterceptor  runWithTenant(request.org.orgId) → getTenantId() khả dụng cho repo
```

- Decorator khai báo trên route theo **action**, không theo role:
  `@RequireOrgPermission(OrgPermission.ORG_MANAGE_MEMBERS)`.
- Đổi "ai được làm gì" = đổi dữ liệu trong `org_role_permissions`, **không đụng code route**.

### 2.4. API quản lý Org RBAC & Invite

**Org RBAC (do OWNER dùng):**

| Method | Endpoint | Permission cần | Mô tả |
|---|---|---|---|
| `GET`   | `/api/v1/orgs/:id/role-permissions`        | `org:manage_roles`   | Xem mapping hiện tại của cả 4 role |
| `PATCH` | `/api/v1/orgs/:id/role-permissions/:role`  | `org:manage_roles`   | Thay thế toàn bộ tập permission của 1 role (trừ OWNER) |

- Mọi thay đổi → invalidate cache `org_perms:{orgId}` (Phase 3).

**Invite (do ADMIN+ dùng):**

| Method | Endpoint | Permission cần | Mô tả |
|---|---|---|---|
| `POST` | `/api/v1/orgs/:id/invites`  | `org:manage_members` | Tạo invite link; body: `{ role, ttlHours }` (1–168h, default 72h) |
| `POST` | `/api/v1/invites/accept`    | JWT only             | Redeem token; body: `{ token }` → tạo Membership |

- Token là 32-byte hex (64 ký tự), globally unique, single-use.
- Accept là transactional: tạo `Membership` + đánh dấu `OrgInvite.usedAt` trong cùng 1 DB transaction.
- Guard đầy đủ: token không tồn tại → 404, hết hạn → 410, đã dùng → 409, đã là member → 409.

### 2.5. Privilege theo Reputation (gamification — bổ trợ, không thay RBAC)
| Ngưỡng | Mở khóa |
|--------|---------|
| 50 | Vote |
| 200 | Edit wiki người khác không cần duyệt |
| 500 | Verify nội dung |
| 1000 | Moderation (gỡ flag, đóng câu hỏi trùng) |

> Reputation-gating là **business logic ở Application layer** (handler tự so `ReputationSummary.points` với ngưỡng), KHÔNG enforce ở HTTP guard — vì HTTP layer không đủ ngữ cảnh về điểm uy tín. RBAC quyết "có được gọi action không"; reputation quyết "có đủ uy tín cho action mở-khóa-theo-điểm không".

---

## 3. 🔒 Tenant Isolation (BẤT BIẾN QUAN TRỌNG NHẤT)

> **RULE: Mọi truy vấn core-api BẮT BUỘC scope theo `orgId`. Không có ngoại lệ.**

- **Nguồn orgId:** header `X-Org-Id` → `OrgGuard` xác thực membership → `TenantInterceptor` đưa vào `AsyncLocalStorage`. Repository đọc `getTenantId()` để chèn `WHERE org_id = ?`. (KHÔNG lấy orgId từ token.)
- **Cross-org access** → HTTP 403 `FORBIDDEN_TENANT`.
- **Defense in depth:** cân nhắc Postgres Row-Level Security (RLS) như lớp bảo vệ thứ hai (Phase 8).
- **Test bắt buộc:** mỗi endpoint phải có test "user org A không thấy data org B" (xem `docs/08`).

### 3.1. AI Data Boundary (đặc thù RAG)
- Embedding mang `orgId`; **retrieval luôn lọc theo org** → ngữ cảnh RAG của org A **không bao giờ** chứa dữ liệu org B.
- Prompt gửi tới Claude chỉ chứa nội dung thuộc đúng org của người hỏi.
- Không log nội dung nhạy cảm ra hệ thống dùng chung; redact PII trong log.

### 3.2. User Identity Projection (đồng bộ danh tính qua biên service)
- core_db chỉ giữ `userId` (loose ref). Để hiển thị tên/avatar tác giả mà không gọi auth-service mỗi lần render → cần **read-model `user_profiles`** trong core_db.
- Đồng bộ qua event (Phase 2): auth-service phát `UserRegisteredEvent`/`UserProfileUpdatedEvent` → core-api consumer upsert `user_profiles`.
- Trước khi có Kafka: chấp nhận chỉ hiển thị `userId`, hoặc nhúng `displayName` tối thiểu.

---

## 4. Rate Limiting & Quota (chống lạm dụng + noisy-neighbor)

| Đối tượng | Giới hạn | Cơ chế |
|-----------|----------|--------|
| Login/Register | 5 req / 5 phút / IP | auth-service (`@fastify/rate-limit`) |
| AI query (đắt) | `aiRateLimitPerMin` / user / org | **Token Bucket (Redis)** |
| Ghi nội dung | N req / phút / user | Redis |
| Credit | chặn khi balance < cost | Ledger check |

- Quota **per tenant** đảm bảo org này không làm cạn tài nguyên org khác.

---

## 5. Bảo mật Dữ liệu & Hạ tầng

- **Encryption in transit:** TLS toàn bộ; cookie `Secure` + `SameSite=Lax/Strict`.
- **Secrets:** `JWT_*`, `ANTHROPIC_API_KEY` qua env/secret manager; rotation định kỳ.
- **CORS:** whitelist từ env, **TUYỆT ĐỐI KHÔNG** `['*']`.
- **Headers:** `@fastify/helmet` (auth-service) + tương đương core-api; `compress`, `rate-limit`.
- **Input validation:** Zod là single source of truth (xem `directives/zod_validation.md`).
- **Audit:** mọi thay đổi credit/knowledge/role-permission có `userId` + timestamp (Event Store + revisions + audit log).

---

## 6. Threat Model (tóm tắt)

| Mối đe dọa | Phòng thủ |
|-----------|-----------|
| Cross-tenant data leak | `X-Org-Id` + membership check + query guard `orgId` + RLS + test |
| Privilege escalation trong org | Org RBAC động + guardrail OWNER + audit log role-permission |
| Org tự khóa (mất quyền quản lý) | OWNER luôn full quyền (implicit) + chặn xóa OWNER cuối |
| Prompt injection / data exfil qua RAG | AI Data Boundary + retrieval filter + output citation |
| Credit fraud / double-spend | Idempotency + Event Sourcing + ledger integrity cron |
| Token theft | Refresh rotation + family revoke + HTTP-only cookie |
| AI cost abuse | Rate limit token-bucket + per-org quota |
| XSS | No token in LocalStorage, sanitize markdown render |
```
