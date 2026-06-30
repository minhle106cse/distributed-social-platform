# SOP: Multi-Tenancy & Org RBAC Standard

> [!NOTE]
> Directive này quy định cách triển khai multi-tenancy + phân quyền trong org cho Cortex.
> **Tenant = Organization**. Mọi resource thuộc về một Organization và bị cô lập hoàn toàn.
> Nguồn sự thật chi tiết: `docs/10_security_rbac.md`.

---

## 🎯 Goal

Tuyệt đối không data leak giữa tenant. Mọi DB query/event/response scoped bởi `orgId`.
Phân quyền trong org là **động** (OWNER chỉnh runtime), không hardcode trong route.

---

## 📜 Kiến Trúc Bắt Buộc

### 1. JWT Access Token — CHỈ chứa identity hệ thống (KHÔNG có orgId)

```typescript
// core-api: infrastructure/http/guards/jwt-auth.guard.ts
export interface JwtPayload {
  sub: string          // userId
  email: string
  roles: string[]      // SYSTEM roles (superadmin/support/user) — KHÔNG phải org role
  permissions: string[] // SYSTEM permissions (platform-level)
}
```

> ⚠️ Một user thuộc **nhiều org** → KHÔNG nhét `orgId`/`orgRole` vào token. Org context xác định
> **per-request** qua header `X-Org-Id`. Token thuần identity → không phải re-issue khi đổi org,
> revoke membership có hiệu lực tức thì.

### 2. Org context — header `X-Org-Id` → TenantContextMiddleware + OrgGuard

**Bước 2a — OrgGuard** (chỉ áp cho route org-scoped): verify membership, resolve role + permissions, gắn `request.org`.

```typescript
// infrastructure/http/guards/org.guard.ts (rút gọn)
// ⚠️ Guard là HTTP infra → KHÔNG inject PrismaService, đi qua repository interface.
const orgId = request.headers['x-org-id']
if (!orgId) throw new ForbiddenException('X-Org-Id header is required')
const membership = await this.membershipRepo.findByOrgAndUser(orgId, userId)
if (!membership) throw new ForbiddenException('You are not a member of this organization')
request.org = { orgId, orgRole: membership.role, permissions: await resolve(orgId, role) }
setTenantId(orgId) // điền orgId (đã xác thực) vào ALS cho repo dùng
```

**Bước 2b — TenantContextMiddleware** (global, chạy đầu request): mở AsyncLocalStorage context **rỗng** bọc TRỌN vòng đời request. **Dùng MIDDLEWARE, KHÔNG interceptor** — middleware gọi `next()` ngay trong scope `run()` nên context propagate đáng tin tới guard/handler/repo; interceptor trả Observable bị subscribe NGOÀI scope → dễ mất context. Store là object mutable; OrgGuard (2a) điền orgId qua `setTenantId` sau khi validate.

```typescript
// infrastructure/http/middlewares/tenant-context.middleware.ts
use(_req, _res, next) {
  runWithTenantContext(() => next()) // store rỗng {}, bọc cả request
}
```

```typescript
// common/tenant/tenant.context.ts
const tenantStorage = new AsyncLocalStorage<{ orgId?: string }>()
export const runWithTenantContext = <R>(fn: () => R): R => tenantStorage.run({}, fn)
export const setTenantId = (orgId: string) => {
  const s = tenantStorage.getStore()
  if (s) s.orgId = orgId
}
export const getTenantId = () => tenantStorage.getStore()?.orgId
// FAIL-CLOSED cho repo tenant-scoped: thiếu context → NÉM (chống `orgId: undefined`
// lọt xuống Prisma → where bỏ filter → rò chéo tenant).
export const requireTenantId = () => {
  const id = getTenantId()
  if (!id) throw new Error('Tenant context not set')
  return id
}
```

### 3. Repository — Bắt buộc filter bởi `orgId` (lấy từ `getTenantId()`)

```typescript
async findById(id: string): Promise<KnowledgeItem | null> {
  const orgId = requireTenantId() // fail-closed: không bao giờ query thiếu orgId
  const db = getTx() ?? this.prisma.client
  // deletedAt:null tự động bởi soft-delete extension (xem database_standard.md §3)
  const row = await db.knowledgeItem.findFirst({ where: { id, orgId } })
  return row ? KnowledgeItemMapper.toDomain(row) : null
}
```

### 4. Schema — `orgId` bắt buộc + index compound `(orgId, ...)`

```prisma
model KnowledgeItem {
  id      String @id @default(uuid())
  orgId   String @map("org_id")    // ← BẮT BUỘC
  spaceId String @map("space_id")
  @@index([orgId, spaceId])
  @@map("knowledge_items")
}
```

> KHÔNG FK chéo domain. `Membership.userId` là loose ref tới auth_db (no cross-db FK).

---

## 🔐 Org RBAC — Phân quyền ĐỘNG trong org

> Hai tầng RBAC độc lập: **System RBAC** (auth-service, "bạn là ai trên platform") vs
> **Org RBAC** (core-api, "bạn làm được gì trong org NÀY"). KHÔNG merge.

### Catalog (code) vs Mapping (DB)

| Thành phần | Nguồn | File / Bảng |
|---|---|---|
| Permission catalog (action tồn tại) | **Code** | `modules/tenant/domain/org-permissions.ts` (`OrgPermission`) |
| Role → permission mapping (per-org) | **DB** | `org_role_permissions` |

### Khai báo quyền trên route — theo ACTION, không theo role

```typescript
@Get('orgs/:id/members')
@UseGuards(OrgGuard)
@RequireOrgPermission(OrgPermission.ORG_MANAGE_MEMBERS)
async getMembers(@CurrentOrg() org: OrgContext) { ... }
```

- Đổi "ai được làm gì" = sửa `org_role_permissions` qua API `PATCH /orgs/:id/role-permissions/:role`.
  **KHÔNG sửa code route.**
- Seed default mapping (ADMIN/MEMBER/GUEST) khi tạo org (`CreateOrgHandler.seedDefaults`).

### Guardrail bắt buộc (chống lock-out)

- **OWNER = implicit-all**: OrgGuard cấp toàn bộ catalog cho OWNER, KHÔNG đọc DB, KHÔNG cho sửa.
- Chỉ ADMIN/MEMBER/GUEST chỉnh được.
- Permission update phải ⊆ catalog (`isValidOrgPermission`) → reject quyền lạ.

### Reputation-gating ≠ RBAC

Quyền mở-khóa-theo-điểm (Verify, edit wiki...) enforce ở **Application layer** (handler so `ReputationSummary.points` với ngưỡng), KHÔNG ở HTTP guard.

---

## 🔁 Org-Switch Flow

Client chỉ cần đổi header `X-Org-Id` ở request kế tiếp. **KHÔNG** re-issue token, **KHÔNG** "multiple orgs in one token".

---

## ⚠️ Forbidden Patterns

| Sai | Đúng |
|---|---|
| Đọc `orgId` từ JWT payload | Đọc từ header `X-Org-Id` → OrgGuard verify membership |
| `db.knowledgeItem.findMany()` không có `orgId` | `where: { orgId: getTenantId(), ... }` |
| Truyền `orgId` qua param từng method | `getTenantId()` từ AsyncLocalStorage |
| Hardcode `if (role === 'ADMIN')` trong route/handler | `@RequireOrgPermission(...)` + mapping DB |
| Cho sửa permission của OWNER | OWNER implicit-all, reject mọi update |
| Query `userId` không kèm `orgId` | `where: { userId, orgId }` (user thuộc nhiều org) |
| Đặt `OrgGuard` / `TenantContextMiddleware` trong `common/` | HTTP infra → `infrastructure/http/{guards,middlewares}/` (xem `folder_structure_sop.md` §Enforcement) |
| `OrgGuard` inject `PrismaService` query thẳng | Đi qua `IMembershipRepository` — guard không được bypass repository |
| `org-permissions.ts` (catalog domain) đặt trong `common/` | `modules/tenant/domain/` — vocabulary của tenant domain, không phải abstraction cross-cutting |

---

## 🔗 Liên quan

- `directives/cqrs_pattern.md` — AsyncLocalStorage (transaction context)
- `directives/database_standard.md` — Naming, index conventions
- `docs/10_security_rbac.md` — RBAC hai tầng + Org RBAC động (chi tiết đầy đủ)
