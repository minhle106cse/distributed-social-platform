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
- **Several permissions = AND, never OR.** `@RequireOrgPermission(A, B)` means the caller needs BOTH.
  The decorator is variadic in all three services (unified 2026-08-25 — search-service and
  notification-service used to accept only ONE permission while sharing core-api's name *and*
  metadata key, so a route needing two could not express it and silently enforced neither).

### How a guard MUST read route metadata (2026-08-25)

```typescript
// ✅ reads BOTH the method and the class; method wins
this.reflector.getAllAndOverride<OrgPermissionValue[]>(ORG_PERMISSION_KEY, [
  context.getHandler(),
  context.getClass(),
])

// ⛔ method only — a decorator placed on the CONTROLLER CLASS reads as
//    "not declared" and the route silently stops being permission-checked
this.reflector.get<OrgPermissionValue[]>(ORG_PERMISSION_KEY, context.getHandler())
```

Class-level is the natural place to put the decorator when every route in a controller needs the
same permission, so the trap is reachable by writing idiomatic Nest — and it fails **open**, with no
error, warning, or failing test. Both `remote-org-membership.guard.spec.ts` files (search-service
and notification-service, copied 2026-08-25 — the guards are logic-identical, only the doc comments
differ) assert the reflector was consulted with **both** targets, so reverting to `.get()` in either
service fails a test.

### Caching an authz lookup (2026-08-25)

Redis, never a per-process `Map`: N instances of a service otherwise means N cold caches, N times the
load on the source, N different staleness windows for the same user, and everything lost on deploy.

**Use `cachedLookup()` from shared-kernel — do NOT hand-roll the read/validate/write dance.** It
takes `{store, key, ttlMs, parse, fetch}` and enforces every rule below in one place. Both
`MembershipVerifier` and core-api's `SystemPermissionsClient` had each written their own copy first,
differing only in which shape they validated; two copies of a policy this subtle is how one of them
silently drifts into caching an error or trusting a malformed entry.

Non-negotiables, all of them learned the hard way rather than chosen for elegance:

- **shared-kernel gets the PORT, the service gets the CLIENT.** `check:arch` H bans `ioredis` from
  shared-kernel — the kernel owns algorithms, never live connections. So `ICacheStore` crosses the
  boundary and each service owns an adapter under `infrastructure/cache/`, the same way
  `OrgAwareThrottlerGuard` stays local while `CircuitBreaker` is shared.
- **The adapter MUST NOT throw.** Redis unreachable ⇒ cache MISS ⇒ re-query the source. A cache sits in
  FRONT of an authoritative source, so on an authz path a broken cache must never become a 500.
- **Key by what INVALIDATES it, not by who reads it.** The permission set of a role is cached as
  `org-permissions:{orgId}:{role}` — one entry shared by every member holding that role — because one
  `PATCH /orgs/:id/role-permissions/:role` changes the answer for all of them at once. Keyed per user
  it would take one DELETE per affected member: O(members), non-atomic, and able to fail halfway
  leaving some members stale with no signal. Membership itself stays keyed per user
  (`membership:{orgId} {userId}`) because that is what a membership write actually changes. This
  mirrors the database, where the two facts are already two tables.
- **Invalidate in `afterCommit`, never inside `execute`.** Deleting before the commit lands opens the
  classic cache-aside race: a concurrent reader misses, reads the still-uncommitted OLD row, and
  re-populates the cache — then the commit lands and the stale value survives a full TTL. `CommandBus`
  swallows anything `afterCommit` throws, which is correct here: the database work already committed,
  so a failed invalidation must degrade to the TTL rather than fail the request. TTL is the floor,
  invalidation only shortens it — that is why the TTL must stay short enough to be acceptable alone.
- **Never cache a failed lookup.** Absorbing a failing dependency is the circuit breaker's job; caching
  the failure turns one blip into a full TTL of denials. A negative *answer* (`isMember: false`) IS
  cacheable — that is a completed lookup, not a failure.
- **Treat a cached entry as untrusted input.** It is whatever is in Redis, not necessarily what you
  wrote. Validate its shape; malformed ⇒ miss, never trust and never crash.
- **Allocate the key in `CacheKeys` (shared-kernel), never build it locally.** Redis is ONE keyspace
  for the whole platform, so a prefix picked inside whichever class happens to need a cache is a
  namespace allocated blind — two features can choose the same one and the only symptom is one
  silently reading the other's value. `cache-keys.spec.ts` asserts the namespaces are distinct, that
  none prefixes another, and that a crafted `orgId` cannot shift the separator to forge a collision.
  Not every cache belongs there: rate-limit counters are per-process memory and HTTP idempotency is
  Postgres — both deliberately outside Redis, and both must be added to `CacheKeys` FIRST if that
  ever changes.

### Consuming the verified org — never re-read the header

The guard publishes `request.org` (`OrgContext`); handlers take `@CurrentOrg()`. Re-reading
`@Headers('x-org-id')` in the handler re-derives a value the guard already validated, so the checked
value and the used value are linked by coincidence rather than by data flow. search-service and
notification-service did exactly that until 2026-08-25; both now mirror core-api. Their `OrgContext`
has **no `orgRole`** — the gRPC contract returns membership + resolved permissions, not the role name,
and an absent field beats one invented at the boundary.

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
| `reflector.get(KEY, context.getHandler())` in a guard | `getAllAndOverride(KEY, [getHandler(), getClass()])` — `.get()` ignores a class-level decorator and fails OPEN |
| A handler taking `@Headers('x-org-id')` | `@CurrentOrg()` — use the value the guard verified, not a second read of the raw header |
| A permission guard returning `true` when the route declares nothing | Decide per tier: org tier may fall back to membership-only (it still proved membership); the **system tier must throw** — it has no floor (see `docs/10_security_rbac.md` §2.1) |

---

## 🔗 Related

- `directives/cqrs_pattern.md` — AsyncLocalStorage (transaction context)
- `directives/database_standard.md` — naming and index conventions
- `docs/10_security_rbac.md` — the two RBAC layers + dynamic Org RBAC (full detail)
