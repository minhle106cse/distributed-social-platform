# Folder Structure SOP — Distributed Social Platform

> **This is an immutable directive.**
> Every service in this monorepo MUST follow this structure.
> The agent MUST NOT create files/folders that deviate from it without the owner's approval.

## Canonical `src/` Structure

```
src/
├── @types/                          # Augmented global type declarations (e.g. fastify.d.ts)
├── bootstrap/                       # App wiring: server setup, plugin registration, swagger
│   ├── fastify.ts                   # Fastify instance + plugin registration
│   ├── server.ts                    # listen(), graceful shutdown
│   └── swagger.ts                   # OpenAPI / Swagger setup
├── common/                          # Cross-cutting ABSTRACTIONS only — NO infrastructure code
│   │                                # ⚠️ NO errors/ folder here at all (2026-08-24): base classes live in
│   │                                #    packages/shared-kernel/src/errors/, and每 module's concrete errors live in
│   │                                #    modules/<module>/domain/<module>.error.ts — naming_conventions.md §6
│   ├── cqrs/                        # Command/Query bus abstractions & middlewares (PURE POJO ONLY)
│   │   ├── index.ts                 # ICommand, ICommandHandler, CommandBus, IEvent, EventBus
│   │   └── middlewares/             # NO @Injectable or NestJS decorators allowed here
│   │       ├── logging.middleware.ts
│   │       ├── retry.middleware.ts
│   │       └── transaction.middleware.ts
│   └── database/                    # DB abstractions only
│       ├── transaction-manager.interface.ts
│       └── transaction.context.ts
├── config/                          # Environment config loading & validation
├── container/                       # Manual DI wiring (required — Fastify has no DI)
│   ├── infra.ts                     # Wires infrastructure deps (repositories, services, logger)
│   └── application.ts               # Wires application layer (CommandBus, QueryBus, Handlers)
├── infrastructure/                  # Concrete implementations — framework-specific code GOES HERE
│   ├── database/
│   │   └── prisma/
│   │       ├── prisma.client.ts
│   │       ├── prisma-transaction-manager.ts
│   │       └── prisma-transient-error.ts
│   ├── http/                        # Fastify/HTTP-specific middleware, decorators, hooks
│   │   ├── decorators/
│   │   │   ├── authenticate.decorator.ts
│   │   │   └── authorize.decorator.ts
│   │   ├── filter/
│   │   │   └── global-error-handler.ts
│   │   └── hooks/
│   │       ├── http-logging.hook.ts
│   │       └── http-response.hook.ts

├── modules/                         # Feature modules — business logic by domain
│   └── <domain>/
│       ├── application/             # Application Layer (Orchestration & CQRS)
│       │   ├── commands/            # Command Handlers (Write Model)
│       │   ├── queries/             # Query Handlers (Read Model)
│       │   ├── events/             # Integration-event Handlers (consumer services) †
│       │   └── repositories/        # Query Repository Interfaces (returns DTOs)
│       ├── domain/                  # Domain Layer (Core Business Rules) — PURE TS, no NestJS
│       │   ├── entities/            # Aggregate Roots & Entities
│       │   ├── value-objects/       # Immutable Value Objects
│       │   ├── services/           # Domain services + OUTBOUND service ports (interfaces) †
│       │   └── repositories/        # Command/WRITE repo interfaces (Entities via mapper) + read ports a DOMAIN class consumes
│       ├── infrastructure/          # Infrastructure Layer (Concrete Implementations)
│       │   ├── mappers/             # Domain <-> Persistence Mappers
│       │   ├── consumers/          # Kafka consumers (event-driven services) †
│       │   ├── services/           # Concrete adapters implementing domain service ports †
│       │   └── repositories/        # Concrete Prisma Repositories (Flat structure, both queries/commands)
│       └── presentation/            # UI/Delivery Layer
│           ├── routes/              # HTTP Routes (Fastify) / controllers (NestJS)
│           └── schemas/             # Zod Validation Schemas

# † Owner-approved extension 2026-07-02 for the consumer/AI services (notification, search):
#   - application/events/     : integration-event handlers (IIntegrationEventHandler)
#   - domain/services/        : PURE domain services (e.g. TextChunker — NO @Injectable/NestJS)
#                               + outbound service PORTS (interfaces: IEmbeddingService, ISummarizerService)
#   - infrastructure/services/: concrete adapters for those ports (HttpEmbedding, ClaudeSummarizer, GeminiSummarizer…)
#   - infrastructure/consumers/: Kafka consumers (KnowledgeIndexerConsumer, NotificationEventsConsumer)
#   The projection/search services have NO domain entity → domain/ holds only services/ (no entities/repositories).
#   ⚠️ domain/ is pure TS: a pure domain service drops @Injectable (Nest still DI-instantiates a zero-arg class).
├── app.ts                           # Root Fastify app factory
├── main.ts                          # Entrypoint (local)
└── main.lambda.ts                   # Entrypoint (AWS Lambda)
```

---

## ⛔ Forbidden Patterns — NEVER DO

| Mistake | Why it's wrong |
|---|---|
| Put a Fastify filter/interceptor/hook in `common/` | `common/` holds ABSTRACTIONS only, never concrete framework infrastructure |
| Put a Prisma module/service in its own `prisma/` folder at the root of `src` | Prisma is an infrastructure detail → it belongs in `infrastructure/database/prisma/` |
| Put a concrete logger implementation in `common/logger/` | `common/` holds interfaces; the shared implementation already lives in `packages/shared-kernel` |
| Define an `ILogger` interface inside a service app (e.g. `auth-service/src/common/logger.ts`) | Shared interfaces must live in `packages/shared-kernel` |
| Create a `common/errors/` folder, or put any concrete error class outside its module | **There is no `common/errors/` any more** (removed from all 3 services that had one, 2026-08-24). Every module owns exactly one `modules/<module>/domain/<module>.error.ts`; base classes come from `packages/shared-kernel/src/errors/` — the real list is `AppError`, `ApplicationError`, `InfrastructureError`, `UnreachableError`, `ResponseFormatError` (this row used to name a **`DomainError` that has never existed**). Decided by who THROWS it, machine-checked by `npm run check:arch` check I. Full reasoning: `naming_conventions.md` §6. |
| Create a folder outside the 5 main components without a specific reason | Breaks consistency between services |
| Put a repository interface loose in `application/queries/`, or nested inside one query's own subfolder | Application-layer read/query ports live in `modules/*/application/repositories/` (one folder per module) — as the canonical tree above has always specified — mirroring `domain/repositories/` for the write side. `application/queries/` holds ONLY use-cases + their response DTOs: per-query subfolders (`{verb}-{noun}/` with `.query.ts` + `.handler.ts`) and the flat `<module>.dto.ts` files. ⚠️ **Resolved 2026-08-21 — this file and `cqrs_pattern.md` had contradicted each other since 2026-07-03:** the tree above listed `application/repositories/` as the home for query-repo interfaces, while `cqrs_pattern.md` declared that same folder **banned** and sent them to `application/queries/`; the code followed `cqrs_pattern.md`, so every service ended up with port files sitting loose among the per-query subfolders. Settled in favour of THIS file (the canonical structure doc): all 10 `*.query-repository.ts` ports moved to `application/repositories/` across all 4 services, and `cqrs_pattern.md` was rewritten to match. The original 2026-07-03 concern — that a folder with no defined meaning becomes an "I'm not sure" bucket — is answered by the folder now having exactly one meaning (application-layer read ports, nothing else). See `cqrs_pattern.md` for the domain-vs-application decision rule. |
| Nest a repository interface inside ONE query's own subfolder (e.g. `application/queries/get-x/some.repository.ts`) | The per-query subfolder (`{verb}-{noun}/`) holds exactly `{name}.query.ts` + `{name}.handler.ts` (+ spec) — nothing else. A query-repo interface belongs in `application/repositories/` so every consumer reaches it the same way (a shared repo buried in `get-org-members/` forcing `list-my-orgs` to reach across is the original anti-pattern). Audited clean repo-wide 2026-08-20: all 17 per-query subfolders across all 4 services contain only the query/handler pair. |
| Declare a port (`I<Name>` behind a DI token, or one a class `implements`) inside `infrastructure/` | A port is an inward-pointing abstraction — something OUTSIDE infrastructure depends on it and infrastructure implements it. Declaring it inside infrastructure either points the arrow backwards (application/`common/` then has to import `@/infrastructure/**`) or is infra-calling-infra through a layer of indirection. Decide by WHERE THE CONSUMERS ARE: ≥1 consumer outside `infrastructure/` → interface goes to the module's `domain/` (or `common/` when it spans modules, shared-kernel when it spans services), class stays in infra; every consumer inside `infrastructure/` → **no interface and no token**, inject the class. Full 2-step rule + the three cases it came from: `resilience_patterns.md` §6.1. Machine-checked by `npm run check:arch` (check F). Plain data shapes (`ClaimedOutboxEvent`, `JwtPayload`, …) are NOT ports and stay put. |
| Inject a concrete infrastructure class into an application-layer handler | Same rule, other direction. `AskAiHandler`/`ProvisionOrgHandler` did exactly this with `RagQueryClient`/`AuthProvisioningClient` until 2026-08-24, because core-api's application-layer eslint group listed only `@/infrastructure/database/**` + `@/infrastructure/http/**` and left `grpc/`, `outbox/`, `messaging/`, `kafka/` open. The group is now `@/infrastructure/**` with `@/infrastructure/cqrs` negated, so a NEW infra folder is closed by default. |
| Invent a NEW subfolder under `modules/*/infrastructure/` (e.g. `grpc/`) | That folder has a closed list in the canonical tree: `mappers/`, `consumers/`, `services/`, `repositories/` — and `consumers/` is there deliberately (a Kafka consumer is bound to one module's event handlers, owner-approved 2026-07-02). Anything else, in particular a **transport endpoint**, belongs to the service, not to a feature module: both directions of one transport live together in the service-wide `infrastructure/<transport>/`, which is already core-api's convention (its gRPC server and clients share `infrastructure/grpc/`). Found 2026-08-24: search-service had the RagQuery gRPC **server** in `modules/search/infrastructure/grpc/` while its gRPC **client** sat in `src/infrastructure/grpc/` — one transport split across two homes, with `bootstrap/grpc.ts` (service-wide wiring) reaching into a module to find it. Moved. Depending on a module's application service FROM service-wide infra is fine — that dependency points inward. **The names in that list are exact, not approximate** — the same 2026-08-24 sweep (`find apps/*/src/modules -type d -path '*/infrastructure/*'`, then count the folder names) found auth-service using `mapper/` (singular) in 3 modules and a `jobs/` folder for `OrphanedProvisionedUserWatcher`; renamed to `mappers/` and `services/` respectively — a module-scoped scheduled job goes in `services/`, matching core-api's `ExpiredReservationSweeperService`. **Machine-checked by `npm run check:arch` check G** since 2026-08-24 — verified by injecting both a `grpc/` folder and a singular `mapper/`, and by confirming it stays silent on a clean tree. |

---

## The 5 Main Components & Responsibilities

| Folder | Role | Allowed to import |
|---|---|---|
| `bootstrap/` | App startup, Fastify plugin registration | `infrastructure/`, `config/`, `container/` |
| `common/` | Abstractions, interfaces, pure utilities | `packages/shared-kernel` ONLY |
| `config/` | Env loading, validation (Zod) | `packages/shared-kernel` |
| `infrastructure/` | Framework-specific implementations (Prisma, Fastify hooks, Pino) | `common/`, `packages/shared-kernel` |
| `modules/` | Business logic per domain | `common/`, `packages/shared-kernel` |
| `container/` | Manual DI wiring (Fastify has no DI) | `infrastructure/`, `modules/`, `packages/shared-kernel` |

---

## core-api vs auth-service — Sync Status

> Status as of 2026-06-25: `core-api` follows the standard architecture, on a par with
> `auth-service` in layering, and is now **lint-enforced** (see §Enforcement below).

- Every infra component (Prisma, Logger, HTTP interceptors, filters) has been moved out of
  `common/` into `infrastructure/`.
- The CQRS buses in `common/cqrs/` are now pure POJOs; the framework module was pushed down into
  `infrastructure/cqrs/`.
- **Re-audit of `modules/tenant` (2026-06-25):** fixed the 3 remaining violations — `OrgGuard` and
  `TenantInterceptor` moved from `common/` to `infrastructure/http/`; `OrgGuard` now goes through
  `IMembershipRepository` instead of querying Prisma directly; the handler uses
  `MembershipNotFoundError` instead of `NotFoundException`. Coupling cleanup: `org-permissions.ts`
  moved to `modules/tenant/domain/` (ending the domain↔common cycle), and `OrgContext` was split
  out of the guard.
- **Note:** `core-api` is a NestJS app, so it uses `infrastructure/http/interceptors` rather than
  `hooks` (as in `auth-service`'s plain Fastify), and NestJS's DI module system rather than a
  manual `container/` directory.

---

## 📍 Where An Abstraction Lives (2026-08-24)

Four homes, each with a **reason** you must be able to state. If you cannot name the reason, the
placement is wrong — that is the whole rule.

| Home | The reason for putting it there | Examples |
|---|---|---|
| `packages/shared-kernel` | One of **A / B / C** below | `ISagaCompensationStore`, `CircuitBreaker`, `grpc/membership.ts` |
| service `common/` | Used by **2+ modules of ONE service**, and framework-free | `CoreApiRepos`, `IOutboxWriter`, `IMessagePublisher` |
| module `domain/` | Used by **one module**; a `domain/` file consumes it, or it is that module's outbound port | `IRagQueryService`, `IKnowledgeItemRepository` |
| `infrastructure/` | **Never a port** — implementations only (§6.1 of `resilience_patterns.md`) | `PrismaOutboxRepository`, `RagQueryClient` |

### The three reasons for shared-kernel — exactly one must apply

- **A — shared-kernel's own code imports it.** Not a choice: remove it and shared-kernel stops
  compiling. `ISagaCompensationStore`+`ITxRunner` (`CommandBus`/`AbstractTxRunner`),
  `IDeadLetterProducer` (`ResilientConsumer`), `IIntegrationEventHandler` (`EventRouter`), `ILogger`.
- **B — 2+ independent services already consume it, AND it is framework-independent.** The
  `CircuitBreaker` precedent (`resilience_patterns.md` §3.1): a pure algorithm needing only `ILogger`,
  with real consumers in search-service and core-api — versus `OrgAwareThrottlerGuard`, which only
  NestJS can use and therefore stays local in each service. *"A service might need it later" is not
  reason B.*
- **C — it is a published wire contract**: something that crosses the network between services —
  `proto/`-generated types, CloudEvent payload definitions, topic/transport routing maps. **Consumer
  count is irrelevant here** (`credit-spent.event.ts` has one producer and no consumer yet, and still
  belongs): the point is that a consumer must never have to import from the producer's service.

Fails all three → it comes **down** into the owning service. Audited 2026-08-24 by building
shared-kernel's real internal import graph (barrel `index.ts` excluded — a re-export is not a
dependency; symbol mentions inside comments stripped, because the first version of that audit counted
them and gave a wrong answer): 28 files on A, 14 on B, 12 on C, and exactly **one** with no
reason — `messaging/interfaces/message-publisher.interface.ts`, whose only consumer AND only
implementer were both core-api, because core-api is the only service that publishes domain events at
all. Moved to `core-api/src/common/messaging/`.

### The kind test — what may NEVER go up, however many services duplicate it

shared-kernel is imported by every service, so its runtime dependencies become everyone's.
**Machine-checked by `npm run check:arch` check H:** no runtime import of `kafkajs`, `@nestjs/*`,
`fastify`, `@prisma/*` or `ioredis` anywhere in shared-kernel, and no runtime `@grpc/grpc-js` outside
`src/grpc/**`. `import type` is erased and always fine.

- **kafkajs**: never imported — `MinimalConsumer`/`MinimalProducer` mirror its API *structurally*, so
  each service owns its own Kafka client.
- **`@grpc/grpc-js`**: IS a runtime dependency, but only inside `src/grpc/**`, which is
  `npm run proto:gen` output (ts-proto emits `makeGenericClientConstructor`). Hand-written code there
  must not add one. ⚠️ An earlier draft of this section claimed shared-kernel "never owns a live
  connection" and used that to justify a placement decision; running check H proved it false in three
  generated files. Stated here as measured, not as intended.

### The two outbox interfaces — never conflate them

Asked directly (2026-08-24) and worth pinning, because the two halves look alike and sit in
different layers on purpose:

| | write side | dispatch side |
|---|---|---|
| Interface | `IOutboxWriter` | **none today** |
| Lives in | `core-api/src/common/outbox/outbox-writer.ts` | — |
| Adapter | `PrismaOutboxWriter` (`infrastructure/outbox/`) | `PrismaOutboxRepository`, injected as a concrete class |
| Consumer | command handlers, via `tx.outbox` in the TxScope | PollingPublisher / Reaper / Cleanup / MetricsReporter |
| Transaction | **inside** the caller's — that is what closes the dual-write hole | **outside** any — it holds row locks and does network I/O |

- The write port is **named for its role, not for its one method** (renamed from `IOutboxAppender`
  2026-08-24). It has a single method because appending is the only thing a handler legitimately does
  to the outbox — reaching `claim`/`mark`/`reap` from application code is what the split exists to
  prevent — but the NAME must not be welded to that verb, or a second write operation makes it a lie.
- **Not** `IOutboxRepository`: `naming_conventions.md` §4 reserves that suffix for an entity
  repository with a mapper (the outbox has no domain entity), and if the dispatch side ever gets a
  port back it is that one which deserves the "repository" surface (`IOutboxStore`). One name for two
  different things would rebuild exactly the confusion this table removes.
**Superseded the same day — the engine DID move, so the table above is now:**

| | write side | dispatch side |
|---|---|---|
| Interface | `IOutboxWriter` | `IOutboxStore` |
| Lives in | `shared-kernel/src/outbox/outbox.ports.ts` | same file |
| Adapter | `PrismaOutboxWriter` (core-api `infrastructure/outbox/`) | `PrismaOutboxRepository`, same folder |
| Consumer | command handlers, via `tx.outbox` | `OutboxPublisher` — **shared-kernel's own engine** |
| Transaction | **inside** the caller's | **outside** any |

The dispatch port was deleted in the morning and restored in the afternoon, and that is the rule
working, not thrash: at 09:00 all four of its consumers were core-api infrastructure, so it crossed
no boundary; by 16:00 the publish loop lived in `shared-kernel/src/outbox/outbox-publisher.ts`, so its
consumer is now a different package — **reason A**. "Where are the consumers" never changed; the
consumers did. Which is exactly why placement is re-derived from the import graph rather than
remembered.

Note what did NOT move: `reapStaleInflight`, `countByStatus` and `purgeProcessed` are absent from
`IOutboxStore`. Their callers (Reaper, MetricsReporter, Cleanup) are still core-api infrastructure
sitting next to the adapter, and each is a one-line delegation — porting a one-liner is the ceremony
§6.1 exists to stop. A port carries exactly what crosses the boundary, never "everything the class
can do".

### Duplication that is deliberate

`MembershipVerificationClient` + its `*GrpcCaller` are **byte-identical apart from comments** in
notification-service and search-service, and `jwt-auth.guard` / `trace-context.middleware` /
`response.interceptor` / `global-exception.filter` / `org-aware-throttler.guard` exist in all three
NestJS services. Under reason B the guards/interceptors are settled — they are framework bindings, so
the kind test blocks them regardless. **The two membership-verification files were NOT settled, and were resolved
2026-08-24**: their core is framework-independent with two real consumers, so reason B applied. The
core is now `MembershipVerifier` in `shared-kernel/src/grpc/` (a runtime `@grpc/grpc-js` import is
allowed there — check H), and each service wires it with a `useFactory` provider in its `GrpcModule`
supplying config, its own Redis `ICacheStore`, and its OWN breaker instance (two services must never
share a breaker). **The shell is a factory, not a class** (2026-08-25): each service first kept a
39-line `@Injectable()` wrapper that only `new`-ed the verifier and forwarded one method — a pure
pass-through, itself duplicated byte-for-byte, which even re-declared the return type by hand instead
of reusing `MembershipCheckResult`. shared-kernel cannot carry `@Injectable()` (check H bans
`@nestjs/*`), but that argues for a factory provider, not for inventing a class per service to hold
a decorator. Consumers now inject `MembershipVerifier` itself. The duplication had already cost
something real: **neither copy attached `traceparent`**, so every membership check broke the W3C trace
chain the other gRPC hops maintain — fixed once in the shared core, plus the two servers that never
read it back (`MembershipVerificationGrpcService`, `RagQueryGrpcService`).

---

## 🔒 Enforcement — Lint-Enforced Boundaries (core-api)

> This document describes **intent**; lint makes it **mandatory**. The boundaries below are
> enforced via `@typescript-eslint/no-restricted-imports` in `apps/core-api/eslint.config.mjs`
> (the `@typescript-eslint/` variant also catches `import type` — a type-only dependency across a
> layer is still a dependency). A violation is a **lint failure at commit/CI**, with a message
> spelling out the fix.

| Layer (`files`) | Forbidden imports | Allowed |
|---|---|---|
| `modules/*/domain/**` | NestJS, Fastify, Prisma/`@/generated`, every outer layer (`@/common`, `@/infrastructure`, the module's own application/infrastructure/presentation) | shared-kernel + relative imports within the same domain. **All four services enforce this identically since 2026-08-24** — auth-service used to allow `@/common/**` and was the reason error classes lived in two different places depending on the service. `check:arch` check D reads each service's own config and blocks the relative-path way around the ban, which eslint cannot see. |
| `modules/*/application/**` | **all of `@/infrastructure/**`** except `cqrs`; ORM/DB; **HTTP exceptions** (`NotFoundException`, …) from `@nestjs/common` | ports (`domain/**`, `application/repositories/`, `common/**`); `@/infrastructure/cqrs` (decorators); `@nestjs/common` DI (`@Injectable`/`@Inject`) |
| `modules/*/presentation/**` | Prisma/`@/generated`, `@/infrastructure/database` | push through CommandBus/QueryBus |
| `common/**` | `@/modules`, `@/infrastructure`, NestJS, Fastify, Prisma | shared-kernel + relative |

**2026-08-24 — the application-layer row is an ALLOWLIST now, not a blocklist.** It used to name two
banned folders (`@/infrastructure/database/**`, `@/infrastructure/http/**`) and silently permitted
every other one; that is how `AskAiHandler`/`ProvisionOrgHandler` came to inject concrete gRPC
clients. All three NestJS services now ban `@/infrastructure/**` and negate `@/infrastructure/cqrs`
(auth-service already did it this way). A NEW infra folder is therefore closed by default — the
failure mode being designed out is "nobody remembered to add it to the ban list".

**Module wiring: a service-wide infra module is `@Global` + imported ONCE by `AppModule`
(2026-08-24).** `CqrsModule`, `KafkaModule`, `MessagingModule`, `SagaCompensationModule`,
`ScheduledJobsModule`, `HttpIdempotencyModule` and now `GrpcModule` all follow this. The rule exists
because of what the alternative did: core-api's `GrpcModule` was imported only by `CreditModule` and
`PlatformAdminModule` (which needed its outbound CLIENTS), so the SERVER half it also contains —
`MembershipVerificationGrpcService` + `GrpcServerBootstrap`, started by `main.ts` via
`app.get(GrpcServerBootstrap)` — reached the injector graph purely as a side effect. **Serving a
transport is a service-level lifecycle concern and must not hang off a feature module's import list.**
Note the Nest mechanic that forces `@Global` here: `AppModule` importing a module does NOT make its
exports visible to other modules, so without `@Global` every consumer still has to import it.
An infra module importing a FEATURE module (search-service's `GrpcModule` imports `SearchModule` for
`SearchKnowledgeService`) is fine — Nest's module graph is composition wiring, not the layer graph,
and a driving adapter depends inward on the application service it drives.

⚠️ **`typecheck`/`lint`/`test` cannot see any of this** — a module-graph error only appears at boot.
When you change module wiring, boot it: a one-off spec calling `NestFactory.create(AppModule)` is
enough, and prove the probe works by breaking the wiring on purpose first (removing `GrpcModule` from
search-service's `AppModule` must produce `Nest can't resolve dependencies of the
RemoteOrgMembershipGuard`). There is no permanent gate for this class yet.

**Settled exception (NOT a violation):** `@Injectable()` / `@Inject()` / `@CommandHandler()` in the
application layer is a **valid NestJS DI idiom** — only HTTP exceptions are forbidden there. This is
a framework difference, not an architectural deviation.

**Recommended workflow for a new module in core-api:** turn on / match the lint boundary *first*,
write the code *after* — so the lint gate blocks a misplaced file during generation rather than at a
later audit.

**Quality gate (whole monorepo):** `npm run check` = `turbo run typecheck lint format:check` +
`npm run check:arch` (read-only).

**`npm run check:arch`** (`scripts/check-repo-placement.cjs`) enforces the repository-placement rule
(checks A–E), the port-placement rule (check F: no port declared under `infrastructure/`,
`resilience_patterns.md` §6.1), the module-infrastructure folder allowlist (check G: only
`mappers`/`consumers`/`services`/`repositories` under `modules/<x>/infrastructure/`) and
shared-kernel's runtime-dependency purity (check H, see § Where An Abstraction Lives) across ALL 4
services — the script is the only gate that is uniform
across them, since each service's eslint config is its own file and they have drifted apart before.
It exists because this rule previously lived only as prose in two directives that
contradicted each other for ~6 weeks with nothing to catch it. It also closes a real hole in the
eslint boundary: `no-restricted-imports` matches the literal import string, so it blocks
`@/modules/*/application/**` from domain but NOT a relative `../../application/...` — the script
resolves relative specifiers and catches both. `typecheck` = `tsc --noEmit` per workspace — catches compile errors lint/format miss
(lint only catches rule violations, not e.g. `TS2322`). Quick fix: `npm run lint:fix` +
`npm run format`.

---

## When The Agent Creates A New File

**Required checklist before creating any file:**

1. Is this file an **abstraction/interface** or an **implementation**?
   - Interface → NEVER `infrastructure/`. A port consumed by one module → that module's `domain/`;
     consumed across modules of one service → `common/`; across services → `packages/shared-kernel`.
     If every consumer is itself in `infrastructure/`, write no interface at all (§6.1 of
     `resilience_patterns.md`).
   - Implementation (imports Prisma/Fastify/Pino/…) → `infrastructure/`
2. Is this a **framework-specific HTTP concern** (filter, hook, decorator)?
   - → `infrastructure/http/`
3. Is this a **cross-service contract**?
   - → `packages/shared-kernel`
4. Does the file belong to a specific **feature domain**?
   - → `modules/<domain>/`
5. Is this service's structure in sync with auth-service?
   - Check it against the 5-main-components table above before committing.
6. (core-api) Run `npm run lint` before committing — the boundary rules in §Enforcement will block a
   misplaced file / cross-layer import automatically.
7. Creating a **repository interface**? Do not decide by eye — run `npm run check:arch` (all 4
   services), and read `cqrs_pattern.md`'s 2-step decision procedure for domain-vs-application.
8. Creating any **other** interface (a service port, a client, a store)? Ask only one question:
   **does any consumer live outside `infrastructure/`?** Yes → the interface lives outside
   `infrastructure/` too. No → don't write the interface. `resilience_patterns.md` §6.1.
