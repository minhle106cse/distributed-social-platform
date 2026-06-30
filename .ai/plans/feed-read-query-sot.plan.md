# PLAN: Consolidate Phase 2 + Feed Read Endpoint (query Source of Truth)

> **Cho session mới (Sonnet).** Đọc trọn file này trước khi code. Thực hiện **Phase 0 → Phase 1** theo thứ tự. Không nhảy cóc.
> Ngày lập: 2026-06-30. Người duyệt hướng: user (chọn "Feed read endpoint query SoT").

---

## 0. BỐI CẢNH BẮT BUỘC ĐỌC (đừng vi phạm)

Dự án **Cortex** (B2B knowledge hub). Vừa qua một đợt refactor lớn + **rollback read model**. Trạng thái hiện tại:

- **Schema = CHỈ source of truth.** Đã gỡ mọi read model/projection: `feed_timeline`, `processed_events`, `credit_balance_summary`, `reputation_summary`, `user_profiles`. Event ledger `credit_events` + `reputation_events` (append-only) là SoT — giữ.
- **Event backbone còn sống nhưng KHÔNG có consumer:** `publish-knowledge → outbox → PollingPublisher(@2s) → Kafka topic knowledge-events`. Không ai consume (cố ý). Worker-service = scaffold rỗng.
- ⛔ **LUẬT VÀNG (vi phạm là sai):** KHÔNG tạo read model / bảng denormalized / projection / cache / materialized view. Mọi query đi **thẳng source of truth** (join lúc đọc). Nếu thấy cần optimize, **DỪNG và hỏi user** — không tự làm. (Xem memory `flag-optimizations-for-approval`.)
- **Sau mỗi task: tự chạy After-Task Protocol** (update `.ai/PROJECT_STATUS.md`, directive liên quan, `.ai/KNOWLEDGE_INDEX.md`, log `.ai/memory/*.jsonl`) — KHÔNG hỏi xin phép.

**SOP phải đọc trước khi code:**
- `directives/cqrs_pattern.md` — command/query bus, middleware
- `directives/folder_structure_sop.md` — cấu trúc module (domain/application/infrastructure/presentation)
- `directives/multi_tenancy.md` — orgId qua `@CurrentOrg`, OrgGuard
- `directives/zod_validation.md` — validate query params
- `directives/eventing_patterns.md` — chỉ để hiểu backbone; KHÔNG đụng consumer/read-model (đã defer)

---

## PHASE 0 — Consolidate về baseline sạch (làm TRƯỚC)

### Task 0.1 — Chốt số phận `Embedding` (HỎI USER trước khi đụng)
`model Embedding` (vector pgvector, Phase 4 RAG) còn trong `apps/core-api/prisma/schema.prisma`. Là search index, derived, **unused**. User chưa quyết.
- **Hỏi user:** gỡ (defer tới Phase 4) hay giữ (coi là search infra)?
- Nếu gỡ: xoá `model Embedding` + back-relation `embeddings Embedding[]` trong `model KnowledgeItem` (kiểm tra dòng relation trong KnowledgeItem). Rồi `prisma generate`.
- Nếu giữ: bỏ qua.

### Task 0.2 — Đẩy schema xuống DB
Schema đã sạch nhưng DB còn bảng cũ. Cần Docker DB chạy (`docker compose up -d` nếu chưa).
```bash
cd apps/core-api && npx prisma db push
```
→ drop: feed_timeline, processed_events, credit_balance_summary, reputation_summary, user_profiles (+ embeddings nếu Task 0.1 gỡ).
- **Worker KHÔNG db:push** (worker schema là type-gen only, core-api owns DB). Chỉ `prisma generate` cho worker nếu cần.

### Task 0.3 — Verify toàn repo
```bash
npx turbo run build typecheck lint
```
Phải xanh 100% trước khi commit.

### Task 0.4 — Commit Phase 2 + rollback (HỎI USER xác nhận trước khi commit)
Hiện rất nhiều thay đổi uncommitted qua nhiều submodule. User kiểm soát commit — **xác nhận trước**.
- Thứ tự: commit submodule con TRƯỚC (`apps/core-api`, `apps/worker-service`), rồi parent repo (bump submodule pointer + shared-kernel + directives + .ai).
- Commit message theo convention hiện có (xem `git log`). Mỗi submodule 1 commit mạch lạc.
- ⚠️ KHÔNG commit `.env`. Lưu ý `.env` còn var chết `KAFKA_CONSUMER_GROUP` (worker đổi sang đọc key khác / đã gỡ) — dọn nếu tiện.

---

## PHASE 1 — Feed Read Endpoint (query Source of Truth)

### Mục tiêu
`GET /api/v1/feed` — trả về các knowledge item PUBLISHED thuộc các Space mà user hiện tại đang follow, mới nhất trước, có phân trang. **Query thẳng SoT** (`follows` × `knowledge_items`), KHÔNG bảng precompute.

### Logic query (fan-out-on-read)
1. Lấy spaceId user follow: `follows WHERE userId=me AND orgId=org AND targetType='SPACE'` → danh sách spaceId.
2. Nếu rỗng → trả `[]`.
3. Lấy item: `knowledge_items WHERE orgId=org AND spaceId IN (spaceIds) AND status='PUBLISHED' AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT n OFFSET m`.
   - Lưu ý: `KnowledgeItem` có soft-delete extension (`deletedAt: null` tự inject qua `this.prisma.client`) — dùng `this.prisma.client` (không phải rawClient).
- **MVP chỉ xét follow SPACE** (đúng `reason: 'new_in_space'` cũ). Follow DOCUMENT/author để sau.

### Cấu trúc — module `feed` MỚI trong core-api (CHỈ query side)
Mirror y hệt query-side của `knowledge` module. KHÔNG có command/entity/write-repo (đây là read concern thuần trên SoT có sẵn).

```
apps/core-api/src/modules/feed/
  application/
    queries/
      feed.query-repository.ts          # IFeedQueryRepository + FEED_QUERY_REPOSITORY (Symbol)
      feed.dto.ts                        # FeedItemDto { itemId, spaceId, type, title, createdByUserId, createdAt }
      get-feed/
        get-feed.query.ts                # GetFeedQuery implements IQuery { name, orgId, userId, limit, offset }
        get-feed.handler.ts              # @QueryHandler(GetFeedQuery), inject FEED_QUERY_REPOSITORY
  infrastructure/
    repositories/
      prisma-feed.query-repository.ts    # implements IFeedQueryRepository, dùng PrismaService, join follows×knowledge_items
  presentation/
    controllers/
      feed.controller.ts                 # GET /feed
    schemas/
      get-feed.schema.ts                 # Zod: { limit?, offset? } (mirror list-knowledge)
  feed.module.ts
```

### Chi tiết từng file (mirror các file tham chiếu)

**get-feed.query.ts** — mirror `knowledge/application/queries/list-knowledge-items/list-knowledge-items.query.ts`:
```ts
export class GetFeedQuery implements IQuery {
  readonly name = 'GetFeedQuery'
  constructor(
    public readonly orgId: string,
    public readonly userId: string,
    public readonly limit: number,
    public readonly offset: number,
  ) {}
}
```

**feed.query-repository.ts** — mirror `knowledge.query-repository.ts`:
```ts
export interface IFeedQueryRepository {
  getFeed(p: { orgId: string; userId: string; limit: number; offset: number }): Promise<FeedItemDto[]>
}
export const FEED_QUERY_REPOSITORY = Symbol('IFeedQueryRepository')
```

**get-feed.handler.ts** — mirror `list-knowledge-items.handler.ts`: `@Injectable() @QueryHandler(GetFeedQuery)`, inject `FEED_QUERY_REPOSITORY`, gọi `getFeed(...)`.

**prisma-feed.query-repository.ts** — inject `PrismaService`. 2 bước: query follows lấy spaceIds → query knowledge_items. Dùng `this.prisma.client` (soft-delete aware). Map sang `FeedItemDto`.

**feed.controller.ts** — mirror guard + context của `knowledge.controller.ts`:
```ts
@Controller()
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('feed')
  @UseGuards(OrgGuard)
  @RequireOrgPermission(OrgPermission.KNOWLEDGE_READ)   // verify tên đúng trong tenant/domain/org-permissions
  async getFeed(
    @Query(new ZodValidationPipe(GetFeedSchema)) q: GetFeedDto,
    @CurrentUser() user: JwtPayload,
    @CurrentOrg() org: OrgContext,
  ) {
    return this.queryBus.execute(new GetFeedQuery(org.orgId, user.sub, q.limit, q.offset))
  }
}
```
- Kiểm tra field user id trong `JwtPayload` (có thể là `sub` hoặc `userId` — xem `jwt-auth.guard.ts`).
- Kiểm tra `OrgPermission` có `KNOWLEDGE_READ` không; nếu không, mirror đúng guard mà endpoint `GET knowledge` (list) đang dùng.

**get-feed.schema.ts** — Zod cho query params (limit default 20 max 100, offset default 0). Xem `list-knowledge` có schema phân trang chưa để tái dùng; shared-kernel `schemas/common.schema.ts` có thể có sẵn pagination.

**feed.module.ts** — mirror `knowledge.module.ts`:
```ts
@Module({
  controllers: [FeedController],
  providers: [
    GetFeedHandler,
    { provide: FEED_QUERY_REPOSITORY, useClass: PrismaFeedQueryRepository },
  ],
})
export class FeedModule {}
```
Rồi import `FeedModule` vào `apps/core-api/src/app.module.ts`.

### Ràng buộc kiến trúc (eslint enforce — đừng vi phạm)
- `application/**` KHÔNG import Prisma/infra (trừ `@/infrastructure/cqrs`). Query repo interface ở application, impl ở infrastructure.
- `presentation/**` KHÔNG chạm ORM — chỉ qua QueryBus.
- Query repo (`prisma-feed.query-repository.ts`) ở infrastructure → được dùng Prisma. Đây là CQRS query side, được phép join nhiều bảng tối ưu cho đọc.
- KHÔNG tạo bảng mới. KHÔNG ghi gì. Chỉ đọc.

### Acceptance criteria
- [ ] `GET /api/v1/feed?limit=20&offset=0` trả item PUBLISHED của space user follow, desc theo createdAt.
- [ ] User không follow space nào → `[]`.
- [ ] Multi-tenant: chỉ trả item cùng orgId (lọc theo `@CurrentOrg`).
- [ ] Soft-deleted item không xuất hiện.
- [ ] `npx turbo run build typecheck lint --filter=...core-api` xanh.
- [ ] Smoke test: tạo space → publish item → user follow space → GET /feed thấy item. (curl, cần auth token + x-org-id header.)
- [ ] KHÔNG có bảng/migration mới trong schema.

---

## SAU KHI XONG (After-Task Protocol — tự làm)
- `.ai/PROJECT_STATUS.md`: thêm module `feed` (read, query SoT) vào Phase 1/§2; ghi "feed read = fan-out-on-read, không read table".
- `.ai/KNOWLEDGE_INDEX.md` §2: auto-scan sẽ thấy module `feed` mới (chạy lại knowledge_builder nếu có, hoặc sửa tay §2).
- `.ai/memory/conventions.jsonl`: log "feed read query thẳng SoT (join follows×knowledge_items), không read model".
- Cập nhật directive nếu phát sinh pattern mới.

## GỢI Ý THỨ TỰ LÀM
1. Phase 0 (0.1 hỏi Embedding → 0.2 db push → 0.3 verify → 0.4 hỏi+commit).
2. Phase 1: query+dto+repo interface → prisma impl → handler → schema → controller → module → wire app.module → verify → smoke test → docs.

## CẠM BẪY ĐÃ BIẾT
- IDE báo lỗi đỏ sau khi move/tạo file nhiều: do TS server cache + shared-kernel `dist/` stale. Nếu CLI `turbo lint` xanh mà IDE đỏ → Restart TS Server; nếu sửa shared-kernel thì xoá `packages/shared-kernel/dist` + rebuild `--force`.
- `JwtPayload` field id: xác minh `sub` vs `userId` trong `jwt-auth.guard.ts` trước khi dùng.
- Prisma soft-delete: đọc qua `this.prisma.client` (extended), KHÔNG `rawClient`.
