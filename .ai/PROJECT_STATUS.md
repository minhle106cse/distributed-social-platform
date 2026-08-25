# 📊 Cortex — Live Status

> **Current-state only.** Injected verbatim into `KNOWLEDGE_INDEX.md §2`. Update as part of the
> After-Task Protocol whenever a phase/module changes. The full historical journal lives in
> `.ai/CHANGELOG.md` (not scanned by the builder). The auto-detected module map that the builder
> appends below this content is filesystem ground-truth — if it disagrees with the table here, this
> file is stale; reconcile it.

> Last curated: **2026-08-25** — file này đã bị viết như NHẬT KÝ suốt một thời gian: 446 dòng /
> 43.8 KB, 19 mục tường thuật có ngày tháng, kéo `KNOWLEDGE_INDEX.md` lên **17.3k token** trong khi
> `CLAUDE.md` ghi ngân sách **~8k**. Vì file này được inject nguyên văn vào index — thứ **mọi**
> session đọc đầu tiên — mỗi mục viết thêm ở đây là thuế thu trên mọi session về sau. Toàn bộ phần
> tường thuật đã chuyển sang `.ai/CHANGELOG.md` (§"Moved out … 2026-08-25"), §"Where we are now"
> viết lại thành **bảng ràng buộc đang sống**. Không mất gì: *lý do* của từng quyết định vốn đã nằm
> ở `.ai/memory/*.jsonl` và `directives/*.md`.
>
> ⚠️ **Hai luật của chính file này từng bị quên, ghi lại để đừng quên lần ba:** (1) *current-state
> only* — "ngày X đã làm gì" thuộc về CHANGELOG; (2) nhãn trạng thái kiểu "(uncommitted)" hết đúng
> ngay khi commit landed, và **không control nào bắt được** (`scripts/sync.cjs` chỉ so code đang
> uncommitted với mtime của memory, mù với prose). Ghi chú 2026-08-11 ngay dưới đã cảnh báo về (2)
> rồi nó vẫn tái diễn.
>
> Last curated: **2026-08-11** — reconciled against `git log`; several items below were labeled
> "uncommitted, pending review" while actually committed since 2026-08-04 (`8bb757f`, `9930ffe`,
> `2a6a12c` et al.). The doc going stale like this is exactly the class of drift the mechanical
> layer (`scripts/sync.cjs`) cannot catch — it only compares *currently-uncommitted* code against
> memory mtime, blind to prose that stops matching reality after a commit lands.

**Overall ~86%** — infrastructure ~88% / product features ~55% (credit ledger has a foundation).
**Tech-stack showcase is deep; product surface is still MVP.**

### Where we are now
> **Đọc §này để biết CÁI GÌ ĐANG ĐÚNG, không phải chuyện đã xảy ra.** Tường thuật theo ngày nằm ở
> `.ai/CHANGELOG.md`; *lý do* của mỗi quyết định nằm ở `.ai/memory/*.jsonl` (→ `GOTCHAS.md`) và
> `directives/*.md`. §này chỉ liệt kê **ràng buộc đang sống** — thứ mà không biết thì viết sai code.

**Đã landed và đang chạy:** resilience curriculum (idempotency, retry, circuit breaker, org-aware
rate limit, graceful shutdown, W3C traceparent) · ADR-0001 transaction/retry rearchitecture +
SagaCompensationOutbox + DLQ auto-replay · RAG/hybrid search (pgvector + ES + RRF) · credit ledger
(5a) · **AI-Query Saga (5b)** · monitoring stack as code. Tất cả đã commit, cây sạch 2026-08-24.

#### Ràng buộc đang sống — vi phạm là sai, không phải "tuỳ style"

| Chủ đề | Luật hiện hành | Chi tiết ở |
|---|---|---|
| **Transaction** | Handler khai bằng **TYPE** (`ITransactionalCommandHandler` vs `ISagaCommandHandler`), không phải flag. **MỘT** repos shape cho mỗi service, dựng bởi **một** factory, truyền vào constructor của `PrismaTxRunner` — không token, không registry | `directives/cqrs_pattern.md` · ADR-0001 + ADR-0002 |
| **Retry** | Mặc định `retryable: false`. Chỉ `true` khi mọi side effect nằm trong transaction rollback được VÀ không có external call giữa handler | `resilience_patterns.md` §3 |
| **Port** | **Không bao giờ** khai port trong `infrastructure/`. Consumer ở đâu quyết định port ở đâu — và đó là **ảnh chụp**, phải suy lại từ import graph mỗi khi code dịch chuyển | `resilience_patterns.md` §6.1 · `check:arch` F |
| **shared-kernel** | Vào được chỉ khi thoả 1 trong 3: (A) code shared-kernel tự import, (B) ≥2 service dùng + độc lập framework, (C) wire contract được publish. Cộng kind test: không runtime-dep kafkajs/NestJS/Fastify/Prisma/Redis | `folder_structure_sop.md` § Where An Abstraction Lives · `check:arch` H |
| **Error** | Mỗi module **đúng một** file: `modules/<x>/domain/<x>.error.ts`, số ít, tên trùng module. `common/errors/` **không còn tồn tại**. Mọi error `extends ApplicationError` (filter chỉ map loại đó) | `naming_conventions.md` §6 · `check:arch` I |
| **Authz guard** | Guard đọc metadata bằng `getAllAndOverride([getHandler(), getClass()])` — `.get()` bỏ qua decorator ở class level và fail **open**. `SystemPermissionGuard` **fail-closed**: route không khai `@RequireSystemPermission` → 403 (tầng system không có sàn membership). Handler nhận org qua `@CurrentOrg()`, không đọc lại `x-org-id`. Nhiều permission = **AND**, variadic ở cả 3 service | `multi_tenancy.md` § How a guard MUST read route metadata · `docs/10_security_rbac.md` §2.1 |
| **Authz resolve** | **CẢ HAI tầng resolve theo request, không tin claim trong token.** Org: `OrgGuard` (DB local) / `RemoteOrgMembershipGuard` (gRPC → core-api). System: `SystemPermissionGuard` → gRPC `SystemRbac` → auth_db. Cả hai **fail CLOSED → 503** khi nguồn không với tới được | `docs/10_security_rbac.md` §2.1 · `proto/system-rbac.proto` |
| **Cache authz** | **Redis, không phải Map trong process.** shared-kernel chỉ giữ port `ICacheStore` (check H cấm `ioredis` ở kernel); adapter nằm ở `infrastructure/cache/` từng service. Adapter **không bao giờ ném** (Redis chết = miss); **không cache lượt lỗi**; entry đọc lên là **untrusted input**. Dùng `cachedLookup()` của shared-kernel, **đừng tự viết lại** read/validate/write. Key **cấp phát ở `CacheKeys`** (shared-kernel) — Redis là MỘT keyspace chung, prefix tự đặt tại chỗ là cấp phát mù; `cache-keys.spec.ts` kiểm tra va chạm | `multi_tenancy.md` § Caching an authz lookup |
| **Transport** | Mọi thứ gRPC/Kafka ở `src/infrastructure/<transport>/` cấp service, **không** trong `modules/`. Module infra chỉ có 4 thư mục con: mappers, consumers, services, repositories | `folder_structure_sop.md` · `check:arch` G |
| **Module wiring** | Module infra cấp service là `@Global` + import **một lần** ở `AppModule`. Application layer bị cấm `@/infrastructure/**` trừ `cqrs` | `folder_structure_sop.md` § Enforcement |
| **Outbox** | Là **capability của shared-kernel**: contract + engine ở `shared-kernel/src/outbox/`; service chỉ cung cấp adapter Prisma + scheduler + metrics. Ghi qua `tx.outbox.append()` (`IOutboxWriter`) | `eventing_patterns.md` §4.1 |
| **Credit** | Two-phase reserve. Ví có **hai** số: `balance` và `available = balance − Σ(OPEN)`. **`available`** là cái mọi kiểm tra so vào, kể cả `POST /credits/spend`. Thiếu tiền = **402** | `docs/06` · `event_sourcing.md` |
| **Search** | `POST /search` là **retrieval thuần** — RAG summary chỉ có trên đường trả tiền (gRPC `RagQuery`). Contract mang enum `RagOutcome`, không phải `bool degraded` | `rag_ai_integration.md` |
| **Domain layer** | Cả 4 service cấm `modules/*/domain/**` import `@/common/**` — kể cả đường vòng relative | `check:arch` D |

#### Gate phải xanh trước khi coi là xong

`npm run check` = `check:arch` (**9 check A–I**) + `turbo typecheck lint format:check` — **22/22 task
xanh**. Test: `turbo test` — **12/12 task, 541 test** (core-api 59 suites/196 · shared-kernel 15/117 ·
auth-service 30/123 · search 15/69 · notification 13/36), verified 2026-08-25.

⚠️ **`typecheck`/`lint`/`test` KHÔNG nhìn thấy lỗi DI wiring của Nest** — chỉ nổ lúc boot. Mỗi service
NestJS có `src/app-module-graph.spec.ts` (NestFactory preview mode, không cần infra) làm gate duy nhất
cho lớp lỗi đó. Đổi module wiring thì phải để nó chạy.

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

- **Saga durability:** superseded 2026-07-30 by `SagaCompensationOutbox` (narrative in
  `.ai/CHANGELOG.md`) — this line used to say "in-request only, no saga-state table", which stopped being true
  once that landed. Remaining gap is crash-recovery *before* the first compensation write
  (`.ai/plans/saga-orchestrator-crash-recovery.plan.md`, NOT started, pending scope sign-off) —
  **narrowed 2026-08-22**: for the AI-Query Saga specifically, `ExpiredReservationSweeperService`
  now covers it (a hold abandoned in that window is released on a TTL). The generic problem stands
  for any future saga whose side effect has no equivalent expiry.
- **CloudEvent tracing:** W3C `traceparent` propagation is implemented and committed (`2a6a12c`,
  `c207fed`) — see `directives/resilience_patterns.md` §7. A distinct `causationId` (event-caused-
  event chain) is still unmodeled — add when Phase 5b saga needs it.
- **Outbox reorder:** retry can reorder same-aggregate events (fix = per-key sequencing; not worth it yet).
- **Internal gRPC chạy `createInsecure()`** (ghi nhận 2026-08-25, trong lượt siết authz): shared secret tĩnh
  truyền plaintext là *toàn bộ* trust boundary service-to-service, mà `RagQuery` thì cố ý không check
  membership → lộ secret = đọc knowledge base của mọi org. Hướng xử lý: mTLS (hoặc tối thiểu rotation +
  network policy). Hoãn vì là việc hạ tầng (CA/cert/compose/rotate) không verify được nếu không dựng cả
  stack — chi tiết ở `docs/10_security_rbac.md` §6.1.
- **Naming split:** `CORS_ORIGINS` (auth) vs `CORS_ALLOWED_ORIGINS` (3 NestJS services) — known,
  unmerged (touches 4 configs); see `directives/naming_conventions.md`.
- **Test gaps:** `credit` module giờ đã có test thật (aggregate two-phase reserve + parity 2 bản fold + 3 handler mới + saga) — dòng "pending user review" cũ đã hết đúng, nhưng code 5b vẫn chưa được owner đọc lại; no
  e2e/integration tests anywhere yet (sequenced into the final performance/hardening phase).
