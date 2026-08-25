# ADR-0001 — Ranh giới Transaction & Retry: Unit of Work + suy từ chữ ký + fail-fast lúc boot

- **Status:** Accepted — 2026-07-29. **IMPLEMENTED cùng ngày trên TOÀN BỘ 5 package** (owner bỏ pilot,
  yêu cầu áp thẳng mọi service). Xem §9 cho những gì thực tế lệch khỏi bản thiết kế này.
- ⚠️ **PARTIALLY SUPERSEDED by [ADR-0002](0002-placement-rule-and-outbox-as-capability.md) (2026-08-24).**
  Nội dung dưới đây **giữ nguyên văn** theo quy ước ở `README.md` (*"đánh dấu Superseded, đừng sửa nội
  dung gốc"*) — đọc nó như bản ghi *quyết định lúc 2026-07-29*, không phải mô tả code hôm nay. Hai
  phần đã bị thay:
  - **§5 `TxScopeToken` + registry** → collapse còn **MỘT** repos shape mỗi service, dựng bởi một
    factory, truyền vào constructor của `PrismaTxRunner`. TypeScript từ chối dựng runner thiếu
    factory, mạnh hơn hẳn check `canResolve()` lúc boot mà nó thay thế. (Landed 2026-07-30, mãi đến
    ADR-0002 mới được ghi thành ADR — chính khoảng trễ đó là thứ ADR-0002 §1 nói tới.)
  - **§9 điểm 2 `IOutboxAppender` / `IOutboxDispatchRepository`** → `IOutboxWriter` / `IOutboxStore`,
    và cả hai chuyển sang `packages/shared-kernel/src/outbox/` cùng với engine. `IOutboxDispatchRepository`
    thực ra **bị xoá hẳn** một lúc (mọi consumer đều là infra của core-api) rồi mới quay lại dưới tên
    `IOutboxStore` khi engine sang shared-kernel — xem ADR-0002 §2.1.
  - **Vẫn còn hiệu lực:** Unit of Work, suy transaction từ **kiểu** của handler thay vì cờ, fail-fast
    lúc boot, và toàn bộ §1 (6 lỗ hổng) — đó vẫn là lý do kiến trúc này tồn tại.
- **Người quyết:** owner dự án. **Người soạn:** AI agent, theo research có dẫn nguồn (§Tham chiếu).
- **Phạm vi:** mọi write path đi qua `CommandBus` ở core-api / auth-service / notification-service, và
  event handler ghi DB ở notification-service / search-service.

---

## 1. Bối cảnh

Thiết kế hiện tại (xem `directives/cqrs_pattern.md`): `CommandBus` + pipeline middleware
`Logging → Retry → Transaction → Handler`, transaction truyền ngầm qua `AsyncLocalStorage`
(`runInTransaction` / `getTx()`), repository đọc bằng `getTx() ?? this.prisma.client`, và command khai
`options.transactional: boolean`.

Thiết kế này **đúng về mặt cơ chế** và có tiền lệ thật (§4). Vấn đề không nằm ở cơ chế, mà ở chỗ:
**mọi bất biến giữ cho nó đúng đều chỉ được bảo vệ bằng comment, kỷ luật, hoặc lint bổ sung — không
cái nào được cưỡng chế bởi type hay cấu trúc.** Audit ngày 2026-07-28/29 tìm ra 6 lỗ hổng:

| # | Lỗ hổng | Bằng chứng thực tế |
|---|---|---|
| 1 | Repo quên `getTx()` → write nằm NGOÀI transaction đang mở | notification-service có `TransactionMiddleware` wired sẵn nhưng cả 2 repo ghi thẳng `this.prisma.client`. Bẫy đã lắp, chưa nổ vì chưa có command nào `transactional: true` |
| 2 | Cờ `transactional` nằm trên command DTO, lệnh ghi nằm trong handler → **lệch nhau âm thầm** | Thêm 1 lệnh ghi repo thứ hai vào handler mà quên mở file command để bật cờ ⇒ mất atomicity, không lỗi |
| 3 | Dispatch lồng nhau → 2 transaction ĐỘC LẬP | `TransactionMiddleware` gọi `run()` vô điều kiện, không kiểm tra ambient. Base client **không** join transaction đang mở → connection khác, inner commit độc lập. Hôm nay chưa nổ **chỉ vì** `ProvisionOrgCommand` để `transactional: false` |
| 4 | Saga quên compensation | Không có gì ép; `ProvisionOrgHandler` có compensation là do người viết nhớ |
| 5 | I/O ngoài (gRPC/HTTP) bên trong transaction | Chỉ được chặn bằng JSDoc. Prisma docs cảnh báo thẳng: *"avoid performing network requests… inside your transaction functions"* |
| 6 | **Thứ tự pipeline không được đảm bảo** | Thứ tự đến từ thứ tự gọi `commandBus.use()` ở composition root. Đảo `Retry`/`Transaction` ⇒ retry chạy trong transaction đã abort ⇒ **retry vô dụng hoàn toàn, không lỗi nào báo** |

Lỗ #1 đã được vá tạm bằng ESLint `no-restricted-syntax` (2026-07-28) — nhưng lint là lớp bọc ngoài, không
phải bảo đảm cấu trúc: service mới không copy config là bẫy quay lại.

### 1.1 Phát hiện định hình lại mục tiêu

Research (§4) cho thấy **mọi framework thật đều có ít nhất một lỗi im lặng**, kể cả bản tiên tiến nhất:

| Hệ | Lỗi im lặng |
|---|---|
| Spring `@Transactional` | self-invocation bypass proxy → aspect không chạy, **không lỗi compile lẫn runtime** |
| MediatR pipeline | thứ tự = thứ tự đăng ký DI, **không validate, không cảnh báo** |
| Wolverine | handler nhận `IDocumentSession` mà chain thiếu transactional middleware → **"all writes are silently discarded"** |
| Cortex (hiện tại) | 6 lỗ ở bảng trên |
| **EF Core** | **KHÔNG — ném `InvalidOperationException`** khi retry strategy gặp user-initiated transaction |

⇒ Mục tiêu đúng **không phải** "làm cho không thể viết sai" (bất khả thi trong TypeScript, không có
effect system), mà là:

> **Chỗ nào làm cho bất khả thi được thì làm. Chỗ nào không, phải làm cho nó NỔ TO và SỚM — lúc boot,
> không phải lúc production.**

Codebase **đã có sẵn** đúng kỹ thuật này: `EventRouter.register()` ném lỗi ngay lúc boot nếu handler
khai `idempotency: 'none'`. ADR này mở rộng chính kỹ thuật đó sang transaction.

---

## 2. Quyết định

Áp dụng **phương án C**: Unit of Work phơi repository + suy nhu cầu transaction từ **chữ ký handler**
(bỏ hẳn cờ) + **validate lúc boot** + guard tái nhập + thứ tự pipeline cố định trong cấu trúc.

### 2.1 Unit of Work phơi repository (`TxScope`)

Repository **không tự đi tìm** client — nó **được trao** lúc construct. Không còn nhánh fallback để quên.

```typescript
// domain — thuần, không Prisma
export interface KnowledgeTxScope {
  readonly items: IKnowledgeItemRepository
  readonly revisions: IRevisionRepository
  readonly outbox: IOutboxRepository
}

// infrastructure
export class KnowledgeTxScopeFactory implements ITxScopeFactory<KnowledgeTxScope> {
  create(db: Prisma.TransactionClient): KnowledgeTxScope {
    return {
      items: new PrismaKnowledgeItemRepository(db),
      revisions: new PrismaRevisionRepository(db),
      outbox: new PrismaOutboxRepository(db),
    }
  }
}
```

> **Giữ nguyên mục tiêu hexagonal ban đầu.** `cqrs_pattern.md §Problem` sinh ra `AsyncLocalStorage` là để
> **chữ ký repository không dính type Prisma**. `TxScope` inject client lúc *construct*, không truyền theo
> từng method ⇒ `IKnowledgeItemRepository.save(item)` vẫn sạch, không có tham số `tx`. Đạt đúng mục tiêu cũ,
> mà bỏ được fallback. (Biến thể "method nhận `TxHandle` branded type" đã bị bác — nó làm hỏng đúng mục tiêu này.)

### 2.2 Bỏ cờ — phân loại handler bằng TYPE

```typescript
export interface ITransactionalHandler<C extends ICommand, R, S> {
  readonly kind: 'transactional'
  readonly txScope: TxScopeToken<S>              // khai MÌNH CẦN scope nào
  execute(command: C, tx: S): Promise<R>
}

export interface ISagaHandler<C extends ICommand, R> {
  readonly kind: 'saga'
  execute(command: C, ctx: SagaContext): Promise<R>
  compensate(command: C, ctx: SagaContext): Promise<void>   // BẮT BUỘC
}

export type ICommandHandler<C extends ICommand, R> =
  | ITransactionalHandler<C, R, any>
  | ISagaHandler<C, R>
```

- **Giết lỗ #2:** không còn cờ để lệch. Muốn ghi repo ⇒ phải có `tx` ⇒ phải là `ITransactionalHandler`
  ⇒ bus đã mở transaction. Thêm lệnh ghi thứ hai không cần sửa file nào khác.
- **Giết lỗ #4:** `compensate()` là member bắt buộc của discriminated union ⇒ saga thiếu bù trừ = **lỗi compile**.
- **Thu hẹp lỗ #5:** `ITransactionalHandler` chỉ nhận `tx` trong `execute`; constructor **không** được inject
  gRPC/HTTP caller. Không được trao thì không gọi được (capability-based DI). Các client ngoài chỉ sống ở saga handler.

### 2.3 Pipeline cố định trong CẤU TRÚC, không do composition root nhớ

Bỏ `commandBus.use()` tuỳ ý. Bus tự dựng thứ tự trong **thân một hàm** — sai thứ tự trở thành bất khả biểu diễn:

```typescript
private dispatch<C extends ICommand, R>(command: C, handler: ICommandHandler<C, R>): Promise<R> {
  return this.withLogging(command, () => {
    if (handler.kind === 'saga') return handler.execute(command, this.sagaContext())
    return this.withRetry(command, () =>                                  // retry BỌC NGOÀI
      this.txRunner.run(handler.txScope, (tx) => handler.execute(command, tx)),
    )
  })
}
```

**Giết lỗ #6.** Đây đúng cách `dotnet/eShop` làm: retry và transaction nằm trong **một khối code duy nhất**,
không phải hai đăng ký DI rời.

### 2.4 Guard tái nhập + fail-fast lúc boot

```typescript
// TxRunner.run — giết lỗ #3
if (getTx() !== undefined) {
  throw new NestedTransactionError(scopeToken)   // NỔ TO, không âm thầm mở tx thứ hai
}
```

```typescript
// CommandBus.register — chạy lúc boot, giết phần còn lại của #1/#2/#5
register(commandType, handler) {
  if (handler.kind === 'transactional' && !this.scopeFactories.has(handler.txScope)) {
    throw new Error(
      `Handler for ${commandType.name} khai txScope "${String(handler.txScope)}" nhưng chưa có ` +
      `TxScopeFactory nào đăng ký cho nó — service sẽ ghi ngoài transaction. Đăng ký factory trước.`,
    )
  }
  // …
}
```

> **Điểm này VƯỢT Wolverine.** Wolverine để lỗi "handler cần session nhưng chain thiếu middleware" xảy ra
> **lúc runtime và nuốt luôn write**. Ở đây, cùng tình huống ⇒ **service không boot được**.

### 2.5 Rollback mặc định

Prisma `$transaction(callback)` đã rollback khi callback throw — giữ nguyên, và **không** thêm cơ chế
"commit tường minh" nào khác. Đúng tinh thần Cosmic Python: *"only one code path that leads to changes"*.

---

## 3. Lỗ hổng nào được giải quyết tới đâu

| # | Lỗ hổng | Mức sau ADR này |
|---|---|---|
| 1 | Repo quên `getTx()` | **Cấu trúc** — không tồn tại fallback để quên |
| 2 | Cờ lệch khỏi handler | **Cấu trúc** — không còn cờ |
| 4 | Saga quên compensation | **Compile error** cho việc THIẾU khai báo (xem §6b — implement thật là `compensation: 'registered'\|'not-needed'` + kiểm tra runtime khi khai `'registered'` mà không đăng ký gì, KHÔNG phải compile error cho việc khai SAI SỰ THẬT) |
| 6 | Thứ tự pipeline | **Cấu trúc** — nằm trong một thân hàm |
| 3 | Nested dispatch | **Nổ to** (`NestedTransactionError`) + transactional handler không được inject bus |
| 5 | I/O ngoài trong tx | **Không được trao capability** + lint chặn import; **không** cấm được tuyệt đối |

**4/6 triệt tiêu bằng cấu trúc, 2/6 chuyển từ im lặng sang nổ.** Không tuyên bố 6/6 — xem §6.

---

## 4. Tiền lệ — từng mảnh, có nguồn

Yêu cầu của owner: **không chấp nhận kiến trúc tự chế.** Đối chiếu từng thành phần:

| Thành phần | Tiền lệ | Ghi chú |
|---|---|---|
| UoW **phơi repository** (`tx.items`) | *Architecture Patterns with Python* (O'Reilly), ch.6: `class AbstractUnitOfWork: batches: AbstractRepository` | Lý do tác giả: *"a single entrypoint to our persistent storage… a handy place to get a repository"* |
| Rollback mặc định, một đường dẫn tới thay đổi | cùng nguồn: *"only one code path that leads to changes"* | |
| **Suy nhu cầu transaction từ chữ ký handler**, bỏ cờ | Wolverine `AutoApplyTransactions()` — *"automatically use the transactional middleware for handlers that have a dependency on `IDocumentSession`"* | Wolverine sinh ra sau khi tác giả phê phán mô hình MediatR |
| Retry + Transaction trong pipeline command bus | `dotnet/eShop` `TransactionBehavior.cs` (kiến trúc tham chiếu .NET, repo **đang sống**) | `CreateExecutionStrategy()` bọc `BeginTransactionAsync()` |
| **Retry bọc ngoài Transaction** | eShop (trên) + EF Core **cưỡng chế**: ném `InvalidOperationException` nếu làm ngược | |
| **Guard tái nhập — CHỦ ĐÍCH ĐI KHÁC eShop, không phải cùng tiền lệ** | eShop: `if (_dbContext.HasActiveTransaction) { return await next(); }` — tức là **JOIN** transaction đang mở, không mở transaction mới | Cortex **THROW** `NestedTransactionError` thay vì join (xem §2.4, §4.1, §5). Lý do đi khác: base Prisma client không tự join transaction đang mở (khác EF Core `DbContext` dùng chung 1 connection) — join thật sự đòi savepoint (Prisma 7.5+, xem §4.1), và ta cố ý CHƯA dùng savepoint vì lồng command trong transaction gần như luôn là design smell. eShop không phải tiền lệ CHO cách làm này — nó là điểm đối chiếu cho thấy Cortex chọn hướng nghiêm ngặt hơn |
| **Fail-fast lúc đăng ký handler** | EF Core (ném thay vì im lặng) + **chính repo này**: `EventRouter.register()` ném khi `idempotency: 'none'` | Không phải kỹ thuật mới trong codebase |
| Transaction boundary thuộc application layer | DDD/Clean Architecture: *"Transaction boundaries belong to the application/service layer: one business operation → one transaction"* | Handler = application service |

Không mảnh nào không có nguồn.

### 4.1 Ràng buộc kỹ thuật đã kiểm chứng trên chính stack này

- Prisma cài đặt: **7.8.0** (kiểm tra `node_modules`).
- `Prisma.TransactionClient = Omit<PrismaClient, ITXClientDenyList>`, và denylist thật là
  `["$connect","$disconnect","$on","$use","$extends"]` ⇒ **`$transaction` VẪN CÒN** trên tx client.
  ⚠️ Nhiều bài blog khẳng định ngược lại ("tx client không có `$transaction` nên không nest được") —
  **sai với 7.x**, đừng dựa vào đó làm cơ chế an toàn.
- Prisma **7.5.0+** hỗ trợ nested transaction bằng **SAVEPOINT** (inner rollback theo outer) — nhưng chỉ khi
  nest qua **tx client**. Gọi `$transaction` trên **base client** thì **không join**, chạy connection riêng.
  Đây chính là điều `PrismaTransactionManager.run()` đang làm ⇒ nguồn gốc lỗ #3.
- Ta **chọn ném lỗi** thay vì dùng savepoint: lồng command trong transaction gần như luôn là design smell.
  Savepoint là đường lùi có sẵn nếu sau này gặp ca hợp lệ thật.

---

## 5. Phương án đã cân nhắc và BÁC

| Phương án | Vì sao bác |
|---|---|
| **Giữ nguyên + chỉ thêm lint** (hướng A) | Vá được #1/#6 nhưng #2/#3/#4/#5 vẫn dựa vào kỷ luật. Lint là lớp ngoài, service mới không copy config là bẫy quay lại |
| **Decorator `@Transactional()` kiểu Spring** | Spring có **silent failure trứ danh**: self-invocation bypass proxy, transaction đơn giản không chạy, không lỗi nào. Đổi bẫy im lặng này lấy bẫy im lặng khác |
| **NestJS Interceptor** | (a) Interceptor luôn nằm NGOÀI bus ⇒ không thể chèn giữa Retry và Handler ⇒ đảo thứ tự đúng của #6; (b) auth-service là Fastify thuần, **không có NestJS** ⇒ phải có cơ chế thứ hai cho cùng một việc |
| **Ambient UoW kiểu ABP.IO** (giữ ALS, không explicit) | Lý lẽ của phe ambient là thật (*ít nhiễu, không rò tầng*), NHƯNG: ambient an toàn **khi framework cưỡng chế** (ABP.IO, Spring, EF Core). Tự chế thì nhận được **tính vô hình mà không có sự cưỡng chế** — phần tệ nhất của cả hai phe. Đó đúng là vị trí hiện tại của Cortex |
| **Wolverine-style source generation** | Sinh mã lúc khởi động là cách Wolverine tránh "Russian Doll" của MediatR — nhưng cần build step + code generator, đặc thù .NET. Chi phí hạ tầng không tương xứng cho 1 bất biến |
| **Effect-TS (typed effects)** | Cách DUY NHẤT cấm được `fetch()` trong transaction ở mức type. Nhưng là đổi paradigm toàn codebase + cả hệ sinh thái. Giá vượt xa lợi ích |
| **UnitOfWork lifecycle phases kiểu Axon** (`onPrepareCommit`/`onAfterCommit`) | Cân nhắc để publish integration event sau commit. **Bác**: outbox + polling publisher của Cortex **bền hơn** — after-commit hook mất event nếu process chết ngay sau commit, outbox thì không |
| **Dựa vào savepoint của Prisma 7.5+ cho nesting** | Kỹ thuật có thật và khả dụng, nhưng biến một design smell thành hợp lệ âm thầm. Chọn ném lỗi; giữ savepoint làm đường lùi |

---

## 6. Hệ quả

**Được:**
- 4/6 bất biến chuyển từ "nhớ thì đúng" sang "không thể sai".
- Bỏ được `options.transactional` khỏi mọi command DTO — bớt một khái niệm.
- Bỏ được ESLint rule `no-restricted-syntax` cho repository (không còn `this.prisma.client` để cấm).
- Test dễ hơn: `TxScope` là object thuần, mock không cần ALS.

**Mất / phải chấp nhận:**
- `tx` xuất hiện tường minh trong chữ ký handler — **ồn hơn** ALS. Đây là đánh đổi explicitness ↔ ergonomics,
  và ta chọn explicitness **cho riêng hoàn cảnh này** (tự chế, không có framework cưỡng chế).
- Repository **thôi là singleton NestJS**, trở thành object tạo theo từng transaction (wrapper stateless, rẻ).
- Migration lớn: mọi command handler + mọi write repository ở 4 service.
- Thêm một registry `TxScopeFactory` cho mỗi module.
- Query-side **không đổi** (`application/queries/*.query-repository.ts` vẫn dùng client thường, không cần tx).

**KHÔNG giải quyết được:**
- TypeScript không cấm được `fetch()` giữa một method ⇒ #5 mãi là *safe by capability*, không phải *by proof*.
- Không phòng được việc giữ `tx` lại rồi dùng sau khi transaction đóng — nhưng Prisma ném
  *"Transaction already closed"*, tức **nổ to**, chấp nhận được.

---

## 6b. AMENDMENT (2026-07-29, trong lúc implement) — saga dùng compensation STACK, không phải `compensate(command)`

§2.2 bản gốc quy định `ISagaHandler.compensate(command, ctx)` là member bắt buộc. **Không dùng được**:
saga thật duy nhất (`ProvisionOrgHandler`) phải huỷ một user tạo giữa chừng bằng `userId` do gRPC trả về —
một chữ ký chỉ nhận `command` không nhìn thấy giá trị đó, nên sẽ phải nhét state bag, tức code TỆ HƠN
hiện trạng.

Thay bằng **compensation stack qua closure** (pattern saga chuẩn):

```typescript
const { userId } = await this.authClient.provisionUser(...)
ctx.onCompensate(async () => { await this.authClient.cancelProvisionedUser(userId) })
```

Bus chạy stack theo thứ tự NGƯỢC khi execute throw, và **nuốt lỗi bù trừ để không che lỗi gốc** — trước
đây `ProvisionOrgHandler` tự viết tay bằng try/catch lồng, giờ là bảo đảm của bus (test ở
`command-bus.spec.ts`, không còn ở spec của handler).

Để **không mất** lỗ hổng #4 (saga quên bù trừ), giữ một khai báo bắt buộc `readonly compensation:
'registered' | 'not-needed'` — cùng kỹ thuật `IIntegrationEventHandler.idempotency` đã dùng. Bus còn
log `error` nếu handler khai `'registered'` mà lúc fail chưa đăng ký compensation nào: khai báo được ép
lúc compile, tính trung thực của khai báo được kiểm lúc chạy.

Đây đúng là loại vấn đề mà pilot lẽ ra phải lộ ra — nó lộ ra khi implement.

## 7. Kế hoạch triển khai

1. **Pilot `notification-service`** — nhỏ nhất (2 repo, 1 command `MarkNotificationRead`, đã có CQRS +
   transaction manager). Đủ để lộ ma sát thật mà không cược cả monorepo.
2. Rà lại ADR này sau pilot — nếu ma sát vượt dự kiến, ghi `Superseded` và viết ADR-0002, **không sửa lén**.
3. Port `core-api` (nhiều command nhất, rủi ro cao nhất), rồi `auth-service`.
4. `search-service`: chỉ có event handler, không có command — áp `TxScope` cho `IndexKnowledgeHandler` phần
   ghi pgvector; phần ghi Elasticsearch **giữ nguyên ngoài transaction** (cross-store, transaction bất khả thi
   — idempotency + retry/DLQ, xem `eventing_patterns.md`).
5. Sau khi 4 service xong: cập nhật `directives/cqrs_pattern.md` + `eventing_patterns.md`, gỡ lint rule
   `no-restricted-syntax` đã thành thừa.

---

## 9. Đã triển khai thực tế (2026-07-29) — và những gì phát sinh ngoài thiết kế

Toàn bộ 5 package đã migrate; `turbo typecheck test` **19/19 task xanh, 404 test pass**
(shared-kernel 67, core-api 143, auth-service 109, search-service 50, notification-service 35).

Quy mô: 38 command handler, 26 repository, 3 composition root khác nhau, 8 TxScope
(Knowledge/Engagement/Tenant/Credit ở core-api, Auth/Rbac/User ở auth-service, Notification, Search).

**Phát sinh ngoài thiết kế — đều là hệ quả tốt, ghi lại để không ai tưởng là lệch chuẩn:**

1. **Buộc phải tách read/write ở 5 chỗ** vốn đang đọc qua write-repo. Vì write-repo giờ chỉ sống trong
   TxScope, mọi caller chạy NGOÀI transaction phải có read port riêng:
   `IMembershipQueryRepository.findRoleByOrgAndUser` (OrgGuard chạy TRƯỚC handler), `IOrgRolePermissionReader`,
   `ISearchChunkReader`, `IOutboxDispatchRepository`, và query-repo riêng của notification-service.
   Đây chính là luật CQRS mà `cqrs_pattern.md` đã quy định từ lâu — kiến trúc mới **ép** nó thay vì khuyên.
2. **`IOutboxRepository` tách đôi** thành `IOutboxAppender` (trong mọi TxScope) + `IOutboxDispatchRepository`
   (singleton). Comment cũ *"never called via getTx() so row locks never span the Kafka network I/O"* từ
   lời hứa trở thành sự thật về cái mà caller có thể với tới.
3. **`IOrgRolePermissionReader` phải đặt ở `domain/`, không phải `application/queries/`** — vì domain
   service `OrgPermissionResolver` phụ thuộc nó, mà domain không được import application. Suýt phá boundary.
4. **`PrismaSearchChunkRepository` đơn giản đi hẳn**: bỏ được cả `$transaction` tự mở lẫn nhánh kiểm tra
   ambient-tx chống nesting — caller sở hữu ranh giới transaction nên cả ca đặc biệt biến mất.
5. **Lint rule `no-restricted-syntax`** (thêm 2026-07-28 để chặn `this.prisma.client.<model>`) đã **gỡ**:
   nó trở nên vừa thừa vừa SAI — thừa vì pattern đó không còn biểu diễn được ở write-repo, sai vì nó sẽ
   chặn nhầm query-repo hợp lệ vốn phải dùng client thường.
6. **`worker-service`** không có repository nào nhưng vẫn được cấp `PrismaTxRunner` để đồng bộ hạ tầng.

## 9b. Review sau triển khai (2026-07-30) — lỗ hổng thực thi tìm thấy + đã vá

Review kiến trúc độc lập (8 góc: line-by-line, removed-behavior, cross-file, concurrency/retry,
reuse/simplification, efficiency, altitude/ADR-fidelity, CLAUDE.md conventions) tìm thấy code
**đúng thiết kế ở §2** nhưng lệch ở vài chỗ thực thi. Đã vá cùng ngày, kế hoạch chi tiết ở
`.ai/plans/adr-0001-review-remediation.plan.md`:

1. **Saga không bù trừ command con đã commit** — `ProvisionOrgHandler` đăng ký compensation cho user
   gRPC nhưng không cho `CreateOrgCommand` đã dispatch. Vá: thêm `ArchiveOrgCommand` (soft-delete),
   đăng ký `ctx.onCompensate` ngay sau khi org tạo xong.
2. **Event handler (notification-service, search-service) đi vòng qua CommandBus** — nghĩa là
   `canResolve` (validate lúc boot) chưa từng được gọi cho các TxScope này, mâu thuẫn tuyên bố ở §2.4.
   Vá: `IIntegrationEventHandler.txScope` (optional) + `EventRouter.validateTxScopes()`, gọi từ
   `OnApplicationBootstrap` của từng consumer (constructor quá sớm — chạy trước MỌI `onModuleInit`).
3. **Audit log trong transaction** (`logAudit(outcome:'success')` bên trong `execute()`) — ghi vào
   ES trước khi Prisma thực sự commit; retry trên lỗi commit-time làm nhân đôi bản ghi. Vá: thêm
   `ITransactionalCommandHandler.afterCommit?(command, result)`, chạy sau khi `txRunner.run` resolve.
4. **OCC credit event-store không được retry tự động** dù an toàn (rollback sạch, re-read version
   mới). Vá: marker `MarkedTransientError` (`transient: true`) trên `CreditConcurrencyError`,
   `isPrismaTransientError` nhận diện marker này ngoài `P2034`.
5. **Handler thiếu `kind` lọt qua validate lúc boot** — `CommandBus.register()` chỉ check khi
   `kind === 'transactional'`. Vá: `else if (kind !== 'saga') throw UnknownHandlerKindError`.
6. **Metric `db_transient_error` đếm cả lỗi nghiệp vụ** (P2002/P2025/P2003), không chỉ P2034/P2028.
   Vá: giới hạn `recordObservation` về đúng 2 mã đang theo dõi.
7. **5 bản `PrismaTxRunner` + 3 bản `prisma-transient-error.ts` gần như giống hệt nhau** — gộp thành
   `AbstractTxRunner` (shared-kernel, mỗi service chỉ còn implement `beginTransaction`) +
   `makePrismaTransientErrorHelpers` factory. `worker-service`'s bản (code chết, không TxScope nào)
   bị xoá hẳn thay vì gộp.
8. **Log ranh giới transaction bị mất** khi xoá `TransactionMiddleware` — phục hồi trong
   `AbstractTxRunner.run()` (debug: starting/committed/rolled-back), giữ nguyên `LogContext.TRANSACTION`.

Không đổi quyết định kiến trúc nào ở §2 — toàn bộ là vá thực thi + đóng khoảng hở giữa lời hứa và
code, đúng tinh thần "chỗ nào làm cho bất khả thi được thì làm, chỗ nào không thì phải nổ to" của
chính ADR này.

## 9c. AMENDMENT (2026-08-04) — bỏ `compensation` flag, thay bằng `dispatches` + chặn saga-lồng-saga

Review lại saga (`ProvisionOrgHandler` dispatch `CreateOrgCommand`) lộ ra 2 vấn đề, một cái dẫn tới
đảo ngược quyết định của §6b:

1. **`readonly compensation: 'registered' | 'not-needed'`** (thêm ở §6b) chỉ từng được đối chiếu
   trong `catch` — SAU khi handler đã fail — với số lần `ctx.onCompensate` thực sự được gọi, rồi log
   `error` nếu lệch. Không có gì ép handler khai đúng lúc compile, và không chặn gì lúc runtime — chỉ
   là một dòng log, đúng loại "nhắc bằng field thay vì bằng comment" mà lẽ ra phải nằm ở tài liệu.
   **Bỏ hẳn field này** (cả 2 nhánh log, kể cả nhánh đối xứng `'not-needed'` mà vẫn đăng ký
   compensation, thêm rồi bỏ cùng ngày sau khi phát hiện field gốc vô dụng). Cơ chế compensation stack
   (`ctx.onCompensate`, chạy NGƯỢC lúc fail, nuốt lỗi bù trừ) từ §6b **không đổi** — chỉ bỏ tờ khai.
2. **Saga dispatch saga khác** (`ctx.dispatch` gọi một command mà handler của nó cũng `kind: 'saga'`)
   không bị chặn — nguy hiểm thật: saga con tự bù trừ xong rồi rethrow, nếu saga cha CŨNG đăng ký
   `onCompensate` cho đúng lần dispatch đó (dễ xảy ra vì mọi bước khác đều cần một cái), bus sẽ bù trừ
   LẦN NỮA trên thứ saga con đã tự dọn. Thêm `readonly dispatches: readonly string[]` (bắt buộc, giống
   kỹ thuật `compensation` cũ nhưng lần này CÓ tác dụng thật) liệt kê mọi command mà `execute` sẽ
   `ctx.dispatch`. `CommandBus.register` quét lại toàn bộ registry sau MỖI lần đăng ký, đối chiếu
   `dispatches` của từng saga với `kind` của handler đích — nếu trúng saga khác, throw
   `NestedSagaDispatchError` ngay tại `register()`, bất kể 2 handler đăng ký theo thứ tự nào. Vì đăng ký
   luôn xảy ra đồng bộ ở composition root lúc app khởi động, lỗi lộ ra TRƯỚC khi nhận request đầu tiên —
   không phải đợi nhánh saga-lồng-saga chạy thật trong production rồi mới phát hiện qua bug bù trừ kép.
   `ProvisionOrgHandler` cập nhật `dispatches: [CreateOrgCommand.name, ArchiveOrgCommand.name]` — cả
   hai đều `kind: 'transactional'`, không vi phạm.

`directives/cqrs_pattern.md` §3-4 đã cập nhật theo amendment này.

## 9d. AMENDMENT (2026-08-11) — `recordObservation` mù với `MarkedTransientError`, dù `isTransient` đã retry nó

User hỏi *"chỉ P2034/P2028 cần monitor, kể cả P2002 không cần?"* dẫn tới audit lại `isTransient` cạnh
`recordObservation` ở `prisma-transient-error.ts` (§9b mục 6 sửa hôm 2026-07-30) — phát hiện 2 hàm này
**không cùng phạm vi** dù trông như phải đi cùng nhau:

- `isTransient` retry cả `P2034` **lẫn** bất kỳ lỗi nào khai `transient: true` (`MarkedTransientError`
  — hiện có 1 caller: `CreditConcurrencyError`, OCC conflict trên credit ledger, bản chất là P2002 bị
  convert ở application layer, xem §9b mục 4).
- `recordObservation` chỉ đếm `OBSERVED_CODES` (`P2034`/`P2028`) qua structural check
  `isPrismaKnownRequestError` — check này đòi field `clientVersion`, mà `CreditConcurrencyError` không
  có (nó là domain error, không phải Prisma error thật) → **không bao giờ được đếm**, dù retry thật xảy
  ra trên nó.

Hệ quả: retry OCC trên credit ledger — tín hiệu contention đáng cảnh báo thật (hot aggregate) — vô hình
với Prometheus, chỉ tra được qua log `LogContext.RETRY` từng lần thử. Không phải lỗi #6 tái diễn (#6 là
đếm QUÁ NHIỀU — lỗi nghiệp vụ lẫn vào; đây là đếm QUÁ ÍT — 1 nhánh retry hợp lệ bị bỏ sót), nhưng cùng
gốc: 2 predicate tách rời cho cùng 1 khái niệm "cái gì được coi là transient" dễ lệch nhau khi 1 bên đổi
mà bên kia không theo.

**Vá:** thêm nhánh riêng trong `recordObservation` đếm `isMarkedTransient(error)` dưới label tổng hợp
`code="A2001"` (chữ `A`, không phải `P` — Prisma đã sở hữu namespace `Pxxxx` thật, dùng lại nó cho 1 mã tự chế sẽ đụng nếu Prisma ra mã mới đúng số đó, hoặc khiến người tra cứu lầm tưởng là mã Prisma thật rồi tìm không ra trong docs), tách biệt khỏi `OBSERVED_CODES` (không gộp vào set đó, giữ đúng tinh thần
#6 — không đếm mọi lỗi nghiệp vụ, chỉ đếm đúng cái mà `isTransient` cũng công nhận). Thêm test khoá bất
biến "isTransient và recordObservation phải cùng nhận diện 1 input", không chỉ test riêng lẻ từng hàm —
để lần sau có `MarkedTransientError` thứ 2 (vd nếu `search-service` cần OCC tương tự) không lặp lại gap
này một cách âm thầm.

## 8. Tham chiếu

**Tiền lệ kiến trúc**
- [Cosmic Python — Ch.6 Unit of Work](https://www.cosmicpython.com/book/chapter_06_uow)
- [dotnet/eShop — TransactionBehavior.cs](https://github.com/dotnet/eShop/blob/main/src/Ordering.API/Application/Behaviors/TransactionBehavior.cs)
- [dotnet/eShop Issue #302 — Retries in TransactionBehavior & EF Core DbContext](https://github.com/dotnet/eShop/issues/302) — lỗi change-tracker khi retry; **không áp vào Cortex** vì Prisma không có change tracker
- [Wolverine — Transactional Middleware](https://wolverinefx.net/guide/durability/marten/transactional-middleware.html) — nguồn của cảnh báo "writes are silently discarded"
- [Wolverine for MediatR Users](https://wolverinefx.net/introduction/from-mediatr)
- [Axon Framework — Unit of Work](https://docs.axoniq.io/axon-framework-reference/4.10/messaging-concepts/unit-of-work/)
- [MikroORM — Unit of Work and Transactions](https://mikro-orm.io/docs/unit-of-work) — tiền lệ TS-native (ALS + `@Transactional` + EM fork)

**Ràng buộc kỹ thuật**
- [Prisma — Transactions and batch queries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) — cảnh báo network request trong transaction
- [Prisma v7.5.0 — nested transaction savepoints](https://www.prisma.io/changelog/2026-03-11)
- [prisma/prisma Discussion #12373](https://github.com/prisma/prisma/discussions/12373) — base client không join transaction đang mở
- [EF Core — Connection Resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency) — ném lỗi khi retry gặp user-initiated transaction

**Lỗi im lặng của các phương án bị bác**
- [When @Transactional Doesn't Work — Spring AOP proxy](https://medium.com/@youngjae991/when-transactional-doesnt-work-understanding-spring-aop-s-proxy-behavior-acf37c1ab284)
- [MediatR Pipeline Behaviors — thứ tự theo DI registration, không safeguard](https://deepwiki.com/jbogard/MediatR/2.3-pipeline-behaviors)
- [Unit of Work — ABP.IO](https://abp.io/docs/latest/framework/architecture/domain-driven-design/unit-of-work) — lập luận của phe ambient

**Nội bộ**
- `directives/cqrs_pattern.md` §5 — luật repository hiện hành (sẽ cập nhật sau pilot)
- `directives/eventing_patterns.md` §4.3 — `ITransactionManager` cho event handler; cross-store dùng idempotency
- `.ai/memory/architecture.jsonl` 2026-07-28 — audit tìm ra lỗ #1/#3
