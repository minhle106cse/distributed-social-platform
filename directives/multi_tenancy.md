# SOP: Multi-Tenancy & Org RBAC Standard

> [!NOTE]
> This directive defines how multi-tenancy + in-org authorization is implemented in Cortex.
> **Tenant = Organization**. Every resource belongs to one Organization and is completely isolated.
> The detailed source of truth: `docs/10_security_rbac.md`.

---

## 🎯 Goal

Absolutely no data leaking between tenants. Every DB query/event/response is scoped by `orgId`.
In-org authorization is **dynamic** (the OWNER adjusts it at runtime), never hardcoded in a route.

---

## 📜 The Mandatory Architecture

### 1. The JWT access token — ONLY system identity (NO orgId)

```typescript
// core-api: infrastructure/http/guards/jwt-auth.guard.ts
export interface JwtPayload {
  sub: string          // userId
  email: string
  roles: string[]      // SYSTEM roles (superadmin/support/user) — NOT org roles
  permissions: string[] // SYSTEM permissions (platform-level)
}
```

> ⚠️ A user belongs to **several orgs** → do NOT put `orgId`/`orgRole` in the token. Org context is determined
> **per request** via the `X-Org-Id` header. A pure-identity token → no re-issue when switching orgs, and
> revoking a membership takes effect immediately.

### 2. Org context — the `X-Org-Id` header → TenantContextMiddleware + OrgGuard

**Step 2a — OrgGuard** (applied only to org-scoped routes): verifies membership, resolves the role + permissions, and attaches `request.org`.

```typescript
// infrastructure/http/guards/org.guard.ts (abridged)
// ⚠️ A guard is HTTP infrastructure → do NOT inject PrismaService; go through the repository interface.
const orgId = request.headers['x-org-id']
if (!orgId) throw new ForbiddenException('X-Org-Id header is required')
const membership = await this.membershipRepo.findByOrgAndUser(orgId, userId)
if (!membership) throw new ForbiddenException('You are not a member of this organization')
request.org = { orgId, orgRole: membership.role, permissions: await resolve(orgId, role) }
setTenantId(orgId) // put the (now authenticated) orgId into the ALS for repositories to use
```

**Step 2b — TenantContextMiddleware** (global, running first in the request): opens an **empty** AsyncLocalStorage context wrapping the ENTIRE request lifecycle. **Use a MIDDLEWARE, NOT an interceptor** — a middleware calls `next()` inside the `run()` scope, so the context propagates reliably to the guard/handler/repository; an interceptor returns an Observable subscribed OUTSIDE the scope → context is easily lost. The store is a mutable object; OrgGuard (2a) fills in the orgId via `setTenantId` after validating.

```typescript
// infrastructure/http/middlewares/tenant-context.middleware.ts
use(_req, _res, next) {
  runWithTenantContext(() => next()) // an empty {} store, wrapping the whole request
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
// FAIL-CLOSED for tenant-scoped repositories: missing context → THROW (preventing `orgId: undefined`
// reaching Prisma → the where clause dropping the filter → a cross-tenant leak).
export const requireTenantId = () => {
  const id = getTenantId()
  if (!id) throw new Error('Tenant context not set')
  return id
}
```

### 3. Repository — MUST filter by `orgId` (taken from `getTenantId()`)

```typescript
async findById(id: string): Promise<KnowledgeItem | null> {
  const orgId = requireTenantId() // fail-closed: never query without an orgId
  const db = getTx() ?? this.prisma.client
  // deletedAt:null is applied automatically by the soft-delete extension (see database_standard.md §3)
  const row = await db.knowledgeItem.findFirst({ where: { id, orgId } })
  return row ? KnowledgeItemMapper.toDomain(row) : null
}
```

### 4. Schema — `orgId` is mandatory + a compound `(orgId, ...)` index

```prisma
model KnowledgeItem {
  id      String @id @default(uuid())
  orgId   String @map("org_id")    // ← MANDATORY
  spaceId String @map("space_id")
  @@index([orgId, spaceId])
  @@map("knowledge_items")
}
```

> NO cross-domain FKs. `Membership.userId` is a loose reference into auth_db (no cross-DB FK).

---

## 🔐 Org RBAC — DYNAMIC authorization within an org

> Two independent RBAC layers: **System RBAC** (auth-service, "who you are on the platform") vs
> **Org RBAC** (core-api, "what you can do in THIS org"). Do NOT merge them.

### Catalog (code) vs Mapping (DB)

| Component | Source | File / Table |
|---|---|---|
| The permission catalog (which actions exist) | **Code** | `modules/tenant/domain/org-permissions.ts` (`OrgPermission`) |
| Role → permission mapping (per org) | **DB** | `org_role_permissions` |

### Declaring permissions on a route — by ACTION, not by role

```typescript
@Get('orgs/:id/members')
@UseGuards(OrgGuard)
@RequireOrgPermission(OrgPermission.ORG_MANAGE_MEMBERS)
async getMembers(@CurrentOrg() org: OrgContext) { ... }
```

- Changing "who can do what" = editing `org_role_permissions` via the `PATCH /orgs/:id/role-permissions/:role` API.
  **Do NOT edit the route code.**
- Seed the default mapping (ADMIN/MEMBER/GUEST) when the org is created (`CreateOrgHandler.seedDefaults`).

### Mandatory guardrails (lock-out prevention)

- **OWNER = implicit-all**: OrgGuard grants the OWNER the entire catalog, reading NO DB and allowing NO edits.
- Only ADMIN/MEMBER/GUEST are adjustable.
- A permission update must be ⊆ the catalog (`isValidOrgPermission`) → unknown permissions are rejected.

### Reputation gating ≠ RBAC

Points-unlocked privileges (Verify, wiki editing, …) are enforced in the **Application layer** (the handler compares `ReputationSummary.points` against a threshold), NOT in an HTTP guard.

---

## 🔁 Org-switch flow

The client only changes the `X-Org-Id` header on the next request. Do **NOT** re-issue the token, and do **NOT** put "multiple orgs in one token".

---

## ⚠️ Forbidden Patterns

| Wrong | Right |
|---|---|
| Reading `orgId` from the JWT payload | Read it from the `X-Org-Id` header → OrgGuard verifies membership |
| `db.knowledgeItem.findMany()` without an `orgId` | `where: { orgId: getTenantId(), ... }` |
| Passing `orgId` as a parameter through every method | `getTenantId()` from AsyncLocalStorage |
| Hardcoding `if (role === 'ADMIN')` in a route/handler | `@RequireOrgPermission(...)` + the DB mapping |
| Allowing the OWNER's permissions to be edited | OWNER is implicit-all; reject every update |
| Querying `userId` without `orgId` | `where: { userId, orgId }` (a user belongs to several orgs) |
| Putting `OrgGuard` / `TenantContextMiddleware` in `common/` | HTTP infrastructure → `infrastructure/http/{guards,middlewares}/` (see `folder_structure_sop.md` §Enforcement) |
| `OrgGuard` injecting `PrismaService` and querying directly | Go through `IMembershipRepository` — a guard must not bypass the repository |
| `org-permissions.ts` (a domain catalog) placed in `common/` | `modules/tenant/domain/` — it is the tenant domain's vocabulary, not a cross-cutting abstraction |

---

## 🔗 Related

- `directives/cqrs_pattern.md` — AsyncLocalStorage (transaction context)
- `directives/database_standard.md` — naming and index conventions
- `docs/10_security_rbac.md` — the two RBAC layers + dynamic Org RBAC (full detail)
