# 📊 Cortex — Live Status

> **Current-state only.** Injected verbatim into `KNOWLEDGE_INDEX.md §2`. Update as part of the
> After-Task Protocol whenever a phase/module changes. The full historical journal lives in
> `.ai/CHANGELOG.md` (not scanned by the builder). The auto-detected module map that the builder
> appends below this content is filesystem ground-truth — if it disagrees with the table here, this
> file is stale; reconcile it.

> Last curated: **2026-08-25** — toàn bộ việc 2026-08-24 (25 commit: Phase 5b + đợt refactor
> placement + normalize EOL) đã commit, cây sạch; 6 nhãn "uncommitted" trong file này được sửa lại.
> ⚠️ Đây là **lần thứ hai** đúng lỗi đó xảy ra — xem chính ghi chú 2026-08-11 ngay dưới, nó cảnh báo
> về đúng failure mode này rồi vẫn tái diễn. `scripts/sync.cjs` không bắt được vì nó chỉ so code
> *đang uncommitted* với mtime của memory, mù với prose đã hết đúng sau khi commit landed.
>
> Last curated: **2026-08-11** — reconciled against `git log`; several items below were labeled
> "uncommitted, pending review" while actually committed since 2026-08-04 (`8bb757f`, `9930ffe`,
> `2a6a12c` et al.). The doc going stale like this is exactly the class of drift the mechanical
> layer (`scripts/sync.cjs`) cannot catch — it only compares *currently-uncommitted* code against
> memory mtime, blind to prose that stops matching reality after a commit lands.

**Overall ~86%** — infrastructure ~88% / product features ~55% (credit ledger has a foundation).
**Tech-stack showcase is deep; product surface is still MVP.**

### Where we are now

- **Latest landed:** the **resilience & defense curriculum** (`directives/resilience_patterns.md` is
  the source of truth) is nearly done — idempotency (claim-before-execute + request-hash), retry
  (P2034-only, auto-applies to every `transactional:true` command), circuit breaker (gRPC + ES +
  Ollama, promoted to shared-kernel), org-aware rate limiting, and graceful shutdown are all ✅.
  **Correlation-id (W3C traceparent across HTTP/gRPC/Kafka) is implemented and committed**
  (`2a6a12c`, `c207fed`) — git-verified 2026-08-11, no longer the open item this line used to
  describe. Also landed: membership-verification gRPC (IDOR fix), 293-test unit-test pass across
  the monorepo, and a monitoring stack as code.
- **Transaction/retry rearchitecture — ADR-0001, LANDED 2026-07-29 across all 5 packages,
  committed 2026-08-04 (`8bb757f`).** Replaced implicit `AsyncLocalStorage` + a `transactional` flag on the command DTO +
  three `commandBus.use()` middlewares with: a Unit-of-Work (`TxScope`) that owns the write
  repositories, handler TYPE (`ITransactionalCommandHandler` vs `ISagaCommandHandler`) instead of a
  flag, a fixed in-bus pipeline, a re-entrancy guard, and boot-time validation that refuses to start a
  service whose handler declares an unbuildable scope. 38 handlers / 26 repositories / 8 scopes
  migrated; forced a proper read/write split in 5 places that had been reading through write repos.
  Rationale, rejected alternatives and precedent: [`docs/adr/0001-transaction-retry-boundary.md`](../docs/adr/0001-transaction-retry-boundary.md).
  **Post-implementation review (2026-07-30) found + fixed 10 execution gaps** (design itself held up):
  saga didn't compensate a committed inner command (orphaned org), event handlers bypassed CommandBus
  so their TxScope had zero boot validation, success-audit logging ran inside the transaction and
  could double-write on retry, credit OCC conflicts weren't auto-retried despite being safe to, a
  handler missing `kind` skipped boot validation, the transient-error metric counted business errors,
  and 5 copy-pasted `PrismaTxRunner`s were consolidated into a shared `AbstractTxRunner`. Details:
  ADR §9b, `.ai/plans/adr-0001-review-remediation.plan.md`. `npx turbo typecheck test` green across
  all 6 packages after the fixes — committed together with the above, 2026-08-04 (`8bb757f`).
- **Saga reliability follow-up (2026-07-30, committed 2026-08-04, built on top of the above).** Discussion of
  the ADR-0001 review surfaced that a failed saga compensation had nowhere durable to go (log only) —
  closed by 3 pieces, all implemented same day: (1) **SagaCompensationOutbox** — compensations are now
  data (`CompensationAction{type,payload}`) not closures, a failed one is recorded in a new
  `SagaCompensation` table and retried by `SagaCompensationReaperService` (same PENDING/INFLIGHT/DONE/
  FAILED_DLQ shape as `OutboxEvent`); (2) **DLQ auto-reprocessor** — `DlqReplayConsumer`
  (shared-kernel) now actually reads `<topic>.DLQ` and republishes to the original topic (it sat
  unconsumed before — "isolated for triage" meant nobody ever triaged it), wired into
  notification-service + search-service; (3) **idempotent `ProvisionUser` gRPC call** — a client retry
  (same `X-Idempotency-Key`, now threaded through `proto/org-provisioning.proto`) recovers the SAME
  provisioned user instead of orphaning a second one when the first gRPC response was lost after
  auth-service had already committed; a fresh temp password is re-issued rather than persisting the
  original at rest. Plus an observability-only (no auto-delete) hourly watcher for orphaned
  saga-provisioned users in auth-service. Full design + the reasoning behind each choice:
  `.ai/plans/saga-compensation-outbox.plan.md`. `npx turbo typecheck test` green, 19/19 tasks.
- **Independent review + fixes (2026-07-30, same day, committed 2026-08-04).** A structured code review of the
  full ADR-0001 diff (background agent, verified against real code not plan claims) confirmed the
  9b/saga-reliability work landed as documented, and found 2 NEW bugs neither plan had caught:
  (1) `refresh.handler.ts` logged `allSessionsRevoked:true` audit for a token-reuse event BEFORE the
  throw that rolled back the revocation it described — fixed by returning `{reused:true}` instead of
  throwing (commit happens, then the route translates it to 401) and moving the audit to `afterCommit`;
  (2) `provision-user.handler.ts`'s idempotency-key reuse path didn't check the request email against
  the original, so a key collision across different emails would silently reissue a live password for
  the wrong account — fixed by adding `email` to `GrpcIdempotencyRecord` and rejecting a mismatch
  (`IdempotencyKeyConflictError`). `npm run db:push` then actually run (Postgres was live this time) —
  `SagaCompensation`/`GrpcIdempotencyRecord`/`User.provisionedViaSaga` confirmed applied — and the full
  saga-reliability stack (happy-path ProvisionOrg, idempotent retry, compensation reaper, DLQ replay)
  smoke-tested end-to-end against real infra, all passing.
- **TxScope → single repos-per-service collapse (2026-07-30, same day, committed 2026-08-04, built on top of
  the above).** Owner pushed back on ADR-0001's per-module `TxScopeToken` + registry
  (`registerScope`/`canResolve`): the scopes already overlapped heavily (shared fields with identical
  types across 2+ scopes) and the extra split bought a soft protection (autocomplete visibility) at a
  real upkeep cost (N interfaces + N factories + N registrations per service). Collapsed to ONE repos
  shape per service, built by ONE factory, passed to `PrismaTxRunner`'s constructor as a required
  argument instead of registered via `onModuleInit`/`registerScope()` — TypeScript itself now refuses
  to construct a runner without its factory, strictly stronger than the boot-time `canResolve()` check
  it replaces. Touched shared-kernel core (`tx-scope.ts`, `abstract-tx-runner.ts`, `command-bus.ts`,
  `event-router.ts` — `ITxRunner<S>`, `IRepoFactory<S,DB>`, no more token/registry) and all 4 services:
  notification-service + search-service were already single-scope (mechanical simplification only);
  auth-service merged Auth+Rbac+User (3→1, `container/repos.ts`); core-api merged
  Knowledge+Engagement+Tenant+Credit (4→1, `infrastructure/database/prisma/core-api-repos.factory.ts`).
  `npx turbo typecheck test` green across all packages (shared-kernel 91, core-api 150, auth-service
  123, notification-service 32, search-service 49). `directives/cqrs_pattern.md` updated to match;
  `docs/adr/0001-transaction-retry-boundary.md` left untouched (frozen historical record per
  `docs/adr/README.md` — this collapse effectively supersedes its `TxScopeToken`/registry design;
  still worth a formal ADR amendment even though the code itself already landed).
- **Naming/CQRS-boundary audit (2026-08-20, during RAG learning curriculum, committed pending).**
  User's questions while reading search-service code (RAG walkthrough) surfaced a real gap in
  `naming_conventions.md` (no rule for an application-layer service with no CommandBus/QueryBus) and
  6 naming/placement fixes across 4 services — `ISearchChunkReader` relocated
  `domain/repositories/`→`application/queries/` (no domain consumer; contrast with
  `IOrgRolePermissionReader`, kept in domain because a domain service depends on it), the reader impl's
  misleading `.query-repository` suffix fixed, `Imp*Service`→`Argon2PasswordService`/`JwtTokenService`
  (auth-service), `Claude/GeminiSummarizer`→`...SummarizerService` (adapter-suffix consistency),
  `resolve-org-permissions.ts`→`org-permission-resolver.ts` (filename/class match), both
  search-service/notification-service controllers moved into `presentation/controllers/` to match
  `folder_structure_sop.md`'s own spec (core-api already had this). `naming_conventions.md` gained §11
  (Application Service) + §12 (controllers/ nesting); `cqrs_pattern.md`'s repository-placement rule
  gained a dependency-direction litmus test. `npx turbo run typecheck test` green across all 4 touched
  services (search-service 12/12 suites·53 tests, notification-service 11/11·32, core-api 53/53·157,
  auth-service 30/30·123) — no logic changed, naming/location only.
- **Repo-placement rule made enforceable (2026-08-21, committed 2026-08-24).** Follow-on to the naming audit
  above. Owner asked how to guarantee this class of drift never recurs; answer was a control, not more
  prose — the rule had lived only in two directives that **contradicted each other for ~6 weeks**
  (`folder_structure_sop.md`'s canonical tree listed `application/repositories/`, `cqrs_pattern.md`
  declared that same folder banned) with nothing cross-checking them. Settled in favour of the
  canonical tree: all 10 `*.query-repository.ts` ports moved `application/queries/` →
  `application/repositories/` across 4 services (DTOs stay in `queries/`). Placement now decided by an
  ORDERED 2-step rule (write method → domain; else read port → domain only if a `domain/` file imports
  it, else application) — the earlier single-step "dependency direction" phrasing was found to
  contradict the pre-existing "mixed write+read" row on `IKeywordSearchRepository` and was replaced.
  Shipped `scripts/check-repo-placement.cjs` → `npm run check:arch` (5 deterministic checks; each
  verified by injecting a violation), wired into `npm run check` **first** so pre-existing lint
  failures can't short-circuit past it, and into the `Stop` hook as a **turn-blocking** check —
  verified end-to-end: blocks with a fix-procedure on a misplaced file, silent on a clean tree. It also
  closes a real eslint hole (`no-restricted-imports` matches literal specifiers, so it misses a
  relative `../../application/...` import from domain) and covers all 4 services, whereas the eslint
  layer boundaries exist only in core-api. **Known gap left open: auth-service has no layer-boundary
  lint rules at all.** typecheck+test green on all 4; lint counts equal their committed baselines.
- **Monorepo lint debt 261 → 0 (2026-08-21).** `npm run check` had been permanently red, which erodes
  every gate hanging off it. Measured before fixing: 194/261 were in `.spec.ts` and 81 of those were
  `unbound-method` — the standard Jest `expect(mock.method)` assertion, not a defect; root cause was
  that auth-service's long-standing spec-relaxation block had never been copied to the 3 NestJS
  services. **The 23 `no-restricted-imports` errors turned out to be one real architecture violation
  the red count had been hiding:** `CoreApiRepos` (the ADR-0001 UoW shape — domain repo interfaces
  only, no Prisma types) was declared inside the infrastructure factory, so all 23 transactional
  handlers imported a type from `@/infrastructure`. Extracted to `src/common/database/core-api-repos.ts`
  (owner's call over a lint exception); the factory stays in infrastructure. Typing the 4 `any` result
  params in auth-service immediately surfaced a latent mismatch (`{ success: true }` vs the widened
  `{ success: boolean }` the bodies return) that `any` had hidden. Now: **`turbo run typecheck lint
  format:check` 19/19 green, 455 tests pass, `check:arch` green.** Remaining blocker for a fully green
  `npm run check`: **`apps/web` has no `eslint.config` file at all** (pre-existing, untouched, git-clean).
- **Both remaining gaps closed (2026-08-21).** `apps/web` had zero eslint config (no devDependency
  even installed) — added eslint.config.mjs (backend shape + React-hooks/refresh plugins), `.prettierrc`
  matching core-api's, format scripts. `auth-service` had zero Hexagonal layer-boundary lint — added,
  reading real imports first rather than copying core-api verbatim (it legitimately allows
  `@/common/**` from domain and `@/container/repos` from application — both verified real, not gaps).
  Both rule sets verified to actually fire (violation injected + confirmed rejected + reverted), not
  just pass on clean code. **`turbo run typecheck lint format:check test` is now 33/33 green across the
  WHOLE monorepo, including apps/web** — no open gaps left from either lint round.
- **Phase 5b — AI-Query Saga LANDED (2026-08-22, committed 2026-08-24 `2bd5793`).** Đây là feature work thật đầu tiên
  sau ba round governance liên tiếp, và là mảnh nối hai nửa đã xây xong: credit ledger (5a) và
  RAG/hybrid search (Phase 4) trước đó **hoàn toàn không biết đến nhau**. `POST /api/v1/ai/ask`
  (core-api) giờ chạy saga thứ 2 của hệ thống: reserve credit → gRPC sang search-service → commit +
  lưu `AiQuery` + emit `CreditSpent`, cả 3 trong một transaction. Dây `credit-events` (khai báo từ
  Phase 5a, không ai emit/subscribe suốt ~2 tháng) **đã sống**: `CreditAwarded` từ grant,
  `CreditSpent` từ commit, `CreditReservationReleased` từ compensation → notification-service tiêu thụ.
  - **Two-phase reserve thật, không phải spend-rồi-refund** (owner chọn): `CreditReserved` giữ tiền
    mà không đổi balance, `CreditReservationCommitted` mới trừ, `CreditReservationReleased` không
    hoàn gì vì chưa từng trừ. Ví giờ có 2 con số — `balance` và `available = balance − Σ(OPEN)` — và
    `available` là cái mọi kiểm tra so vào, **kể cả `POST /credits/spend`**.
  - **Review plan trước khi code tìm ra 4 lỗi chặn + 8 gap**, ghi trong `.ai/memory/gotchas.jsonl`
    (dòng này từng trỏ vào `.ai/plans/phase5b-ai-query-saga.plan.md` §Amendments — **section đó chưa
    bao giờ tồn tại**; plan file là bản DRAFT viết TRƯỚC review, các phát hiện sau đó chỉ vào memory.
    Sửa 2026-08-24). Nặng nhất: (1) `POST /search` vẫn cho
    `summarize:true` miễn phí → hai cửa vào cùng một RAG, một tính tiền một không → đã gỡ
    `summarize` khỏi HTTP public; (2) bảng `notifications` NOT NULL toàn cột knowledge-item, không
    chứa nổi notification AI → migration nullable + `metadata Json?`; (3) không chỗ nào ghi
    `AiQuery.status='FAILED'` dù smoke test assert nó; (4) `spend()` vẫn so với `balance` → user tiêu
    được đúng phần một AI query đang giữ.
  - **`InsufficientCreditsError` 409 → 402** (docs/06 vốn đã hứa 402 từ đầu; 409 trùng nghĩa với
    `OCC_CONFLICT`). Ảnh hưởng cả `/credits/spend` — chấp nhận có chủ ý.
  - **Contract mang enum `RagOutcome` chứ không `bool degraded`**: search-service degrade thay vì
    throw, nên `summary: null` có hai nguyên nhân khác hẳn — AI chết (503 + compensation) vs knowledge
    base rỗng (200, không tính tiền). Bool sẽ gộp chúng làm một.
  - **`ExpiredReservationSweeperService`** (owner chọn): reaper chỉ retry compensation **đã ghi
    xuống**; saga chết trước lúc ghi để lại hold OPEN mà không ai nhớ — `balance` vẫn đúng nhưng
    `available` mất vĩnh viễn. Sweeper quét theo TTL và dispatch release (vốn đã idempotent).
  - **search-service mọc gRPC server đầu tiên** (trước đó chỉ là client). Token bucket per (org,user)
    ở **Postgres** — nơi duy nhất trong repo có rate-limit thật sự multi-instance.
  - `turbo run typecheck lint format:check test` **33/33 xanh**; core-api 57 suites/184 tests,
    search-service 13/59, notification-service 12/35, `check:arch` xanh.
- **`db:push` + smoke test Phase 5b — DONE 2026-08-24, PASS 5/5.** `db:push` áp dụng cả `core_db` (2
  bảng mới + index) và `notification_db` (4 cột nullable + `metadata`) lên Postgres thật. Boot cả 3
  service thật trên Postgres/Kafka/Elasticsearch/Ollama (docker-compose) + Gemini key thật (search-
  service `.env.secrets` dùng Gemini, không phải Claude — `SUMMARIZER_PROVIDER=gemini` trong root
  `.env`), JWT craft bằng openssl theo khuôn smoke-test-core-api-harness. Cả 5 luồng đúng thiết kế:
  ANSWERED (citation thật từ Gemini), NO_RESULTS (200 answer:null, không notification), AI_UNAVAILABLE
  (phá key tạm → 503 + fallbackChunks + `available` phục hồi đúng), idempotency (2 lần cùng key →
  không thêm event), sweeper (chèn reservation cũ 10 phút qua SQL, giả lập saga chết giữa chừng →
  `available` mất ngay lập tức, tự phục hồi sau ≤60s với reason EXPIRED). Gotcha phát sinh: Kafka
  không auto-create topic đủ nhanh, cả 2 service Kafka-consumer crash lúc boot cho tới khi topic được
  tạo thủ công trước — ghi vào `.ai/memory/gotchas.jsonl`. Toàn bộ seed data đã dọn sạch sau test.
- **Port-placement audit — Hexagonal, 2026-08-24 (committed `7723979`).** Owner nhớ đúng một rule đã có sẵn
  (`resilience_patterns.md` §6.1, sinh ra từ lần `IIdempotencyRepository` bị revert) và hỏi vì sao
  `infrastructure/outbox/` vẫn chứa cả interface lẫn implement. Quét toàn repo: chỉ core-api dính, và
  dính theo **cả hai chiều ngược nhau**.
  - **Thừa interface (cả 2 đầu đều infra):** `IOutboxDispatchRepository` (4 consumer —
    PollingPublisher/Reaper/Cleanup/MetricsReporter) và `ISagaCompensationDispatchRepository`
    (2 consumer — reaper/cleanup) bị xoá cùng 2 `Symbol` token; consumer inject thẳng
    `PrismaOutboxRepository`/`PrismaSagaCompensationRepository`. `ISagaCompensationStore`
    (shared-kernel, `CommandBus` tiêu thụ) giữ nguyên — đó là port thật.
  - **Port thật nhưng đặt sai chỗ:** `IOutboxAppender` (6 command handler gọi `tx.outbox.append`)
    chuyển `infrastructure/outbox/` → `common/outbox/outbox-appender.ts`. Bằng chứng nó sai chỗ
    không phải cảm tính: `common/database/core-api-repos.ts` phải import `@/infrastructure/**` và
    được cấp một eslint exception mô tả sai chính nó ("domain repository interfaces, no framework
    type") — exception giờ đúng như lời nó nói.
  - **Thiếu port hoàn toàn (chiều ngược lại, phát hiện thêm):** `AskAiHandler` và
    `ProvisionOrgHandler` inject **class infra cụ thể** `RagQueryClient`/`AuthProvisioningClient`.
    Thêm `IRagQueryService` (`modules/credit/domain/services/`) + `IAuthProvisioningService`
    (`modules/platform-admin/domain/services/`), 2 client `implements` chúng, `GrpcModule` chỉ export
    qua token. Lint không bắt được vì group của application layer chỉ liệt kê
    `@/infrastructure/database/**` + `@/infrastructure/http/**`.
  - **Ràng buộc viết lại + có control:** §6.1 bỏ hẳn vế "logic đủ khó thì đáng port-ify" — chính vế
    đó bảo kê 2 interface vi phạm, vì `FOR UPDATE SKIP LOCKED` là thứ duy nhất nó áp dụng vào. Rule
    mới quyết định bằng **vị trí consumer**, 2 bước. Enforce: `check-repo-placement.cjs` **check F**
    (port khai báo trong `infrastructure/` → fail; verified bằng 3 probe: interface+token → fail,
    interface+implements → fail, data shape thuần → im lặng) và eslint application group đảo thành
    `@/infrastructure/**` trừ `cqrs` (đóng mặc định thay vì mở mặc định).
  - **Cùng lỗ hổng đó có ở notification-service + search-service** (y hệt allowlist 2 dòng), đã bịt
    luôn — auth-service vốn đã làm đúng kiểu này từ 2026-08-21. Bỏ luôn lời hứa miễn trừ
    `@/infrastructure/kafka` trong message cũ: không file application nào từng import nó (consumer
    Kafka nằm ở `infrastructure/consumers/`), giữ lại chỉ là để hở sẵn một cửa.
  - Cả 2 control đều **verified bằng cách bơm vi phạm rồi revert**, không chỉ pass trên code sạch:
    eslint bắt `@/infrastructure/grpc/...` trong `ask-ai.handler.ts` (core-api) và
    `@/infrastructure/kafka/...` trong `search-knowledge.service.ts` (search-service), đồng thời vẫn
    im lặng với `@/infrastructure/cqrs`. `docs/adr/0001` **không sửa** (frozen historical record) dù
    §304/§306 của nó còn nhắc `IOutboxDispatchRepository`.
- **Follow-on: gRPC server đặt sai tầng (2026-08-24, cùng ngày, owner phát hiện).** Ngay sau audit
  port ở trên, owner hỏi vì sao `rag-query.grpc-service.ts` vẫn nằm trong
  `modules/search/infrastructure/grpc/`. Đúng — và audit trước của tôi **không** bắt được vì nó chỉ
  quét *interface khai báo trong infrastructure*, không quét *vị trí của adapter*. Bằng chứng nó sai
  chỗ: (1) gRPC **client** của chính search-service nằm ở `src/infrastructure/grpc/` → một transport
  bị xẻ làm hai nhà; (2) `bootstrap/grpc.ts` (wiring cấp service) phải với vào trong `modules/` để
  lấy nó, trong khi bootstrap của core-api thì không; (3) canonical tree của
  `folder_structure_sop.md` cho `modules/*/infrastructure/` là **danh sách đóng** — mappers,
  consumers, services, repositories — `grpc/` không có trong đó; (4) core-api đã có sẵn precedent
  (server + client chung `infrastructure/grpc/`). Đã chuyển sang
  `src/infrastructure/grpc/rag-query.grpc-service.ts`; `search.module.ts` vẫn là nơi provide (
  search-service không có `GrpcModule` riêng, và module này vốn đã provide client/caller/guards từ
  `@/infrastructure/**`). Thêm 1 dòng anti-pattern vào `folder_structure_sop.md` — có nêu rõ
  `consumers/` là ngoại lệ **có chủ đích**, không phải quên.
  - **Quét cả họ thay vì sửa đúng 1 file:** `find apps/*/src/modules -type d -path '*/infrastructure/*'`
    rồi đếm tên thư mục → lộ thêm 2 sai lệch nữa, đều ở auth-service: `mapper/` (số ít) ở 3 module
    trong khi canonical tree là `mappers/`, và `jobs/` (OrphanedProvisionedUserWatcher) không có
    trong danh sách đóng → đổi thành `services/`, khớp precedent của core-api
    (`ExpiredReservationSweeperService` nằm ở `modules/credit/infrastructure/services/`).
  - **check G** (owner yêu cầu ngay sau đó): allowlist 4 tên thư mục dưới `modules/<x>/infrastructure/`,
    duyệt trên **directory** chứ không trên file. Verified bằng 2 probe (bơm lại `grpc/`, bơm `mapper/`
    số ít) + xác nhận im lặng trên cây sạch. `check:arch` giờ có A–G.
- **gRPC wiring: 3 service 3 kiểu → `@Global` + AppModule (2026-08-24, owner hỏi "sao không import
  trong AppModule luôn mà rải rác thế").** Không có lý do gì cả, là drift — và nó có lỗi thật, không
  chỉ bất nhất. `GrpcModule` của core-api chứa **cả hai vai**: client (`AuthProvisioningClient`,
  `RagQueryClient`) và **server** (`MembershipVerificationGrpcService` + `GrpcServerBootstrap`, do
  `main.ts` gọi qua `app.get()`). `AppModule` không import nó — nó vào được injector graph **chỉ vì**
  `CreditModule` + `PlatformAdminModule` import để lấy client. Bỏ AI-Query saga và platform-admin
  provisioning đi thì core-api chết lúc boot ở `app.get(GrpcServerBootstrap)`, không có gì chỉ ra
  nguyên nhân. Nó cũng là module infra **cấp service duy nhất** vắng mặt trong AppModule của core-api
  (Cqrs/Prisma/PrismaTxRunner/ScheduledJobs/SagaCompensation/HttpIdempotency/Kafka/Messaging/Outbox
  đều có). search-service còn mỏng hơn: server sống nhờ `providers` array của `SearchModule`.
  - Đã sửa cả 3: `GrpcModule` `@Global` + import 1 lần ở AppModule; feature module bỏ import/bỏ liệt
    kê. search-service + notification-service được tạo `GrpcModule` mới (trước đó không có).
    search-service's GrpcModule **import SearchModule** để lấy `SearchKnowledgeService` —
    infra-module import feature-module là hợp lệ: module graph của Nest là wiring chứ không phải
    layer graph, và driving adapter thì phụ thuộc vào application service nó drive (hướng vào trong).
    Không cycle vì SearchModule không import ngược (GrpcModule global).
  - **Lưu ý cơ chế Nest:** AppModule import một module KHÔNG làm feature module thấy được export của
    nó — muốn feature module bỏ import thì phải `@Global`, đúng đường repo đã đi cho mọi module infra
    khác.
  - **typecheck/lint/test KHÔNG bắt được lỗi DI** (chỉ nổ lúc boot) → viết probe tạm
    (`NestFactory.create(AppModule)` trong 1 spec) chạy cho cả 3 service: resolve sạch. Probe được
    **chứng minh là có tác dụng** bằng cách gỡ `GrpcModule` khỏi AppModule của search-service → báo
    đúng `Nest can't resolve dependencies of the RemoteOrgMembershipGuard ... MembershipVerificationClient
    at index [0]`. Xoá probe sau khi xong: nó boot app thật nên phụ thuộc env/infra, không làm gate
    mặc định được. **Đây là khoảng trống còn để ngỏ** — chưa có control nào chặn DI-wiring regression.
- **Thanh tra ranh giới shared-kernel + rule đặt abstraction (2026-08-24, owner hỏi vì sao
  `ISagaCompensationStore` ở shared-kernel mà `IOutboxAppender` ở `core-api/common`).** Lý do thật của
  `ISagaCompensationStore` **không phải** "service nào cũng dùng" mà là **`CommandBus` của
  shared-kernel inject nó** — không có thì shared-kernel không compile. Còn outbox: core-api là service
  **duy nhất** có bảng `OutboxEvent` và **duy nhất** publish domain event (notification/search chỉ
  dùng producer thô cho DLQ replay), nên `IOutboxAppender` ở `common/` là đúng.
  - **Rule mới — 3 lý do cho shared-kernel, phải thoả đúng một:** (A) chính code shared-kernel import
    nó; (B) ≥2 service độc lập đã tiêu thụ **và** độc lập framework (precedent `CircuitBreaker`);
    (C) là **wire contract được publish** (proto type, event payload definition, routing map) — **số
    consumer không liên quan**, vì mục đích là consumer không bao giờ phải import từ service của
    producer. Trượt cả 3 → xuống `common/` của service sở hữu. Cộng **kind test**: shared-kernel không
    runtime-import kafkajs/NestJS/Fastify/Prisma/Redis → một framework binding bị trùng lặp giữa các
    service **không** được promote dù giống hệt nhau.
  - **Kết quả thanh tra** (dựng import graph thật, loại barrel `index.ts` vì re-export không phải
    dependency, và **strip comment** trước khi đếm — bản đầu đếm cả tên trong comment nên cho kết luận
    sai): 28 file thuộc A, 14 thuộc B, 12 thuộc C, **đúng 1 file không có lý do** —
    `messaging/interfaces/message-publisher.interface.ts`, consumer **và** implementer đều là core-api
    → chuyển về `core-api/src/common/messaging/`.
  - **check H** (mới): shared-kernel không được runtime-import kafkajs/@nestjs/fastify/@prisma/ioredis,
    và không `@grpc/grpc-js` ngoài `src/grpc/**`. Verified 3 probe (runtime grpc-js trong file
    hand-written → fail; runtime kafkajs → fail; `import type` → im lặng).
  - ⚠️ **Một khẳng định sai của tôi bị chính probe này lật:** tôi đã tuyên bố "shared-kernel không bao
    giờ giữ kết nối sống, `@grpc/grpc-js` chỉ là `import type`" — sai, 3 file ts-proto sinh ra
    runtime-import thật và export cả client constructor. Tôi đã `grep -v` loại trừ đúng 3 file đó rồi
    kết luận từ sự vắng mặt của chúng, và đã dùng kết luận sai đó làm lý do cho một quyết định kiến
    trúc. Directive giờ ghi đúng thực tế đo được, kèm cảnh báo.
  - **Nợ đã ghi nhận (không phải tai nạn):** `MembershipVerificationClient` + `*GrpcCaller` **giống
    nhau từng byte trừ comment** ở notification-service và search-service. Phần lõi độc lập framework
    và có 2 consumer thật → **reason B áp dụng được** nếu tách lõi lên shared-kernel, mỗi service giữ
    vỏ `@Injectable()` mỏng + breaker riêng. Chưa làm, đã ghi vào directive.
- **Ba món nợ đóng hết + một lỗ hổng tracing phát hiện kèm (2026-08-24).**
  - **`.gitattributes` cho submodule.** `apps/*` là repo riêng nên **không kế thừa** `.gitattributes`
    của repo cha — đó là nguyên nhân gốc vụ CRLF→LF biến sửa 12 dòng thành diff 363 dòng. Đã thêm file
    vào cả 5 submodule; **chỉ thêm file, KHÔNG chạy `git add --renormalize`** (đo lại bằng
    `git diff --numstat`: không file nào bị renormalize). Bước renormalize phải là **commit riêng**,
    làm sau khi commit xong việc đang dở.
  - **`MembershipVerifier` lên shared-kernel.** Hai bản `MembershipVerificationClient` ở
    notification-service và search-service giống nhau **từng byte trừ comment** → reason B. Lõi
    framework-free giờ ở `shared-kernel/src/grpc/membership-verifier.ts` (runtime `@grpc/grpc-js`
    hợp lệ trong `src/grpc/**` theo check H), nhận `BreakerCall` từ ngoài vào để **mỗi service giữ
    breaker riêng** (hai service dùng chung một breaker sẽ làm nhau mở circuit). Mỗi service còn
    39 dòng vỏ `@Injectable()` thay vì 65.
  - **DI-wiring gate — control thật, không cần infra.** `app-module-graph.spec.ts` ở cả 3 NestJS
    service, dùng `NestFactory.create(AppModule, { preview: true })`: dựng **đủ** dependency graph
    nhưng **không** instantiate provider và **không** chạy `onModuleInit` → không cần
    Postgres/Kafka/ES, chạy trong `npm test` bình thường. Verified 2 chiều trên notification-service
    (gỡ `GrpcModule` → FAIL đúng tên guard; khôi phục → PASS). ⚠️ env validation **vẫn** chạy trong
    preview mode, nên spec phân biệt lỗi env (warn + return) với lỗi wiring (throw) — nếu không sẽ
    fail nhầm ở môi trường không có `.env`.
  - **Lỗ hổng tracing tìm được khi tách client** (feature `correlation-id` vốn ghi là đã xong): trong
    3 chặng gRPC, chỉ **1** chặng propagate đủ. `core-api → search-service` (RagQuery): client attach
    nhưng **server không đọc** → trace chết ngay biên, ở đúng chặng duy nhất có tính tiền.
    `notification/search → core-api` (Membership): **không** attach và **không** đọc. Đã vá cả 3 chỗ
    theo khuôn `AuthProvisioningGrpcService`. Chính sự trùng lặp là thứ giấu nó: hai bản client giống
    hệt nhau nên **cùng thiếu** traceparent. `resilience_patterns.md` §7 liệt kê đích danh "4 RECEIVE /
    2 SEND points" — danh sách đó **không sai về cái đang tồn tại, nó sai vì thiếu**, và chỗ thiếu
    chính là bug: có 3 gRPC endpoint mà chỉ 1 xuất hiện trong danh sách RECEIVE. Đã thay bằng bảng đầy
    đủ (**8 RECEIVE / 4 SEND**) kèm chỉ dẫn **regenerate bằng `grep -rl startTraceContext` /
    `grep -rl getCurrentTraceparent`** thay vì tin trí nhớ.
  - **Đổi tên theo vai trò + tách bạch "hai outbox" (owner yêu cầu).** `IOutboxAppender` →
    **`IOutboxWriter`** (`common/outbox/outbox-writer.ts`), adapter → `PrismaOutboxWriter`. Lý do: tên
    không nên hàn chết vào method duy nhất hiện có; interface vẫn **cố tình hẹp** (handler không được
    với tới `claim`/`mark`/`reap` — đó là thứ đóng lỗ dual-write bằng kiểu dữ liệu). **Không** đặt
    `IOutboxRepository` vì `naming_conventions.md` §4 dành hậu tố đó cho entity repository có mapper,
    và nếu port dispatch quay lại thì chính nó mới xứng tên đó. Bảng đối chiếu 2 interface (vị trí,
    adapter, consumer, trong/ngoài transaction) đã ghi vào `folder_structure_sop.md`.
- **Outbox trở thành capability của shared-kernel (2026-08-24, owner đề xuất — và đúng).** Lập luận
  của owner không phải "service nào cũng dùng" (sai) mà là **"service nào có dùng thì cũng dùng y hệt
  một kiểu, sao không cho thành hạ tầng shared rồi inject"** — cái này đúng, và tôi đã phản bác nhầm
  vế đầu. Tách làm 3:
  - **Contract** → `shared-kernel/src/outbox/outbox.ports.ts`: `IOutboxWriter` (bên ghi, 1 method,
    trong transaction) + `IOutboxStore` (bên dispatch: `claim`/`markProcessed`/`markFailed`, **chỉ 3
    cái đó**) + `OutboxAppendInput`/`ClaimedOutboxEvent`.
  - **Engine** → `outbox-publisher.ts`: `OutboxPublisher`, vòng lặp thuần (claim → map CloudEvent →
    publish → mark → quyết định DLQ), không scheduler / không DI decorator / không prom-client, đúng
    khuôn `ResilientEventConsumer`, nhận options object + hook `onDeadLetter`. **7 unit test mới.**
  - **Adapter ở lại core-api**: `PrismaOutboxWriter`/`PrismaOutboxRepository` (`FOR UPDATE SKIP
    LOCKED`), model Prisma, tick `@Interval` + re-entrancy guard, counter, `sourcePrefix`.
    `PollingPublisherService` từ ~130 dòng còn ~75 dòng wiring. Adopt outbox ở service mới giờ =
    model + adapter + scheduler gọi `pollOnce()`, **không copy vòng lặp**.
  - ⚠️ **Hai lần dịch chuyển trong cùng một ngày, và đó là rule đang chạy đúng chứ không phải thrash:**
    `IMessagePublisher` shared-kernel → core-api/common (sáng: không file shared-kernel nào import,
    core-api là consumer + implementer duy nhất) → **quay lại shared-kernel** (chiều: `OutboxPublisher`
    inject nó = **reason A**). Y hệt, `IOutboxDispatchRepository` bị xoá buổi sáng (4 consumer đều là
    infra core-api) rồi **sống lại buổi chiều** dưới tên `IOutboxStore` (consumer giờ ở package khác).
    **Rule không đổi — "consumer ở đâu" — consumer mới là thứ đổi.** Đã ghi cả hai chuyện vào comment
    của chính file để người sau không "dọn dẹp" ngược lại.
  - **Không** đưa `reapStaleInflight`/`countByStatus`/`purgeProcessed` vào `IOutboxStore`: caller của
    chúng vẫn là infra của core-api và mỗi cái là một dòng delegation. Port mang thứ **băng qua biên**,
    không mang "tất cả những gì class làm được".
- **`credit.errors.ts` — hoá ra là RULE sai, không phải code sai (2026-08-24, owner hỏi "sao lỗi lại
  nằm đây").** `naming_conventions.md` §6 bắt **mọi** error class phải ở `common/errors/`, và ghi
  chính file này là *"known exception, NOT yet fixed — wrong on two counts: plural, và sai vị trí"*.
  Kiểm tra ra: **nửa "sai vị trí" là chẩn đoán sai.** `credit-account.aggregate.ts` — một **domain
  aggregate** — throw `InsufficientCreditsError`/`ReservationNotOpenError`/`CreditConcurrencyError`,
  mà eslint **cấm `modules/*/domain/**` import `@/common/**``. Làm theo directive thì aggregate không
  import nổi error của chính nó. credit là module **duy nhất** có domain nem error → là chỗ duy nhất
  mâu thuẫn lộ ra, và nó bị ghi lại thành "cẩu thả chưa sửa".
  - **Rule viết lại:** vị trí file error quyết định bởi **ai throw nó** — domain class throw →
    `modules/<x>/domain/<x>.error.ts`; application/presentation/infra cấp service throw →
    `common/errors/<x>.error.ts`. Tên file **luôn số ít**.
  - Đã đổi `credit.errors.ts` → `credit.error.ts` (nửa "plural" của ghi chú cũ là đúng), **giữ nguyên
    vị trí `domain/`**.
  - **`folder_structure_sop.md` liệt kê `DomainError` trong danh sách base class — class đó chưa bao
    giờ tồn tại.** Thật ra chỉ có `AppError`, `ApplicationError`, `InfrastructureError`,
    `UnreachableError`, `ResponseFormatError`. Mọi error đều extends `ApplicationError` vì
    `GlobalExceptionFilter` chỉ map đúng loại đó sang status code. Đã sửa.
  - **check I** (mới): file `*.error.ts` phải số ít **và** phải nằm ở `common/errors/` hoặc
    `modules/*/domain/`. Verified 2 chiều.
  - 🔴 **Bài học đắt nhất, ghi vào memory:** *khi đúng MỘT file "vi phạm" một rule, kiểm tra rule
    trước khi sửa file.* Một ghi chú `known exception, NOT yet fixed` mà chỉ có **đúng một** ví dụ
    thường là dấu hiệu rule sai chứ không phải code sai — y hệt vụ `folder_structure_sop.md` vs
    `cqrs_pattern.md` mâu thuẫn ~6 tuần hồi 2026-07.
- **Error class quy về một mối — `common/errors/` bị xoá khỏi toàn repo (2026-08-24, owner chốt).**
  Trước đó cùng một loại artefact nằm ở hai chỗ tuỳ service: core-api cấm `domain → @/common/**` nên
  credit phải để error trong `domain/`, auth-service cho phép nên 3 file error nằm ở `common/errors/`.
  - **Luật mới, không ngoại lệ:** `modules/<module>/domain/<module>.error.ts` — mỗi module đúng **một**
    file, tên trùng tên module, số ít. Đã gom **8 file** (core-api 4, auth-service 3,
    notification-service 1), **xoá sạch `common/errors/`**, sửa **89 file import** (cùng module domain
    → relative; còn lại → alias).
  - **Siết eslint auth-service** thêm `'@/common/**'` vào ban-list của domain → **cả 4 service giờ
    giống hệt nhau**. `check:arch` check D đọc chính file config đó nên tự động enforce, kể cả đường
    vòng relative mà eslint không thấy.
  - **check I** đổi từ "1 trong 2 chỗ" thành **"đúng 1 chỗ + tên file phải trùng tên module"** —
    verified 2 chiều.
  - ⚠️ **Sửa lại một kết luận sai của tôi:** tôi đã nói auth-service **"bị buộc"** phải để error ở
    `common/` vì `auth.error` được domain của 2 module dùng. Đúng ở cấp **file**, sai ở cấp **class** —
    đo lại từng class thì **không class nào** bị throw bởi domain của 2 module, tách sạch hoàn toàn.
    Bài học ghi vào memory: khi kết luận "không tách được", kiểm tra xem đang đo ở cấp file hay cấp
    symbol; cấp file gần như luôn cho kết quả bi quan hơn thực tế.
  - **Class thuộc module nào đi theo NGƯỜI THROW, không theo tên class**: `AuthMethodNotFoundError`
    mang chữ "auth" nhưng `user.entity.ts` throw nó → nằm ở `modules/user/domain/user.error.ts`.
  - Plan: `.ai/plans/auth-service-domain-boundary.plan.md` (đã thực hiện, mở rộng ra cả 3 service).
- **Current focus:** Phase 5c (bounty + reputation) hoặc quay lại
  RAG learning curriculum tuỳ owner chọn.

### Phase map

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | ✅ Done (taxonomy deferred to post-Phase-3) |
| 2 | Event Backbone (Kafka + Outbox) | ✅ Done — 2a outbox/publisher + 2b consumer, smoke-tested |
| 3 | CQRS & Read Model | ⬜ Deferred — schema stays source-of-truth-only until a read path needs it |
| 4 | AI Search & Discovery (RAG) | ✅ Code-complete + smoke-tested. ⚠️ 2026-08-22: `POST /search` giờ là retrieval thuần — RAG summary chuyển sang đường trả tiền (5b) |
| 5 | Credit Economy & Saga | 🔄 5a Credit Ledger done + smoke-tested; **5b AI-Query Saga done — smoke-tested + committed 2026-08-24**; 5c bounty+reputation pending (plan v3 sẵn, tiền đề đã được cập nhật 2026-08-25) |
| 6 | Realtime & Workers | 🔄 Started early — notification-service B1 + B2 done |
| 7 | The Great Migration | ⬜ Not started (re-anchored: credit-ledger-service + CDC replay demo) |
| 8 | Production Hardening | ⬜ Not started |

**Built modules:** core-api (`tenant`, `knowledge`, `engagement`, `feed`, `credit`, `platform-admin`,
`outbox`); auth-service (auth JWT RS256 + refresh rotation, system RBAC, user); notification-service
(B1 consumer + B2 fan-out); search-service (semantic + hybrid RRF + RAG summary). Cross-service:
gRPC org-provisioning saga (ts-proto codegen), System-Admin vs Org-Admin split, per-service Kafka ids.

### Live debts (consciously deferred, not forgotten)

- **Saga durability:** superseded 2026-07-30 by `SagaCompensationOutbox` (see "Where we are now"
  above) — this line used to say "in-request only, no saga-state table", which stopped being true
  once that landed. Remaining gap is crash-recovery *before* the first compensation write
  (`.ai/plans/saga-orchestrator-crash-recovery.plan.md`, NOT started, pending scope sign-off) —
  **narrowed 2026-08-22**: for the AI-Query Saga specifically, `ExpiredReservationSweeperService`
  now covers it (a hold abandoned in that window is released on a TTL). The generic problem stands
  for any future saga whose side effect has no equivalent expiry.
- **CloudEvent tracing:** W3C `traceparent` propagation is implemented and committed (`2a6a12c`,
  `c207fed`) — see `directives/resilience_patterns.md` §7. A distinct `causationId` (event-caused-
  event chain) is still unmodeled — add when Phase 5b saga needs it.
- **Outbox reorder:** retry can reorder same-aggregate events (fix = per-key sequencing; not worth it yet).
- **Naming split:** `CORS_ORIGINS` (auth) vs `CORS_ALLOWED_ORIGINS` (3 NestJS services) — known,
  unmerged (touches 4 configs); see `directives/naming_conventions.md`.
- **Test gaps:** `credit` module giờ đã có test thật (aggregate two-phase reserve + parity 2 bản fold + 3 handler mới + saga) — dòng "pending user review" cũ đã hết đúng, nhưng code 5b vẫn chưa được owner đọc lại; no
  e2e/integration tests anywhere yet (sequenced into the final performance/hardening phase).
