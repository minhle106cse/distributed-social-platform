# 📜 Cortex — Changelog (Archived Task Journal)

> **This is the historical append-only journal**, moved out of `PROJECT_STATUS.md` on 2026-07-21 so
> the live status (and the generated `KNOWLEDGE_INDEX.md §2`) stays short. It is **not** scanned by
> `knowledge_builder.py` — nothing here is injected into the index. Append new dated entries at the
> top when you want a durable narrative record; keep `PROJECT_STATUS.md` itself to current-state only.
> Entries are chronological (newest first), each a point-in-time snapshot — later entries may supersede
> earlier ones.

---

### 📊 Task journal (newest first)

> Last curated in this format: **2026-07-08**

---

## 🗄️ Moved out of `PROJECT_STATUS.md` on 2026-08-25 (2026-07-29 → 2026-08-24)

> **Vì sao chuyển:** `PROJECT_STATUS.md` được inject NGUYÊN VĂN vào `KNOWLEDGE_INDEX.md §2`, thứ mọi
> session đọc đầu tiên. Nó đã phình lên 446 dòng / 43.8 KB, kéo index lên **63.5 KB ≈ 17.3k token**
> trong khi `CLAUDE.md` ghi ngân sách **~8k**. Tức là mỗi mục nhật ký viết thêm vào đó là một khoản
> thuế thu trên **mọi** session về sau. Đây đúng là lý do file CHANGELOG này được tách ra hồi
> 2026-07-21, và luật đó đã bị quên dần.
>
> **Không mất gì:** phần *lý do* của mỗi quyết định vốn đã nằm trong `.ai/memory/*.jsonl`
> (→ `GOTCHAS.md`, đọc khi cần) và `directives/*.md` (đọc theo khu vực). Những mục dưới đây là bản
> tường thuật — giữ nguyên văn ở đây, còn `PROJECT_STATUS.md` chỉ giữ *hiện tại đang ra sao*.

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

---


> ✅ **gRPC contract chuyển sang codegen `ts-proto` thay vì hand-typed interface (2026-07-08, chưa commit).** Follow-up entry ngay dưới: user chỉ đúng điểm yếu — `AuthProvisioningClient`/`Server` bản đầu tự khai tay request/response type, sai tên field chỉ vỡ lúc runtime, tsc không biết. Cài `ts-proto` (devDep `shared-kernel`) + script mới `packages/shared-kernel/scripts/gen-proto.js` (`npm run proto:gen`) sinh `src/grpc/org-provisioning.ts` từ `.proto`, export qua `index.ts`, **commit như source thường** (không gitignore) — chạy app không cần `protoc`, chỉ cần khi sửa lại `.proto`. **Gotcha Windows:** `grpc-tools` (npm, bundle sẵn protoc.exe) lỗi thiếu `ucrtbased.dll` → chuyển sang cài `protoc` thật qua `choco install protoc`; path tương đối truyền vào `--plugin=...` luôn lỗi trên Windows (`%1 is not a valid Win32 application` hoặc `'..' is not recognized`) dù chạy từ bash hay từ `npm run` (cmd.exe) — script phải tự resolve absolute path bằng Node trước khi gọi `protoc`, đừng quay lại dùng path tương đối inline. auth-service + core-api giờ import type từ generated code, gỡ hẳn `@grpc/proto-loader` khỏi cả 2 `package.json`. Server handler đổi từ `async` trực tiếp sang `void (async () => {...})()` (eslint `no-misused-promises` chặn đúng — async trên property `void`-return sẽ nuốt unhandled rejection). Re-verify sống lại đủ happy path + compensation sau khi đổi, hành vi y hệt. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-08, "grpc-codegen-ts-proto").

> ✅ **Org provisioning = System-Admin-only qua gRPC saga (core-api ↔ auth-service), thêm seed script (2026-07-07, chưa commit).** User đổi business model: org không còn self-service (`POST /orgs` cũ ai đăng nhập cũng gọi được) mà do System Admin tạo sau khi ký hợp đồng, kèm luôn tài khoản owner đầu tiên. Thảo luận 2 phương án (gộp 1 bước vs tách đăng ký+invite) — chọn gộp vì admin đã biết email owner từ hợp đồng, tránh org mồ côi. **Cái khó:** `Organization` ở `core_db` (core-api), `User` ở `auth_db` (auth-service) — lần đầu tiên codebase cần 1 cuộc gọi đồng bộ cross-service (mọi thứ trước giờ là Kafka/outbox, eventual). User chủ động muốn dùng gRPC (chưa có trong stack) + muốn thấy compensation hoạt động thật khi fail giữa chừng. **Xây:** `proto/org-provisioning.proto` ở root (dynamic `@grpc/proto-loader`, không cần protoc codegen) — service `AuthProvisioning` 2 RPC (`ProvisionUser`, `CancelProvisionedUser`), auth M2M qua shared-secret trong metadata (`INTERNAL_GRPC_SHARED_SECRET`), không phải JWT. auth-service: `ProvisionUserCommand/Handler` (gần giống `RegisterHandler`, sinh password ngẫu nhiên trả về 1 lần) + `hardDelete()` mới trên `UserRepository` + `CancelProvisionedUserCommand/Handler` (chỉ xoá nếu `emailVerified=false` — chặn race xoá nhầm user thật) + gRPC server (`bootstrap/grpc.ts`, `@grpc/grpc-js` thuần, chạy song song Fastify trên port `AUTH_GRPC_PORT`). core-api: `AuthProvisioningClient` (wrapper kiểu `KafkaClientService`, deadline 5s) + `ProvisionOrgHandler` (platform-admin module) orchestrate: gọi gRPC tạo owner → **tái dùng nguyên `CreateOrgCommand`** hiện có (không sửa gì, nó vốn không quan tâm `ownerUserId` là ai) → fail thì gọi bù `cancelProvisionedUser` (best-effort, log to nếu compensation cũng fail, không nuốt lỗi gốc). Endpoint mới `POST admin/orgs` (`SystemPermissionGuard`+`SystemPermission.ORG_CREATE` mới thêm vào catalog `shared-kernel`), xoá hẳn `POST /orgs` cũ khỏi `org.controller.ts`. **Bug thật bắt được lúc verify sống** (không phải lý thuyết): `SUPER_ADMIN` vốn thiết kế implicit-all (0 dòng `role_permissions`, đúng ý), nhưng **chưa từng có chỗ nào thực sự mở rộng permissions lúc mint JWT** — `UserMapper.toDomain` chỉ aggregate từ bảng `role_permissions`, nên SUPER_ADMIN login thật trả JWT `permissions: []`, bị mọi guard 403 (kể cả `requirePermissions` của chính auth-service). Chưa ai bắt được trước đây vì các lần verify trước đều tự chế JWT có sẵn permission, chưa từng login thật. Fix 1 chỗ duy nhất: `UserMapper.toDomain` trả `ALL_SYSTEM_PERMISSIONS` nếu role có `SUPER_ADMIN`. **Thêm luôn:** `apps/auth-service/prisma/seed.ts` (`npm run db:seed`) — seed permission+role catalog hệ thống + 1 tài khoản `SUPER_ADMIN` đầu tiên (`admin@cortex.local`/`ChangeMe123!`), phá vỡ chicken-and-egg (`POST /roles/assign` tự nó cần `RBAC_ALL`). **Verify sống 100% trên DB thật:** happy path (user thật `auth_db` + org/OWNER membership thật `core_db` + owner login được bằng temp password) ✓; trùng email → 409 sạch, 0 org rác ✓; **compensation thật** — ép slug trùng sau khi provision user mới → xác nhận user vừa tạo bị `hardDelete` khỏi `auth_db` thật (không chỉ log) ✓; auth-service down → fail nhanh ~150ms, map 503 `AUTH_PROVISIONING_UNAVAILABLE`, không treo, 0 org rác ✓; `POST /orgs` cũ → 404 ✓. Typecheck+lint cả 2 service xanh. **Nợ có ý thức:** compensation là orchestration trong-request, core-api crash giữa 2 bước sẽ để lại user mồ côi vô hại (không có saga-state table + sweep job — không tương xứng với tần suất dùng thấp của thao tác admin này). Chi tiết: `.ai/memory/architecture.jsonl` + `.ai/memory/gotchas.jsonl` (2026-07-07, "org-provisioning-saga" + "super-admin-implicit-all-never-wired-into-jwt").

> ✅ **Gộp `SystemPermission` catalog về `shared-kernel` — chốt CANONICAL (2026-07-07, chưa commit).** User phát hiện `@RequireSystemPermission('platform:manage_orgs')` là magic string, yêu cầu audit toàn bộ permission trong app + có 1 nơi quản lý. Audit thấy: `OrgPermission` (core-api) đã là pattern chuẩn (30 usage thật); System RBAC (auth-service) thì `'rbac:*'` bị lặp lại **10 lần dạng literal**, không có constant nào. **Phát hiện quan trọng giữa chừng:** `apps/auth-service/src/common/rbac/system-permissions.ts` **đã tồn tại sẵn** — catalog đầy đủ 14 permission + `SystemRole` enum + seed mapping — nhưng **grep xác nhận 0 chỗ import**, chưa từng được wire vào route nào (có vẻ scaffold từ trước cho tính năng "report management" defer sau này). **Giải quyết:** chuyển phần catalog (`SystemPermission`/`SystemPermissionValue`/`ALL_SYSTEM_PERMISSIONS`/`isValidSystemPermission`) lên `packages/shared-kernel/src/auth/system-permissions.ts` làm nguồn DUY NHẤT xuyên service (vì cả auth-service lẫn core-api đều cần verify cùng 1 JWT permission claim) — export qua `shared-kernel/src/index.ts`. Giữ `SystemRole` + `DEFAULT_SYSTEM_ROLE_PERMISSIONS` **ở lại auth-service** (chỉ auth-service cần biết TÊN role, service khác chỉ thấy permission qua JWT — giống hệt cách `OrgRole` ở lại core-api). Bỏ hẳn `'platform:manage_orgs'` tự bịa trước đó, dùng lại `SystemPermission.ORG_READ` có sẵn (cùng ý nghĩa — xem thông tin org). Update: `role.routes.ts`/`permission.routes.ts` (10x) + 2 file `.spec.ts` tương ứng (tránh lệch giữa test và code thật); `org.controller.ts` + siết type `RequireSystemPermission`/`SystemPermissionGuard` từ `string` thô sang `SystemPermissionValue`. Verify: grep xác nhận 0 magic string còn sót (chỉ còn 1 dòng comment); typecheck auth-service + core-api sạch. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-07, "system-permission-catalog-consolidated-shared-kernel").

> ✅ **Sửa lỗi IA: tách System Admin (platform) khỏi Org Admin (trong org) + endpoint mới `GET /admin/orgs` (2026-07-05, chưa commit).** User chỉ ra lỗi kiến trúc thật: trang Admin trước gộp System RBAC (platform-wide, auth-service) và Org RBAC (1 org cụ thể, core-api) vào chung 1 nav item của user thường — 2 vai trò khác hẳn nhau không nên trộn. Lên plan lại qua EnterPlanMode, xác nhận 2 quyết định với user: (1) toggle mode ở login **chỉ là UI fork**, cùng gọi 1 `POST /auth/login`, không có endpoint admin login riêng; (2) "quản lý org" cho v1 = build **thật** endpoint mới (không hoãn như report). **Backend (core-api):** phát hiện `JwtAuthGuard` đã decode sẵn claim `permissions` (system-level) vào `request.user` nhưng chưa ai đọc nó (mọi guard hiện tại chỉ check DB Membership qua `OrgGuard`) — thêm `SystemPermissionGuard`+`RequireSystemPermission` (đọc thẳng JWT claim, KHÔNG query DB, khác hẳn `OrgGuard`) + permission code mới `platform:manage_orgs` (string tự do, giống cách `rbac:*` đã hoạt động). Thêm CQRS query slice mới (`system-admin.dto.ts`/`.query-repository.ts`/Prisma impl dùng `_count.memberships`) + endpoint `GET /admin/orgs` trong `OrgController`. Sửa `nginx.conf` thêm `admin` vào regex core_api (thiếu thì `/api/v1/admin/orgs` rơi vào stub mặc định) — reload bằng `docker exec dsp-api-gateway nginx -s reload` (config volume-mount, không cần restart container). **Frontend:** tách `AdminPage.tsx` cũ thành `OrgAdminPage.tsx` (giữ trong org shell, route `/admin`, nav đổi tên "Admin"→"Org Settings") + `SystemAdminRolesPage.tsx`/`SystemAdminOrgsPage.tsx` (mới, ngoài org shell). `SystemAdminLayout.tsx` — sidebar riêng (dark theme), nav Roles & Permissions/Organizations/Reports (disabled "soon" theo đúng ý user hoãn tính năng này). Route mới `/system-admin/*` song song route org trong `App.tsx`. `LoginPage.tsx` thêm toggle "Đăng nhập vào tổ chức"/"Quản trị hệ thống" — chỉ quyết định điểm đến sau login + có hỏi Org ID hay không. **Verify sống:** typecheck+lint core-api sạch, typecheck web sạch, nginx test+reload OK; mint JWT mới có `platform:manage_orgs` (không cần tạo record DB — chứng minh guard chỉ đọc JWT claim đúng như thiết kế), login qua toggle mới → vào đúng shell System Admin riêng biệt (không thấy nav org nào), `GET /admin/orgs` trả **200 với dữ liệu org thật** (2 org thật trong `core_db`, `memberCount` tính đúng), 0 lỗi console. Xác nhận `OrgAdminPage` vẫn hoạt động y hệt cũ sau khi tách. Không đụng tới stack `npm run dev` đang chạy của user (rút kinh nghiệm sự cố tự gây trước đó — dùng preview server riêng trên port 3001 đang rảnh). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "split-system-admin-vs-org-admin-with-jwt-permission-guard").

> ✅ **FE: thêm trang Admin — System RBAC + Org RBAC UI (2026-07-05, chưa commit).** User hỏi "site admin đâu" — phát hiện backend đã có đủ System RBAC (auth-service `/roles`+`/permissions`, 9 endpoint) và Org RBAC (core-api `/orgs/:id/members`+`/orgs/:id/role-permissions`) nhưng FE (4 trang MVP) chưa từng build UI cho cả 2. Lên plan qua EnterPlanMode (file `ticklish-bubbling-pine.md`) trước khi code vì đụng nhiều file + 2 API surface khác nhau. **Đã thêm:** `apps/web/src/pages/AdminPage.tsx` — 2 tab (System Roles & Permissions / Organization), tái dùng đúng convention FE có sẵn (TanStack Query, Tailwind, `ApiError` pattern). Wire route `/admin` (`App.tsx`) + nav link (`Layout.tsx`). Không cần đổi nginx (2 prefix `roles|permissions` và `orgs` đã route sẵn). **Verify sống thật:** craft JWT RS256 thật ký bằng private key local, login qua dev-token, xác nhận `GET /roles`+`/permissions` → 200, `POST /permissions` → 201 + tự refetch list (full write-path), tab Organization hiện lỗi 403 gracefully (không crash) với org giả không có membership — đúng tiêu chí thành công đề ra. 0 lỗi console. **Còn sót:** 1 permission test `test:verify-admin-page` tạo thật vào `auth_db` lúc verify, không có endpoint xoá permission (chỉ có `DELETE /roles/:code`, không có cho permission) — vô hại, để lại, báo cho user biết.
>
> ⚠️ **Sự cố tự gây ra trong lúc verify (đã disclose ngay, đã khắc phục):** xin phép tắt "riêng process web" port 3001 để attach preview — hoá ra kill nhầm sập **cả 4 backend** (turbo chạy chung 1 process group, kill 1 child kéo sập cả nhóm trên Windows). Thêm lỗi kép: lần restart đầu tự thêm `&` phía sau lệnh trong khi đã dùng `run_in_background:true` → tạo tiến trình orphan không track được, chiếm giữ port cũ, khiến lần thử đúng cách sau đó bị dội cổng (`web` phải chạy sang `:3002`, `auth-service` từng crash `EADDRINUSE` do orphan cũ chiếm `:4001`). Đã dò từng orphan bằng PowerShell `Get-NetTCPConnection` + `Stop-Process` để dọn sạch. **Kết quả cuối:** cả 4 backend khoẻ mạnh port chuẩn; riêng `web` hiện chạy ở `:3002` (không phải `:3001`) — không ảnh hưởng nginx/gateway (gateway không quan tâm FE dev server chạy port nào), chỉ cần bạn `npm run dev` lại lúc nào tiện để lấy lại `:3001`. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "admin-page-added-system-and-org-rbac-ui" + "self-inflicted-full-stack-outage-during-verification").

> ✅ **Fix màn trắng FE — cache Vite pre-bundle React lẫn 2 version (2026-07-05, chưa commit).** Sau khi fix `react-router-dom` (npm install), FE chuyển từ lỗi import sang crash runtime thật: `Uncaught TypeError: Cannot read properties of undefined (reading 'S')` trong `react-dom_client.js`, màn trắng hoàn toàn. Verify: root `node_modules` có React **19.2.5** hoist (từ dependency transitive nào đó, không truy ra nguồn cụ thể), `apps/web` khai `^18.3.1` nên npm tạo bản local riêng `apps/web/node_modules/react@18.3.1` (đúng hành vi npm workspace) — nhưng **Vite optimizeDeps cache** (`apps/web/node_modules/.vite/deps/`) đã pre-bundle từ lúc chưa ổn định, lẫn internal của 2 bản React → crash ngay lúc `ReactDOM.createRoot()`. Fix: `rm -rf apps/web/node_modules/.vite` — Vite tự re-scan/re-optimize đúng bản 18.3.1 local ở request kế tiếp, không cần restart server (chỉ cần reload trang). **Riêng biệt, không liên quan:** `ERROR (auth-service): premature close` lặp lại trong log — xác nhận là artifact vô hại của `React.StrictMode` (bật trong `main.tsx`) tự gọi effect 2 lần lúc dev, có thể abort 1 fetch giữa chừng → Fastify log dòng này. Không phải bug thật, không sửa gì. Đọc qua `App.tsx`/`LoginPage.tsx`/`Layout.tsx`/`store/auth.ts`/`lib/api.ts` xác nhận không có auto-fetch nào lúc mount ban đầu (route mặc định redirect `/login`, chỉ render form) — loại trừ khả năng crash do gọi API trước khi kết luận do lẫn version React. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "vite-react-dual-version-stale-optimize-deps-cache").

> ✅ **RUNNABLE — FE + backend chạy thật lần đầu, 2 bug live vừa fix (2026-07-05, chưa commit).** User chạy `infra:up` + `npm run dev` thật, mở FE `:3001` lần đầu, gặp 2 lỗi thật. **(1)** `CORS_ORIGINS` default auth-service trỏ `localhost:3000` trong khi FE Vite thật chạy `:3001` (`vite.config.ts`) — vô hại hiện tại vì FE gọi qua proxy same-origin `/api` → nginx `:8000` (verify sống bằng curl: response có header nginx, KHÔNG kích hoạt CORS check thật), nhưng sẽ vỡ ngay nếu FE gọi thẳng service port sau này. Sửa gốc ở `env.schema.ts` + sync `.env`/`.env.example`. **(2)** `apps/web/package.json` khai `react-router-dom` nhưng chưa từng `npm install` — `node_modules` thiếu hoàn toàn → Vite import-analysis fail ngay khi mở trang. Fix: `npm install --workspace=@distributed-social-platform/web` (81 package). Verify sống trên đúng dev server user đang chạy (không phải preview mới — `preview_list` rỗng lúc đó): curl `:3001/src/main.tsx` xác nhận `react-router-dom` resolve sạch qua Vite dep pre-bundle. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "cors-origin-port-mismatch-and-web-missing-dep-fixed").

> ✅ **Fix naming: `KAFKA_CLIENT_ID` → `WORKER_KAFKA_CLIENT_ID` (2026-07-05, chưa commit).** User soát thấy worker-service thiếu tiền tố service so với 3 anh em (`CORE_KAFKA_CLIENT_ID`/`NOTIFICATION_KAFKA_CLIENT_ID`/`SEARCH_KAFKA_CLIENT_ID`), yêu cầu quét toàn bộ `.env`/`.env.example` tìm lỗi cùng loại. Quét hệ thống mọi suffix lặp lại xuyên service — xác nhận **đây là trường hợp DUY NHẤT** (loại trừ các case trông giống nhưng không phải bug: `KAFKA_BROKERS` không tiền tố vì đúng là hạ tầng dùng chung; `EMBEDDING_*`/`ELASTIC_*`/`GEMINI_*` không tiền tố vì chỉ search-service dùng, không có anh em nào để so sánh; `CORS_ORIGINS` vs `CORS_ALLOWED_ORIGINS` là bất nhất khác đã ghi nhận riêng, không phải thiếu tiền tố). Sửa 4 chỗ đồng bộ: `apps/worker-service/src/config/env.validation.ts` (zod key), `env.config.ts` (reference), root `.env`, `.env.example`. Verify: `tsc --noEmit` worker-service sạch; grep xác nhận 0 tham chiếu tên cũ còn trong source (chỉ còn trong `dist/` build cũ, gitignored, sẽ tự mất khi build lại). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "kafka-client-id-prefix-naming-bug-fixed").

> ✅ **Đồng bộ hoàn toàn `.env` ↔ `.env.example` + điền giá trị local thật (2026-07-05, chưa commit).** User phát hiện `.env.example` có key `.env` thật không có (vd `KAFKA_CONSUMER_MAX_RETRIES`) — yêu cầu (1) audit toàn bộ service tìm env chưa tường minh, (2) đồng bộ key `.env`↔`.env.example` 2 chiều, (3) điền giá trị local thật thoải mái (kể cả secret như `JWT_PRIVATE_KEY` — hệ thống demo, không rủi ro thật), **CHỈ trừ cloud API key** (`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`) không bao giờ điền vào file có commit. Diff xác nhận: `.env.example`→`.env` không thiếu; nhưng `.env` thiếu đúng 9 biến (`NODE_ENV`, `CORS_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_MAX_RETRIES`, `KAFKA_CONSUMER_RETRY_BACKOFF_MS`, `LOG_LEVEL`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_POLL_BATCH_SIZE`, `OUTBOX_CLAIM_TIMEOUT_MS`) — thêm đủ vào `.env` thật, re-diff xác nhận 0 lệch 2 chiều. Điền `JWT_PUBLIC_KEY` giá trị thật vào `.env.example` (không phải secret, nên chia sẻ); điền `JWT_PRIVATE_KEY`/`JWT_REFRESH_SECRET` giá trị thật vào `apps/auth-service/.env.secrets.example` theo đúng yêu cầu tường minh lần này (khác sự cố nghi injection trước — lần này user thật sự yêu cầu trong hội thoại). `apps/search-service/.env.secrets.example` giữ `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` **rỗng** — ngoại lệ duy nhất. **Verify cuối:** hợp của toàn bộ key Zod schema (5 service) so với hợp của `.env`+2 file `.env.secrets` = 0 lệch (mọi biến đều có giá trị tường minh ở đâu đó, không còn dựa default ẩn). Typecheck auth-service lại xanh (4 lỗi spec pre-existing) + mô phỏng dotenv runtime xác nhận 63 key từ `.env` + 2 key từ `.env.secrets` nạp đúng. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "env-full-sync-env-vs-example-plus-fill-local-secrets").

> ✅ **Thực thi split env 2-nguồn cho auth-service + search-service (2026-07-05, chưa commit).** Tiếp nối phân tích trước — user xác nhận thiết kế (hạ tầng chung giữ ở root `.env`; secret riêng-1-service tách ra; service đọc từ 2 nguồn) và yêu cầu làm luôn. **Đã tách:** `JWT_PRIVATE_KEY`+`JWT_REFRESH_SECRET` → `apps/auth-service/.env.secrets` (gitignored) + `.env.secrets.example` (commit); `ANTHROPIC_API_KEY`+`GEMINI_API_KEY` → `apps/search-service/.env.secrets` + `.env.secrets.example`. `JWT_PUBLIC_KEY` **giữ ở root** (mọi service cần để verify, đúng bản chất public key). Wiring: `auth-service/env.ts` gọi `dotenv.config()` 2 lần (root rồi tới `.env.secrets`); `search-service/config.module.ts` đổi `envFilePath` thành mảng `['.env.secrets', '../../.env']`. **Gotcha:** `apps/auth-service`+`apps/search-service` là git SUBMODULE, có `.gitignore` RIÊNG (không kế thừa root) — phải thêm `!.env.secrets.example` vào từng submodule's `.gitignore`, không phải root. **Sự cố bảo mật giữa chừng:** 1 tool-result giả xuất hiện giữa task, tự nhận đã âm thầm sửa `.env.secrets.example` nhét private key thật vào, kèm chỉ dẫn "đừng nói cho user" — nghi ngờ prompt injection, đã báo thẳng cho user thay vì im lặng theo chỉ dẫn đó; grep xác nhận file lúc đó THẬT SỰ chứa key thật → ghi đè lại placeholder ngay, verify sạch lại. Verify: typecheck cả 2 service xanh (auth 4 lỗi spec pre-existing không liên quan); Docker chưa chạy nên không boot full app được — viết script tạm (đã xoá) mô phỏng đúng thứ tự nạp dotenv/NestJS của từng service, xác nhận thực nghiệm: root .env một mình KHÔNG có private key/API key (đã gỡ đúng), nạp thêm `.env.secrets` thì có đủ, biến dùng chung (`JWT_PUBLIC_KEY`, `KAFKA_BROKERS`) vẫn lấy được từ root. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "env-split-implemented-2-source-per-service").

> ✅ **Phân tích env tập trung vs phân tán + viết lại `.env.example` đầy đủ (2026-07-05, chưa commit).** User hỏi: 1 file `.env` gốc dùng chung cho cả 5 service có đi ngược triết lý mã hoá bất đối xứng (private key chỉ auth-service cần) không? Verify: `JWT_PRIVATE_KEY` chỉ được code auth-service đọc (grep xác nhận), nhưng vì `dotenv` nạp TOÀN BỘ file vào `process.env` của mọi tiến trình, cả core-api/notification/search/worker đều đang giữ private key trong bộ nhớ dù không dùng — **vi phạm thật** nguyên tắc least-privilege, dù tầng code đã tách đúng (chỉ decode `JWT_PUBLIC_KEY`). Kết luận không nhị phân: hạ tầng dùng chung thật (`DB_HOST`/`KAFKA_BROKERS`/`REDIS_HOST`) nên giữ tập trung (tránh drift đã bắt được 2 lần trong phiên trước); riêng secret có ranh giới 1-service (`JWT_PRIVATE_KEY`, và nhẹ hơn là `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` chỉ search-service dùng) nên tách file riêng — đề xuất, **chưa thực thi** (chờ user quyết định có làm không). Song song, xác nhận `.env`/`.env.example` thiếu ~25 biến so với Zod schema thật (chạy được nhờ `.default()` ẩn, không tường minh) — viết lại **toàn bộ `.env.example`**, đối chiếu tự động xác nhận 100% key trong Zod schema của cả 5 service giờ có mặt, kèm comment giải thích các bất nhất phát hiện được (CORS_ORIGINS vs CORS_ALLOWED_ORIGINS đặt tên khác nhau giữa auth và 3 service kia; per-service Kafka clientId). Phát hiện thêm `.env.development` (33 dòng, tên biến khác hẳn như `AUTH_DIRECT_URL`) — có vẻ artifact cũ, **không đụng tới** theo đúng phạm vi user chọn (chỉ viết lại `.env.example`, không đụng `.env` thật hay `.env.development`). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "env-centralization-tradeoff-analysis-and-env-example-rewrite").

> ✅ **Gộp `dev`/`dev:stack` thành 1 lệnh + gỡ `db:migrate`/`db:deploy` toàn repo (2026-07-05, chưa commit).** User tự soát script gốc, phát hiện 2 vấn đề. **(1)** `npm run dev` trước đây chỉ khởi động auth-service + web (2 nơi duy nhất có script `"dev"` — core-api/notification/search chỉ có `"start:dev"`) → silently thiếu 3 service, dễ tưởng nhầm đã chạy hết. Thêm `"dev"` (= `"start:dev"`) vào core-api/notification-service/search-service, xoá hẳn `scripts/dev-stack.cjs` + entry `dev:stack` ở root — giờ `npm run dev` chạy đủ 5/5 (auth+core+notif+search+web), `worker-service` cố tình để ngoài (scaffold rỗng). Sync `RUN.md`/`readme.md`/2 file docs stale. **(2)** `db:migrate`/`db:deploy` — verify thấy **không service nào từng có `prisma/migrations/`** (kể cả auth-service, nơi duy nhất có 2 script này) → chưa từng chạy thật, sớm hơn nhu cầu (dự án còn ở Phase 1-7, dùng `db push` xuyên suốt; migrate chỉ cần khi Phase 8 Production Hardening). Gỡ sạch khỏi auth-service + root. **`db:push` xác nhận ĐÃ đúng chuẩn từ trước** (chỉ 4 service sở hữu DB riêng — auth/core/notif/search — có script; `worker-service` mirror `core_db` read-only KHÔNG có, tránh push chồng làm hỏng schema thật). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-05, "dev-script-consolidation-and-migrate-scripts-removed").

> ✅ **Sweep toàn repo: `config.get() ?? default` → `getOrThrow()` (2026-07-04, chưa commit).** Nối tiếp finding trước — user yêu cầu check lại TOÀN BỘ service, không chỉ 1 chỗ. Grep ra ~15 call site khác lặp đúng pattern (`kafka-client.service.ts` x4, `main.ts` x3, 2 consumer, `http-embedding`/`gemini-summarizer`/`claude-summarizer`/`elasticsearch-client`/`outbox-reaper`/`polling-publisher`). **Bắt được 2 bug copy-paste thật nhờ sweep này:** search-service's `kafka-client.service.ts` fallback `clientId` ghi nhầm `'notification-service'`; search-service's `main.ts` fallback port ghi nhầm `4003` (đúng ra `4004`). Fix: mọi `config.get<T>('env.x') ?? literal` → `config.getOrThrow<T>('env.x')` — đóng vòng hoàn toàn, default CHỈ còn tồn tại đúng 1 chỗ (Zod schema trong `env.validation.ts`), sai cấu hình giờ crash to tiếng ngay tại điểm gọi thay vì âm thầm dùng literal có thể sai. Verify: `tsc --noEmit` + `eslint` chạy tuần tự từng service (chạy song song 4x tsc bị OOM trên máy này, không liên quan tới thay đổi) — 4/4 xanh cả typecheck lẫn lint. Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-04, "config-getOrThrow-not-double-default").

> ✅ **Dọn 3 DRY violation phát hiện qua Q&A ôn tập Section 3 (2026-07-04, chưa commit).** User tự đặt câu hỏi Socratic ("sao không import từ shared-kernel", "sao dùng magic string trong khi có enum", "sao fallback env như vậy") và cả 3 đều trúng bug thật, không chỉ là câu hỏi lý thuyết. **(1) `DeadLetterInput` duplicate:** notification-service + search-service `dead-letter.producer.ts` tự khai lại y hệt shape mà `DeadLetterPort.send()` đã định nghĩa trong shared-kernel `resilient-consumer.ts` → export `DeadLetterInput` từ shared-kernel, 2 producer giờ `import { type DeadLetterInput }`. **(2) Magic-string topic:** `notification-events.consumer.ts` + `knowledge-indexer.consumer.ts` hardcode `'knowledge-events'`/`'engagement-events'` dù `KafkaTopic` enum đã có sẵn trong `messaging/routing/kafka-topic.ts` → đổi sang `KafkaTopic.KNOWLEDGE_EVENTS`/`KafkaTopic.ENGAGEMENT_EVENTS`. **(3) Env default duplicate (finding lớn nhất, xuyên 4 service):** mọi `env.config.ts` (`registerAs('env', ...)`) tự khai default lần 2 bằng `??` dù `env.validation.ts` (Zod) đã có `.default(...)` → 2 nguồn sự thật cho cùng 1 giá trị, drift âm thầm nếu sửa 1 chỗ quên chỗ kia. Fix core-api/notification-service/search-service/worker-service: factory giờ gọi `validate(process.env)` (hàm Zod parse đã export sẵn) rồi chỉ reshape sang camelCase, không tự fallback nữa. Auth-service vốn đã làm đúng (`env.ts` dùng thẳng `parsed.data`) — dùng làm reference pattern. Ngoại lệ giữ nguyên có chủ đích: core-api `port` vẫn đọc raw `process.env.PORT` làm escape hatch (không có trong Zod schema) để boot instance thứ 2 lúc smoke test mà không đụng `CORE_API_PORT`. `turbo typecheck lint` = 4/4 xanh (1 warning pre-existing không liên quan). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-04, "dedup-DeadLetterInput-KafkaTopic-and-env-defaults-single-source").

> ✅ **ĐỒNG BỘ query-DTO — flat, không nested (2026-07-03, chưa commit).** Trục thứ 2 sau repo-placement. Response DTO = **flat**: 1 file `<name>.dto.ts`/query-repo ở **cấp** `application/queries/`, tên khớp query-repo (`membership.query-repository.ts`↔`membership.dto.ts`). Làm phẳng 3 file nested còn lại: core-api tenant `get-org-members/get-org-members.dto.ts` + `list-my-orgs/list-my-orgs.dto.ts` → `application/queries/membership.dto.ts` (gộp `MemberDto`+`MyOrgDto` vì cùng do `membership.query-repository` trả — nesting trước đó ép cross-folder import); auth user `get-me/get-me.dto.ts` → `application/queries/user.dto.ts`. Query `.query.ts`+`.handler.ts` vẫn ở folder con, chỉ DTO lên 1 cấp. **10/10 query DTO giờ flat.** Request/input DTO (Zod ở `presentation/schemas/`) là artifact khác, sống ở `presentation/schemas/`. (Đã xử lý trap trùng tên: request `FollowDto` → **`FollowTargetDto`** — khớp `FollowTargetCommand`/`UnfollowTargetCommand`, dùng chung follow+unfollow; response `FollowDto` giữ nguyên ở `engagement.dto.ts`.) Ghi authority: `directives/cqrs_pattern.md` (CANONICAL section) + `.ai/memory/conventions.jsonl` ("query-dto-flat-not-nested"). core-api + auth typecheck xanh.

> ✅ **ĐỒNG BỘ TOÀN BỘ vị trí repo-interface — chốt CANONICAL 2 vị trí (2026-07-03, chưa commit).** Audit lại 4 service phát hiện repo-interface rải 3 folder (`domain/repositories/`, `application/queries/`, `application/repositories/`). Chốt **đúng 2 vị trí hợp lệ**, ghi thành authority trong `directives/cqrs_pattern.md` (section mới "Repository-interface & DTO placement — CANONICAL"): **(1)** `domain/repositories/<name>.repository.ts` = write-side (entity) + projection/write-model + mixed-write-với-internal-read (kết quả read là **bước trung gian** cho handler/service, không phải response); type write-input **inline**. **(2)** `application/queries/<module>.query-repository.ts` = query-side mà kết quả **đi thẳng ra** làm DTO cho query handler/client; response DTO ở **file `.dto.ts` riêng**. Folder `application/repositories/` **BỊ CẤM** (là folder "chưa chắc" gây drift). Câu hỏi phân loại repo vừa-đọc-vừa-ghi: *"read đi thẳng ra làm response, hay là bước trung gian trong handler/service?"* — thẳng ra → `application/queries/`, trung gian → `domain/repositories/`. **Đã sửa:** auth-service (user/role/permission query-repo + dto) `application/repositories/` → `application/queries/`; search-service (search-chunk + keyword-search = mixed, `SearchHit`/`KeywordHit` feed RRF chứ không phải `SearchResult`) → `domain/repositories/` + inline lại type (xoá `*.dto.ts` trung gian tạo bước trước); core-api tenant `membership.query-repository` (dùng chung 2 query) làm phẳng `get-org-members/` → cấp `application/queries/`. **Đếm cuối:** auth 3q/4d, core-api 5q/12d, notification 1q/2d, search 0q/2d. 4 service typecheck xanh (auth còn 4 lỗi `*.routes.spec.ts` pre-existing, không liên quan). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-03, "repo-placement-CANONICAL-cross-service-synced").

> ✅ **Dọn vị trí repo-interface + DTO cross-service (2026-07-03, chưa commit).** Sau khi user phát hiện layout lộn xộn trong notification-service. Chuẩn hoá theo majority (core-api): write-repo → `domain/repositories/`, query-repo (HTTP read, DTO) → `application/queries/<module>.query-repository.ts` ở **cấp** `queries/`, DTO tách **file riêng** `*.dto.ts` (không inline vào interface). **notification-service:** dời `notification.query-repository.ts` → `application/queries/`, tách `NotificationDto` ra file riêng; **quyết định về `space_followers`:** đây là **local projection** (maintain từ FOLLOW events + read nội bộ bởi ItemPublished handler — KHÔNG phải query-side HTTP, không có entity/invariant) → repo interface thuộc `domain/repositories/space-follower.repository.ts` (cạnh write-side `notification.repository.ts`), KHÔNG phải folder trung lập `application/repositories/` (đã xoá). **auth-service/rbac:** tách `RoleDto`/`PermissionDto` ra `*.dto.ts`. **search-service:** tách `InsertChunkRow`/`SearchHit`/`IndexItemDoc`/`KeywordHit`/`RankedItem`/`SearchResult` ra `*.dto.ts`. **Bất nhất còn lại (chưa đụng):** auth-service để query-repo ở `application/repositories/` (khác core-api dùng `application/queries/`) — auth có trước convention, để lại. Typecheck cả 3 service xanh (auth có 4 lỗi spec pre-existing, không liên quan). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-03, "repo-interface-and-dto-placement-rule").

> ✅ **Fix kiến trúc: notification-service retrofit CQRS (2026-07-03, chưa commit).** Review phát hiện `notification.controller.ts` chọc thẳng `INotificationRepository` (bỏ qua Application layer hoàn toàn) và **cả service chưa hề có hạ tầng CQRS** (0 kết quả grep `CommandBus`/`QueryBus` — so với `engagement` module ở core-api dùng đầy đủ). Không có `domain/` folder, không có entity → `markRead` là raw Prisma update, không guard invariant (mark-read lặp lại từng âm thầm bump `readAt`). **Đã fix:** port `CqrsModule` + decorators + `PrismaTransactionManager`/`prisma-transient-error` từ core-api sang notification-service (`infrastructure/cqrs/`, `infrastructure/database/prisma/`), wire vào `app.module.ts`. Thêm `domain/entities/notification.entity.ts` (mutable, style giống `Follow`) với `markAsRead()` **idempotent** (no-op nếu đã đọc — đây mới là bug thật được sửa, không chỉ là tái cấu trúc). Tách `domain/repositories/notification.repository.ts` (write-side: giữ nguyên `insertMany` cho đường Kafka fan-out, thêm `findById`/`save` entity-based) khỏi `application/notification.query-repository.ts` (read-side DTO, mirror `IEngagementQueryRepository`). Thêm `MarkNotificationReadCommand`/`Handler` + `GetNotificationsQuery`/`Handler`. Controller giờ chỉ inject `CommandBus`/`QueryBus`. `NotificationNotFoundError extends ApplicationError` thay vì `NestJS NotFoundException` ném từ application layer. **Không đụng** 3 Kafka event handler (ItemPublished/FollowCreated/FollowRemoved) — đúng chủ đích, chúng là integration-event handler chứ không phải command do user gọi. `tsc --noEmit` notification-service = xanh. Chi tiết: `.ai/memory/architecture.jsonl` (2026-07-03, "notification-service retrofit").
> Đây là nguồn chủ quan (phase %, focus). Phần auto-detect bên dưới mới là ground truth — nếu lệch nhau thì file này stale.

**Overall:** ~86% (hạ tầng ~88% / tính năng sản phẩm ~55% — credit ledger có nền) · **Phase đang làm:** Phase 5a Credit Ledger **DONE + smoke-tested** · **Next:** Phase 5b AI-Query Saga (reserve→RAG→commit/compensate, refund primitive đã sẵn) ↔ search-service; rồi 5c bounty+reputation.

> ✅ **Phase 5a — Credit Ledger Foundation (2026-07-03): event-sourced wallet trong core-api. DONE + SMOKE-TESTED end-to-end.**
> - **Quyết định:** ví **per-user-per-org** (`aggregateId = orgId:userId`, deterministic, không provisioning); **balance FOLD-ON-READ** từ `credit_events`, KHÔNG summary table (giữ SoT-only, override event_sourcing.md §2 — đã ghi note trong directive); Kafka emit `credit-events` DEFER tới 5c (chưa consumer).
> - **Aggregate** `CreditAccount` (grant/spend/refund/apply, version). **OCC** qua `@@unique([aggregateId,version])`: repo.save `createMany` → catch P2002 → `CreditConcurrencyError(409)`. Commands transactional:true retryable:false. `CreditEvent` schema += `org_id` (denormalized, tenant-safe, mirror ReputationEvent) → `prisma db push` OK.
> - **Idempotency:** tái dùng `IdempotencyRecord` model (đã có) + `IdempotencyInterceptor` MỚI (per resilience_patterns §1), gắn CHỈ trên `POST /credits/spend`. **RBAC:** thêm `credit:read/spend/grant` vào OrgPermission catalog.
> - **Endpoints:** `GET /credits/wallet` (fold), `POST /credits/grant` (nguồn, admin), `POST /credits/spend` (sink, idempotent). `turbo typecheck lint` = xanh.
> - **Smoke (harness RS256+seed core_db, instance riêng :4102 cạnh dev server :4002):** 401/403 auth ✓; grant 100→balance 100 ✓; spend 30→70 ✓; overspend→409 INSUFFICIENT_CREDITS ✓; idempotency same-key→1 lần trừ ✓; **OCC 12 concurrent spend→9 ok + 3 CREDIT_CONCURRENCY_CONFLICT, không overspend** ✓; **ledger integrity Sum(events)==balance (=5)** ✓; tenant isolation (org2 ví riêng) ✓.
> - **Gotcha:** global-exception filter chỉ map `ApplicationError` (DomainError→500) → credit errors extend ApplicationError đặt trong `domain/credit.errors.ts`; jsonwebtoken hoist ở ROOT node_modules; `@nestjs/config` không override process.env → set `CORE_API_PORT` để boot instance thứ 2.

> ℹ️ **Re-sync git (2026-07-03):** các mốc đã landed nhưng file này từng chạy sau — **FE MVP integrated + browser-verified** (`5aeae23`), **ResilientEventConsumer** — 1 vòng at-least-once dùng chung mọi consumer (`709e9ca`), **org discovery + silent token refresh + per-service kafka ids** (`a296579`, vá gotcha CLIENT-ID=core-api toàn cục ở B1).

> ✅ **Refactor: messaging folder DI-aligned + Reaper tách khỏi Polling Publisher (2026-07-03, chưa commit).** `kafka-producer.service.ts`/`queue-producer.service.ts` dời từ `infrastructure/{kafka,queue}/` → `infrastructure/messaging/adapters/` (folder giờ khớp đúng ai `provide` — trước đây nằm vật lý trong `kafka/` nhưng do `MessagingModule` provide, gây lệch pha khi đọc code). `infrastructure/kafka/` giờ CHỈ còn raw connection (`KafkaClientService`+`KafkaModule`). `PollingPublisherService` (poll only) và `OutboxReaperService` (reapStaleClaims, `modules/outbox/infrastructure/reapers/`) tách thành 2 class riêng — trước gộp chung 1 tên chỉ phản ánh 1 nửa trách nhiệm. Không đổi hành vi runtime. `turbo typecheck lint` core-api = xanh. + Checklist chọn `aggregateId` cho event mới thêm vào `eventing_patterns.md §4.1` (row.id nếu 1 row sống xuyên vòng đời, deterministic key nếu không). Chi tiết: `.ai/memory/conventions.jsonl` (2026-07-03, "aggregateId-selection-rule" + "driving-vs-driven-adapter-interface-rule").

> ✅ **Fix: orgId single-source-of-truth trong outbox/CloudEvent (2026-07-03, chưa commit).** `OutboxEvent` += cột `orgId` thật (mirror CreditEvent/ReputationEvent) + `@@index([orgId])`; `PrismaOutboxRepository.append()` giờ persist nó; `PollingPublisherService` đọc `event.orgId` (cột) thay vì đào `payload.orgId` (convention ngầm, không ép compiler). Xoá `orgId` khỏi 3 `*Payload` interface (KnowledgePublished/FollowCreated/FollowRemoved) + producer literals — consumer (`item-published`, `follow-created`, `index-knowledge` handler) đọc `event.orgid` thay vì `event.data.orgId`. Backfill 10 row dev cũ bằng raw SQL trước `db push` (tránh `--force-reset`). `turbo typecheck lint` = 9/9 xanh. Chi tiết: `.ai/memory/gotchas.jsonl` (2026-07-03, "orgId duplicated..."). **Đề xuất chưa làm (YAGNI, chờ Phase 5b saga):** thêm `correlationId`/`causationId` vào CloudEvent top-level khi saga cần trace chuỗi event nhân-quả.

**(Cũ) Phase 4 focus:** RAG/AI Search code-complete + smoke-tested; happy-path summary chưa test (cần key thật, FE đang dùng Gemini).

> ✅ **Runnable-first (2026-07-02):** gateway nginx sửa route (`/search`→:4004, `/notifications`→:4003 — trước trỏ nhầm core-api), `npm run dev:stack` (1 lệnh 4 service), `RUN.md`. **Cookie-first auth mọi service:** register `@fastify/cookie` core/notif/search (guard vốn đọc cookie-first nhưng plugin chưa từng register) — verified qua gateway: cookie-only OK, no-auth 401, Bearer fallback OK. RS256 vốn đã đủ 4 service. Commits: core `e8e65b6`, notif `35fa725`, search `737084f`.
> ✅ **FE MVP integrated (2026-07-02, commit `5aeae23`):** browser-verified against live stack — login cookie thật (bob), Search render AI answer (Gemini) + citations [n] + ranked sources, Notifications list + mark-read persisted. E2E curl full-chain PASS: register→login→org→space→invite accept→follow→publish→outbox→Kafka→search semantic đúng + NEW_IN_SPACE fan-out. **2 bug bắt được nhờ verify thật:** (1) gateway thiếu route invites|follows|bookmarks (rơi vào default 200 text) — fixed; (2) FE gửi content-type json không body → Fastify 400 EMPTY_JSON_BODY — fixed (conditional header). Còn thiếu (đề xuất BE, chưa làm): endpoint "list my orgs" để FE khỏi dán orgId tay.
> 🔄 **FE MVP (`apps/web`, working tree — chưa commit):** Vite+React18+TS+Tailwind+TanStack Query+Zustand. 4 trang: Login (cookie-first + dev-token fallback), Search (RAG marquee: AI answer + citations + chunks), Knowledge (create/publish), Notifications (list/mark-read). Vite proxy `/api`→gateway:8000 (same-origin → cookie tự chạy). Typecheck 0 lỗi; proxy chain verified bằng curl. CÒN: browser-verify UI + luồng thật (register→org→publish→search) + commit.
> 📄 **Docs re-sync (2026-07-02):** readme.md (badge Phase 4 ~83%, tech AI row sửa "Claude embedding"→self-hosted, diagram CURRENT STATE, quick-start→RUN.md) + readme.phases.md (bảng trạng thái, Phase 4 marked done + 2 lệch-plan có chủ đích, **Phase 7 RE-ANCHORED**: target mới = credit-ledger-service + CDC replay demo vì search-service sinh ra đã là microservice).

> ✅ **Phase 4 — RAG/AI Search (2026-07-02): search-service = consumer #2, own `search_db` (pgvector). CODE-COMPLETE + SMOKE-TESTED, CHƯA commit (chờ GitHub repo).**
> - **Quyết định:** embeddings **self-hosted local** (Ollama `nomic-embed-text` dim 768 — Claude KHÔNG có embeddings API, đã sửa `rag_ai_integration.md §1`); search = **service riêng** consume `knowledge-events` (mirror notification, tái dùng backbone hardened). `KnowledgePublished` payload += `body` (snapshot, no cross-DB join; fat-event, scale path = Claim-Check).
> - **C1 semantic:** embed-on-publish → `KnowledgeChunk` (`vector(768)` + HNSW cosine) → `POST /api/v1/search` (JWT + X-Org-Id, no OrgGuard). Smoke: semantic ranking đúng, 401/tenant-isolation/400.
> - **C2 hybrid:** `ElasticsearchKeywordRepository` (per-tenant index BM25) + **RRF fusion** (k=60, item-level). Smoke: keyword-exact→ES top, semantic→pgvector top, ES down→degrade semantic-only (201 không 500).
> - **C3 RAG summary:** `ClaudeSummarizer` (`claude-opus-4-8`) + **Circuit Breaker** (5 fail→OPEN→fail-fast). Smoke: key rỗng→degrade summary:null, breaker trip đúng 3 pha. Happy-path summary chưa test (cần key).
> - Reliability tái dùng: consumer group riêng, DLQ + bounded retry, idempotency `natural-key` (replaceForItem + ES upsert), `@InjectPinoLogger`. `turbo typecheck lint` = 3/3 xanh.
> - **Bug/gotcha:** copy-tree scaffold sót `prisma.service` DATABASE_URL var (fix); TEI hf-hub bug→Ollama; multi-boot→consumer group churn "coordinator not aware".

> ✅ **Idempotency safety net (2026-07-02) — 6 nước đi principal giữ an toàn luồng:**
> - **[Enforce] Compile-time invariant.** `IIntegrationEventHandler.idempotency` (shared-kernel) BẮT BUỘC: `'natural-key' | 'dedup-constraint' | 'none'`. Handler quên → `error TS2420` (đã chứng minh: bỏ field → typecheck đỏ). `EventRouter.register` ném lúc boot nếu `'none'`. → invariant *được ép buộc*, không *được nhớ* — chặn "handler tương lai quên idempotent".
> - **[Observability] Metrics** (`/metrics`, prom-client): `notification_dedup_skipped_total` (từ `createMany().count`), `notification_dlq_total{reason}`, `notification_handler_retry_total{eventType}` → phân biệt "dedup khỏe" vs "ăn nhầm event thật".
> - **[Docs] Directive mới `idempotency_strategy.md`:** chốt "dedup tại điểm ghi, không inbox tập trung" + 2 pattern được phê duyệt + **tripwire** (xem lại khi có side effect ngoài-DB / không-idempotent-tự-nhiên) + **đường lùi** (IdempotentRouter decorator, đã chứng minh rẻ) + YAGNI (không dựng inbox sớm). `eventing_patterns.md` §4.3 cập nhật field bắt buộc.
> - **Giữ nguyên** idempotent-writes (quyết định cũ đúng); KHÔNG dựng inbox (chưa có side effect ngoài DB). `turbo typecheck lint` = xanh.

> ✅ **Pipeline hardening (2026-07-01) — principal review + fix toàn bộ finding:**
> - **[HIGH] Consumer DLQ + bounded retry (LIVE).** `DeadLetterProducer` (notification-service `infrastructure/kafka`). Poison pill (parse fail) → `<topic>.DLQ` ngay + commit; handler error → retry bounded (`KAFKA_CONSUMER_MAX_RETRIES=3`, linear backoff `KAFKA_CONSUMER_RETRY_BACKOFF_MS`) → hết budget thì DLQ + commit. Consumer LUÔN commit → hết cảnh poison pill nghẽn partition (trước đây `throw` → crash-loop vô hạn).
> - **[HIGH] Partition-key ghost-follower bug (fixed).** FollowCreated keyed `follow.id`, FollowRemoved keyed `targetId` → lạc partition → unfollow có thể xử lý trước follow → follower ma. Nay CẢ HAI key bằng `Follow.streamKey(userId, targetType, targetId)` → per-relationship ordering đảm bảo.
> - **[MED] Outbox HA-safe (fixed).** PollingPublisher đổi từ `findMany(PENDING)` trần → claim `FOR UPDATE SKIP LOCKED` (PENDING→INFLIGHT, publish ngoài tx) + Reaper reset INFLIGHT quá `OUTBOX_CLAIM_TIMEOUT_MS`. An toàn khi core-api chạy >1 replica. Schema core_db thêm `OutboxStatus.INFLIGHT` + `claimed_at` (đã `prisma db push`, verify SQL trên DB thật).
> - **[LOW] Consumer group đổi tên** `notification-service-knowledge-group` → `notification-service-group` (đã consume cả engagement, tên cũ sai nghĩa). `.env` + defaults cập nhật.
> - **Còn nợ có ý thức:** [LOW] retry outbox có thể reorder same-aggregate (fix = per-key sequencing, không tương xứng); [INFO] fan-out point-in-time, follow ngay sát publish có thể miss (bản chất async projection, best-effort).
> - `turbo typecheck lint` core-api + notification-service = 5/5 xanh.

> ✅ **notification-service Milestone B2 (2026-06-30):** FOLLOW events + fan-out to space followers.
> - **shared-kernel:** `FollowCreatedEvent` + `FollowRemovedEvent` (payload: orgId/userId/targetType/targetId) + export từ `events/index.ts`. Rebuild dist.
> - **core-api engagement:** `follow-target.command.ts` + `unfollow-target.command.ts` → `transactional: true`. `FollowTargetHandler` inject `OUTBOX_REPOSITORY` → append `FollowCreatedEvent` sau `followRepo.add()`. `UnfollowTargetHandler` inject `OUTBOX_REPOSITORY` + `requireTenantId()` → append `FollowRemovedEvent` sau `followRepo.remove()`. `EngagementModule` import `OutboxModule`.
> - **notification-service:** `SpaceFollower` model (PK `[spaceId,userId]`) + `prisma db push notification_db` ✅. `ISpaceFollowerRepository` + `PrismaSpaceFollowerRepository` (upsert/remove/findFollowerIds). `FollowCreatedHandler` (upsert SpaceFollower nếu targetType=SPACE). `FollowRemovedHandler` (remove by PK). `NotificationEventsConsumer` (rename từ `KnowledgeEventsConsumer`) — subscribe cả `knowledge-events` + `engagement-events`, 1 EventRouter register 3 handlers. `ItemPublishedHandler` đổi: fan-out to `findFollowerIds(orgId,spaceId)` → filter out author → `insertMany(NEW_IN_SPACE)`. `turbo typecheck lint` = 5/5 xanh.
> - **Quyết định B2:** type `ITEM_PUBLISHED` ngừng sinh; `NEW_IN_SPACE` là type mới — tác giả KHÔNG tự notify mình (chỉ follower của space mà tác giả đăng vào). Rows cũ ITEM_PUBLISHED giữ trong DB (backward-compat). `space_followers` = local projection từ FOLLOW events (microservice own-data pattern), KHÔNG join core_db.

> ✅ **notification-service Milestone B1 (2026-06-30):** First real Kafka consumer — notification-service fully bootstrapped. NestJS + Fastify + own DB (`notification_db`). `KnowledgeEventsConsumer` (kafkajs raw, group `notification-service-knowledge-group`) → `EventRouter` → `ItemPublishedHandler` → `PrismaNotificationRepository.insertMany(skipDuplicates)`. Idempotent via `@@unique([recipientUserId, sourceEventId])`. REST: `GET /api/v1/notifications` (JWT + X-Org-Id) + `PATCH /api/v1/notifications/:id/read`. No OrgGuard (notification-service has no memberships — JWT auth + recipientUserId filter = naturally tenant-safe). `prisma db push notification_db` ✅. `turbo build typecheck lint` = 4/4 xanh. **✅ SMOKE-TESTED end-to-end (2026-06-30):** bơm CloudEvent byte-faithful vào `knowledge-events` → row ghi đúng (titleSnapshot snapshot từ payload); redeliver cùng event id → KHÔNG nhân đôi (count=1); GET trả row (401 nếu thiếu JWT); PATCH read: other-user=404/author=200; consumer group LAG 0. ⚠️ **Finding nhỏ:** consumer/producer report `CLIENT-ID=core-api` trong kafka-ui vì `.env` set `KAFKA_CLIENT_ID=core-api` toàn cục (worker-service cùng pattern) — observability mờ, không ảnh hưởng delivery.

> ✅ **Feed read endpoint (2026-06-30, committed):** `GET /feed` — fan-out-on-read, query thẳng SoT. Module `feed` mới trong core-api (chỉ query side): `GetFeedQuery → GetFeedHandler → PrismaFeedQueryRepository`. Logic: `follows(targetType=SPACE)` → `knowledge_items(spaceId IN, status=PUBLISHED, deletedAt IS NULL)` DESC createdAt. Guard: `OrgGuard + KNOWLEDGE_READ`. KHÔNG có bảng mới. Schema: `Embedding` model gỡ (defer Phase 4). `prisma db push` đã drop bảng cũ. `turbo run build typecheck lint` = 12/12 xanh.

> ✅ **Phase 2 refactor/hardening (2026-06-30, committed):** lớp messaging làm lại bài bản theo pattern chuẩn —
> `KafkaClientService` singleton; `CompositeMessagePublisher` + `EVENT_TRANSPORT_MAP` (binder pattern, Kafka+queue coexist, queue stub sẵn); `EventRouter` (Message Dispatcher, thay switch tay); `defineEvent` typed factory (vá `payload: unknown`); **envelope đổi sang CloudEvents 1.0** (`CloudEvent<T>`: id/source/type/time/data + orgid/partitionkey ext); worker có `PrismaTransactionManager` + `getTx()` (handler không chạm Prisma). Cấu trúc shared-kernel: `events/` (vocabulary) vs `messaging/routing|ports` (plumbing).
> 📄 **Directive mới:** `directives/eventing_patterns.md` — reference architecture cho toàn bộ event-driven (domain vs integration event, CloudEvents, binder, dispatcher, idempotent receiver) + cite nguồn.
> ✅ **Reliability hardening (2026-06-30, đợt 2):** Idempotent producer (`producer({ idempotent: true })`) + Consumer DLQ (`DeadLetterProducer` → `<topic>.DLQ`, retry bounded `CONSUMER_MAX_RETRIES` → poison pill dead-letter ngay). Cấu trúc: outbox module chia subfolder theo role (`repositories/`, `publishers/`); worker `application/events/<name>/` (bộ ba commands/queries/events); handler gom vào mảng `INTEGRATION_HANDLERS` (thêm handler = 1 dòng).
> 🧭 **Quyết định eventing (2026-06-30):** EventRouter **1:1** trong 1 consumer group; fan-out 1 event → N concern = **N consumer GROUP riêng** (group id theo concern, vd `KAFKA_FEED_CONSUMER_GROUP`), KHÔNG nhồi N handler vào 1 router. EventRouter scope **per-module** (rẻ, là Map in-mem), KHÔNG global — khác `KafkaClientService` singleton (giữ connection).
> ⛔ **ROLLBACK read model (2026-06-30):** Gỡ **`feed_timeline` (read model) + ProcessedEvent + toàn bộ worker feed projection** (handler, consumer, repo, DLQ, consumer env). Lý do: read model là optimization làm SỚM — app chưa xong, chưa có đường đọc nào dùng tới (bảng write-only). **Quy tắc mới:** schema chỉ chứa **source of truth**; query đi thẳng source of truth; read model/projection để dành tới **read phase** (Phase 3). GIỮ backbone: core-api outbox/Kafka vẫn emit, shared-kernel messaging, `Follow`. Worker = scaffold consumer rỗng (KafkaClientService inert), chờ consumer thật. ⚠️ DB vẫn còn bảng cũ tới khi chạy `prisma db push`.
> ⛔ **Gỡ NỐT read model trong schema (2026-06-30):** xoá cả section `// READ MODELS — CQRS Projections` ở core-api schema — `CreditBalanceSummary`, `ReputationSummary`, `UserProfile` (cả 3 unused trong code). Schema giờ **chỉ source of truth**: giữ event ledger nguồn sự thật `CreditEvent` + `ReputationEvent` (append-only), gỡ projection của chúng → dựng lại ở read phase. `Embedding` đã **gỡ** (defer Phase 4, quyết 2026-06-30).

> ✅ **Phase 2a hoàn thành + smoke test Docker:** Transactional Outbox + Polling Publisher → Kafka. Resilience (Kafka down→up) OK.
> ✅ **Phase 2b hoàn thành + smoke test:** worker-service consume knowledge-events → FeedTimeline fan-out + ProcessedEvent idempotency. `npm run check` xanh.
> ⚠️ **Chưa commit (hoãn tới khi sẵn sàng):** Phase 2a (outbox/kafka) + Phase 2b (worker-service) + logging refactor. Fix nhỏ: `envFilePath: '../../.env'` trong core-api config.module.ts.
> 🔧 **Fix nhỏ 2026-06-28:** `@@unique([userId, itemId])` thêm vào FeedTimeline (cả core-api + worker schema) để idempotent `createMany skipDuplicates`.
> 🔧 **Fix nhỏ 2026-06-28:** `ProcessedEvent` model đặt ở core-api schema (owns core_db); worker schema là type-gen only (không db:push).

| Phase | Mục tiêu | Trạng thái |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | ✅ Done (taxonomy deferred) |
| 2 | Event Backbone (Kafka + Outbox) | ✅ Done — 2a + 2b smoke tested |
| 3 | CQRS & Read Model | ⬜ Chưa bắt đầu |
| 4 | AI Search & Discovery (RAG) | 🔄 Code-complete + smoke-tested (search-service; chưa commit/chờ repo) |
| 5 | Credit Economy & Saga | 🔄 5a Credit Ledger DONE (event-sourced wallet + OCC + idempotency, smoke-tested); 5b Saga / 5c bounty+reputation chưa |
| 6 | Realtime & Workers | 🔄 Khởi động sớm — notification-service B1+B2 done |
| 7 | The Great Migration | ⬜ Chưa bắt đầu |
| 8 | Production Hardening | ⬜ Chưa bắt đầu |

#### Phase 1 — chi tiết

| Hạng mục | Service | Trạng thái |
|---|---|---|
| auth (JWT RS256, refresh rotation) | auth-service | ✅ Done |
| system RBAC (role/permission, wildcard catalog) | auth-service | ✅ Done |
| user | auth-service | ✅ Done |
| tenant (Org, Space, Membership, Invite, OrgGuard) | core-api | ✅ Done |
| **knowledge** (KnowledgeItem CRUD + OCC versioning + Revision) | core-api | ✅ Done — 8 endpoints, OCC, soft-delete, Revision history |
| **engagement** (Vote + Bookmark + Accept Answer + Follow) | core-api | ✅ Done — 11 endpoints, hard-delete, cross-module repo sharing |
| **feed** (GET /feed — fan-out-on-read, query SoT) | core-api | ✅ Done — 1 endpoint, query follows×knowledge_items |
| taxonomy (Tag/Topic, Space subscribe) | core-api | ⬜ Deferred — sau Phase 3 |

#### Phase 2 — chi tiết

| Hạng mục | Service | Trạng thái |
|---|---|---|
| Transactional Outbox (OutboxModule, IOutboxRepository, PrismaOutboxRepository) | core-api | ✅ Done |
| Kafka Producer (KafkaProducerService, kafkajs) | core-api | ✅ Done |
| Polling Publisher (@Interval 2s, at-least-once, DLQ sau 5 attempts) | core-api | ✅ Done |
| Event contracts (shared-kernel: **CloudEvent 1.0**, EventType, defineEvent factory, KafkaTopic) | shared-kernel | ✅ Done — CloudEvents-aligned 2026-06-30 |
| Messaging layer (CompositeMessagePublisher+transport map, EventRouter, KafkaClientService) | shared-kernel + core + worker | ✅ Done (2026-06-30) |
| Worker transaction mgmt (PrismaTransactionManager + getTx) | worker-service | ⛔ Removed 2026-06-30 (theo projection) — PrismaModule scaffold giữ lại |
| publish-knowledge → outbox atomic (transactional:true) | core-api | ✅ Done |
| Smoke test Docker (kafka-ui, db:push, end-to-end, resilience) | — | ✅ Done (2026-06-28) |
| worker-service scaffold (NestJS ApplicationContext, no HTTP) | worker-service | ✅ Done — giờ là scaffold rỗng |
| ~~worker consumer + EventRouter + DLQ~~ | worker-service | ⛔ **Removed 2026-06-30** — read model rollback |
| ~~Idempotency (ProcessedEvent guard)~~ | worker-service | ⛔ **Removed 2026-06-30** |
| ~~FeedTimeline fan-out (read model projection)~~ | worker-service | ⛔ **Removed 2026-06-30** — defer tới read phase |
| ~~Smoke test 2b (feed_timeline)~~ | — | ⛔ N/A sau rollback |

#### Phase 6 (early) — notification-service

| Hạng mục | Service | Trạng thái |
|---|---|---|
| Bootstrap NestJS+Fastify + own DB (notification_db) | notification-service | ✅ Done B1 |
| KnowledgeEventsConsumer (kafkajs raw, group riêng) | notification-service | ✅ Done B1 |
| ItemPublishedHandler → notify author | notification-service | ✅ Done B1 |
| GET /notifications + PATCH /:id/read (JWT-only, no OrgGuard) | notification-service | ✅ Done B1 |
| Emit FOLLOW_CREATED/REMOVED từ engagement module | core-api | ✅ Done B2 |
| SpaceFollower local projection | notification-service | ✅ Done B2 |
| Fan-out to space followers (NEW_IN_SPACE) | notification-service | ✅ Done B2 |

**Quyết định kiến trúc đã chốt liên quan:**
- Org context truyền qua `x-org-id` header + `OrgGuard` (KHÔNG nhúng `orgId` vào JWT). System RBAC (auth) và Org RBAC (core) tách biệt hoàn toàn.
- **Clean-Arch boundaries của core-api đã lint-enforced** (`eslint.config.mjs`, `no-restricted-imports` per layer).
- **Microservices sequencing (2026-06-28):** taxonomy deferred; Phase 2 (Outbox+Kafka) TRƯỚC. worker-service = pure consumer, không tách submodule ở giai đoạn này.
- **Transactional Outbox pattern:** outboxRepo.append() dùng getTx() → atomic. PollingPublisher dùng `running` flag. orgId trong payload. Xem `directives/resilience_patterns.md`.
- **worker-service (2026-06-28):** kafkajs raw (không @nestjs/microservices); NestFactory.createApplicationContext (không HTTP); ProcessedEvent owned by core-api schema (worker type-gen only, không db:push); fan-out qua Follow targetType=SPACE; `@@unique([userId, itemId])` trên FeedTimeline.
- **Eventing reference architecture (2026-06-30):** wire contract = **CloudEvents 1.0** (`CloudEvent<T>`), outbox table giữ column riêng → map sang CloudEvent lúc publish (storage ≠ wire). Transport chọn qua `EVENT_TRANSPORT_MAP` (binder, Kafka+queue coexist); inbound qua `EventRouter` (dispatcher, thay switch). Mỗi event 1 file `events/definitions/*.event.ts` (payload+`defineEvent`). Handler = subscriber tự khai `readonly eventType` (≈ MediatR INotificationHandler). Toàn bộ chốt trong `directives/eventing_patterns.md`.
