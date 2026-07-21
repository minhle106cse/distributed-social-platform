# 🛡️ BẢO MẬT & PHÂN QUYỀN (SECURITY & ACCESS CONTROL)


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

- **Mô hình:** `Role` (có cột `permissions: String[]`, không phải bảng `Permission`/`RolePermission` join) ──< `UserRole` >── `User`.
- **Permission catalog:** định nghĩa trong `packages/shared-kernel/src/auth/system-permissions.ts` (`SystemPermission` const) — closed set, KHÔNG có `POST /permissions` để tạo permission mới runtime. Lý do: guard (`SystemPermissionGuard`) chỉ so khớp chuỗi với `SystemPermissionValue` (union type từ catalog) — permission tạo runtime với code lạ sẽ vô tác dụng vì không có endpoint nào check nó. **Role thì ngược lại, tạo tự do runtime** (`POST /roles`) vì role chỉ là nhãn gộp permission có sẵn, guard không bao giờ check tên role. Format permission `resource:action` lowercase — đồng nhất với Org RBAC.
- **Permission catalog đầy đủ (`SystemPermission`, `packages/shared-kernel/src/auth/system-permissions.ts`):** `report:read`, `report:resolve`, `report:dismiss`, `system:monitor`, `system:resource_manage`, `user:read`, `user:ban`, `user:unban`, `org:read`, `org:create`, `org:suspend`, `org:restore`, `billing:read`, `billing:manage`, `rbac:*`.
  > **Bổ sung so với tài liệu cũ:** `org:read`, `org:create`, `user:read`, `org:restore`, `billing:read` từng bị thiếu ở đây. `org:create`/`org:read` là permission thật bảo vệ `POST`/`GET /admin/orgs` (saga gRPC provisioning, shipped 2026-07-07 — xem `docs/06` §3 và §2.6 dưới).
- **System Roles:** `SUPER_ADMIN` (implicit-all), `SUPPORT_AGENT`, `CONTENT_MODERATOR`, `SYSTEM_ENGINEER`, `BILLING_ADMIN` — định nghĩa ở `apps/auth-service/src/common/rbac/system-rbac.ts` (ở lại auth-service, không lên `shared-kernel` — chỉ auth-service cần biết TÊN role, service khác chỉ thấy permission qua JWT, giống `OrgRole` ở lại core-api).
- **Wildcard matching** (AWS IAM style) trong `requirePermissions([...])`:
  - `'*'` → pass mọi thứ
  - `'rbac:*'` → pass mọi action trên resource `rbac` (ví dụ: `rbac:read`, `rbac:create`)
  - `'rbac:read'` → exact match
- **Enforce:** auth-service routes dùng `fastify.requirePermissions([...])`; core-api dùng `SystemPermissionGuard` + `@RequireSystemPermission(...)` (đọc thẳng JWT claim, KHÔNG query DB — khác hẳn `OrgGuard`).
- **Đặc tính:** ít thay đổi, gắn với vận hành platform, không biết gì về domain org.

### 2.1a. gRPC Org-Provisioning Saga (shipped 2026-07-07) — chưa từng đặc tả ở đây

`POST /admin/orgs` (core-api, `SystemPermissionGuard` + `SystemPermission.ORG_CREATE`) orchestrate 1 saga đồng bộ xuyên service: gọi gRPC sang auth-service (`AuthProvisioningClient`, service `AuthProvisioning`, RPC `ProvisionUser`/`CancelProvisionedUser`) để tạo user owner thật trong `auth_db`, rồi tái dùng `CreateOrgCommand` hiện có để tạo org + Membership OWNER trong `core_db`. Auth M2M qua `INTERNAL_GRPC_SHARED_SECRET` trong gRPC metadata — **không phải JWT**. Nếu bước core-api fail sau khi user đã provision → compensation gọi bù `cancelProvisionedUser` (best-effort, in-request — không có saga-state table + sweep job, biết trước là nợ kỹ thuật ở tần suất thao tác admin thấp). Idempotent qua `X-Idempotency-Key` (blast-radius cao nhất hệ thống: user thật + org thật xuyên 2 DB). `POST /orgs` self-service cũ đã bị xoá hẳn — org KHÔNG còn tạo được ngoài luồng này (xem `docs/06` §3).

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
| `engagement:vote` | Vote knowledge item |
| `engagement:bookmark` | Bookmark knowledge item |
| `engagement:follow` | Follow document/space |
| `engagement:accept_answer` | Accept 1 answer cho question |
| `ai:query` | Hỏi AI (search + RAG summary — hiện KHÔNG tốn credit, xem `docs/06` §5) |
| `credit:read` | Xem wallet/ledger credit của mình |
| `credit:spend` | Trừ credit của chính mình |
| `credit:grant` | Cấp credit cho thành viên (admin/owner phân phối gói) |
| `org:manage_members` | Mời/đổi role/xóa thành viên |
| `org:manage_spaces` | Tạo/sửa/xóa space |
| `org:manage_billing` | Mua credit, quản lý gói |
| `org:manage_roles` | **Meta-permission:** chỉnh mapping role→permission của org |

> **Bổ sung so với tài liệu cũ:** `credit:read`/`credit:spend`/`credit:grant` (bảo vệ `GET /credits/wallet`, `POST /credits/spend`, `POST /credits/grant` — shipped 2026-07-03) và `engagement:*` (bảo vệ vote/bookmark/follow/accept-answer) chưa từng liệt kê ở đây. Catalog thật giờ sống ở `packages/shared-kernel/src/auth/org-permissions.ts` (dời khỏi core-api-local khi search-service/notification-service cần verify cùng permission code qua gRPC — xem §2.3).

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
  ├─ OrgGuard (core-api — có Membership local)         RemoteOrgMembershipGuard (search-service,
  │   1. orgId = header['x-org-id']  (thiếu → 403)      notification-service — KHÔNG có Membership local)
  │   2. membership = find(orgId, user.sub)               1. gRPC sang core-api (MembershipVerificationClient)
  │      (không phải member → 403)                           verify orgId + resolve permissions
  │   3. orgRole = membership.role                        2. Fail CLOSED: core-api unreachable/breaker OPEN
  │   4. permissions = resolveOrgPermissions(orgId, orgRole)  → 503, KHÔNG âm thầm cho qua (chống IDOR —
  │      ├─ OWNER → toàn bộ catalog (implicit)               trước đây X-Org-Id bị trust verbatim, đã vá)
  │      └─ khác  → query org_role_permissions (DB          3. request.org = { orgId, orgRole, permissions }
  │        trực tiếp, KHÔNG có cache — mục "cache Redis
  │        5 phút" của tài liệu cũ là thiết kế Phase 3,
  │        CHƯA triển khai)
  │   5. request.org = { orgId, orgRole, permissions }
  │   6. nếu route có @RequireOrgPermission(p) và p ∉ permissions → 403 (cả 2 guard)
  │
  └─ TenantContextMiddleware mở ALS (đầu request); OrgGuard setTenantId(orgId) → getTenantId() khả dụng cho repo
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

> **Chưa triển khai (aspirational, Phase 5c).** `reputation_events` (ledger append-only) đã có trong schema (`docs/04` §2.6), nhưng **không có bảng summary `ReputationSummary`** (rollback 2026-06-30, `docs/04` §2.7) **và không có bất kỳ HTTP endpoint nào** đọc điểm hay gate theo ngưỡng — Phase 5c (bounty + reputation) chưa bắt đầu. Bảng ngưỡng ở trên là thiết kế mục tiêu, không phải hành vi hiện tại. Khi build: reputation-gating là **business logic ở Application layer** (handler fold `reputation_events` rồi so ngưỡng), KHÔNG enforce ở HTTP guard.

---

## 3. 🔒 Tenant Isolation (BẤT BIẾN QUAN TRỌNG NHẤT)

> **RULE: Mọi truy vấn core-api BẮT BUỘC scope theo `orgId`. Không có ngoại lệ.**

- **Nguồn orgId:** header `X-Org-Id` → `TenantContextMiddleware` mở `AsyncLocalStorage` → `OrgGuard` xác thực membership + `setTenantId(orgId)`. Repository đọc `requireTenantId()` (fail-closed) để chèn `WHERE org_id = ?`. (KHÔNG lấy orgId từ token.)
- **Cross-org access** → HTTP 403 `FORBIDDEN_TENANT`.
- **Defense in depth:** cân nhắc Postgres Row-Level Security (RLS) như lớp bảo vệ thứ hai (Phase 8).
- **Test bắt buộc:** mỗi endpoint phải có test "user org A không thấy data org B" (xem `docs/08`).

### 3.1. AI Data Boundary (đặc thù RAG)
- `knowledge_chunks` (search-service, `search_db` — KHÔNG còn `embeddings` trong `core_db`, xem `docs/04` §2.4) mang `orgId`; **retrieval luôn lọc theo org** → ngữ cảnh RAG của org A **không bao giờ** chứa dữ liệu org B.
- Prompt gửi tới Claude (RAG summary) chỉ chứa nội dung thuộc đúng org của người hỏi — verify qua `RemoteOrgMembershipGuard` trước khi search-service chạm dữ liệu (search-service không có `Membership` local, xem §2.3).
- Không log nội dung nhạy cảm ra hệ thống dùng chung; redact PII trong log.

### 3.2. Danh tính tác giả qua biên service — CHƯA có projection, gọi trực tiếp `userId`

> **Đính chính:** thiết kế "read-model `user_profiles` trong `core_db`, đồng bộ qua `UserRegisteredEvent`/`UserProfileUpdatedEvent`" mô tả ở đây **chưa từng triển khai VÀ đã bị loại khỏi kế hoạch gần nhất** — model tương tự (`UserProfile` như projection trong `core_db`) bị gỡ khỏi schema trong đợt rollback read-model 2026-06-30 cùng lúc với `CreditBalanceSummary`/`ReputationSummary`/`FeedTimeline` (xem `docs/04` §2.7). `core_db` hiện **chỉ giữ `userId`** (loose ref, không FK) ở mọi bảng liên quan tác giả — chưa có cơ chế nào hiển thị tên/avatar mà không gọi chéo sang auth-service. (Lưu ý: `auth_db` CÓ bảng `user_profiles` — đó là **profile của chính user**, không phải bản sao phục vụ core-api — xem `docs/04` §2.1.) Nếu cần, đây là ứng viên cho read phase (Phase 3, chưa bắt đầu).

---

## 4. Rate Limiting & Quota (chống lạm dụng + noisy-neighbor)

| Đối tượng | Giới hạn | Cơ chế thật |
|-----------|----------|--------|
| Login/Register | 5 req / 5 phút / IP | auth-service (`@fastify/rate-limit`) |
| Refresh token | 10 req / phút / IP | auth-service (`@fastify/rate-limit`) |
| `POST /admin/orgs` (provision org) | 10 req / phút | `@nestjs/throttler` (`@Throttle`, in-memory) |
| `POST /credits/grant` | 30 req / phút | `@nestjs/throttler` |
| `POST /credits/spend` | 60 req / phút | `@nestjs/throttler` |
| `POST /search` | 20 req / phút / org | `@nestjs/throttler` + `OrgAwareThrottlerGuard` (key theo `orgId`, không phải global) |
| Credit | chặn khi balance < cost | Ledger check (`INSUFFICIENT_CREDITS`, 409) |

> **Đính chính:** "Token Bucket (Redis)" per-`aiRateLimitPerMin`/org và "Redis rate-limit ghi nội dung" của tài liệu cũ **chưa triển khai** — `aiRateLimitPerMin` không tồn tại trên `Organization` (xem `docs/04` §2.2), và toàn bộ rate-limit ở core-api hiện dùng `@nestjs/throttler` **in-memory** (không backing Redis), keyed theo route + org (`OrgAwareThrottlerGuard`) cho endpoint nhạy cảm. Redis đã khai báo trong compose nhưng chưa dùng cho rate-limit (xem `docs/09`).
- Quota **per tenant** (qua `OrgAwareThrottlerGuard`) đảm bảo org này không làm cạn throttle-budget của org khác trên cùng route.

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
