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
│   → Gán role 1 lần, TOÀN CỤC. Có trong JWT, NHƯNG core-api không tin claim đó:
│     nó resolve lại từ auth_db mỗi request (gRPC + cache Redis 30s) — xem §2.1.
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
- **Enforce:** auth-service routes dùng `fastify.requirePermissions([...])` (đọc claim trong token nó tự ký); core-api dùng `SystemPermissionGuard` + `@RequireSystemPermission(...)` — **resolve từ auth_db qua gRPC + cache Redis**, KHÔNG đọc claim (đổi 2026-08-25, xem gạch đầu dòng bên dưới).
- **Đặc tính:** ít thay đổi, gắn với vận hành platform, không biết gì về domain org.
- **Tầng system resolve TỪ DB, KHÔNG đọc claim trong token nữa (đổi 2026-08-25).**
  `SystemPermissionGuard` gọi gRPC `SystemRbac.ResolveSystemPermissions` (proto/system-rbac.proto) sang
  auth-service — nơi duy nhất sở hữu System RBAC — rồi cache Redis 30s. Trước đó guard đọc thẳng claim
  `permissions` trong JWT, tức **ảnh chụp tại thời điểm login**: thu hồi `SUPER_ADMIN` vẫn để token cũ
  full quyền hết 15 phút còn lại, và cách duy nhất để rút ngắn là rút ngắn TTL của *mọi* token. Org RBAC
  chưa bao giờ dính vì `OrgGuard` vốn resolve theo request — đây là đóng nốt bất đối xứng đó, đúng gốc rễ
  đã ghi trong `.ai/memory/gotchas.jsonl`. auth-service **vẫn** đặt `permissions` vào token cho
  `requirePermissions` của chính nó; chỉ core-api thôi không tin nữa.
  - Đánh đổi: route admin của core-api giờ phụ thuộc auth-service. **Fail CLOSED → 503** (giống
    `RemoteOrgMembershipGuard`), vì authz mà degrade thành "cho qua" khi nguồn chết thì tệ hơn không check.
  - Luật resolve (SUPER_ADMIN implicit-all) nằm ở **một** hàm `resolveSystemPermissions()` (auth-service
    `common/rbac/`), dùng chung bởi cả đường mint JWT (`UserMapper`) lẫn đường gRPC — hai đường lệch nhau
    chính là lỗi đã từng xảy ra.
  - Repo query loại luôn user/role đã `isActive=false` hoặc soft-delete, lọc **ở tầng DB** chứ không phải
    trong JS, để điều kiện không âm thầm mất tác dụng khi đổi cột `select`.
- **`SystemPermissionGuard` FAIL-CLOSED (siết 2026-08-25).** Route nào guard này bảo vệ mà **không** khai
  `@RequireSystemPermission` sẽ bị **từ chối 403**, kể cả với `SUPER_ADMIN` — không còn cho qua như trước.
  Lý do: tầng này **không có sàn** để rơi xuống. `OrgGuard` chứng minh membership trong DB *trước khi* nhìn tới
  decorator, nên quên decorator ở tầng org tệ nhất là "member bất kỳ"; quên ở tầng system trước đây là
  **"user đăng nhập bất kỳ"** — tức một member org thường chạm được endpoint platform-admin. Guard cũng đã
  chuyển lên **class level** ở `PlatformAdminController` (`@UseGuards(JwtAuthGuard, SystemPermissionGuard)`),
  nên route mới chỉ còn phải khai *quyền nào*, không thể quên *có gác hay không*. Đánh đổi có chủ đích:
  route hỏng ồn ào (403 cho tất cả) tốt hơn route mở âm thầm.
- **`@RequireSystemPermission(...permissions)` variadic, cùng hình dạng với `@RequireOrgPermission`
  (đồng bộ 2026-08-25).** Nhiều permission = AND, giống hệt tầng org. Chưa route admin nào cần AND
  thật, nhưng trước đó decorator này chỉ nhận 1 tham số **do tình cờ chứ không phải quyết định** —
  hai decorator lệch hình dạng cho cùng một khái niệm ("cần permission gì để qua guard") là nguồn
  nhầm lẫn, và là đúng kiểu lỗi đã xảy ra ở search/notification-service (xem gạch đầu dòng org bên
  dưới). `@RequireSystemPermission()` không tham số = coi như không khai báo → vẫn 403 fail-closed.
- **Đọc metadata bằng `getAllAndOverride([getHandler(), getClass()])`**, không phải `reflector.get(…, getHandler())`
  — bản cũ bỏ qua decorator đặt ở class level một cách im lặng (fail-open, không lỗi, không cảnh báo).
  Xem `directives/multi_tenancy.md` § *How a guard MUST read route metadata*.
- **Verify access token dùng chung `verifyAccessToken`** (`packages/shared-kernel/src/auth/access-token-verifier.ts`).
  Trước 2026-08-25 phần verify bị copy **byte-identical** ở cả 3 service (core-api, search-service,
  notification-service); mỗi service nay chỉ giữ vỏ `JwtAuthGuard` (đọc config + map lỗi sang HTTP).
  Hàm dùng chung ghim `algorithms: ['RS256']` (chặn algorithm-confusion: ký lại bằng HS256 với chính
  public key làm HMAC secret) và **chuẩn hoá claim** (`roles`/`permissions` thiếu → `[]`, phần tử không phải
  string bị loại) thay cho blind-cast payload như trước.

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
| `credit:spend` | Trừ credit của chính mình (`POST /credits/spend`, và **`POST /ai/ask`** — xem dưới) |
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

> **Route đầu tiên cần NHIỀU permission cùng lúc (Phase 5b):** `POST /api/v1/ai/ask` khai báo
> `@RequireOrgPermission(KNOWLEDGE_READ, CREDIT_SPEND)` — vì nó làm hai việc: đọc knowledge của org
> *và* tiêu credit của caller. `RequireOrgPermission` giờ nhận nhiều permission và `OrgGuard` kiểm
> **AND** (phải có đủ), không phải OR. Một role được đọc nhưng không được tiêu tiền phải bị chặn ở
> cửa này, đúng như nó bị chặn ở `POST /credits/spend`.
>
> **Ngoại lệ có chủ ý — gRPC `RagQuery` (search-service) KHÔNG check membership.** Đây không phải
> lỗi IDOR tái diễn: lỗi 2026-07-19 là một endpoint **HTTP public** tin `X-Org-Id` do client gửi.
> Ở đây caller là core-api, đã chạy JwtAuthGuard + OrgGuard + permission trước khi saga bắt đầu, và
> `x-internal-secret` là trust boundary. Bắt search-service verify lại còn tạo vòng gọi ngược về
> core-api trong lúc core-api đang chờ chính call này.

### 2.3. Luồng enforce (per-request)

```
Request + Cookie(accessToken) + Header(X-Org-Id: orgId)
  │
  ├─ JwtAuthGuard      verify RS256 → request.user = { sub, email, roles, permissions }
  │
  ├─ OrgGuard (core-api — có Membership local)         RemoteOrgMembershipGuard (search-service,
  │   1. orgId = header['x-org-id']  (thiếu → 403)      notification-service — KHÔNG có Membership local)
  │   2. membership = find(orgId, user.sub)               1. gRPC sang core-api (MembershipVerifier)
  │      (không phải member → 403)                           verify orgId + resolve permissions
  │   3. orgRole = membership.role                        2. Fail CLOSED: core-api unreachable/breaker OPEN
  │   4. permissions = resolveOrgPermissions(orgId, orgRole)  → 503, KHÔNG âm thầm cho qua (chống IDOR —
  │      ├─ OWNER → toàn bộ catalog (implicit)               trước đây X-Org-Id bị trust verbatim, đã vá)
  │      └─ khác  → query org_role_permissions (DB          3. request.org = { orgId, permissions }
  │        trực tiếp, KHÔNG có cache — mục "cache Redis         (KHÔNG có orgRole: contract gRPC trả
  │        5 phút" của tài liệu cũ là thiết kế Phase 3,          membership + permissions, không trả tên role)
  │        CHƯA triển khai)
  │   5. request.org = { orgId, orgRole, permissions }
  │   6. nếu route có @RequireOrgPermission(p1, p2…) → cần ĐỦ CẢ (AND), thiếu bất kỳ → 403 (cả 2 guard)
  │
  └─ TenantContextMiddleware mở ALS (đầu request); OrgGuard setTenantId(orgId) → getTenantId() khả dụng cho repo
```

- Decorator khai báo trên route theo **action**, không theo role:
  `@RequireOrgPermission(OrgPermission.ORG_MANAGE_MEMBERS)`. Khai nhiều permission = **AND** (cần đủ cả),
  variadic ở **cả 3 service** (thống nhất 2026-08-25 — trước đó search/notification chỉ nhận MỘT permission
  dù trùng tên và trùng metadata key với core-api).
- Handler nhận org đã verify qua `@CurrentOrg()`, **không** đọc lại `@Headers('x-org-id')` — giá trị đã kiểm
  và giá trị đem dùng phải nối bằng data flow, không phải trùng nhau do tình cờ.
- Đổi "ai được làm gì" = đổi dữ liệu trong `org_role_permissions`, **không đụng code route**.
- **Cache membership 30s trên REDIS (thêm 2026-08-25, `MembershipVerifier` trong shared-kernel).** Trước đó
  mỗi request org-scoped ở search/notification tốn 1 round-trip gRPC sang core-api → core-api là hard
  dependency của **mọi** lượt đọc. Dùng Redis chứ không phải Map trong process: N instance mà cache in-process
  thì thành N cache lạnh, N lần tải gRPC, N cửa sổ stale khác nhau cho cùng một user, và mất sạch mỗi lần
  deploy. **Không bao giờ cache lượt gọi lỗi** (đó là việc của circuit breaker); kết quả "không phải member"
  thì CÓ cache vì đó là một lượt tra cứu hoàn tất. Đánh đổi: thu hồi membership/permission trễ tối đa 30s —
  vẫn thấp hơn nhiều so với TTL 15 phút của access token vốn đã chấp nhận, và **không có kênh invalidate**
  nên đừng nâng lên hàng phút.
  - Redis client **không** nằm trong shared-kernel: `check:arch` H cấm `ioredis` ở đó (kernel giữ thuật toán,
    không giữ kết nối sống). shared-kernel chỉ khai port `ICacheStore`; adapter Redis nằm ở
    `infrastructure/cache/` của từng service — cùng lý do `OrgAwareThrottlerGuard` ở lại từng service.
  - Adapter **không bao giờ ném**: Redis chết = cache MISS, đi hỏi lại nguồn. Cache đứng TRƯỚC nguồn đáng tin,
    nên cache hỏng không được phép biến thành 500 trên đường authz. Entry đọc lên được coi là **input không
    đáng tin** (có thể do thứ khác ghi vào cùng Redis) — sai định dạng thì đọc thành miss, không tin và không
    crash. Key có namespace (`membership:` / `system-permissions:`) đúng vì store dùng chung.

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
| `POST /ai/ask` | Token bucket per `(org, user)` — cap `AI_QUOTA_CAP`, refill `AI_QUOTA_REFILL_PER_MIN` | `AiQuotaGuard` — **Postgres** (`ai_quota_buckets`), refill+consume atomic trong 1 `UPDATE … RETURNING`. `@Throttle` 20/phút vẫn còn nhưng chỉ là backstop |
| Credit | chặn khi `available` < cost | Ledger check (`INSUFFICIENT_CREDITS`, **402**) |

> **Cập nhật 2026-08-22 (Phase 5b):** token bucket cho AI query **đã triển khai**, nhưng ở **Postgres
> chứ không Redis** — Redis vẫn zero dòng code, thêm nó cho một bộ đếm là thêm client + config +
> health check + shutdown path. Đây cũng là chỗ duy nhất trong repo có rate-limit **thật sự
> multi-instance**: `@nestjs/throttler` là fixed-window in-memory từng instance, nên N instance nhân
> giới hạn thật lên N lần — không thay thế được. Lý do phải có nó dù query đã tốn credit: **giá là
> ngân sách, không phải tốc độ** — user còn 500 credit vẫn bắn được 200 query trong 10 giây và kéo
> sập chi phí/latency của Claude+Ollama.
>
> `aiRateLimitPerMin` trên `Organization` vẫn **không tồn tại** (xem `docs/04` §2.2) — hạn mức đọc từ
> env, chưa per-org configurable.
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
| Route mới quên khai quyền | Guard fail-closed (system tier) + guard ở class level + `getAllAndOverride` |
| Algorithm confusion trên access token | `verifyAccessToken` ghim `algorithms:['RS256']`, có test forge HS256 bằng public key |
| Lộ `INTERNAL_GRPC_SHARED_SECRET` | ⚠️ **CHƯA phòng thủ đủ — xem rủi ro mở bên dưới** |
```

### 6.1. Rủi ro còn mở: internal gRPC chạy `createInsecure()` (ghi nhận 2026-08-25, CHƯA xử lý)

Toàn bộ trust của kênh service-to-service dồn vào **một shared secret tĩnh** truyền **plaintext**
(`grpc.credentials.createInsecure()` trong `MembershipVerifier` và các gRPC client khác). So sánh không bị
timing attack (`verifyInternalGrpcSecret` dùng `timingSafeEqual` trên sha256), nhưng đó là bảo vệ *phép so
sánh*, không bảo vệ *đường truyền*.

Blast radius lớn bất thường vì `RagQuery` (`proto/ai-query.proto`) **cố ý không kiểm tra membership** — nó tin
hoàn toàn vào caller. Lộ secret = đọc được knowledge base của **mọi org**, không cần JWT, không cần là member.

**Chưa làm** vì đây là việc hạ tầng (CA + cert từng service + mount vào compose + cơ chế rotate) không thể
verify nếu không dựng cả stack, và một "seam TLS" cắm sẵn nhưng không bao giờ chạy chính là loại trừu tượng
đầu cơ mà repo này vẫn xoá đi (tiền lệ: `CommandOptions.safety`). Hướng xử lý khi làm: mTLS giữa các service,
tối thiểu là secret rotation + network policy giới hạn ai chạm được cổng gRPC.
