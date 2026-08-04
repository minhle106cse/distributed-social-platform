# Plan — Vá các lỗ hổng review ADR-0001 (TxScope / Transaction & Retry boundary)

- **Ngày:** 2026-07-30 · **Trạng thái:** ĐÃ THỰC THI (Wave 1, 2, 3, 4 — xem §9b của ADR cho tóm tắt).
  Owner đã chốt cả 4 câu hỏi mở (§"Câu hỏi cần owner chốt"): org mồ côi → tự soft-delete; audit → đẩy
  ra ngoài transaction; OCC credit → cho tự động retry; trùng lặp TxRunner/transient-error → gộp ngay
  trong đợt này. `npx turbo typecheck test` xanh toàn bộ 6 package sau khi vá.
- **Bối cảnh:** review sâu diff ADR-0001 (chưa commit, ~200 file / 5 submodule + shared-kernel).
  Kiến trúc lõi **đúng và nên giữ** — TxScope, suy transaction từ chữ ký handler, pipeline cố định
  trong thân hàm đều bám tiền lệ thật. Plan này chỉ vá phần thực thi còn hở.
- **Nguồn:** `docs/adr/0001-transaction-retry-boundary.md`, review 2026-07-30.

---

## Nguyên tắc xếp thứ tự

Đi từ **đúng đắn** → **bịt lỗ kiến trúc ADR tuyên bố đã bịt** → **tài liệu/độ sạch**.
Wave 1+2 nên xong **trước khi commit** diff này; Wave 3+4 có thể là commit riêng.

---

## Wave 1 — Correctness (chặn commit)

### 1.1 Saga không bù trừ command con đã commit
**File:** `apps/core-api/src/modules/platform-admin/application/commands/provision-org/provision-org.handler.ts:63`

`ctx.dispatch(CreateOrgCommand)` commit xong mà không đăng ký compensation. Lỗi sau đó ⇒ huỷ user
auth-service nhưng org + OWNER membership + role→permission ở lại vĩnh viễn, trỏ tới user đã huỷ.

**Việc cần làm:**
- Thêm `ctx.onCompensate` ngay sau khi `dispatch` trả về `orgId` — cần một `ArchiveOrgCommand` /
  `DeleteOrgCommand` (soft delete qua `deletedAt`, đúng hard rule của CLAUDE.md), hoặc
- Nếu quyết định **không** bù trừ được (org đã commit là chấp nhận được), thì phải ghi rõ lý do
  bằng comment tại chỗ + một dòng trong ADR §6b, chứ không để người đọc tưởng bus tự undo.

> Quyết định WHY/WHAT là của owner: org mồ côi thì **xoá mềm** hay **giữ lại để admin dọn tay**?

### 1.2 I/O không rollback được nằm trong transaction (`logAudit`)
**File:** `apps/auth-service/.../login/login.handler.ts:33,55,70,108` (+ `register`, `refresh` tương tự)

`logAudit` ghi thẳng pino → stdout → Elasticsearch, **không rollback**. Retry P2034 ⇒ 2 bản ghi
`outcome:'success'` cho 1 lần login; retry cạn ⇒ audit "success" cho login chưa từng commit.
Vi phạm đúng lời hứa `ITransactionalCommandHandler` tự viết: *"its only I/O surface is `tx`"*.

**Việc cần làm (chọn 1):**
- **(a) Đẩy audit ra ngoài transaction** — handler `return` payload + danh sách audit event, caller/bus
  emit sau khi commit. Sạch nhất, nhưng đổi chữ ký.
- **(b) Audit-through-outbox** — ghi audit vào outbox trong cùng tx, publisher đẩy đi sau commit.
  Nhất quán với cơ chế outbox đã có ở core-api; auth-service chưa có outbox ⇒ chi phí cao hơn.
- **(c) Chấp nhận at-least-once cho audit**, ghi rõ vào `directives/logging_standard.md` +
  sửa comment của `ITransactionalCommandHandler` cho khỏi nói dối. Rẻ nhất, nhưng phải sửa
  cả phần detect credential-stuffing (đếm theo `actorEmailHash`) để dedupe theo request id.

> **Cần owner quyết** — đây là trade-off audit-fidelity ↔ chi phí, không phải HOW thuần tuý.

### 1.3 Handler thiếu `kind` lọt qua validate lúc boot
**File:** `packages/shared-kernel/src/cqrs/command-bus.ts:65,80`

`register()` chỉ check khi `kind === 'transactional'`; object không có `kind` boot xanh rồi chết
runtime bằng `TypeError: Cannot read properties of undefined (reading 'name')`.

**Việc cần làm:**
```ts
// register()
if (handler.kind === 'saga') { /* ok */ }
else if (handler.kind === 'transactional') { /* canResolve check như hiện tại */ }
else { throw new UnknownHandlerKindError(commandName, (handler as any)?.kind) }
```
- Thêm `UnknownHandlerKindError` vào `cqrs.error.ts`.
- Đối xứng ở `execute()`: nhánh `else` cuối throw thay vì rơi vào `runTransactional`.
- Thêm test ở `command-bus.spec.ts`: đăng ký object `{}` ⇒ throw lúc register, không phải lúc execute.

### 1.4 Metric `db_transient_error` đếm cả lỗi nghiệp vụ
**File:** `apps/{core-api,auth-service,notification-service}/src/infrastructure/database/prisma/prisma-transient-error.ts:42`

`recordDbTransientErrorObservation` inc counter cho **mọi** `PrismaClientKnownRequestError` — P2002
(trùng tên space), P2025 (not found), P2003 (FK) đều vào. Diff này còn nới phạm vi: `withRetry` giờ
bọc **mọi** command non-saga, trước kia chỉ bọc `transactional:true`.

**Việc cần làm:** giới hạn label set về đúng nhóm quan tâm (`P2034`, `P2028`, connection errors),
hoặc tách hẳn 2 metric: `db_transient_error_total` vs `db_known_request_error_total`.
Nhớ rà lại alert threshold đang dựng trên metric này.

---

## Wave 2 — Bịt lỗ ADR tuyên bố đã bịt

### 2.1 Event handler đi vòng qua CommandBus ⇒ không có boot-check, không có retry
**File:** `apps/search-service/.../index-knowledge.handler.ts:43,68`,
`apps/notification-service/.../item-published.handler.ts` (+ follow-created, follow-removed)

`ITxRunner.canResolve` **chỉ có đúng một caller** trong toàn repo: `CommandBus.register`.
search-service **không có CommandBus** ⇒ `SEARCH_TX_SCOPE` không được validate lúc boot lần nào.
ADR §2.4 tuyên bố *"service không boot được"* và *"VƯỢT Wolverine"* — không đúng cho service này.

**Việc cần làm:**
- Mở rộng `EventRouter.register()` (đã fail-fast cho `idempotency: 'none'`) để cũng validate TxScope.
  Vướng cấu trúc: command handler khai `readonly txScope` (đọc được lúc register), event handler
  chôn token trong thân method. ⇒ **cần thêm `readonly txScope?: TxScopeToken<any>` vào
  `IIntegrationEventHandler`** cho handler có ghi DB, rồi router check `canResolve`.
- Cân nhắc cho event handler dùng chung `withRetry` (transient-aware) thay vì chỉ dựa vào
  `ResilientEventConsumer.routeWithRetry` (retry mù mọi lỗi, backoff tuyến tính).
- Sửa JSDoc sai ở `apps/search-service/.../prisma-tx-runner.ts:24` và bản worker-service.

### 2.2 OCC của credit event-store không bao giờ được retry
**File:** `apps/core-api/src/modules/credit/infrastructure/repositories/prisma-credit-event.repository.ts:34`

P2002 trên `@@unique([aggregateId, version])` bị đổi thành `CreditConcurrencyError` **trước khi** bus
kịp phân loại; `isPrismaTransientError` chỉ nhận P2034 ⇒ không retry. Trong khi `SpendCreditsHandler`
rollback sạch và `loadOrOpen()` re-read version mới khi retry — tức là ca retry-được điển hình nhất
của cả hệ thống lại nằm ngoài cơ chế retry.

**Việc cần làm (chọn 1):**
- Cho `CreditConcurrencyError` implement một marker (`readonly transient = true`) và
  `isPrismaTransientError` nhận marker đó, **hoặc**
- Bọc riêng OCC retry trong handler, **hoặc**
- Quyết định để nguyên (409 cho client) nhưng **ghi vào ADR §6 "KHÔNG giải quyết được"** — hiện ADR
  đang ngụ ý ngược lại.

> **Cần owner quyết** — 409-cho-client vs tự retry là quyết định UX/nghiệp vụ.

---

## Wave 3 — Tài liệu & tính trung thực của ADR

### 3.1 Directives/docs còn dạy kiến trúc đã xoá
Chưa làm bước 5 của chính ADR §7.

| File | Chỗ hỏng |
|---|---|
| `directives/resilience_patterns.md` | §318–420: `commandBus.use(...)`, `RetryMiddleware`, `command.options?.transactional`, `CommandOptions.retryable`. Dòng 354 còn sai sự thật từ trước: nói retry cả `P2028` trong khi code chỉ retry `P2034` |
| `readme.md:162` | `Middleware Chain: LoggingMiddleware → RetryMiddleware → TransactionMiddleware → Handler` |
| `.ai/plans/phase2-event-backbone.plan.md:16` | mô tả `TransactionMiddleware` |
| `apps/{core-api,auth-service,notification-service}/.../prisma-transient-error.ts:6,33` | JSDoc trỏ `RetryMiddleware` — class vừa bị chính diff này xoá |
| `docs/linkedin_posts_plan.md:106-122` | bài viết dựa trên middleware chain (nội dung marketing, sửa sau cũng được) |

### 3.2 ADR tự mâu thuẫn ở 3 chỗ §6b chưa với tới
- §2.2 vẫn ghi `compensate(command, ctx) // BẮT BUỘC` và *"saga thiếu bù trừ = **lỗi compile**"*.
- §3 bảng vẫn ghi lỗ #4 mức **"Compile error"**.
- Thực tế ship: `compensation: 'registered' | 'not-needed'` — một **lời tự khai**, không phải tính chất
  của code. Viết `'not-needed' as const` trong khi vẫn gọi gRPC ⇒ không lỗi compile, không cảnh báo.

  ⇒ Theo `docs/adr/README.md` (*"không sửa lén"*), **đừng sửa §2.2/§3**; thêm dòng trỏ chéo tại §3
  bảng: *"xem §6b — mức thực tế là khai báo bắt buộc + kiểm tra runtime, không phải compile error"*.

### 3.3 §4 dẫn eShop làm tiền lệ cho re-entrancy guard nhưng làm ngược lại
eShop: `if (_dbContext.HasActiveTransaction) { return await next(); }` — **join**.
Code này: **throw** `NestedTransactionError`. Lập luận chọn throw (§4.1, §5) tự nó đứng vững, và các
tiền đề kỹ thuật đã verify đúng (prisma 7.8.0, `$transaction` vẫn còn trên `TransactionClient`).
Nhưng cách trình bày phải là *"eShop join; ta cố ý đi khác vì …"*, không phải *"eShop là tiền lệ"*.
⇒ Sửa 1 ô trong bảng §4. Đây là điểm owner yêu cầu "không tự chế" nên nó quan trọng.

### 3.4 `npm run check` đang đỏ
`search-service#format:check` fail — 5 file, 3 file thuộc diff này. ADR §9 ghi "19/19 xanh" là kết quả
của `turbo typecheck test` (đúng: 404 test), không phải gate CLAUDE.md quy định.
⇒ `cd apps/search-service && npx prettier --write "src/**/*.ts"`, rồi sửa lại câu trong §9 cho khớp
đúng lệnh đã chạy.

---

## Wave 4 — Trùng lặp & code chết (không chặn commit)

### 4.1 `PrismaTxRunner` copy 5 lần
notification/search/worker **giống hệt từng byte**; core-api chỉ khác JSDoc; auth-service chỉ khác
`prisma.$transaction` vs `prisma.client.$transaction` + thiếu `@Injectable()`.
Phần ORM-specific đúng **2 dòng**. Registry, `canResolve`, nesting guard, `TRANSACTION_TIMEOUT_MS`,
2 message lỗi — đều ORM-agnostic.

⇒ `abstract class AbstractTxRunner implements ITxRunner` trong shared-kernel với đúng một
`protected abstract beginTransaction<R>(fn: (db: unknown) => Promise<R>): Promise<R>`.
Không có gì kiểu-Prisma phải chuyển vào shared-kernel ⇒ **không phá mục tiêu ORM-agnostic**.
Lợi ích phụ: `getTx`/`runInTransaction` thôi phải là public export của shared-kernel — đúng cái API
duy nhất có thể tái tạo lại bug ambient-fallback mà ADR sinh ra để giết.

### 4.2 `prisma-transient-error.ts` copy 3 lần
Khác nhau đúng 1 chuỗi metric name + 1 import path. Quyết định được lập luận kỹ nhất của cả thay đổi
này (**cố ý loại P2028** để tránh retry-storm) đang nằm ở 3 nơi.
⇒ factory `makePrismaTransientErrorHelpers({ metricPrefix, Prisma })`.
Kèm đó: `cqrs.module.ts` của core-api và notification-service **giống hệt từng byte** ⇒
`createCqrsProviders({ isTransientError, onRetryableError })`.

### 4.3 `PrismaTxRunner` của worker-service là code chết
Không có TxScope nào, không `registerScope` nào, không CommandBus. `canResolve` luôn false,
`run` luôn throw. 57 dòng không đường nào chạm tới, kèm JSDoc sai.
⇒ Xoá file + gỡ `PrismaTxRunner`/`TX_RUNNER` khỏi `prisma.module.ts`. ADR §9.6 giải thích lý do giữ
("đồng bộ hạ tầng") — nếu vẫn muốn giữ thì tối thiểu phải sửa comment cho đúng sự thật.

### 4.4 Mất log ranh giới transaction
`TransactionMiddleware` cũ log 3 dòng debug (`Starting` / `committed` / `rolled back`) dưới
`LogContext.TRANSACTION`. `runTransactional` mới là one-liner không log gì.
`LogContext.TRANSACTION` giờ **mồ côi**, mà giá trị của nó lại đúng bằng chuỗi `'TransactionMiddleware'`
— một mục taxonomy log trỏ tới class đã xoá. Saved search Kibana lọc `context:TransactionMiddleware`
từ nay trả về rỗng.
⇒ Hoặc log lại ở `runTransactional`/`AbstractTxRunner` và đổi giá trị enum thành `'Transaction'`,
hoặc xoá hẳn enum member. Đừng để trạng thái lửng như hiện tại.

### 4.5 Các điểm nhỏ hơn
- `ITxScopeFactory.create(db: unknown)` ⇒ 9 chỗ `as Prisma.TransactionClient` không được kiểm.
  Sửa thành `ITxScopeFactory<S, DB = unknown>`, mỗi service alias lại — shared-kernel vẫn zero-Prisma.
- `readonly kind = 'transactional' as const` lặp ở 36 handler, trong khi `txScope` đã đủ để narrow
  union (`'txScope' in handler`). Cân nhắc `abstract class TransactionalHandler<C,R,S>`.
  **Đánh đổi:** `kind` tường minh dễ đọc hơn; nếu giữ thì giữ có chủ đích, đừng vì quán tính.
- `RetryPolicy.maxRetries` không validate: `NaN` (từ `Number(process.env.X)` chưa set) hoặc số âm ⇒
  vòng lặp không chạy lần nào ⇒ **mọi command** trả 500 `UNREACHABLE`. Hiện chưa chạm được vì cả 3
  composition root đều truyền `undefined`. Là bẫy tiềm ẩn trên public API, không phải bug sống.
  ⇒ validate trong constructor.
- `withRetry` (command-bus) và `ResilientEventConsumer.routeWithRetry` là 2 vòng retry khác cấu trúc,
  khác backoff, khác hook signature, cùng nằm trong shared-kernel. Cân nhắc một
  `retryAsync()` trong `packages/shared-kernel/src/resilience/` (thư mục đã tồn tại).

---

## Câu hỏi cần owner chốt trước khi code

1. **1.2** — audit trong transaction: đẩy ra ngoài (a), qua outbox (b), hay chấp nhận at-least-once (c)?
2. **1.1** — org mồ côi sau khi saga fail: soft-delete tự động hay để admin dọn tay?
3. **2.2** — OCC credit: tự retry, hay giữ 409 và ghi vào ADR là giới hạn có chủ đích?
4. **4.1/4.2** — gom `AbstractTxRunner` + factory transient-error ngay trong đợt này, hay tách commit sau?

---

## After-Task Protocol cho chính plan này

Khi thực thi xong mỗi wave: log lesson vào `.ai/memory/architecture.jsonl`, cập nhật
`directives/resilience_patterns.md` + `cqrs_pattern.md`, cập nhật `.ai/PROJECT_STATUS.md`.
**Không** sửa tay `.ai/KNOWLEDGE_INDEX.md` (hook `Stop` tự sinh).
