# 📊 Cortex — Live Status

> **Current-state only.** Injected verbatim into `KNOWLEDGE_INDEX.md §2`. Update as part of the
> After-Task Protocol whenever a phase/module changes. The full historical journal lives in
> `.ai/CHANGELOG.md` (not scanned by the builder). The auto-detected module map that the builder
> appends below this content is filesystem ground-truth — if it disagrees with the table here, this
> file is stale; reconcile it.

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
- **Repo-placement rule made enforceable (2026-08-21, uncommitted).** Follow-on to the naming audit
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
- **Current focus:** land correlation-id once reviewed, then RAG learning curriculum → resume
  feature work.

### Phase map

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | ✅ Done (taxonomy deferred to post-Phase-3) |
| 2 | Event Backbone (Kafka + Outbox) | ✅ Done — 2a outbox/publisher + 2b consumer, smoke-tested |
| 3 | CQRS & Read Model | ⬜ Deferred — schema stays source-of-truth-only until a read path needs it |
| 4 | AI Search & Discovery (RAG) | ✅ Code-complete + smoke-tested (search-service; happy-path summary needs a real key) |
| 5 | Credit Economy & Saga | 🔄 5a Credit Ledger done + smoke-tested; **5b AI-Query Saga = next**; 5c bounty+reputation pending |
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
  once that landed. Remaining gap, if any, is crash-recovery *before* the first compensation write
  (`.ai/plans/saga-orchestrator-crash-recovery.plan.md`, NOT started, pending scope sign-off).
- **CloudEvent tracing:** W3C `traceparent` propagation is implemented and committed (`2a6a12c`,
  `c207fed`) — see `directives/resilience_patterns.md` §7. A distinct `causationId` (event-caused-
  event chain) is still unmodeled — add when Phase 5b saga needs it.
- **Outbox reorder:** retry can reorder same-aggregate events (fix = per-key sequencing; not worth it yet).
- **Naming split:** `CORS_ORIGINS` (auth) vs `CORS_ALLOWED_ORIGINS` (3 NestJS services) — known,
  unmerged (touches 4 configs); see `directives/naming_conventions.md`.
- **Test gaps:** `credit` module unit tests pending user review of the AI-authored code; no
  e2e/integration tests anywhere yet (sequenced into the final performance/hardening phase).
