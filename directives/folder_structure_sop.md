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
│   │                                # ⚠️ Error base classes do NOT live here — use packages/shared-kernel/src/errors/
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
│       │   └── repositories/        # Command Repository Interfaces (returns Entities)
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
| Put error base classes in a service's `common/errors/` | All error base classes (`AppError`, `DomainError`, `ApplicationError`, `InfrastructureError`, `ResponseFormatError`) live in `packages/shared-kernel/src/errors/` — import them from `@distributed-social-platform/shared-kernel` |
| Create a folder outside the 5 main components without a specific reason | Breaks consistency between services |

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

## 🔒 Enforcement — Lint-Enforced Boundaries (core-api)

> This document describes **intent**; lint makes it **mandatory**. The boundaries below are
> enforced via `@typescript-eslint/no-restricted-imports` in `apps/core-api/eslint.config.mjs`
> (the `@typescript-eslint/` variant also catches `import type` — a type-only dependency across a
> layer is still a dependency). A violation is a **lint failure at commit/CI**, with a message
> spelling out the fix.

| Layer (`files`) | Forbidden imports | Allowed |
|---|---|---|
| `modules/*/domain/**` | NestJS, Fastify, Prisma/`@/generated`, every outer layer (`@/common`, `@/infrastructure`, the module's own application/infrastructure/presentation) | shared-kernel + relative imports within the same domain |
| `modules/*/application/**` | ORM/DB/HTTP infra; **HTTP exceptions** (`NotFoundException`, …) from `@nestjs/common` | repository interfaces; `@/infrastructure/cqrs` (decorators); `@nestjs/common` DI (`@Injectable`/`@Inject`) |
| `modules/*/presentation/**` | Prisma/`@/generated`, `@/infrastructure/database` | push through CommandBus/QueryBus |
| `common/**` | `@/modules`, `@/infrastructure`, NestJS, Fastify, Prisma | shared-kernel + relative |

**Settled exception (NOT a violation):** `@Injectable()` / `@Inject()` / `@CommandHandler()` in the
application layer is a **valid NestJS DI idiom** — only HTTP exceptions are forbidden there. This is
a framework difference, not an architectural deviation.

**Recommended workflow for a new module in core-api:** turn on / match the lint boundary *first*,
write the code *after* — so the lint gate blocks a misplaced file during generation rather than at a
later audit.

**Quality gate (whole monorepo):** `npm run check` = `turbo run typecheck lint format:check`
(read-only). `typecheck` = `tsc --noEmit` per workspace — catches compile errors lint/format miss
(lint only catches rule violations, not e.g. `TS2322`). Quick fix: `npm run lint:fix` +
`npm run format`.

---

## When The Agent Creates A New File

**Required checklist before creating any file:**

1. Is this file an **abstraction/interface** or an **implementation**?
   - Interface → `common/`
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
