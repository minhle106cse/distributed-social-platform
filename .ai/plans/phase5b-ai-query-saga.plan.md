# Phase 5b — AI-Query Saga (reserve → RAG → commit/release)

> **Status:** DRAFT — chờ owner review, chưa implement dòng nào.
> **Ngày lập:** 2026-08-22

## Context

Cortex đang ở trạng thái: hạ tầng ~88%, product surface còn MVP. Ba round gần nhất
(2026-08-20/21) toàn là *governance* — naming audit, repo-placement enforcement, dọn 261 lint
error về 0. `turbo run typecheck lint format:check test` hiện 33/33 xanh trên toàn monorepo, không
còn gap kỹ thuật nào mở. Nghĩa là: hết cớ để hoãn feature work.

Theo `readme.phases.md` phase map, mảnh build kế tiếp là **Phase 5b — AI-Query Saga**, và đây là
mảnh duy nhất còn thiếu để hai nửa đã xây xong nối vào nhau:

- **Credit ledger** (core-api, event-sourced, OCC) chạy được nhưng **hoàn toàn độc lập với search** —
  `docs/06_api_contracts.md:140` ghi thẳng: *"chưa có wiring credit↔search nào trong code"*.
- **RAG/hybrid search** (search-service) chạy được nhưng **miễn phí** — không tốn credit.
- **Saga machinery** (`SagaContext`, `CompensationAction`, `SagaCompensationRegistry`, reaper,
  DLQ replay) đã build đầy đủ từ ADR-0001 nhưng **chỉ có đúng 1 saga đang dùng nó**
  (`ProvisionOrgHandler`). Hạ tầng saga đang thừa so với nhu cầu thật.
- **`EventType.CREDIT_SPENT` / `CREDIT_AWARDED` + topic `credit-events`** đã khai báo trong
  `packages/shared-kernel/src/messaging/routing/maps.ts` nhưng **không ai emit, không ai subscribe** —
  dây chết đã ~2 tháng.

UC-C2 trong `docs/02_use_cases.md:69-77` đã spec sẵn luồng này (kể cả luồng lỗi), nên đây là
implement theo spec có sẵn, không phải thiết kế mới từ đầu.

**Kết quả mong muốn:** `POST /api/v1/ai/ask` trừ credit đúng, RAG fail thì credit không mất, ledger
không lệch, user nhận được notification, và toàn bộ dây `credit-events` sống.

---

## 5 quyết định kiến trúc (đã chốt với owner 2026-08-22)

| # | Quyết định | Lý do |
|---|---|---|
| 1 | **Saga đặt ở core-api**, không phải search-service | core-api có CommandBus + `SagaContext` + `SagaCompensationRegistry` + reaper + outbox; search-service **không có CQRS bus** (`search-knowledge.service.ts:44` tự ghi nhận điều này) và không có bảng `SagaCompensation`. Đặt saga ở search-service = build lại toàn bộ hạ tầng đó. |
| 2 | **Two-phase reserve thật** (không phải spend-rồi-refund) | Owner chọn. Đúng chữ "reserve credit (trừ tạm)" của `readme.phases.md:226`, và balance user **không bao giờ tụt** khi AI fail — ledger sạch hơn (1 cặp Reserved/Released thay vì Spent+Refunded). Đánh đổi: aggregate + wallet fold phải viết lại, không dùng được `refund()` sẵn có. |
| 3 | **gRPC + proto mới** cho core-api → search-service | Đúng convention: mọi sync call nội bộ đều gRPC + `verifyInternalGrpcSecret` + `CircuitBreaker` caller (`auth-provisioning`, `membership`). HTTP sẽ tạo vòng lặp — `RemoteOrgMembershipGuard` của search-service gọi ngược về core-api. |
| 4 | **Step 3 là MỘT command transactional**, không phải 2 dispatch | Commit reservation + insert `AiQuery` + append outbox `CreditSpent` phải nguyên tử. Tách 2 dispatch sẽ đẻ ra một compensation nữa cho chính nó. |
| 5 | **Token bucket lưu ở Postgres**, không phải Redis | Redis có trong `docker-compose.yml` nhưng **zero dòng code nào dùng** — thêm Redis client vào core-api là thêm module/config/health-check/shutdown mới. Bucket là 1 row per (org,user), contention thấp, `UPDATE ... RETURNING` là atomic sẵn. Redis là đường nâng cấp khi đo được nó nóng, không phải mặc định. |

---

## Work breakdown

### Bước 0 — shared-kernel: vocabulary + proto (làm trước, mọi thứ khác phụ thuộc)

**`packages/shared-kernel/src/messaging/events/event-types.ts`** — thêm EventType:
- `CREDIT_RESERVATION_RELEASED: 'CreditReservationReleased'`

  *Tại sao không đặt tên `AI_QUERY_FAILED`:* notification mà user thấy là về **kết cục credit**
  ("AI tạm không khả dụng, credit không bị trừ"), payload mang `reason: 'AI_UNAVAILABLE'` +
  `aiQueryId` để notification-service render. Giữ vocabulary credit-centric → không phải đẻ topic
  mới cho đúng 1 event.

**`maps.ts`** — cả 2 map là `Record<EventTypeValue, …>` exhaustive nên TS sẽ **bắt lỗi compile** nếu
quên: map event mới → `KafkaTopic.CREDIT_EVENTS`.

**`events/definitions/`** — 3 file mới theo đúng khuôn `knowledge-published.event.ts`
(`defineEvent<Payload>({ eventType, aggregateType: 'CreditAccount' })`):
`credit-awarded.event.ts`, `credit-spent.event.ts`, `credit-reservation-released.event.ts`.

**`proto/ai-query.proto`** (file mới):
```proto
service RagQuery { rpc Query(RagQueryRequest) returns (RagQueryResponse); }
message RagQueryRequest  { string org_id = 1; string question = 2; int32 top_k = 3; }
message RagQueryResponse { string summary = 1; bool degraded = 2;
                           repeated Source sources = 3; repeated Chunk chunks = 4; }
```
Chạy `npm run proto:gen` (shared-kernel) → sinh `packages/shared-kernel/src/grpc/ai-query.ts`, export
qua index như `membership.ts` / `org-provisioning.ts`.

> `degraded` là field quan trọng nhất của contract này — xem Bước 3.

---

### Bước 1 — Aggregate: two-phase reserve

**`apps/core-api/src/modules/credit/domain/entities/credit-account.aggregate.ts`**

`CreditEventType` thêm 3 giá trị: `CreditReserved | CreditReservationCommitted | CreditReservationReleased`.
`CreditEventPayload` thêm `reservationId?: string`.

State mới — fold giữ **trạng thái cuối** của từng reservation, không chỉ các reservation đang mở:

```ts
private _reservations = new Map<string, { amount: number; status: 'OPEN'|'COMMITTED'|'RELEASED' }>()
get available(): number   // = _balance - tổng các reservation OPEN
get reserved(): number
```

Fold rules bổ sung trong `apply()`:
- `CreditReserved` → set `{amount, OPEN}`; **`_balance` KHÔNG đổi**
- `CreditReservationCommitted` → status `COMMITTED`; `_balance -= amount`
- `CreditReservationReleased` → status `RELEASED`; `_balance` không đổi

Method mới:
- `reserve(reservationId, amount, reason)` — so sánh với **`available`**, không phải `_balance`
  (đây là chỗ dễ sai nhất: 2 reservation song song phải cùng nhìn thấy nhau)
- `commitReservation(reservationId, reason)` — không OPEN → `ReservationNotOpenError`
- `releaseReservation(reservationId, reason): boolean` — **phải idempotent**: nếu không OPEN thì
  **no-op trả `false`**, tuyệt đối không raise event. Lý do bắt buộc: đây là compensation, và
  `SagaCompensationReaperService` sẽ retry nó từ storage bền — release lần 2 trên một reservation đã
  COMMITTED mà lại raise event thì user được "hoàn" một khoản chưa từng bị giữ → **ledger lệch**.
  Đây chính là acceptance criterion `Sum(events) == Balance` của Phase 5.

`spend()`/`grant()`/`refund()` giữ nguyên (route `POST /credits/spend` hiện có vẫn dùng).
`InsufficientCreditsError` giờ report theo `available`.

**Read side** — `prisma-wallet.query-repository.ts:19-40`: fold ở đây là **bản sao thủ công** của
fold trong aggregate (SoT-only, không có summary table). Thêm 3 case y hệt + trả `available`/`reserved`.
Cập nhật `wallet.dto.ts`, và `delta` ở dòng 50 phải xử lý event mới (Reserved/Released có
`delta = 0` trên balance).

> ⚠️ Hai bản fold trùng nhau là món nợ có sẵn, **không sửa trong task này** — nhưng viết test khẳng
> định hai bản cho cùng kết quả trên cùng chuỗi event, để lần lệch tiếp theo bị bắt.

**Schema:** `CreditEvent` **không cần đổi** — `reservationId` nằm trong `payload Json`. Không migration
cho phần ledger.

---

### Bước 2 — Commands + AiQuery table

**Schema** `apps/core-api/prisma/schema.prisma` — 2 model mới (UUID PK, `@map("snake_case")`,
`orgId` + compound index theo `multi_tenancy.md`):

```prisma
model AiQuery {
  id String @id @default(uuid(7))
  orgId / userId / question / answer String? / sources Json / creditCost Int
  status String   // ANSWERED | FAILED
  reservationId String @unique   // 1 saga run = 1 reservation = 1 row
  createdAt
  @@index([orgId, userId, createdAt])
  @@map("ai_queries")
}

model AiQuotaBucket {          // Bước 6
  orgId / userId / tokens Float / lastRefillAt
  @@id([orgId, userId])
  @@map("ai_quota_buckets")
}
```

**Commands mới** (`modules/credit/application/commands/`), tất cả `kind = 'transactional'`, nhận
`CoreApiRepos`:

| Command | Việc |
|---|---|
| `ReserveCreditsCommand` | `loadOrOpen` → `reserve()` → `save()` |
| `CommitAiQueryCommand` | `commitReservation()` → `save()` → `tx.aiQueries.insert(...)` → `tx.outbox.append(CreditSpentEvent…)` — **cả 3 trong 1 transaction** (quyết định #4) |
| `ReleaseCreditReservationCommand` | `releaseReservation()`; **chỉ khi trả `true`** mới `save()` + `tx.outbox.append(CreditReservationReleasedEvent…)` |

`GrantCreditsHandler` (đã tồn tại) — thêm `tx.outbox.append(CreditAwardedEvent…)`. Đây là nửa còn lại
của việc nối dây chết.

**Repo mới:** `IAiQueryRepository` (có method write → **`domain/repositories/`** theo bước 1 của rule
trong `cqrs_pattern.md`), impl Prisma, và thêm field `aiQueries` vào `CoreApiRepos`
(`src/common/database/core-api-repos.ts`) + `core-api-repos.factory.ts`.
`npm run check:arch` sẽ chặn nếu đặt sai chỗ.

---

### Bước 3 — gRPC: search-service mọc server đầu tiên

**search-service** hiện chỉ là gRPC *client* (`membership-verification.client.ts`), chưa từng làm server.

- `apps/search-service/src/bootstrap/grpc.ts` — theo khuôn `GrpcServerBootstrap` của core-api
  (`main.ts:6,20,38` — start + `tryShutdown()` gắn vào graceful shutdown đã có sẵn ở
  `apps/search-service/src/main.ts:25-52`).
- `infrastructure/grpc/rag-query.grpc-service.ts` — implement `RagQueryServer`, dùng `#`-private
  fields (grpc-js index-signature bắt buộc, xem comment ở
  `membership-verification.grpc-service.ts:31-37`), `verifyInternalGrpcSecret` + **log warn khi
  reject** (gRPC không có boundary interceptor nào bắt hộ). Delegate thẳng sang
  `SearchKnowledgeService.search()` đang có — **không viết lại RAG**.
- Env mới: `GRPC_PORT` cho search-service; `SEARCH_GRPC_URL` cho core-api (`env.validation.ts` cả hai).

> **Ghi rõ trong doc-comment của service này:** RPC này **cố ý không check membership**. core-api đã
> authorize caller (JWT + `OrgGuard` + permission) trước khi dispatch saga; `x-internal-secret` là
> trust boundary. Không ghi ra thì lần audit sau sẽ đọc nhầm thành IDOR regression giống lỗi đã fix
> hồi trước.

**core-api client** — mirror `auth-provisioning`:
- `infrastructure/grpc/rag-query-grpc.caller.ts` — SRP wrapper quanh
  `new CircuitBreaker('rag-query-grpc', logger)`
- `infrastructure/grpc/rag-query.client.ts` — metadata/deadline/trace propagation, trả **tagged
  outcome** (không tự throw application error — đúng layering của `AuthProvisioningClient`)
- đăng ký trong `grpc.module.ts`

**Điểm design quan trọng nhất của bước này:** `SearchKnowledgeService` **degrade chứ không throw** —
Claude chết → `summary: null` (dòng 76-92), Ollama chết → keyword-only, ES chết → semantic-only.
Với billing, "trả về chunks mà không có summary" = **không giao được thứ user trả tiền**. Nên:

> `degraded = (summary === null)` trên wire; core-api thấy `degraded` → `throw AiUnavailableError` →
> bus chạy compensation → release reservation. HTTP trả **503 `AI_UNAVAILABLE`** (mã này đã có sẵn
> trong `docs/06_api_contracts.md:37`) kèm chunks làm fallback, đúng UC-C2 luồng lỗi.

---

### Bước 4 — Saga handler + endpoint

**`modules/credit/application/commands/ask-ai/ask-ai.handler.ts`** —
`ISagaCommandHandler<AskAiCommand, AskAiResult>`, `kind = 'saga'`, khai báo `dispatches`.
Saga thứ 2 của hệ thống; đọc `provision-org.handler.ts` làm mẫu.

```
reservationId = uuid()
① ctx.dispatch(ReserveCreditsCommand)              // ném InsufficientCreditsError → 402, chưa có gì để undo
   ctx.onCompensate({type:'release-credit-reservation', payload:{orgId,userId,reservationId}},
                    () => ctx.dispatch(ReleaseCreditReservationCommand))   // đăng ký NGAY sau khi reservation tồn tại
② ragQueryClient.query(...)  → degraded ? throw AiUnavailableError : tiếp
③ ctx.dispatch(CommitAiQueryCommand)               // commit + lưu AiQuery + outbox CreditSpent, nguyên tử
```

- Đăng ký `'release-credit-reservation'` runner vào `SagaCompensationRegistry` trong
  `credit.module.ts`'s `onModuleInit` (khuôn: `platform-admin.module.ts:40-45`) — bắt buộc, nếu không
  reaper coi type lạ là permanent failure → FAILED_DLQ.
- `logAudit` cho cả success/failure như `provision-org.handler.ts:97,110`.
- Saga **không nằm trong retry path** — retry mù sẽ reserve lần 2.

**Endpoint** `POST /api/v1/ai/ask` — `presentation/controllers/ai-query.controller.ts`:
`@UseGuards(JwtAuthGuard, OrgGuard)`, `@RequireOrgPermission(OrgPermission.CREDIT_SPEND)` +
`KNOWLEDGE_READ`, `@UseInterceptors(IdempotencyInterceptor)`, zod schema
(`zod_validation.md`). `IdempotencyInterceptor` **đã có sẵn** và trả response cached — đó chính là
yêu cầu *"cùng Idempotency-Key gửi 2 lần → không trừ credit lần 2"* của UC-C2, **không cần cơ chế mới**.

Query history: `GET /api/v1/ai/queries` (QueryBus + `application/repositories/ai-query.query-repository.ts`).

---

### Bước 5 — notification-service consume `credit-events`

- `notification-events.consumer.ts:45` — thêm `KafkaTopic.CREDIT_EVENTS` vào `topics`;
  `dlq-replay.consumer.ts:47-48` — thêm `deadLetterTopic(KafkaTopic.CREDIT_EVENTS)`.
- Handler mới `application/events/credit-reservation-released/` theo khuôn `item-published.handler.ts`:
  `IIntegrationEventHandler<CreditReservationReleasedPayload>`, `txRunner.run()`, notification
  `type: 'AI_UNAVAILABLE'`, recipient = chính user đó (không fan-out).
  Idempotent qua `@@unique([recipientUserId, sourceEventId])` **đã có sẵn** — dùng `event.id`,
  không thêm cơ chế dedup mới (`idempotency_strategy.md`).
- `.register(...)` vào `EventRouter`.

> **Câu chữ phải sửa:** UC-C2 hiện ghi *"credit đã được hoàn"*. Với two-phase reserve thì credit
> **chưa từng bị trừ** → thông điệp đúng là *"AI tạm thời không khả dụng, credit không bị trừ"*.
> Sửa trong `docs/02_use_cases.md:75` cùng task.

---

### Bước 6 — Token bucket cho AI query

`infrastructure/http/guards/ai-quota.guard.ts` (hoặc interceptor), chạy **trước** saga:
một câu `UPDATE ai_quota_buckets SET tokens = LEAST(cap, tokens + elapsed*rate) - 1, last_refill_at = now()
WHERE ... AND (tokens + elapsed*rate) >= 1 RETURNING tokens` — refill + consume atomic trong 1
round-trip, đúng multi-instance. Không match → **429 `RATE_LIMITED`** (mã đã có,
`docs/06_api_contracts.md:35`). Config `AI_QUOTA_CAP` / `AI_QUOTA_REFILL_PER_MIN`.

> **Nói thẳng để owner cân lại nếu muốn:** credit spend **bản thân nó đã là quota**. Token bucket chỉ
> thêm giá trị ở chỗ chặn *burst* — user giàu credit đốt 200 query trong 10 giây vẫn làm sập chi phí
> Claude/Ollama dù trả đủ tiền. Đó là lý do hợp lệ duy nhất để có nó. `@Throttle` per-route hiện tại
> không thay thế được (fixed window, in-memory per instance). Nếu owner thấy chưa đáng, bước này cắt
> được mà không ảnh hưởng bước 0-5.

---

### Bước 7 — Test + docs (không phải phần phụ)

**Unit test** (`testing_standard.md`, co-location `.spec.ts`):
- `credit-account.aggregate.spec.ts` — nặng nhất: reserve vượt `available` (không phải `balance`);
  2 reservation song song; commit rồi release **phải no-op**; release 2 lần; rehydrate từ chuỗi
  event hỗn hợp cả 6 loại.
- `ask-ai.handler.spec.ts` — `degraded:true` → compensation chạy; `ReserveCreditsCommand` fail →
  **không** compensation nào chạy; happy path dispatch đúng thứ tự.
- Handler specs cho 3 command mới, `credit-reservation-released.handler.spec.ts`,
  `rag-query.grpc-service.spec.ts`.
- **Test đối chiếu 2 bản fold** aggregate ↔ wallet query repo (xem cảnh báo Bước 1).

**Smoke test thật** (harness thủ công đã dùng nhiều lần: craft RS256 JWT bằng openssl + seed
`core_db` trực tiếp; không cần auth-service):
1. `npm run db:push` — 2 bảng mới thật sự apply.
2. Grant credit → `POST /ai/ask` happy path → `AiQuery.status=ANSWERED`, `available` giảm, ledger có
   `CreditReserved` + `CreditReservationCommitted`.
3. **Tắt Ollama/Claude** (`docker stop`) → `/ai/ask` → 503, ledger có `CreditReserved` +
   `CreditReservationReleased`, **`available` về đúng như trước**, `AiQuery.status=FAILED`.
4. Notification xuất hiện; consumer LAG = 0 (boot consumer **trước** khi produce vì
   `fromBeginning:false`; nhớ gotcha `KAFKA_CLIENT_ID` dùng chung trong `.env`).
5. Gửi 2 lần cùng `X-Idempotency-Key` → 1 lần trừ credit.
6. **Acceptance của Phase 5:** `SELECT` fold toàn bộ `credit_events` của org → khớp
   `available` + `reserved`.

**Gate:** `npm run check` (chạy `check:arch` **trước**, rồi typecheck/lint/format/test) — phải giữ 33/33.

**Docs cần reconcile trong CÙNG task** (bắt buộc, đụng schema + API + security):
`docs/02_use_cases.md` (UC-C2 câu chữ), `docs/04_database_schema.md` (2 model mới),
**`docs/06_api_contracts.md` (dòng 140 đang ghi "chưa triển khai" — sẽ thành sai; thêm
`POST /api/v1/ai/ask`)**, `docs/09_devops_infrastructure.md` (env mới),
`docs/10_security_rbac.md` (permission cho route mới).
Directives: `resilience_patterns.md` (breaker mới), `cqrs_pattern.md` (saga thứ 2),
`event_sourcing.md` (two-phase reserve trên event stream), `eventing_patterns.md` (3 event mới).

---

## Thứ tự thực thi

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7`. Bước 0-2 thuần core-api/shared-kernel, chạy `turbo typecheck test`
được ngay. Bước 3 là chỗ rủi ro nhất (gRPC server đầu tiên của search-service) — làm sau khi
domain đã xanh, để lỗi transport không lẫn với lỗi domain.

## Rủi ro / điểm dễ sai

1. **`releaseReservation` không idempotent** → ledger lệch khi reaper retry. Đây là bug nghiêm trọng
   nhất có thể xảy ra trong task này, và nó *im lặng*.
2. **`reserve()` so với `_balance` thay vì `available`** → over-commit khi 2 query song song.
   OCC bắt được xung đột cùng version, nhưng không bắt được lỗi logic này.
3. **Quên `EVENT_TOPIC_MAP`** → TS bắt compile, an toàn.
4. **Quên `registry.register('release-credit-reservation')`** → không lỗi lúc build, chỉ lộ khi
   compensation lần đầu fail → FAILED_DLQ. Có test riêng cho nó.
5. **`degraded` bị bỏ qua** → user bị trừ credit cho câu trả lời rỗng.

## After-Task Protocol (khi implement xong)

- Log lesson → `.ai/memory/architecture.jsonl` (two-phase reserve trên event stream; tại sao saga ở
  core-api) + `.ai/memory/gotchas.jsonl` (degrade-không-throw của search-service đụng billing).
- Cập nhật `.ai/PROJECT_STATUS.md`: Phase 5 → 5b done, 5c pending; xoá mô tả "credit ledger độc lập
  với search"; ghi nhận `credit-events` đã hết là dây chết.
- Enrich post tương ứng trong `docs/linkedin_posts_plan.md` bằng chất liệu thật.
- Stop hook tự regenerate `.ai/KNOWLEDGE_INDEX.md` — **không sửa file generated**.

---

## References & Compliance

**Directives đã đọc:**
- `cqrs_pattern.md` — handler TYPE quyết định transaction (`ITransactionalCommandHandler` vs
  `ISagaCommandHandler`); `ctx.dispatch` là cách duy nhất gửi command từ trong handler; rule đặt
  repo 2 bước → `IAiQueryRepository` (có write) vào `domain/repositories/`, read port vào
  `application/repositories/`.
- `event_sourcing.md` — append-only, OCC qua `@@unique([aggregateId, version])`, fold-on-read →
  reserve/commit/release là **event**, không phải cột status.
- `eventing_patterns.md` — domain vs integration event; outbox append trong cùng transaction;
  `defineEvent` factory; DLQ replay.
- `idempotency_strategy.md` — dùng natural-key/`@@unique([recipientUserId, sourceEventId])` có sẵn
  cho handler notification thay vì thêm bảng inbox.
- `resilience_patterns.md` — CircuitBreaker cho mọi external call; `IdempotencyInterceptor` §1.1;
  compensation bền qua `SagaCompensationOutbox`.
- `rag_ai_integration.md` — search-service không có CQRS bus (nền của quyết định #1); breaker quanh
  mọi AI call.
- `multi_tenancy.md` — `orgId` bắt buộc + compound index trên 2 model mới; `OrgGuard` là nơi duy
  nhất quyết định quyền chạm data org.
- `naming_conventions.md` §4/§5/§9/§11/§12 — tên repo/handler/port/controller nesting.
- `database_standard.md` — UUID PK, `camelCase` + `@map("snake_case")`.
- `zod_validation.md`, `testing_standard.md`, `folder_structure_sop.md`, `logging_standard.md`
  (`LogContext` tường minh, audit log), `observability_monitoring.md`.

**Docs:** `docs/02_use_cases.md:69-77` (UC-C2 — spec gốc của luồng này),
`docs/06_api_contracts.md:35,37,120,140` (mã lỗi 402/429/503 đã có; xác nhận wiring credit↔search
chưa tồn tại), `readme.phases.md:203,215-249` (Phase 5 deliverables + acceptance),
`docs/adr/0001-transaction-retry-boundary.md`.

**Code đã đọc và sẽ tái sử dụng (không viết mới):**
`provision-org.handler.ts` (khuôn saga), `saga-context.interface.ts`, `saga-compensation.registry.ts`,
`platform-admin.module.ts:40-45` (khuôn đăng ký compensation), `publish-knowledge.handler.ts:32`
(khuôn outbox append), `auth-provisioning-grpc.caller.ts` + `membership-verification.grpc-service.ts`
(khuôn gRPC client/server), `item-published.handler.ts` (khuôn integration-event handler),
`credit.controller.ts` (khuôn guard/permission/idempotency stack), `search-knowledge.service.ts`
(RAG orchestrator — gRPC service chỉ delegate vào đây).
