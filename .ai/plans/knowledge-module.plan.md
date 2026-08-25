# PLAN — Knowledge Module (core-api) · Phase 1 NEXT

> ⚠️ **BẢN GHI LỊCH SỬ, ĐÃ THỰC THI — đừng chép cấu trúc lỗi thời làm template.** Plan này đặt error
> class ở `common/errors/knowledge.error.ts`; kể từ ADR-0002 (2026-08-24), `common/errors/` **không
> còn tồn tại** — mỗi module có đúng một file `modules/<module>/domain/<module>.error.ts`. Xem
> `directives/naming_conventions.md` §6 và `docs/adr/0002-placement-rule-and-outbox-as-capability.md`
> cho luật hiện hành trước khi dùng file này làm mẫu.

> **Đối tượng thực thi:** session mới (Sonnet). Plan này TỰ ĐỦ — không cần đọc lại nhiều source.
> Khi cần mẫu, chỉ mở **đúng 1 file template** được chỉ ra (đừng đọc cả repo).
> Ngôn ngữ code/comment: theo repo (comment tiếng Việt ngắn gọn cho phần "vì sao").

---

## 0. ĐỌC TRƯỚC (bắt buộc, ~5 phút) — rồi không cần đọc gì thêm

1. `.ai/KNOWLEDGE_INDEX.md` §4 (Critical Rules) + §5 (gotchas).
2. `directives/folder_structure_sop.md` §Enforcement (lint biên tầng — VI PHẠM = lint fail).
3. `directives/domain_modeling.md` §0, §1, §2 (entity style + factory + validate-write/trust-read).
4. `directives/multi_tenancy.md` §2–3 (tenant context + isolation).
5. `directives/zod_validation.md` §4 (validate input CHỈ ở Zod).
6. `directives/database_standard.md` §3 (soft-delete auto-filter).

**Template files để COPY pattern (mở khi code, mỗi layer 1 file):**
- Command stack: `apps/core-api/src/modules/tenant/application/commands/create-space/` (command + handler) và `create-org/` (handler trả `string`, transactional).
- Query stack: `apps/core-api/src/modules/tenant/application/queries/get-org-members/` (query + handler + `*.query-repository.ts` interface + `*.dto.ts`).
- Repo: `apps/core-api/src/modules/tenant/infrastructure/repositories/prisma-space.repository.ts` (getTx + requireTenantId).
- Mapper: `apps/core-api/src/modules/tenant/infrastructure/mappers/space.mapper.ts`.
- Controller: `apps/core-api/src/modules/tenant/presentation/controllers/org.controller.ts`.
- Module wiring: `apps/core-api/src/modules/tenant/tenant.module.ts`.
- Errors: `apps/core-api/src/common/errors/tenant.error.ts`.

---

## 1. PHẠM VI

Module `knowledge` = **CRUD KnowledgeItem + OCC versioning + Revision history**, multi-tenant.
Schema **đã có sẵn** trong `apps/core-api/prisma/schema.prisma`: `KnowledgeItem`, `Revision`, enum `KnowledgeType` (DOCUMENT/QUESTION/ANSWER/RUNBOOK/ADR), `KnowledgeStatus` (DRAFT/PUBLISHED/ARCHIVED/STALE). **KHÔNG sửa schema** (trừ T0 không liên quan schema).

**OUT OF SCOPE (đừng đụng):** Tag/taxonomy (module khác), Vote/engagement, Embedding/RAG, contentHash (để `null`, Phase 4 mới dùng).

**Endpoints (8):**
| # | Method + Path | Permission | Ghi chú |
|---|---|---|---|
| E1 | `POST /knowledge` | `KNOWLEDGE_WRITE` | tạo (status=DRAFT, version=1) → trả `{id}` |
| E2 | `GET /knowledge/:id` | `KNOWLEDGE_READ` | 1 item (scope org) |
| E3 | `GET /knowledge?spaceId=&type=&status=&limit=&offset=` | `KNOWLEDGE_READ` | list (query side, paginated) |
| E4 | `PATCH /knowledge/:id` | `KNOWLEDGE_WRITE` | **OCC update** (body có `expectedVersion`) + tạo Revision |
| E5 | `POST /knowledge/:id/publish` | `KNOWLEDGE_WRITE` | DRAFT→PUBLISHED |
| E6 | `POST /knowledge/:id/verify` | `KNOWLEDGE_VERIFY` | set isVerified=true |
| E7 | `DELETE /knowledge/:id` | `KNOWLEDGE_WRITE` | **soft-delete** (set deletedAt) |
| E8 | `GET /knowledge/:id/revisions` | `KNOWLEDGE_READ` | list revisions của item |

> Permission đã có sẵn trong `modules/tenant/domain/org-permissions.ts` → chỉ DÙNG qua `@RequireOrgPermission(OrgPermission.KNOWLEDGE_*)`. KHÔNG thêm permission mới.

---

## 2. LUẬT BẮT BUỘC (vi phạm = sai) — rút gọn để khỏi tra lại

- **Entity** (`domain_modeling §0`): mutable, **field private `_x` riêng** (KHÔNG props-bag). Factory **tự sinh `v7()`** từ package `uuid` (CẤM nhận `id` từ caller, CẤM `crypto.randomUUID`). Behavior method **mutate in-place, trả `void`**. Field Date/array → clone **constructor + getter** (Date: `new Date(x.getTime())`). Primitive/child-entity trả thẳng.
- **KHÔNG validate input trong entity/factory** (`zod_validation §4`). Mọi validate input ở **Zod** (`z.string().trim().min(1).max(...)`; nhớ `.trim()` TRƯỚC `.min`). Entity chỉ giữ bất biến *type/structural* + chuyển trạng thái.
- **Validate-write / trust-read** (`domain_modeling §2`): `mapper.toDomain`/rehydrate KHÔNG re-validate; type row = Prisma enum, gán thẳng.
- **Tenant isolation** (`multi_tenancy §3`): MỌI query repo scope theo `orgId` lấy từ `requireTenantId()` (fail-closed, import từ `@/common/tenant/tenant.context`). `spaceId` lọc thêm khi cần. Cross-org = không thể thấy.
- **Soft-delete** (`database_standard §3`): `deletedAt:null` **tự động** (sau T0). Repo KHÔNG ghi tay `deletedAt:null` ở `find*`. Xóa = `update` set deletedAt.
- **Layer boundary (lint-enforced)**: `domain/**` chỉ import shared-kernel + relative. `application/**` cấm ORM/HTTP infra + HTTP exception; được dùng repo interface, `@/infrastructure/cqrs`, `@nestjs/common` DI, `@/common/errors`. `presentation/**` cấm Prisma; đẩy qua CommandBus/QueryBus.
- **Error**: dùng class kế thừa `ApplicationError` (shared-kernel) trong `@/common/errors/knowledge.error.ts`, throw ở **handler** (application). KHÔNG `throw new Error()`, KHÔNG HTTP exception của Nest.
- **Mapper riêng mỗi entity**; repo delegate, không `rehydrate` inline.
- **CQRS**: command/query là POJO implement `ICommand`/`IQuery`; handler có decorator `@CommandHandler(Cmd)`/`@QueryHandler(Q)` (xem `@/infrastructure/cqrs/decorators/`), khai báo ở module providers. Command tốn nhiều bước (update+revision) → `options: { transactional: true }`.
- **Controller**: class `@UseGuards(JwtAuthGuard)`; route `@UseGuards(OrgGuard)` + `@RequireOrgPermission(...)`; lấy ngữ cảnh qua `@CurrentUser()`/`@CurrentOrg()`; validate bằng `new ZodValidationPipe(Schema)`; write route thêm `@Throttle`. Trả plain object (ResponseInterceptor tự bọc). Lấy id từ handler: `await commandBus.execute<Cmd, string>(...)`.
- **Gate**: `npm run check` (typecheck + lint + format:check). Fix: `npm run lint:fix && npm run format`. Chạy ở root: `npx turbo run typecheck lint format:check --filter=@distributed-social-platform/core-api`.

---

## 3. TASKS (làm tuần tự; mỗi task xong phải typecheck sạch)

### T0 — Prereq: bật soft-delete auto-filter cho KnowledgeItem
File `apps/core-api/src/infrastructure/database/prisma/prisma.service.ts`:
thêm `'KnowledgeItem'` vào mảng `modelsWithSoftDelete` (hiện `['Organization','Space']`).
→ `const modelsWithSoftDelete = ['Organization', 'Space', 'KnowledgeItem']`

### T1 — Domain layer
Tạo:
- `modules/knowledge/domain/entities/knowledge-item.entity.ts`
- `modules/knowledge/domain/entities/revision.entity.ts`
- `modules/knowledge/domain/repositories/knowledge-item.repository.ts` (interface + Symbol)
- `modules/knowledge/domain/repositories/revision.repository.ts` (interface + Symbol)
- `common/errors/knowledge.error.ts`

**`knowledge-item.entity.ts` — skeleton (theo §0):**
```ts
import { v7 } from 'uuid'

export type KnowledgeType = 'DOCUMENT' | 'QUESTION' | 'ANSWER' | 'RUNBOOK' | 'ADR'
export type KnowledgeStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'STALE'

export interface KnowledgeItemProps {
  id: string
  orgId: string
  spaceId: string
  type: KnowledgeType
  title: string
  body: string
  parentId: string | null
  status: KnowledgeStatus
  isVerified: boolean
  version: number
  createdByUserId: string
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export class KnowledgeItem {
  private _id: string
  private _orgId: string
  private _spaceId: string
  private _type: KnowledgeType
  private _title: string
  private _body: string
  private _parentId: string | null
  private _status: KnowledgeStatus
  private _isVerified: boolean
  private _version: number
  private _createdByUserId: string
  private _updatedByUserId: string | null
  private _createdAt: Date
  private _updatedAt: Date
  private _deletedAt: Date | null

  private constructor(props: KnowledgeItemProps) {
    this._id = props.id
    // ...gán từng field; Date: this._createdAt = new Date(props.createdAt.getTime())
    // deletedAt: props.deletedAt ? new Date(props.deletedAt.getTime()) : null
  }

  // Tạo mới: luôn DRAFT, version=1, chưa verified. KHÔNG validate input (Zod lo).
  static create(props: {
    orgId: string
    spaceId: string
    type: KnowledgeType
    title: string
    body: string
    parentId?: string | null
    createdByUserId: string
  }): KnowledgeItem {
    const now = new Date()
    return new KnowledgeItem({
      id: v7(),
      orgId: props.orgId,
      spaceId: props.spaceId,
      type: props.type,
      title: props.title,
      body: props.body,
      parentId: props.parentId ?? null,
      status: 'DRAFT',
      isVerified: false,
      version: 1,
      createdByUserId: props.createdByUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  static rehydrate(props: KnowledgeItemProps): KnowledgeItem {
    return new KnowledgeItem(props)
  }

  // Sửa nội dung: mutate in-place + BUMP version (OCC). editor là người sửa.
  applyEdit(props: { title: string; body: string; editedByUserId: string }): void {
    this._title = props.title
    this._body = props.body
    this._updatedByUserId = props.editedByUserId
    this._version += 1
  }

  publish(): void {
    if (this._status !== 'DRAFT') throw new Error('only DRAFT can be published') // xem note dưới
    this._status = 'PUBLISHED'
  }

  verify(verifierUserId: string): void {
    this._isVerified = true
    this._updatedByUserId = verifierUserId
  }

  softDelete(): void {
    this._deletedAt = new Date()
  }

  // getters: id/orgId/spaceId/type/title/body/parentId/status/isVerified/version/
  //   createdByUserId/updatedByUserId/createdAt(clone)/updatedAt(clone)/deletedAt(clone)
  get isDeleted(): boolean { return this._deletedAt !== null }
}
```
> ⚠️ **Note `publish()`/invariant chuyển trạng thái:** ĐÂY là domain rule (không phải input validation) → được phép throw trong entity. NHƯNG đừng `throw new Error` — tạo `InvalidKnowledgeStateError extends ApplicationError` (statusCode 409) trong `knowledge.error.ts` và throw ở **handler** sau khi check, HOẶC để entity throw error class đó (import từ `@/common/errors` — application/domain? Để AN TOÀN biên tầng: handler check `if (item.status !== 'DRAFT') throw new InvalidKnowledgeStateError()` rồi mới gọi `item.publish()`; `publish()` chỉ set field). Chọn cách handler-check để khỏi cho domain import `@/common/errors`.

**`revision.entity.ts`:** field `id, itemId, version, bodySnapshot, editedByUserId, createdAt`. `static create({ itemId, version, bodySnapshot, editedByUserId })` → `id: v7()`, `createdAt: new Date()`. Có `rehydrate`. Getters.

**`knowledge-item.repository.ts` (interface):**
```ts
export interface IKnowledgeItemRepository {
  save(item: KnowledgeItem): Promise<void>            // INSERT (create)
  findById(id: string): Promise<KnowledgeItem | null> // scope orgId qua requireTenantId()
  // OCC update: chỉ update nếu version DB == expectedVersion. Trả false nếu count==0 (conflict).
  updateWithOcc(item: KnowledgeItem, expectedVersion: number): Promise<boolean>
}
export const KNOWLEDGE_ITEM_REPOSITORY = Symbol('IKnowledgeItemRepository')
```
**`revision.repository.ts`:** `save(rev): Promise<void>`; Symbol `REVISION_REPOSITORY`. (List revisions đi qua query-repo, không ở đây.)

**`knowledge.error.ts`** (mirror `tenant.error.ts`, đều `extends ApplicationError`):
- `KnowledgeItemNotFoundError` (404, `KNOWLEDGE_ITEM_NOT_FOUND`)
- `KnowledgeVersionConflictError` (409, `KNOWLEDGE_VERSION_CONFLICT`) — OCC fail
- `InvalidKnowledgeStateError` (409, `INVALID_KNOWLEDGE_STATE`) — vd publish khi không DRAFT

### T2 — Infrastructure layer
Tạo:
- `modules/knowledge/infrastructure/mappers/knowledge-item.mapper.ts`
- `modules/knowledge/infrastructure/mappers/revision.mapper.ts`
- `modules/knowledge/infrastructure/repositories/prisma-knowledge-item.repository.ts`
- `modules/knowledge/infrastructure/repositories/prisma-revision.repository.ts`
- `modules/knowledge/infrastructure/repositories/prisma-knowledge.query-repository.ts`

**Mapper** (theo `space.mapper.ts`): `toDomain(row)` → `KnowledgeItem.rehydrate({...})` (type row = Prisma type, gán thẳng — KHÔNG cast string); `toPersistence(item)` đọc qua getter, trả object khớp Prisma `create` data.

**`prisma-knowledge-item.repository.ts` — phần OCC là TRỌNG TÂM:**
```ts
private get client(): Prisma.TransactionClient {
  return getTx<Prisma.TransactionClient>() ?? this.prisma.client
}

async save(item: KnowledgeItem): Promise<void> {
  await this.client.knowledgeItem.create({ data: KnowledgeItemMapper.toPersistence(item) })
}

async findById(id: string): Promise<KnowledgeItem | null> {
  // deletedAt:null tự động (soft-delete extension). orgId fail-closed.
  const row = await this.client.knowledgeItem.findFirst({
    where: { id, orgId: requireTenantId() },
  })
  return row ? KnowledgeItemMapper.toDomain(row) : null
}

// OCC: where version == expectedVersion → atomic. count==0 nghĩa là có người sửa
// trước (hoặc không tồn tại) → conflict.
async updateWithOcc(item: KnowledgeItem, expectedVersion: number): Promise<boolean> {
  const result = await this.client.knowledgeItem.updateMany({
    where: { id: item.id, orgId: requireTenantId(), version: expectedVersion },
    data: {
      title: item.title,
      body: item.body,
      status: item.status,
      isVerified: item.isVerified,
      version: item.version,        // đã = expectedVersion + 1 (entity bump)
      updatedByUserId: item.updatedByUserId,
      deletedAt: item.deletedAt,    // dùng chung cho softDelete qua update
    },
  })
  return result.count === 1
}
```
> imports: `getTx` từ shared-kernel; `requireTenantId` từ `@/common/tenant/tenant.context`; `Prisma` từ `@/generated`.

**`prisma-revision.repository.ts`:** `save(rev)` → `this.client.revision.create({ data: RevisionMapper.toPersistence(rev) })`.

**`prisma-knowledge.query-repository.ts`** (Query side, mirror `prisma-membership.query-repository.ts` — dùng `this.prisma.client`, KHÔNG getTx, KHÔNG mapper-to-domain → trả DTO thẳng):
- `findItemById(id, orgId): Promise<KnowledgeItemDto | null>` — cho E2 (trả DTO, KHÔNG entity).
- `findItems(filter: { orgId; spaceId?; type?; status?; limit; offset }): Promise<KnowledgeListItemDto[]>` — `where: { orgId, ...(spaceId && {spaceId}), ... }`, `orderBy: { updatedAt: 'desc' }`, take/skip. **orgId truyền tường minh từ handler** (query side nhận orgId qua query object, KHÔNG getTenantId — nhất quán với membership.query-repo). Lưu ý: query-repo dùng `this.prisma.client` nên soft-delete tự lọc.
- `findRevisionsByItemId(itemId, orgId): Promise<RevisionDto[]>` — join an toàn: trước hết verify item thuộc org (hoặc where qua relation `item: { orgId }`), `orderBy: { version: 'desc' }`.

### T3 — Application layer (commands + queries)
**Commands** (mỗi cái 1 folder: `command.ts` + `handler.ts`), mirror `create-space`:
- `create-knowledge/` → `CreateKnowledgeCommand(orgId, spaceId, type, title, body, parentId, createdByUserId)`; handler: `KnowledgeItem.create({...})` → `repo.save` → `return item.id`. `ICommandHandler<Cmd, string>`. (Tạo thì 1 bước, không cần transaction; nhưng nếu tạo Revision v1 luôn thì set `transactional: true` + dùng revisionRepo — xem note.)
- `update-knowledge/` → `UpdateKnowledgeCommand(id, expectedVersion, title, body, editedByUserId)`. **`options:{ transactional:true }`**. Handler:
  ```ts
  const item = await this.itemRepo.findById(command.id)
  if (!item) throw new KnowledgeItemNotFoundError()
  item.applyEdit({ title: command.title, body: command.body, editedByUserId: command.editedByUserId })
  const ok = await this.itemRepo.updateWithOcc(item, command.expectedVersion)
  if (!ok) throw new KnowledgeVersionConflictError()
  await this.revisionRepo.save(
    Revision.create({ itemId: item.id, version: item.version, bodySnapshot: item.body, editedByUserId: command.editedByUserId }),
  )
  ```
- `publish-knowledge/` → `PublishKnowledgeCommand(id, userId)`. Handler: findById→ `if(!item)`404; `if(item.status!=='DRAFT') throw InvalidKnowledgeStateError`; `item.publish()`; `updateWithOcc(item, item.version - 1)`? — publish KHÔNG đi qua applyEdit nên version không bump; dùng `save`/update đơn giản: thêm repo method hoặc `updateMany where {id,orgId}` set status. **Đơn giản nhất:** thêm `updateStatus(item)` vào repo (update status/isVerified theo id+orgId, không OCC) HOẶC tái dùng updateWithOcc với expectedVersion=item.version (không bump). Khuyến nghị: thêm method nhẹ `update(item)` (no-OCC, set status/isVerified/deletedAt) cho publish/verify/delete; giữ `updateWithOcc` riêng cho edit nội dung.
- `verify-knowledge/` → `VerifyKnowledgeCommand(id, verifierUserId)`. Handler: findById→404; `item.verify(userId)`; `repo.update(item)`.
- `delete-knowledge/` → `DeleteKnowledgeCommand(id)`. Handler: findById→404; `item.softDelete()`; `repo.update(item)`.

> **Quyết định gọn:** thêm vào `IKnowledgeItemRepository` method `update(item): Promise<void>` (update theo `{id, orgId}`, set status/isVerified/title?/body?/deletedAt/updatedByUserId — KHÔNG OCC) cho publish/verify/delete; `updateWithOcc` chỉ cho E4. (2 method update là chấp nhận được, tách rõ ý nghĩa.)

**Queries** (mirror `get-org-members`): mỗi cái `query.ts` + `handler.ts` + (dùng chung) `knowledge.query-repository.ts` (interface) + `*.dto.ts`:
- `get-knowledge-item/` → `GetKnowledgeItemQuery(id, orgId)`; handler gọi **query-repo `findItemById(id, orgId)`** → trả `KnowledgeItemDto` (null → `KnowledgeItemNotFoundError` 404). ⚠️ **KHÔNG** reuse command-repo `findById` (vi phạm strict-CQRS: query phải trả DTO, không entity — xem KNOWLEDGE_INDEX §5).
- `list-knowledge-items/` → `ListKnowledgeItemsQuery(orgId, spaceId?, type?, status?, limit, offset)`; handler → `queryRepo.findItems(...)`.
- `list-revisions/` → `ListRevisionsQuery(itemId, orgId)`; handler → `queryRepo.findRevisionsByItemId(...)`.

DTO: `KnowledgeItemDto` (full), `KnowledgeListItemDto` (gọn: id, type, title, status, isVerified, version, updatedAt — KHÔNG body để list nhẹ), `RevisionDto` (version, editedByUserId, createdAt).

### T4 — Presentation layer
Tạo `presentation/schemas/*.schema.ts` + `presentation/controllers/knowledge.controller.ts` (mirror `org.controller.ts`).

**Zod schemas** (nhớ `.trim().min(1).max()`; KHÔNG validate ở entity):
```ts
// create-knowledge.schema.ts
export const CreateKnowledgeSchema = z.object({
  spaceId: z.string().uuid(),
  type: z.enum(['DOCUMENT', 'QUESTION', 'ANSWER', 'RUNBOOK', 'ADR']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  parentId: z.string().uuid().nullable().optional(),
})
// update-knowledge.schema.ts
export const UpdateKnowledgeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
})
// list query schema: spaceId uuid optional, type enum optional, status enum optional,
//   limit/offset: z.coerce.number().int()... (clamp ở controller như org.controller getMembers)
```

**Controller** (`@Controller()`, class `@UseGuards(JwtAuthGuard)`):
- Mỗi route `@UseGuards(OrgGuard)` + `@RequireOrgPermission(OrgPermission.KNOWLEDGE_*)` (import OrgPermission từ `@/modules/tenant/domain/org-permissions`).
- `@CurrentUser() user` (→ `user.sub`), `@CurrentOrg() org` (→ `org.orgId`).
- E1 create: `@Post('knowledge')` `@HttpCode(201)` `@Throttle(...)` → `const id = await commandBus.execute<CreateKnowledgeCommand, string>(new CreateKnowledgeCommand(org.orgId, body.spaceId, body.type, body.title, body.body, body.parentId ?? null, user.sub))` → `return { id }`.
- E4 update: `@Patch('knowledge/:id')` `@HttpCode(200)` → execute(UpdateKnowledgeCommand(id, body.expectedVersion, body.title, body.body, user.sub)).
- E5/E6: `@Post('knowledge/:id/publish'|'verify')` `@HttpCode(200)`.
- E7 delete: `@Delete('knowledge/:id')` `@HttpCode(204)`.
- E2/E3/E8: `@Get(...)` → `queryBus.execute(new ...Query(...))`. List truyền `org.orgId` vào query.
- `id` param: `@Param('id') id: string` (validate uuid ở schema params nếu muốn, hoặc bỏ qua — không bắt buộc).

### T5 — Wiring
- Tạo `modules/knowledge/knowledge.module.ts` (mirror `tenant.module.ts`): khai báo `KnowledgeController` + tất cả handlers + bind repo Symbols → Prisma impl. **Cần `OrgGuard`** trong providers (như TenantModule) vì route dùng nó — HOẶC import TenantModule nếu OrgGuard được export (kiểm tra: TenantModule hiện KHÔNG export OrgGuard → thêm `OrgGuard` vào providers của KnowledgeModule, nó tự inject membership/role-perm repo... nhưng các repo đó bind trong TenantModule).
  → **Cách đúng:** trong `TenantModule` thêm `exports: [OrgGuard, MEMBERSHIP_REPOSITORY, ORG_ROLE_PERMISSION_REPOSITORY]` rồi `KnowledgeModule` `imports: [TenantModule]`. (OrgGuard cần 2 repo đó.) Kiểm tra OrgGuard inject gì → export đủ.
- Đăng ký `KnowledgeModule` vào `app.module.ts` `imports`.

### T6 — Gate + Verify
1. `npm run lint:fix && npm run format` (trong `apps/core-api`).
2. Root: `npx turbo run typecheck lint format:check --filter=@distributed-social-platform/core-api` → phải 100% xanh. (core-api chưa có test → bỏ qua `test`.)
3. `npm run db:push` (apply nếu schema đụng — ở đây KHÔNG đổi schema nên thường "in sync"; KnowledgeItem table đã tồn tại).
4. **Manual smoke (nếu dựng được server + DB `localhost:15432`):** tạo org → tạo space → `POST /knowledge` (header `X-Org-Id`) → `PATCH` với `expectedVersion=1` (OK, version→2) → `PATCH` lại với `expectedVersion=1` (phải **409 conflict**) → `GET /knowledge/:id/revisions` (có 1 revision) → `GET /knowledge?spaceId=...` thấy item. Xác minh **tenant isolation**: user org khác gọi `GET /knowledge/:id` → null/404.

---

## 4. DEFINITION OF DONE
- [ ] 8 endpoint hoạt động đúng bảng E1–E8.
- [ ] OCC: PATCH với version cũ → 409 `KNOWLEDGE_VERSION_CONFLICT`; thành công → version++ và tạo đúng 1 Revision.
- [ ] Tenant isolation: mọi truy vấn scope orgId; không thấy data org khác.
- [ ] Soft-delete: DELETE set deletedAt; item đã xóa không xuất hiện ở GET/list.
- [ ] Tuân thủ entity style (mutable + _fields + v7 factory), input validate CHỈ ở Zod, error là ApplicationError.
- [ ] `npm run check` (core-api) xanh, không có `any` mới / `console.log` / HTTP exception trong application.

## 5. SAU KHI XONG (After-Task Protocol)
- Cập nhật `.ai/PROJECT_STATUS.md`: knowledge ⬜→✅ (Phase 1 %↑).
- Log lesson nếu có vào `.ai/memory/*.jsonl`.
- Nếu phát sinh quy ước mới → cập nhật directive liên quan.

## 6. ⛔ DO NOT
- ❌ Nhận `id` từ controller/command cho entity (factory tự `v7()`).
- ❌ `if (!x.trim()) throw` trong entity — validate ở Zod.
- ❌ `where` quên `orgId` / dùng `getTenantId()` trả undefined (dùng `requireTenantId()`).
- ❌ ghi tay `deletedAt: null` trong `find*` (extension lo).
- ❌ `throw new Error()` / `NotFoundException` của Nest trong handler — dùng class `@/common/errors/knowledge.error.ts`.
- ❌ import Prisma/`@/generated` ở `domain/**` hoặc `presentation/**`.
- ❌ sửa schema.prisma (đã đủ) / đụng Tag, Vote, Embedding.
