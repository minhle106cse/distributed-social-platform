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

- `IMembershipQueryRepository.findRoleByOrgAndUser` (`application/repositories/`) — used by `OrgGuard` (runs *before* any handler).
- `IOrgRolePermissionReader` — split from the write repo; lives in `domain/` because the domain service
  `OrgPermissionResolver` depends on it (domain must not import `application/`).
- `ISearchChunkReader.semanticSearch` (search-service) — lives in `application/repositories/`, NOT
  `domain/` (no domain-layer file depends on it, only the application-layer `SearchKnowledgeService`
  does — see the repository-placement litmus test below).
- `IOutboxDispatchRepository` (claim/mark/reap — publishing does Kafka I/O, so it must never join a
  caller's transaction).

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

> **Ruling 2026-08-21 — resolves a 6-week contradiction between THIS file and `folder_structure_sop.md`.**
> A repository interface has exactly two legal homes, split by LAYER, each in its own `repositories/`
> folder: `domain/repositories/` (command/write-side ports — Entities via mapper — plus any read port a
> **domain-layer** class depends on) and `application/repositories/` (read/query ports consumed only by
> the application layer, returning DTOs/plain shapes, never Entities).
>
> **What was wrong before:** `folder_structure_sop.md`'s canonical `src/` tree — the file that calls
> itself an immutable directive — has listed `application/repositories/  # Query Repository Interfaces
> (returns DTOs)` since it was written. This file, meanwhile, declared that exact folder **banned** in the
> 2026-07-03 ruling and routed query-repo interfaces into `application/queries/` instead. Both statements
> lived in `directives/` at the same time; nothing cross-checked them, and the CODE followed this file.
> The visible symptom was in every module: `application/queries/` held two different KINDS of thing at
> once — per-query subfolders (`get-vote-summary/`, `list-bookmarks/`, each a `.query.ts` + `.handler.ts`
> pair) sitting next to loose port files (`engagement.query-repository.ts`) — so a reader could not tell
> ports from use-cases without opening files. That is what the owner spotted 2026-08-21.
>
> **Settled in favour of `folder_structure_sop.md`** (the canonical structure doc wins a structure
> question). The 2026-07-03 ruling's actual concern was never the folder itself — it was that
> `application/repositories/` at the time had NO defined meaning and had become an "I'm not sure where
> this goes" bucket, which is what let interfaces drift across three locations. That concern is answered
> by definition, not by deletion: the folder now holds exactly one thing (application-layer read ports)
> and the domain-vs-application choice is decided by the dependency-direction test below, not by taste.
>
> Mechanically: all 10 `*.query-repository.ts` port files moved `application/queries/` →
> `application/repositories/` across all 4 services (2026-08-21). Response DTOs stay in
> `application/queries/` next to the handlers that return them, so a port importing its own DTO reads
> `from '../queries/<module>.dto'`.

**Decision rule — classify a repo by what its result is used for, not by whether it happens to read or write:**

| Repo kind | Location | File | Types |
|---|---|---|---|
| **Command / write-side** (entity-based, serves command handlers, mutation goes through a mapper when an Entity exists) | `domain/repositories/` | `<name>.repository.ts` | write-input types **inline** in the file |
| **Projection / write-model** (maintained from events; has NO entity/invariant; any read it exposes is an *internal* pipeline lookup, not an HTTP response) | `domain/repositories/` | `<name>.repository.ts` | input/intermediate types **inline** |
| **Domain READ port** (a **domain-layer class** — a domain service, not just a query handler — depends on it; domain must not import `application/`, so this is structural, not a style choice) | `domain/repositories/` | `<name>.repository.ts`, interface named `I{X}Reader` | **inline**; impl is `Prisma{X}Reader{Repository}` / `<x>-reader.repository.ts`, **never** `.query-repository.ts` (see `naming_conventions.md` §4) |
| **Application READ port** (only an `application/`-layer class consumes it — a query handler, or an application service like `SearchKnowledgeService` — nothing in `domain/` imports it) | `application/repositories/` | `<module>.query-repository.ts` | response DTO in its **own** `<module>.dto.ts` next to it, OR (if the result is an intermediate feeding further application-layer computation, not a straight response) inline in the query-repo file |

### The decision procedure — answer in this ORDER, stop at the first Yes

Two steps, and the order matters. Asking only step 2 gets `IKeywordSearchRepository` wrong (found
2026-08-21 while mechanizing this rule: the single-step "dependency direction" phrasing that briefly
lived here contradicted the "Mixed write + internal-read" row above, on that exact file).

1. **Does the interface have ANY method that mutates state** (`save`, `insert`, `replaceForItem`,
   `indexItem`, `upsert`, `delete`…)? → **`domain/repositories/`**. A write port is the domain's
   persistence contract, and that is true no matter who assembles it — most write ports are referenced
   by the service's repos-factory in `infrastructure/`, not by any `domain/` file, so step 2 alone would
   wrongly evict all 15 of them. A mixed write+read port (a search index: written by an event handler,
   read back internally) is a write port by this step — `IKeywordSearchRepository` stays in `domain/`.
2. **Read-only port. Does any file under `domain/` import it?**
   - **Yes → `domain/repositories/`**, named `I{X}Reader`, regardless of how "query-shaped" it looks.
     This is structural, not stylistic: Clean Architecture's Dependency Rule makes domain the innermost
     layer, so a domain class depending on an application-layer interface is not fixable by relocating
     the file — only by not needing the dependency. Example: `IOrgRolePermissionReader`.
   - **No → `application/repositories/`**, named `I{X}QueryRepository`, file `<module>.query-repository.ts`.
     Example: `ISearchChunkReader`, and all 9 `*QueryRepository` ports.

**This is machine-checked — `npm run check:arch` (`scripts/check-repo-placement.cjs`), part of
`npm run check`.** The script does NOT guess at steps 1–2 (that is a design judgement; a heuristic
that misfires just teaches people to ignore the gate). It enforces the consequences, which are
deterministic: a `*.query-repository.ts` anywhere but `application/repositories/` fails; that suffix
inside `domain/repositories/` fails; a non-port file inside `application/repositories/` fails; anything
under `domain/**` importing `application/**` fails — **including relative-path imports, which the
eslint `no-restricted-imports` boundary does not catch** (it only matches the `@/modules/*/application/**`
alias form); and a stray file inside a per-query subfolder fails. Each check was verified to actually
fire by injecting the violation, not just by passing on clean code.

**Worked examples (both audited 2026-08-20):**
- `IOrgRolePermissionReader` (core-api tenant module) — `OrgPermissionResolver`, a **domain service**,
  depends on it directly (`domain/services/org-permission-resolver.ts`) → stays in `domain/repositories/`.
  Its Prisma impl was wrongly named `PrismaOrgRolePermissionQueryRepository`/`*.query-repository.ts` (that
  suffix implies an application-layer port in `application/repositories/`) — renamed to `PrismaOrgRolePermissionReaderRepository`
  (`prisma-org-role-permission-reader.repository.ts`); the domain interface itself did not move.
- `ISearchChunkReader` (search-service) — only `SearchKnowledgeService` (`application/queries/`, an
  Application Service per `naming_conventions.md` §11 since search-service has no CommandBus/QueryBus)
  consumes it, feeding RRF fusion. No `domain/` file imports it. Moved from
  `domain/repositories/search-chunk.repository.ts` to `application/repositories/search-chunk.query-repository.ts`
  — this one's result IS an intermediate (feeds fusion, not handed straight to the client as
  `SearchResult`), so its types stayed inline in the query-repo file rather than getting a separate
  `.dto.ts` (matches the "intermediate vs straight-out response" split already established below).

**Rules:**
- A query-repo interface shared by more than one query lives in **`application/repositories/`**, NOT inside one query's sub-folder (a shared repo buried in `get-org-members/` forcing `list-my-orgs` to reach across is the anti-pattern that was fixed) and no longer loose in `application/queries/` either (2026-08-21).
- **Response DTOs stay in `application/queries/` (they belong to the use-case, not the port) and are FLAT — one `<name>.dto.ts` per query-repo, at the `application/queries/` level, NOT nested per-query** (`get-me/get-me.dto.ts`, `get-org-members/get-org-members.dto.ts` were the anti-pattern; flattened to `user.dto.ts`, `membership.dto.ts` 2026-07-03). The DTO file is named to match its query-repo, which now sits one folder over in `application/repositories/` (`repositories/membership.query-repository.ts` ↔ `queries/membership.dto.ts`, `repositories/wallet.query-repository.ts` ↔ `queries/wallet.dto.ts`) — so a port importing its own DTO reads `from '../queries/<module>.dto'`. All DTOs a given query-repo returns go in that one file, even if consumed by several query handlers (`membership.dto.ts` holds both `MemberDto` and `MyOrgDto`). Query `.query.ts` + `.handler.ts` stay in their per-query sub-folder; only the DTO comes up a level. (Request/input DTOs are a different artifact — they live in `presentation/schemas/` as Zod-schema types and are out of scope for this rule.)
- **Response DTOs get their own `.dto.ts` file** (query side). **Write-input/intermediate types stay inline** in the domain repo file (mirrors `InsertNotificationRow` in `notification.repository.ts`). Do NOT invert this.
- The deciding question for a repo that both reads and writes: **"does its read result go straight out as the query response, or is it an intermediate step inside a handler/service?"** Straight-out → `application/repositories/`. Intermediate → usually `domain/repositories/`, EXCEPT when nothing under `domain/` actually imports the interface — then it belongs in `application/repositories/` regardless of being an intermediate (dependency direction wins over "is this conceptually a query", see the sharper litmus test above). (Examples: `space_followers.findFollowerIds` feeds fan-out, consumed inside a `domain`-adjacent event handler → domain; `ISearchChunkReader.semanticSearch` feeds RRF fusion but is consumed ONLY by the application-layer `SearchKnowledgeService` → `application/repositories/` (moved 2026-08-20 — this was the wrong example in this line before that date, corrected after an audit found no domain consumer); `INotificationQueryRepository.findByRecipient` → returns `NotificationDto[]` to the query handler → `application/repositories/`.)
- **Application-layer read ports live in `application/repositories/`, one folder per module** — NOT loose
  inside `application/queries/` (changed 2026-08-21, see the ruling at the top of this section; the old
  "NEVER create `application/repositories/`" rule from 2026-07-03 is superseded, not merely relaxed).
  `application/queries/` now holds ONLY use-cases and their response DTOs: per-query subfolders
  (`{verb}-{noun}/` with `.query.ts` + `.handler.ts`) plus the flat `<module>.dto.ts` files.
- **Still NEVER** put a repository interface loose in `application/` itself, or nested inside one query's
  own subfolder — the two `repositories/` folders (domain + application) are the only legal homes, and
  the reason the 2026-07-03 ban existed (a folder with no defined meaning invites drift) still applies to
  any third location.

## A command that needs to read mid-flight reads through the domain/write repo, NEVER through a query-repo

> Settled 2026-07-23, after an audit found that every current query-repo
> (`membership.query-repository.ts`, `knowledge.query-repository.ts`, `engagement.query-repository.ts`,
> auth's `user`/`role.query-repository.ts`, …) does **NOT** participate in a transaction, unlike every
> write-repo (per ADR-0001: a write-repo only exists inside a `TxScope`, a query-repo uses the plain
> client — so this boundary is now **STRUCTURAL**, no longer a convention). Reality check: **no command
> handler currently** injects a query-repository or calls `QueryBus` — query-repos are only called from
> a Controller. So the present state is not a bug, but it needs settling as a rule so nobody breaks the
> boundary by accident.

**Rule:** if a command handler needs to read **transactionally-consistent** data mid-flight (must see
writes not yet committed in the same transaction), it must read through the **write repository inside
the `TxScope`** (`tx.<repo>`), **NEVER** through a query-repository — even where it is technically
possible today (query-repo and write-repo currently point at the same source-of-truth DB).

**The reason goes deeper than "nobody has violated it yet" — this is a real CQRS boundary, not just a
technical convenience:** Query = always reads from the **read DB** (read model / projection, may be
eventually-consistent). Command = writes to the **source-of-truth DB**; if a command needs to read in
order to decide something, it must read from the source-of-truth itself (through the write-repo) to be
sure the data is current — not from the read DB. Today Phase 3 (physically splitting the CQRS read
model) is not implemented, so query-repo and write-repo happen to share one DB — this rule must hold
**BOTH BEFORE AND AFTER** Phase 3 lands, so it applies from now rather than being fixed only once the
DBs are genuinely split. If a future command needs to read, add a method to the domain write-repo
interface (do not reuse the query-repo even though one exists) — even when that means duplicating part
of the read logic.
