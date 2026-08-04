# CQRS Command Pipeline & the Unit-of-Work boundary

> **Rewritten 2026-07-29 for ADR-0001** (`docs/adr/0001-transaction-retry-boundary.md`). The previous
> design — `ITransactionManager` + implicit `AsyncLocalStorage` + a `transactional` flag on the command
> + three middlewares wired with `commandBus.use()` — is GONE. Read the ADR for why (6 invariants that
> were only protected by comments), what was rejected, and the precedent for each piece.

## Problem

A command handler often writes through several repositories and they must commit together. Two things
must be true at once:

1. Repository interfaces must not leak ORM types (`domain/` stays pure) — so a `tx` parameter on every
   repository method is not acceptable.
2. "These writes are in one transaction" must be impossible to get wrong — not merely documented.

The old solution satisfied (1) with an ambient transaction in `AsyncLocalStorage` but failed (2): a
repository had to *remember* to call `getTx() ?? client`, and forgetting was silent.

## Solution: the transaction is a VALUE that owns the repositories

> **Collapsed 2026-07-30: one repos shape per SERVICE, not one per module.** The original ADR-0001
> design below had a `TxScopeToken` + a registry (`registerScope`/`canResolve`) so a service could hold
> several DIFFERENT scope shapes (e.g. core-api had `KnowledgeTxScope`/`EngagementTxScope`/
> `TenantTxScope`/`CreditTxScope`). Audited and removed: the scopes already overlapped heavily
> (`items`, `outbox`, `spaces`, `memberships` were shared fields with identical types across 2+ scopes
> before the collapse), splitting them bought a SOFT protection (a handler in one module doesn't see
> another module's repos on autocomplete) at the cost of upkeep (N interfaces + N factories + N
> `registerScope()` calls to keep in sync, plus "which scope does this handler belong to now?" every
> time a command needed repos spanning 2 old scopes). The hard guarantee — every write in one handler
> shares the SAME transaction — never needed per-module splitting; it only needs ONE object built from
> ONE `tx` client, which a single repos-wide factory gives just as well. See
> `packages/shared-kernel/src/database/tx-scope.ts`'s doc for the full reasoning.

A service's repos shape is every write repository in its database, already bound to one open
transaction. Handlers receive it as a parameter; they never construct or inject a repository
themselves.

```typescript
// e.g. core-api's infrastructure/database/prisma/core-api-repos.factory.ts
export interface CoreApiRepos {
  readonly items: IKnowledgeItemRepository
  readonly revisions: IRevisionRepository
  readonly outbox: IOutboxAppender
  readonly bookmarks: IBookmarkRepository
  // ...every other write repo in the service, flat — no per-module grouping
}
```

Repository interfaces keep clean signatures (`save(item)` — no `tx` argument), because the client is
supplied at CONSTRUCTION, not per call. Requirement (1) still holds; requirement (2) now holds too,
because there is no repository instance that isn't already inside a transaction.

### 1. The write repository takes the transaction client

```typescript
export class PrismaKnowledgeItemRepository implements IKnowledgeItemRepository {
  constructor(private readonly client: Prisma.TransactionClient) {}
  // no getTx(), no `?? this.prisma.client` — there is no fallback branch to forget
}
```

**It is NOT a DI provider.** Only the ONE service-wide repos factory constructs it:

```typescript
@Injectable()
export class CoreApiRepoFactory implements IRepoFactory<CoreApiRepos, Prisma.TransactionClient> {
  create(tx: Prisma.TransactionClient): CoreApiRepos {
    return {
      items: new PrismaKnowledgeItemRepository(tx),
      revisions: new PrismaRevisionRepository(tx),
      outbox: new PrismaOutboxAppender(tx),
      // ...every other repo, one factory for the whole service
    }
  }
}
```

### 2. Reads that run outside a transaction use a READ port

A guard, a query handler, or a search hot path has no transaction and must not open one. Those get a
separate reader implemented on the plain client:

- `IMembershipQueryRepository.findRoleByOrgAndUser` — used by `OrgGuard` (runs *before* any handler).
- `IOrgRolePermissionReader` — split from the write repo; lives in `domain/` because the domain service
  `OrgPermissionResolver` depends on it (domain must not import `application/`).
- `ISearchChunkReader.semanticSearch`, `IOutboxDispatchRepository` (claim/mark/reap — publishing does
  Kafka I/O, so it must never join a caller's transaction).

### 3. The handler's TYPE declares what it needs — there is no flag, and no per-handler scope token

```typescript
export interface ITransactionalCommandHandler<C extends ICommand, R, S> {
  readonly kind: 'transactional'
  execute(command: C, tx: S): Promise<R>
}

export interface ISagaCommandHandler<C extends ICommand, R> {
  readonly kind: 'saga'
  readonly dispatches: readonly string[]   // REQUIRED — every command name passed to ctx.dispatch
  execute(command: C, ctx: SagaContext): Promise<R>
}
```

There used to be a `compensation: 'registered' | 'not-needed'` declaration here too, self-reported by the
handler author. It was removed (2026-08-04): the bus checked it only in the `catch` block, after the fact,
by comparing it to how many `ctx.onCompensate` calls actually happened — a runtime log line, not something
that changed control flow or blocked anything. That is the kind of "answer at review time" reminder that
belongs in this doc, not as a field a handler can silently get wrong forever with no compile-time signal.
`dispatches` above stays required because it is NOT decorative — `CommandBus.register` reads it to run the
static check in the next paragraph.

`CommandOptions.transactional` no longer exists. The flag used to sit on the command DTO while the
writes sat in the handler, so adding a second write silently lost atomicity unless someone remembered
to edit another file. Now taking the `tx` parameter IS the opt-in, and it is the same file. `S` is
always the SAME type for every transactional handler in one service (its one repos shape) — there is
no `readonly txScope` field to declare any more (removed 2026-07-30 along with the per-module split).

⛔ **A transactional handler MUST NOT be injected with a gRPC/HTTP client or the CommandBus.** Its only
capability is the scope. Work that calls another service is a saga instead.

### 4. Saga = compensation stack, not atomicity

```typescript
async execute(command: ProvisionOrgCommand, ctx: SagaContext) {
  const { userId } = await this.authProvisioningClient.provisionUser(command.ownerEmail)
  ctx.onCompensate(async () => { await this.authProvisioningClient.cancelProvisionedUser(userId) })
  const orgId = await ctx.dispatch<string>(new CreateOrgCommand(...))   // only sagas may dispatch
  ...
}
```

Compensation is a closure registered the moment the undoable side effect exists — that is how it can
see `userId`, which a `compensate(command)` signature could not. The bus runs the stack in REVERSE on
failure and swallows compensation errors so they cannot mask the original one. Sagas are NEVER
auto-retried: their side effects do not roll back.

⛔ **A saga MUST NOT `ctx.dispatch` another saga command.** One saga owns orchestration and
compensation for its whole flow — nesting two sagas splits that ownership (the inner one
self-compensates and rethrows; if the outer also registered `onCompensate` for that same dispatch,
the bus undoes it a second time). `dispatches` on `ISagaCommandHandler` makes this checkable
statically: `CommandBus.register` cross-checks every saga's declared `dispatches` against every other
registered handler's `kind` on each `register()` call, so the pairing throws `NestedSagaDispatchError`
at composition-root startup — the instant both handlers are registered, in whichever order — not
only if and when that saga's branch actually runs in production.

### 5. The pipeline order is structural

```
CommandBus.execute(command)
  → withLogging          (always)
  → withRetry            (transactional branch only — deadlock/serialization)
  → txRunner.run(scope)  (opens the transaction, builds the scope)
  → handler.execute(command, tx)
```

There is **no `use()` and no `ICommandMiddleware`**. The order lives inside one method body of
`CommandBus`, so "retry must wrap the transaction" is not a comment any more — the wrong order is
unrepresentable. (MediatR orders behaviours by DI registration with no validation; that is the failure
mode this avoids. `dotnet/eShop` likewise nests retry around the transaction inside a single behaviour.)

Retry applies automatically to every transactional handler — no second flag. It is sound precisely
because that handler's only I/O surface is the scope.

### 6. Construction-time guarantee + re-entrancy guard

Boot-time `canResolve()` validation is gone (2026-07-30) along with the registry it validated against —
there is nothing left to forget registering. `PrismaTxRunner`'s constructor now takes the service's ONE
repos factory as a required argument:

```typescript
export class PrismaTxRunner extends AbstractTxRunner<CoreApiRepos, Prisma.TransactionClient> {
  constructor(prisma: PrismaService, logger: PinoLogger, factory: CoreApiRepoFactory) {
    super(logger, factory)
  }
  ...
}
```

TypeScript itself refuses to compile `new PrismaTxRunner(prisma, logger)` with the factory omitted —
strictly stronger than a runtime check, and Nest's own DI graph resolves construction order
automatically (no `onModuleInit` racing to register before `CqrsModule` boots).

```typescript
// PrismaTxRunner.run
if (getTx() !== undefined) throw new NestedTransactionError()
```

`AsyncLocalStorage` survives ONLY as this detector. Nesting would open a second transaction on another
pooled connection that commits independently, so an outer rollback would not undo it. Prisma 7.5+ can
nest via SAVEPOINT, but only through the transaction client — going through the base client silently
does not join, so we fail loudly rather than pick savepoint semantics by accident.

---
---

## Folder Structure & Clean Architecture

The CQRS implementation dictates a strict directory separation based on Hexagonal Architecture:

1. **`src/common/cqrs/`**: Contains the pure abstractions and implementations of Commands, Queries, Events, Handlers, Middlewares, and Buses. **Rule:** Pure TypeScript (POJO). No domain-specific logic, no infra-specific imports (e.g., Prisma), and **ABSOLUTELY NO framework decorators** (like NestJS `@Injectable()`, `@Module()`). Bus classes (`CommandBus`, `QueryBus`, `EventBus`) must be pure classes.
2. **`src/infrastructure/cqrs/`** (or `container/` for pure Fastify apps): Contains the Dependency Injection wiring and framework-specific Modules (e.g., `cqrs.module.ts` in NestJS). **Rule:** This is where pure CQRS classes are instantiated and provided to the framework's DI container.
3. **shared-kernel `database/`**: Generic abstractions only — `ITxRunner`/`IRepoFactory`/`AbstractTxRunner` and `transaction.context.ts` (now only a nesting detector). **Rule:** Completely agnostic of the underlying ORM.
4. **`src/modules/[module]/domain/`**: Contains Entities, Value Objects, and Repository Interfaces. **Rule:** Pure TypeScript. No imports from external libraries or infra.
5. **`src/modules/[module]/application/`**: Contains Command Handlers and Query Handlers. **Rule:** Orchestrates domain logic using Interfaces. Never imports Prisma or HTTP Request objects.
6. **`src/modules/[module]/infrastructure/`**: Concrete repository implementations. **Rule:** write repositories take a `Prisma.TransactionClient` in their constructor and are built ONLY by the service's one repos factory (lives in `infrastructure/database/prisma/` or, for auth-service's no-DI composition root, `container/repos.ts` — not per-module any more, see §Solution above); read-side repositories are ordinary singletons on the plain client.
7. **`src/modules/[module]/presentation/`**: Contains Fastify routes/controllers. **Rule:** Translates HTTP requests into Commands/Queries and pushes them to the `CommandBus`.

By strictly enforcing this folder structure and the "Pure POJO" rule for the CQRS core, the business logic and messaging patterns remain fully decoupled from HTTP, Database, and Framework specifics (like NestJS DI).

---

## Repository-interface & DTO placement — CANONICAL (enforced across ALL services)

> Ruling 2026-07-03 after a cross-service audit found repo interfaces scattered across three different folders (`domain/repositories/`, `application/queries/`, `application/repositories/`). There are now **exactly two** legal locations for a repository interface. `application/repositories/` is **banned** — it existed only as a neutral "I'm not sure" folder and is what caused the drift.

**Decision rule — classify a repo by what its result is used for, not by whether it happens to read or write:**

| Repo kind | Location | File | Types |
|---|---|---|---|
| **Command / write-side** (entity-based, serves command handlers) | `domain/repositories/` | `<name>.repository.ts` | write-input types **inline** in the file |
| **Projection / write-model** (maintained from events; has NO entity/invariant; any read it exposes is an *internal* pipeline lookup, not an HTTP response) | `domain/repositories/` | `<name>.repository.ts` | input/intermediate types **inline** |
| **Mixed write + internal-read** (e.g. a search index: written by an event handler, read internally to feed further logic — the read result is an *intermediate*, not the endpoint's response DTO) | `domain/repositories/` | `<name>.repository.ts` | **inline** |
| **Query-side** (returns a DTO that is handed **straight back** to a query handler / the client) | `application/queries/` | `<module>.query-repository.ts` | response DTO in its **own** `<module>.dto.ts` next to it |

**Rules:**
- A query-repo interface shared by more than one query lives at the **`application/queries/` level**, NOT inside one query's sub-folder (a shared repo buried in `get-org-members/` forcing `list-my-orgs` to reach across is the anti-pattern that was fixed).
- **Response DTOs are FLAT — one `<name>.dto.ts` per query-repo, at the `application/queries/` level, NOT nested per-query** (`get-me/get-me.dto.ts`, `get-org-members/get-org-members.dto.ts` were the anti-pattern; flattened to `user.dto.ts`, `membership.dto.ts` 2026-07-03). The DTO file is named to match its query-repo (`membership.query-repository.ts` ↔ `membership.dto.ts`, `wallet.query-repository.ts` ↔ `wallet.dto.ts`). All DTOs a given query-repo returns go in that one file, even if consumed by several query handlers (`membership.dto.ts` holds both `MemberDto` and `MyOrgDto`). Query `.query.ts` + `.handler.ts` stay in their per-query sub-folder; only the DTO comes up a level. (Request/input DTOs are a different artifact — they live in `presentation/schemas/` as Zod-schema types and are out of scope for this rule.)
- **Response DTOs get their own `.dto.ts` file** (query side). **Write-input/intermediate types stay inline** in the domain repo file (mirrors `InsertNotificationRow` in `notification.repository.ts`). Do NOT invert this.
- The deciding question for a repo that both reads and writes: **"does its read result go straight out as the query response, or is it an intermediate step inside a handler/service?"** Straight-out → `application/queries/`. Intermediate → `domain/repositories/`. (Examples: `space_followers.findFollowerIds` feeds fan-out → domain; `ISearchChunkReader.semanticSearch` feeds RRF fusion → domain (read port, split from the write repo in ADR-0001); `INotificationQueryRepository.findByRecipient` → returns `NotificationDto[]` to the query handler → `application/queries/`.)
- **NEVER** create `application/repositories/`. (Historical note: auth-service originally put query-repos there; migrated 2026-07-03.)

## Command cần đọc dữ liệu giữa chừng → đọc qua domain/write repo, KHÔNG BAO GIỜ qua query-repo

> Chốt 2026-07-23, sau audit tìm thấy mọi query-repo hiện tại (`membership.query-repository.ts`,
> `knowledge.query-repository.ts`, `engagement.query-repository.ts`, auth `user`/`role.query-repository.ts`...)
> đều KHÔNG tham gia transaction, khác với mọi write-repo (từ ADR-0001: write-repo chỉ tồn tại trong TxScope, query-repo dùng client thường — nên ranh giới này giờ là CẤU TRÚC, không còn là quy ước). Kiểm tra thực tế: hiện
> tại **không có command handler nào** inject query-repository hoặc gọi `QueryBus` — query-repo chỉ
> được gọi từ Controller. Vậy hiện trạng không phải bug, nhưng cần chốt thành luật để không ai vô
> tình phá ranh giới.

**Luật:** nếu một command handler cần đọc dữ liệu **transactionally-consistent** giữa chừng (thấy được
write chưa commit trong cùng transaction), nó phải đọc qua **write repository trong TxScope** (`tx.<repo>`),
**KHÔNG BAO GIỜ** qua query-repository — kể cả khi kỹ thuật có thể làm được ở giai đoạn hiện tại (query-repo
và write-repo cùng trỏ 1 DB source-of-truth).

**Lý do sâu hơn "hiện tại chưa ai vi phạm" — đây là ranh giới CQRS thật, không chỉ tiện lợi kỹ thuật:**
Query = luôn đọc từ **read DB** (read model / projection, có thể eventually-consistent). Command = ghi
vào **source-of-truth DB**; nếu command cần đọc để quyết định logic, nó phải đọc từ chính source-of-truth
(qua write-repo) để đảm bảo dữ liệu mới nhất — không phải từ read DB. Hôm nay Phase 3 (CQRS read model
tách vật lý) chưa triển khai nên query-repo và write-repo tình cờ cùng 1 DB — luật này phải đúng CẢ
TRƯỚC LẪN SAU khi Phase 3 triển khai, nên áp dụng từ bây giờ, không đợi tới lúc tách DB thật mới sửa.
Nếu 1 command tương lai cần đọc, thêm method vào domain write-repo interface (không tái sử dụng
query-repo dù có sẵn) — kể cả khi nghĩa là trùng lặp 1 phần logic đọc.
