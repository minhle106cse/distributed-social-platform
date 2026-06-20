# SOP: Multi-Tenancy Standard

> [!NOTE]
> Directive này quy định cách triển khai multi-tenancy trong toàn bộ hệ thống Cortex.
> **Tenant = Organization**. Mọi resource đều thuộc về một Organization và bị cô lập hoàn toàn.

---

## 🎯 Goal

Đảm bảo tuyệt đối không có data leak giữa các tenant. Mọi DB query, event, và API response đều phải được scoped bởi `orgId`.

---

## 📜 Kiến Trúc Bắt Buộc

### 1. JWT Access Token — Phải chứa `orgId`

```typescript
// Token payload chuẩn (auth-service)
export interface JwtPayload {
  sub: string       // userId
  orgId: string     // tenant scope — BẮT BUỘC
  role: string      // role trong org
  spaceIds: string[] // spaces user có access
  iat: number
  exp: number
}
```

> Không có `orgId` trong token → Từ chối issue token. Auth guard phải validate `orgId` present.

---

### 2. Tenant Context Propagation — AsyncLocalStorage

Tương tự Transaction Context, `orgId` được propagate qua call stack mà không cần truyền thủ công vào từng function.

```typescript
// packages/shared-kernel/src/tenant/tenant.context.ts (hoặc service-level)
import { AsyncLocalStorage } from 'async_hooks'

const tenantContext = new AsyncLocalStorage<{ orgId: string }>()

export function getTenantId(): string {
  const store = tenantContext.getStore()
  if (!store) throw new InfrastructureError('Tenant context not initialized')
  return store.orgId
}

export function runWithTenant<R>(orgId: string, fn: () => Promise<R>): Promise<R> {
  return tenantContext.run({ orgId }, fn)
}
```

**Điểm inject (auth-service — Fastify hook):**
```typescript
// infrastructure/http/hooks/tenant.hook.ts
export async function tenantHook(req: FastifyRequest) {
  const orgId = req.user?.orgId  // đã được JwtAuthGuard decode
  if (!orgId) throw new UnauthorizedError('Missing tenant context')
  // Lưu vào AsyncLocalStorage để repositories dùng
  req.tenantId = orgId  // cũng attach vào request cho logging
}
```

**Điểm inject (core-api — NestJS Guard/Interceptor):**
```typescript
// infrastructure/http/interceptors/tenant.interceptor.ts
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const orgId = req.user?.orgId
    if (!orgId) throw new UnauthorizedException('Missing tenant context')
    return new Observable(observer => {
      runWithTenant(orgId, () => lastValueFrom(next.handle()))
        .then(val => { observer.next(val); observer.complete() })
        .catch(err => observer.error(err))
    })
  }
}
```

---

### 3. Repository — Bắt Buộc Filter bởi `orgId`

**KHÔNG BAO GIỜ** query toàn bộ table mà không có `orgId` filter (trừ system-level queries của admin service).

```typescript
// modules/knowledge/infrastructure/repositories/prisma-knowledge.repository.ts
export class PrismaKnowledgeRepository implements KnowledgeRepository {
  async findById(id: string): Promise<KnowledgeItem | null> {
    const orgId = getTenantId()  // lấy từ AsyncLocalStorage
    const db = (getTx() ?? this.prisma) as PrismaClient

    const row = await db.knowledgeItem.findFirst({
      where: {
        id,
        orgId,        // ← BẮT BUỘC — tenant isolation
        deletedAt: null,
      },
    })
    return row ? KnowledgeItemMapper.toDomain(row) : null
  }

  async findAll(spaceId: string): Promise<KnowledgeItem[]> {
    const orgId = getTenantId()
    const rows = await (getTx() ?? this.prisma as PrismaClient).knowledgeItem.findMany({
      where: { orgId, spaceId, deletedAt: null },
    })
    return rows.map(KnowledgeItemMapper.toDomain)
  }
}
```

---

### 4. Database Schema — `orgId` là cột bắt buộc

Mọi domain model (không phải lookup table hay system table) phải có `orgId`:

```prisma
model KnowledgeItem {
  id        String    @id @default(uuid())
  orgId     String    @map("org_id")         // ← BẮT BUỘC
  spaceId   String    @map("space_id")
  title     String
  content   String
  createdAt DateTime  @default(now()) @map("created_at")
  deletedAt DateTime? @map("deleted_at")

  organization Organization @relation(fields: [orgId], references: [id])

  @@index([orgId, spaceId])                  // ← index compound bắt buộc
  @@index([orgId, deletedAt])
  @@map("knowledge_items")
}
```

> Index `(orgId, ...)` phải luôn được tạo — mọi query đều filter bằng orgId trước.

---

### 5. Org-Switch Flow

Khi user chuyển sang org khác:
1. Client gọi `POST /auth/org-switch` với `{ targetOrgId }`.
2. auth-service validate user có Membership trong `targetOrgId`.
3. Issue **access token mới** với `orgId = targetOrgId`.
4. Client thay thế token cũ.

> Không dùng cơ chế "multiple orgs in one token" — phức tạp và nguy hiểm.

---

## ⚠️ Forbidden Patterns

| Sai | Đúng |
|---|---|
| `db.knowledgeItem.findMany()` không có `where: { orgId }` | Luôn `where: { orgId: getTenantId(), ... }` |
| Truyền `orgId` qua parameter vào từng repository method | Dùng `getTenantId()` từ AsyncLocalStorage |
| Lưu `orgId` vào JWT nhưng không validate ở guard | Guard phải throw nếu `orgId` missing/invalid |
| Query bằng `userId` không kết hợp `orgId` | `where: { userId, orgId }` — user có thể thuộc nhiều org |

---

## 🔗 Liên quan

- `directives/cqrs_pattern.md` — AsyncLocalStorage pattern (transaction context)
- `directives/database_standard.md` — Naming, index conventions
- `docs/10_security_rbac.md` — RBAC trong context multi-tenancy
