# PLAN — Engagement Module (core-api) · Phase 1 (sau knowledge)

> ⚠️ **BẢN GHI LỊCH SỬ, ĐÃ THỰC THI — đừng chép cấu trúc lỗi thời làm template.** Plan này đặt error
> class ở `common/errors/engagement.error.ts`; kể từ ADR-0002 (2026-08-24), `common/errors/` **không
> còn tồn tại** — mỗi module có đúng một file `modules/<module>/domain/<module>.error.ts`. Xem
> `directives/naming_conventions.md` §6 và `docs/adr/0002-placement-rule-and-outbox-as-capability.md`
> cho luật hiện hành trước khi dùng file này làm mẫu.

> **Đối tượng thực thi:** session mới (Sonnet). Plan này TỰ ĐỦ — không cần đọc lại nhiều source.
> Khi cần mẫu, mở **đúng các file template knowledge-module** (vừa làm xong, là tham chiếu tốt nhất).
> Ngôn ngữ code/comment: theo repo (comment tiếng Việt ngắn gọn cho phần "vì sao").

---

## 0. ĐỌC TRƯỚC (bắt buộc, ~5 phút) — rồi không cần đọc gì thêm

1. `.ai/KNOWLEDGE_INDEX.md` §4 (Critical Rules) + §5 (gotchas).
2. `directives/folder_structure_sop.md` §Enforcement (lint biên tầng — VI PHẠM = lint fail).
3. `directives/domain_modeling.md` §0, §1, §2 (entity style + factory + validate-write/trust-read).
4. `directives/multi_tenancy.md` §2–3 (tenant context + isolation).
5. `directives/zod_validation.md` §4 (validate input CHỈ ở Zod).
6. `directives/database_standard.md` §3 (soft-delete vs hard-delete: **Vote/Bookmark/Follow = HARD delete** vì là mapping/join tables).

**Template files để COPY pattern (module `knowledge` vừa xong — đối chiếu 1-1):**
- Entity: `modules/knowledge/domain/entities/knowledge-item.entity.ts` (mutable + `_fields` + v7 factory + clone Date).
- Repo interface + Symbol: `modules/knowledge/domain/repositories/knowledge-item.repository.ts`.
- Mapper: `modules/knowledge/infrastructure/mappers/knowledge-item.mapper.ts`.
- Write repo (getTx + requireTenantId): `modules/knowledge/infrastructure/repositories/prisma-knowledge-item.repository.ts`.
- Query repo (this.prisma.client, trả DTO): `modules/knowledge/infrastructure/repositories/prisma-knowledge.query-repository.ts`.
- Command stack: `modules/knowledge/application/commands/create-knowledge/` + `update-knowledge/` (transactional).
- Query stack: `modules/knowledge/application/queries/get-knowledge-item/` + `knowledge.query-repository.ts` + `knowledge.dto.ts`.
- Controller: `modules/knowledge/presentation/controllers/knowledge.controller.ts`.
- Module wiring: `modules/knowledge/knowledge.module.ts` (đã `imports: [TenantModule]`).
- Errors: `common/errors/knowledge.error.ts`.
- Permission catalog: `modules/tenant/domain/org-permissions.ts`.

---

## 1. PHẠM VI

Module `engagement` = **Vote + Bookmark + Accept Answer + Follow**, multi-tenant.
Schema cần **THÊM** (xem T0) — đây KHÔNG phải "no schema change" như knowledge.

**Scope IN:** Vote (up/down/remove + summary), Bookmark (toggle + list mine), Accept Answer (asker chấp nhận 1 ANSWER cho QUESTION của mình + bỏ chấp nhận), Follow (document/space + list mine + unfollow).
**OUT OF SCOPE (đừng đụng):** Verify (đã làm ở knowledge E6), digest/notification (Phase 6), reputation/credit khi vote (Phase 5 — vote giờ chỉ ghi nhận, KHÔNG cộng điểm), trending read-model (Phase 3).

**Endpoints (11):**
| # | Method + Path | Permission | Loại | Ghi chú |
|---|---|---|---|---|
| E1 | `PUT /knowledge/:id/vote` | `ENGAGEMENT_VOTE` | cmd | body `{value:1\|-1}` → upsert (idempotent set) |
| E2 | `DELETE /knowledge/:id/vote` | `ENGAGEMENT_VOTE` | cmd | gỡ vote của mình (idempotent, 204) |
| E3 | `GET /knowledge/:id/vote-summary` | `KNOWLEDGE_READ` | query | `{score,upvotes,downvotes,myVote}` |
| E4 | `PUT /knowledge/:id/bookmark` | `ENGAGEMENT_BOOKMARK` | cmd | thêm bookmark (idempotent, 204) |
| E5 | `DELETE /knowledge/:id/bookmark` | `ENGAGEMENT_BOOKMARK` | cmd | gỡ bookmark (idempotent, 204) |
| E6 | `GET /bookmarks?limit=&offset=` | `KNOWLEDGE_READ` | query | list bookmark của chính user (scope org) |
| E7 | `POST /knowledge/:id/accept-answer` | `ENGAGEMENT_ACCEPT_ANSWER` | cmd | `:id`=QUESTION; body `{answerId}`; chỉ asker |
| E8 | `DELETE /knowledge/:id/accept-answer` | `ENGAGEMENT_ACCEPT_ANSWER` | cmd | bỏ chấp nhận (chỉ asker, 204) |
| E9 | `PUT /follows` | `ENGAGEMENT_FOLLOW` | cmd | body `{targetType,targetId}` (idempotent, 204) |
| E10 | `DELETE /follows` | `ENGAGEMENT_FOLLOW` | cmd | body `{targetType,targetId}` (idempotent, 204) |
| E11 | `GET /follows?limit=&offset=` | `KNOWLEDGE_READ` | query | list follow của chính user |

> ⚠️ Permission engagement **CHƯA tồn tại** → T0 thêm vào catalog. KHÔNG bịa permission ngoài 4 cái dưới.

---

## 2. LUẬT BẮT BUỘC (vi phạm = sai) — rút gọn

- **Entity** (`domain_modeling §0`): mutable, field private `_x` riêng (KHÔNG props-bag). Factory tự sinh `v7()` từ `uuid` (CẤM nhận `id` từ caller). Behavior method mutate in-place trả `void`. Field Date → clone constructor + getter (`new Date(x.getTime())`).
- **KHÔNG validate input trong entity/factory** (`zod_validation §4`). `value ∈ {1,-1}`, `targetType ∈ {DOCUMENT,SPACE}` validate ở **Zod** (`z.union([z.literal(1),z.literal(-1)])`, `z.enum(['DOCUMENT','SPACE'])`).
- **Validate-write / trust-read**: `mapper.toDomain` KHÔNG re-validate; type row = Prisma type/enum, gán thẳng.
- **Tenant isolation** (`multi_tenancy §3`): MỌI query repo scope `orgId` từ `requireTenantId()` (import `@/common/tenant/tenant.context`). Vote/Bookmark/Follow có cột `orgId` (T0) → filter trực tiếp như knowledge.
- **Verify target tồn-tại-trong-org TRƯỚC khi ghi** (chống ghi chéo org): handler load item/space (scope org) → không có thì 404. Chỉ sau khi verify mới ghi row engagement với `orgId` từ context.
- **Hard-delete**: Vote/Bookmark/Follow KHÔNG có `deletedAt`, KHÔNG vào `modelsWithSoftDelete`. Xóa = `delete`/`deleteMany` thật. (KnowledgeItem vẫn soft-delete như cũ.)
- **Layer boundary (lint-enforced)**: như knowledge. `domain/**` chỉ shared-kernel + relative. `application/**` cấm ORM/HTTP infra + HTTP exception; được dùng repo interface (kể cả **cross-module**: `@/modules/knowledge/...` , `@/modules/tenant/...` — cross-module OK, chỉ cross-LAYER bị cấm), `@/infrastructure/cqrs`, `@nestjs/common` DI, `@/common/errors`. `presentation/**` cấm Prisma.
- **Error**: class kế thừa `ApplicationError` trong `@/common/errors/engagement.error.ts`, throw ở **handler**. Item không tồn tại → **reuse** `KnowledgeItemNotFoundError` từ `@/common/errors/knowledge.error.ts`. KHÔNG `throw new Error()` / HTTP exception Nest.
- **Mapper riêng mỗi entity**; repo delegate.
- **CQRS**: command/query POJO implement `ICommand`/`IQuery`; handler decorator `@CommandHandler`/`@QueryHandler` (từ `@/infrastructure/cqrs/decorators/`), khai báo ở module providers. Command nhiều bước (accept-answer: load + verify + mutate + save) → cân nhắc `transactional` chỉ khi có ≥2 lệnh ghi; vote/bookmark/follow 1 lệnh ghi → `transactional:false`.
- **Controller**: class `@UseGuards(JwtAuthGuard)`; mỗi route `@UseGuards(OrgGuard)` + `@RequireOrgPermission(...)`; `@CurrentUser() user`(→`user.sub`), `@CurrentOrg() org`(→`org.orgId`); validate `new ZodValidationPipe(Schema)`; cmd ghi thêm `@Throttle`. Idempotent toggle trả `@HttpCode(204)`.
- **Gate**: `npm run check`. Fix: `npm run lint:fix && npm run format`. Root: `npx turbo run typecheck lint format:check --filter=@distributed-social-platform/core-api`.

---

## 3. TASKS (làm tuần tự; mỗi task xong phải typecheck sạch)

### T0 — Prereq: schema + Prisma generate + permission catalog

**(a) `apps/core-api/prisma/schema.prisma` — sửa 3 model + thêm 1 model + 1 enum:**

- `KnowledgeItem`: thêm 1 field (KHÔNG tạo relation chính thức — tránh self-relation boilerplate, và tránh FK; chỉ scalar nullable):
  ```prisma
  acceptedAnswerId String?  @map("accepted_answer_id")
  ```
- `Vote`: thêm `orgId` + `createdAt`, thêm index. Giữ `@@unique([itemId, userId])`:
  ```prisma
  model Vote {
    id        String   @id @default(uuid())
    orgId     String   @map("org_id")
    itemId    String   @map("item_id")
    userId    String   @map("user_id")
    value     Int                              // +1 upvote / -1 downvote
    createdAt DateTime @default(now()) @map("created_at")
    item KnowledgeItem @relation(fields: [itemId], references: [id])
    @@unique([itemId, userId])
    @@index([orgId, itemId])
    @@map("votes")
  }
  ```
- `Bookmark`: thêm `orgId`. Giữ `@@unique([userId, itemId])`:
  ```prisma
  model Bookmark {
    id        String   @id @default(uuid())
    orgId     String   @map("org_id")
    userId    String   @map("user_id")
    itemId    String   @map("item_id")
    createdAt DateTime @default(now()) @map("created_at")
    @@unique([userId, itemId])
    @@index([orgId, userId])
    @@map("bookmarks")
  }
  ```
- **Thêm** model `Follow` + enum:
  ```prisma
  model Follow {
    id         String           @id @default(uuid())
    orgId      String           @map("org_id")
    userId     String           @map("user_id")
    targetType FollowTargetType @map("target_type")
    targetId   String           @map("target_id")
    createdAt  DateTime         @default(now()) @map("created_at")
    @@unique([userId, targetType, targetId])
    @@index([orgId, userId])
    @@map("follows")
  }
  enum FollowTargetType {
    DOCUMENT
    SPACE
  }
  ```
> `Bookmark` không có quan hệ tới `KnowledgeItem` trong schema gốc (không FK) → giữ nguyên, isolate bằng `orgId`. `Vote` đã có FK `item` → giữ.

**(b) Regenerate Prisma client** (để `@/generated` có `Follow`, `FollowTargetType`, `Vote.orgId`…):
- `cd apps/core-api && npm run db:generate` (hoặc lệnh generate của repo — xem `package.json` scripts; thường `prisma generate`). **PHẢI chạy trước khi code T2** nếu không type `@/generated` sẽ thiếu.
- KHÔNG vào `modelsWithSoftDelete` (giữ `['Organization','Space','KnowledgeItem']`).

**(c) `modules/tenant/domain/org-permissions.ts` — thêm 4 permission + seed mapping:**
```ts
// Engagement
ENGAGEMENT_VOTE: 'engagement:vote',
ENGAGEMENT_BOOKMARK: 'engagement:bookmark',
ENGAGEMENT_FOLLOW: 'engagement:follow',
ENGAGEMENT_ACCEPT_ANSWER: 'engagement:accept_answer',
```
Thêm vào `DEFAULT_ROLE_PERMISSIONS`: ADMIN + MEMBER nhận cả 4; GUEST KHÔNG (read-only). (OWNER implicit-all, không cần seed.)
> ⚠️ Org đã tạo trước đây sẽ KHÔNG có mapping mới (seed chỉ chạy lúc create org). Với smoke test, **tạo org mới** sau khi seed-defaults đã có 4 quyền. Không cần migration backfill cho portfolio.

### T1 — Domain layer
Tạo:
- `modules/engagement/domain/entities/vote.entity.ts` — fields `id, orgId, itemId, userId, value, createdAt`. Factory `create({orgId,itemId,userId,value})` → `id:v7()`, `createdAt:new Date()`. Behavior `changeValue(value:number):void { this._value = value }`. `rehydrate`. Getters (Date clone).
- `modules/engagement/domain/entities/bookmark.entity.ts` — `id, orgId, userId, itemId, createdAt`. `create({orgId,userId,itemId})`. Không có behavior mutate. `rehydrate`. Getters.
- `modules/engagement/domain/entities/follow.entity.ts` — `id, orgId, userId, targetType, targetId, createdAt`. `targetType: 'DOCUMENT'|'SPACE'` (type union trong file). `create({...})`. `rehydrate`. Getters.
- `modules/engagement/domain/repositories/vote.repository.ts`:
  ```ts
  export interface IVoteRepository {
    findByItemAndUser(itemId: string, userId: string): Promise<Vote | null> // scope orgId
    upsert(vote: Vote): Promise<void>            // create hoặc update value theo (itemId,userId)
    removeByItemAndUser(itemId: string, userId: string): Promise<void>       // hard delete, scope orgId
  }
  export const VOTE_REPOSITORY = Symbol('IVoteRepository')
  ```
- `modules/engagement/domain/repositories/bookmark.repository.ts`: `add(bookmark):Promise<void>` (idempotent — bỏ qua nếu trùng), `remove(itemId,userId):Promise<void>`. Symbol `BOOKMARK_REPOSITORY`.
- `modules/engagement/domain/repositories/follow.repository.ts`: `add(follow):Promise<void>`, `remove(userId,targetType,targetId):Promise<void>`. Symbol `FOLLOW_REPOSITORY`.
- **Sửa `modules/knowledge/domain/entities/knowledge-item.entity.ts`** (Accept Answer là behavior của aggregate KnowledgeItem):
  - `KnowledgeItemProps` thêm `acceptedAnswerId: string | null`.
  - constructor gán `this._acceptedAnswerId = props.acceptedAnswerId`. Field private `_acceptedAnswerId: string | null`.
  - `create()` set `acceptedAnswerId: null`.
  - thêm behavior:
    ```ts
    acceptAnswer(answerId: string): void { this._acceptedAnswerId = answerId; this._updatedAt = new Date() }
    clearAcceptedAnswer(): void { this._acceptedAnswerId = null; this._updatedAt = new Date() }
    get acceptedAnswerId(): string | null { return this._acceptedAnswerId }
    ```
- `common/errors/engagement.error.ts` (extends `ApplicationError`):
  - `NotAQuestionError` (400, `NOT_A_QUESTION`) — `:id` không phải type QUESTION.
  - `NotAnAnswerError` (400, `NOT_AN_ANSWER`) — answerId không phải type ANSWER.
  - `AnswerNotForQuestionError` (400, `ANSWER_NOT_FOR_QUESTION`) — `answer.parentId !== questionId`.
  - `AcceptAnswerForbiddenError` (403, `ACCEPT_ANSWER_FORBIDDEN`) — actor ≠ asker (question.createdByUserId).
  - `FollowTargetNotFoundError` (404, `FOLLOW_TARGET_NOT_FOUND`) — target không tồn tại trong org.
  - `InvalidVoteValueError` — KHÔNG cần (Zod chặn rồi).

### T2 — Infrastructure layer
Tạo:
- `modules/engagement/infrastructure/mappers/{vote,bookmark,follow}.mapper.ts` — `toDomain(row)`→`rehydrate`; `toPersistence(entity)` đọc getter, khớp Prisma `create` data (gồm `orgId`). Follow: `targetType` gán thẳng (Prisma enum).
- `modules/engagement/infrastructure/repositories/prisma-vote.repository.ts`:
  - `client` getter = `getTx() ?? this.prisma.client` (như knowledge).
  - `findByItemAndUser` → `findFirst({ where:{ itemId, userId, orgId: requireTenantId() } })`.
  - `upsert` → `this.client.vote.upsert({ where:{ itemId_userId:{itemId,userId} }, create: VoteMapper.toPersistence(vote), update:{ value: vote.value } })`. (compound unique name Prisma sinh = `itemId_userId`.)
  - `removeByItemAndUser` → `deleteMany({ where:{ itemId, userId, orgId: requireTenantId() } })`. (deleteMany = idempotent, không throw nếu 0 row.)
- `modules/engagement/infrastructure/repositories/prisma-bookmark.repository.ts`: `add` → `upsert` theo `userId_itemId` (idempotent, update no-op); `remove` → `deleteMany({where:{itemId,userId,orgId:requireTenantId()}})`.
- `modules/engagement/infrastructure/repositories/prisma-follow.repository.ts`: `add` → `upsert` theo `userId_targetType_targetId`; `remove` → `deleteMany`.
- Query repos (this.prisma.client, KHÔNG getTx, trả DTO; **orgId truyền tường minh từ handler**):
  - `prisma-engagement.query-repository.ts` (1 file, implement interface ở application — xem T3):
    - `getVoteSummary(itemId, orgId, userId): Promise<VoteSummaryDto>` — `aggregate({_sum:{value}, _count:true, where:{itemId,orgId}})` cho score+total; `count({where:{itemId,orgId,value:1}})` cho upvotes; downvotes=total-upvotes; `myVote` = `findFirst({where:{itemId,userId,orgId}})?.value ?? 0`.
    - `listBookmarks(orgId, userId, limit, offset): Promise<BookmarkDto[]>` — `where:{orgId,userId}`, `orderBy:{createdAt:'desc'}`, take/skip.
    - `listFollows(orgId, userId, limit, offset): Promise<FollowDto[]>` — tương tự.

### T3 — Application layer (commands + queries)
**Verify-target dependency:** handler engagement cần đọc KnowledgeItem (verify tồn tại) và Space (verify follow space). Dùng repo interface có sẵn qua DI:
- KnowledgeItem write-repo: `KNOWLEDGE_ITEM_REPOSITORY` (`IKnowledgeItemRepository.findById` — scope org qua requireTenantId). Dùng cho accept-answer (load + save) **và** verify item tồn tại cho vote/bookmark/follow-DOCUMENT.
- Space: `SPACE_REPOSITORY` (`ISpaceRepository.findById`) cho follow-SPACE.
> ⚠️ `findById` của các repo này gọi `requireTenantId()` → handler chạy SAU `OrgGuard` (đã `setTenantId`) nên OK.

**Commands** (mỗi cái 1 folder `command.ts`+`handler.ts`):
- `cast-vote/` → `CastVoteCommand(itemId, userId, value)`. Handler: `item=itemRepo.findById(itemId); if(!item) throw KnowledgeItemNotFoundError`; `existing=voteRepo.findByItemAndUser`; nếu có → `existing.changeValue(value)` else `Vote.create({orgId:item.orgId,itemId,userId,value})`; `voteRepo.upsert(...)`. `transactional:false`.
- `remove-vote/` → `RemoveVoteCommand(itemId, userId)`. Handler: `voteRepo.removeByItemAndUser` (không cần load item — deleteMany scope orgId; idempotent). `transactional:false`.
- `add-bookmark/` → `AddBookmarkCommand(itemId, userId)`. Handler: verify item tồn tại (404) → `bookmarkRepo.add(Bookmark.create({orgId:item.orgId,userId,itemId}))`.
- `remove-bookmark/` → `RemoveBookmarkCommand(itemId, userId)`. Handler: `bookmarkRepo.remove`.
- `accept-answer/` → `AcceptAnswerCommand(questionId, answerId, actorUserId)`. **`transactional:true`** nếu sau này ghi nhiều; hiện 1 ghi nhưng để `true` cho an toàn (đọc 2, ghi 1). Handler:
  ```ts
  const question = await this.itemRepo.findById(command.questionId)
  if (!question) throw new KnowledgeItemNotFoundError()
  if (question.type !== 'QUESTION') throw new NotAQuestionError()
  if (question.createdByUserId !== command.actorUserId) throw new AcceptAnswerForbiddenError()
  const answer = await this.itemRepo.findById(command.answerId)
  if (!answer) throw new KnowledgeItemNotFoundError()
  if (answer.type !== 'ANSWER') throw new NotAnAnswerError()
  if (answer.parentId !== question.id) throw new AnswerNotForQuestionError()
  question.acceptAnswer(answer.id)
  await this.itemRepo.update(question)   // xem sửa repo bên dưới
  ```
- `unaccept-answer/` → `UnacceptAnswerCommand(questionId, actorUserId)`. Handler: load question→404; `type!==QUESTION`→NotAQuestionError; `createdByUserId!==actor`→403; `question.clearAcceptedAnswer()`; `itemRepo.update(question)`.
- `follow-target/` → `FollowTargetCommand(userId, targetType, targetId)`. Handler: nếu `DOCUMENT` → `itemRepo.findById(targetId)`; nếu `SPACE` → `spaceRepo.findById(targetId)`; không có → `FollowTargetNotFoundError`; lấy `orgId=requireTenantId()` (hoặc từ entity) → `followRepo.add(Follow.create({orgId,userId,targetType,targetId}))`.
- `unfollow-target/` → `UnfollowTargetCommand(userId, targetType, targetId)`. Handler: `followRepo.remove`.

> **Sửa knowledge repo cho accept-answer:** `modules/knowledge/infrastructure/repositories/prisma-knowledge-item.repository.ts` → method `update(item)` thêm `acceptedAnswerId: item.acceptedAnswerId` vào `data`. Và **mapper** `knowledge-item.mapper.ts`: `toDomain` thêm `acceptedAnswerId: row.acceptedAnswerId`; `toPersistence` thêm `acceptedAnswerId: item.acceptedAnswerId`. Và **`KnowledgeItemDto`** (`knowledge.dto.ts`) + `prisma-knowledge.query-repository.ts findItemById` thêm `acceptedAnswerId` để E2 trả về.

**Queries** (mỗi cái `query.ts`+`handler.ts`; dùng chung `engagement.query-repository.ts` interface + `engagement.dto.ts`):
- `get-vote-summary/` → `GetVoteSummaryQuery(itemId, orgId, userId)` → `queryRepo.getVoteSummary`.
- `list-bookmarks/` → `ListBookmarksQuery(orgId, userId, limit, offset)` → `queryRepo.listBookmarks`.
- `list-follows/` → `ListFollowsQuery(orgId, userId, limit, offset)` → `queryRepo.listFollows`.

DTO (`engagement.dto.ts`): `VoteSummaryDto {score:number; upvotes:number; downvotes:number; myVote:number}`, `BookmarkDto {itemId:string; createdAt:Date}`, `FollowDto {targetType:string; targetId:string; createdAt:Date}`.
Interface `engagement.query-repository.ts` + Symbol `ENGAGEMENT_QUERY_REPOSITORY`.

### T4 — Presentation layer
Tạo `presentation/schemas/*.schema.ts` + `presentation/controllers/engagement.controller.ts` (mirror `knowledge.controller.ts`; `@Controller()` + class `@UseGuards(JwtAuthGuard)`).

**Zod schemas:**
```ts
// cast-vote.schema.ts
export const CastVoteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1)]) })
// follow.schema.ts (dùng cho cả PUT/DELETE /follows)
export const FollowSchema = z.object({
  targetType: z.enum(['DOCUMENT', 'SPACE']),
  targetId: z.string().uuid(),
})
// accept-answer.schema.ts
export const AcceptAnswerSchema = z.object({ answerId: z.string().uuid() })
```

**Controller routes** (lấy `id` qua `@Param('id')`, ngữ cảnh qua `@CurrentUser()/@CurrentOrg()`):
- E1 `@Put('knowledge/:id/vote')` `@HttpCode(204)` `@Throttle(...)` → `CastVoteCommand(id, user.sub, body.value)`.
- E2 `@Delete('knowledge/:id/vote')` `@HttpCode(204)` → `RemoveVoteCommand(id, user.sub)`.
- E3 `@Get('knowledge/:id/vote-summary')` → `queryBus.execute(new GetVoteSummaryQuery(id, org.orgId, user.sub))`.
- E4 `@Put('knowledge/:id/bookmark')` `@HttpCode(204)` → `AddBookmarkCommand(id, user.sub)`.
- E5 `@Delete('knowledge/:id/bookmark')` `@HttpCode(204)` → `RemoveBookmarkCommand(id, user.sub)`.
- E6 `@Get('bookmarks')` (limit/offset clamp như knowledge list) → `ListBookmarksQuery(org.orgId, user.sub, take, skip)`.
- E7 `@Post('knowledge/:id/accept-answer')` `@HttpCode(200)` → `AcceptAnswerCommand(id, body.answerId, user.sub)`.
- E8 `@Delete('knowledge/:id/accept-answer')` `@HttpCode(204)` → `UnacceptAnswerCommand(id, user.sub)`.
- E9 `@Put('follows')` `@HttpCode(204)` `@Throttle(...)` → `FollowTargetCommand(user.sub, body.targetType, body.targetId)`.
- E10 `@Delete('follows')` `@HttpCode(204)` → `UnfollowTargetCommand(user.sub, body.targetType, body.targetId)`. (DELETE có body → đọc qua `@Body(new ZodValidationPipe(FollowSchema))`.)
- E11 `@Get('follows')` → `ListFollowsQuery(org.orgId, user.sub, take, skip)`.
- Mỗi route: `@UseGuards(OrgGuard)` + `@RequireOrgPermission(OrgPermission.<...>)` theo bảng E1–E11.

### T5 — Wiring
- **`modules/knowledge/knowledge.module.ts`**: thêm `exports: [KNOWLEDGE_ITEM_REPOSITORY, KNOWLEDGE_QUERY_REPOSITORY]` (engagement cần dùng).
- **`modules/tenant/tenant.module.ts`**: `exports` thêm `SPACE_REPOSITORY` (đang export `OrgGuard, MEMBERSHIP_REPOSITORY, ORG_ROLE_PERMISSION_REPOSITORY`).
- Tạo `modules/engagement/engagement.module.ts`:
  - `imports: [TenantModule, KnowledgeModule]` (lấy OrgGuard + SPACE_REPOSITORY + KNOWLEDGE_*).
  - `controllers: [EngagementController]`.
  - `providers`: tất cả command/query handlers + bind `VOTE_REPOSITORY`/`BOOKMARK_REPOSITORY`/`FOLLOW_REPOSITORY`/`ENGAGEMENT_QUERY_REPOSITORY` → Prisma impl.
- **`app.module.ts`**: thêm `EngagementModule` vào `imports`.

### T6 — Gate + Verify
1. `npm run db:push` (apply schema mới vào DB `localhost:15432`) + `npm run db:generate` (nếu chưa chạy ở T0). → `@/generated` phải có `Follow`/`FollowTargetType`/`Vote.orgId`.
2. `cd apps/core-api && npm run lint:fix && npm run format`.
3. Root: `npx turbo run typecheck lint format:check --filter=@distributed-social-platform/core-api` → 100% xanh.
4. **Manual smoke** (nếu dựng được server + DB): tạo **org mới** (để có seed 4 quyền engagement) → space → QUESTION → ANSWER (parentId=question) →
   - `PUT /knowledge/:question/vote {value:1}` rồi `GET vote-summary` (score=1, myVote=1) → đổi `{value:-1}` (score=-1) → `DELETE vote` (score=0).
   - `PUT /knowledge/:id/bookmark` → `GET /bookmarks` thấy item → `DELETE` → list rỗng.
   - `POST /knowledge/:question/accept-answer {answerId}` (bằng tài khoản asker → 200; bằng người khác → 403; answerId thuộc question khác → 400).
   - `PUT /follows {targetType:'SPACE',targetId}` → `GET /follows` thấy → `DELETE`.
   - **Tenant isolation**: user org khác `GET /knowledge/:id/vote-summary` → score 0 / không thấy vote của org kia.

---

## 4. DEFINITION OF DONE
- [ ] 11 endpoint hoạt động đúng bảng E1–E11.
- [ ] Vote idempotent set (đổi value không tạo row mới); summary tính đúng score/up/down/myVote.
- [ ] Accept Answer: chỉ asker (author của QUESTION) accept được; answer phải đúng `parentId`; sai → 400/403.
- [ ] Follow: verify target tồn tại trong org trước khi ghi; unique theo (userId,targetType,targetId).
- [ ] Tenant isolation: Vote/Bookmark/Follow scope `orgId`; không thấy/đụng data org khác.
- [ ] Hard-delete cho Vote/Bookmark/Follow (KHÔNG thêm vào modelsWithSoftDelete).
- [ ] Entity style (mutable+_fields+v7), input validate CHỈ ở Zod, error là ApplicationError.
- [ ] `npm run check` (core-api) xanh; không `any` mới / `console.log` / HTTP exception trong application.

## 5. SAU KHI XONG (After-Task Protocol)
- `.ai/PROJECT_STATUS.md`: engagement ⬜→✅; Phase 1 → ~100% (4/4 module); **Next:** Phase 2 (Event Backbone) hoặc unit tests Phase 1.
- Log lesson vào `.ai/memory/*.jsonl` (đặc biệt: pattern verify-target cross-module qua exported repo; hard-delete mapping tables; accept-answer thuộc aggregate KnowledgeItem).
- Cập nhật `directives/multi_tenancy.md` nếu chốt quy ước "engagement table mang orgId + verify-target".
- Cân nhắc bổ sung **unit tests** (acceptance criteria Phase 1 yêu cầu vote logic) — có thể tách plan riêng.

## 6. ⛔ DO NOT
- ❌ Nhận `id` từ controller/command cho entity (factory tự `v7()`).
- ❌ Validate `value`/`targetType` trong entity — validate ở Zod.
- ❌ `where` quên `orgId` / dùng `getTenantId()` (dùng `requireTenantId()`).
- ❌ Thêm Vote/Bookmark/Follow vào `modelsWithSoftDelete` (chúng hard-delete).
- ❌ Cho engagement ghi thẳng vào bảng `knowledge_items` — Accept Answer phải qua entity `KnowledgeItem` + `KNOWLEDGE_ITEM_REPOSITORY`.
- ❌ `throw new Error()` / `NotFoundException` Nest — dùng `@/common/errors/engagement.error.ts` (+ reuse `KnowledgeItemNotFoundError`).
- ❌ import Prisma/`@/generated` ở `domain/**` hoặc `presentation/**`.
- ❌ Cộng điểm reputation/credit khi vote (Phase 5) / tạo digest khi follow (Phase 6).
