# SOP: Naming Conventions

> The naming standard for class/file families that repeat across the monorepo (Guard, Caller, gRPC
> Client, Repository, Handler, Error, Module, env var). Read this BEFORE creating a class in one of
> the groups below — the goal is that the name states the mechanism, without needing to open the
> file or read a comment to understand it.

## 🎯 Why this file exists

A 2026-07-19 survey found that several class "families" (same architectural role, repeated across
services) had organically settled into reasonably good naming — but **nowhere was it written down as
an explicit rule**, so each new piece of code risked being named by whatever felt right in that
session rather than by the existing convention. A real example: `OrgGuard` (core-api, checking
membership against the local DB) and the first version of the equivalent guard in
search-service/notification-service were given the **identical** name (`OrgMembershipGuard`) despite
completely different mechanisms (an outbound gRPC call, not a DB query) — later corrected to
`RemoteOrgMembershipGuard`.

The principle running through this whole file: **the name must answer "where does the truth come
from"** — the local DB, an outbound call (network), or just reading a claim that's already present
(JWT) — without making the reader open the file to find out.

## 1. NestJS Guard (`implements CanActivate`)

| Authentication/authorization mechanism | Suffix | Example |
|---|---|---|
| Only verifies the JWT signature, checks nothing else (no DB, no network) | `JwtAuthGuard` (fixed name, identical across services) | `JwtAuthGuard` (core-api/search-service/notification-service) |
| Checks permission against the **local DB** (a table owned by this service) and may resolve extra role/permission data | `{Scope}Guard` (no "Local" prefix needed — this is the default baseline) | `OrgGuard` (core-api — queries the local `MembershipRepository`, resolves role + permissions) |
| Checks permission by **calling out over the network** (gRPC/HTTP) because this service doesn't own that table | `Remote{Scope}Guard` | `RemoteOrgMembershipGuard` (search-service, notification-service — gRPC to core-api) |
| Only reads a claim already present in the JWT payload — NO DB, NO network | `{Scope}PermissionGuard` (no "DB"/"Remote", because it's zero-lookup; the name should imply "reads straight off the token") | `SystemPermissionGuard` (core-api — reads the `permissions` claim, queries nothing) |

**Decision rule when creating a new guard:** ask *"where does this guard get its truth from?"*

1. From nowhere — it only verifies a signature → `JwtAuthGuard` (reuse it, don't create a variant).
2. Queries a table INSIDE this service's own DB → `{Scope}Guard`, no prefix.
3. Must call out (a network call) because this service doesn't own that table → `Remote{Scope}Guard`.
4. Only reads an existing JWT claim, no lookup at all → `{Scope}PermissionGuard`.

⚠️ **Known technical debt, NOT yet fixed (don't rename it on sight):** by the rule above, `OrgGuard`
(core-api) could read as "mechanism unclear" if seen in isolation, without `RemoteOrgMembershipGuard`
next to it for contrast. The team considered this and decided **not to add `Local` to `OrgGuard`**,
because this is the service that owns the data — the default baseline needs no prefix; only the
"exceptional" instance (calling outward) needs the `Remote` prefix to mark itself as different from
the baseline.

## 2. SRP "Caller" class (wrapping a `CircuitBreaker`)

The pattern: a class containing **only** a `CircuitBreaker` plus a
`call<T>(fn: () => Promise<T>): Promise<T>` method, with no business logic (see
`resilience_patterns.md` §3.1.2).

**Rule:** `{ProtectedDependencyName}Caller` — if that dependency is itself a gRPC/generated client,
insert `Grpc` into the middle of the name to distinguish the wrapper from the client it wraps.

| Example | What it protects |
|---|---|
| `ClaudeApiCaller`, `GeminiApiCaller` | HTTP calls out to the Claude/Gemini API |
| `OllamaEmbeddingCaller` | HTTP call out to the Ollama embedding service |
| `ElasticsearchSearchCaller` | The ES client's `search()` call |
| `AuthProvisioningGrpcCaller` | Wraps `AuthProvisioningClient` (gRPC) |
| `MembershipVerificationGrpcCaller` | Wraps `MembershipVerificationClient` (gRPC) |

100% consistent across the repo as of 2026-07-19 — no exceptions.

## 3. gRPC Client class (the caller side, NOT the server)

**Rule:** `{ServiceContract}Client` — always suffixed `Client`, and **do NOT** add `Grpc` to the name
(unlike the Caller in §2, where `Grpc` DOES appear — the reason: the Client's name already matches
the `service` declared in the `.proto`, so adding `Grpc` is redundant; that it is gRPC is already
obvious from how it's used/generated).

| Example | proto service |
|---|---|
| `AuthProvisioningClient` | `service AuthProvisioning` |
| `MembershipVerificationClient` | `service MembershipVerification` |

## 4. Repository (Domain interface + Infrastructure impl)

**The standard rule (core-api, search-service, notification-service):**

- Interface: `I{Entity}Repository` (domain layer, sitting next to the `{ENTITY}_REPOSITORY` DI token,
  a `Symbol`)
- Implementation: `Prisma{Entity}Repository implements I{Entity}Repository`
- A separate query side (CQRS, returning DTOs instead of Entities): the `.query-repository.ts`
  suffix / `I{Entity}QueryRepository`

✅ **Fixed (2026-07-31):** `auth-service` used to omit the `I` prefix on interfaces — e.g.
`RefreshTokenRepository`, `UserRepository`, `RoleRepository` — while the implementations still
followed the pattern correctly (`PrismaUserRepository implements UserRepository`). Found during a
repo-wide sweep for interfaces deviating from the rule (2026-07-31); all were renamed to
`IUserRepository`, `IRoleRepository`, `IRefreshTokenRepository`, `IUserQueryRepository`,
`IRoleQueryRepository`, `IGrpcIdempotencyRepository` (plus two domain-service ports from the same
root cause: `TokenService`→`ITokenService`, `PasswordService`→`IPasswordService` — these are NOT
repositories, but they shared the same "auth-service doesn't use the `I` prefix" origin, so they were
fixed in the same pass for consistency). auth-service now matches
`core-api`/`search-service`/`notification-service` 100%. `tsc --noEmit` clean and 123/123 tests
passing after the rename.

## 5. Command/Query Handler (CQRS)

**Rule:** `{Verb}{Noun}Command`/`{Verb}{Noun}Query` always pairs with `{Verb}{Noun}Handler` — the
handler's name must match the command/query it handles EXACTLY (no abbreviations, no reordered
words).

Examples: `GrantCreditsCommand` ↔ `GrantCreditsHandler`, `SpendCreditsCommand` ↔
`SpendCreditsHandler`, `RefreshCommand` ↔ `RefreshHandler`. Confirmed 100% consistent — no exceptions
found.

## 6. Domain Error class

**Rule:** `{SpecificReason}Error extends ApplicationError` (not `AppError`/`Exception`).

**Location + filename:** `common/errors/{module}.error.ts` — **singular** (`error`, not `errors`).

Correct examples: `auth.error.ts`, `rbac.error.ts`, `user.error.ts`, `engagement.error.ts`,
`knowledge.error.ts`, `platform-admin.error.ts`, `tenant.error.ts`, `notification.error.ts`.

⚠️ **Known exception, NOT yet fixed:** `apps/core-api/src/modules/credit/domain/credit.errors.ts` —
wrong on **two counts** at once: (a) plural (`credit.errors.ts` instead of `credit.error.ts`), and
(b) wrong location (inside `modules/credit/domain/` rather than `common/errors/` like every other
module). Don't move/rename it just because you happened to walk past it — fix it only when another
legitimate reason is already touching that file, to avoid one PR mixing a pure rename with a logic
change.

## 7. NestJS Module (`@Module`)

**Rule:** `{Feature}Module`, filename `{feature}.module.ts` — the class name MUST match the filename
(no hidden prefix that doesn't appear in the filename).

⚠️ **Known exception, NOT yet fixed:**
`apps/core-api/src/infrastructure/http/idempotency/idempotency.module.ts` — the file is named
`idempotency.module.ts` but the actual class is `HttpIdempotencyModule` (not `IdempotencyModule`).
Historical reason: `HttpIdempotencyModule` deliberately distinguishes it from the idempotency concept
at another layer (the Kafka consumer — §1.0 technique #3/#4 in `idempotency_strategy.md`) — but the
file/class mismatch should still be fixed when convenient: rename the file to
`http-idempotency.module.ts` to match, and leave the class name alone (the class name is the
meaningful one).

## 8. Config env var

**Rule:**

- `.env`: `SCREAMING_SNAKE_CASE`, with a `{SERVICE}_` prefix when the variable is service-specific
  (e.g. `CORE_KAFKA_CLIENT_ID`, `NOTIFICATION_KAFKA_CLIENT_ID`, `SEARCH_KAFKA_CLIENT_ID`,
  `WORKER_KAFKA_CLIENT_ID`) — do NOT use one generic `KAFKA_CLIENT_ID` for a variable whose value
  differs per service (this was a real bug once; see `.ai/memory/conventions.jsonl`).
- `env.config.ts` (after `registerAs('env', ...)` reshapes it): `camelCase`, preserving the
  singular/plural of the source name (`kafkaBrokers` is plural because `KAFKA_BROKERS` is plural).
- Singular/plural must match the real semantics: a single value → singular (`CORE_GRPC_URL`); a
  comma-separated list of values → plural (`KAFKA_BROKERS`, `CORS_ALLOWED_ORIGINS`).

⚠️ **Known exception, NOT yet fixed:** `CORS_ORIGINS` (auth-service) vs `CORS_ALLOWED_ORIGINS`
(core-api, search-service, notification-service) — two names for the same concept. Recorded as a
"known split" in `.ai/memory/conventions.jsonl`; not unified yet because it touches all four
`.env.schema`/`.env.validation` files and risks breaking a running config — fix it only when another
reason is already touching the CORS configuration of all four services at once, never as a
standalone PR just to rename an environment variable.

## 9. Domain Port (outbound service interface — calling an AI provider / external service)

**Rule:** `I{Capability}Service` for the interface, file `{capability}.service.ts` — even when the
more natural name would be an agent noun ending in "-er" (`Summarizer`, `Chunker`). The accompanying
DI token: `{CAPABILITY}_SERVICE` (SCREAMING_SNAKE, dropping the `I` prefix, adding the `_SERVICE`
suffix).

| Example | File | Token |
|---|---|---|
| `IEmbeddingService` | `embedding.service.ts` | `EMBEDDING_SERVICE` |
| `ISummarizerService` | `summarizer.service.ts` | `SUMMARIZER_SERVICE` |

⚠️ **Does NOT apply to a PURE domain service with no interface** (makes no outbound call, needs no
swappable adapter) — e.g. `TextChunker` (`text-chunker.ts`, `domain/services/`) has no `I` prefix and
no `Service` suffix, because it isn't a port. The deciding question: *"can this class have more than
one swappable implementation (different adapters behind one interface)?"* — yes → group 9 (a port);
no → name it freely by its domain meaning, with no obligation to use `.service.ts`.

**History:** found on 2026-07-24 when the user (learning RAG, reading the code for the first time)
asked why `embedding.service.ts` (`IEmbeddingService`) and `summarizer.ts` (`ISummarizer`) were named
differently despite playing the same port role — group 9 had never been written down as a rule until
then, even though `folder_structure_sop.md` listed both names as examples without noticing the
inconsistency. Standardised on `I{X}Service` and renamed
`summarizer.ts`→`summarizer.service.ts`, `ISummarizer`→`ISummarizerService`,
`SUMMARIZER`→`SUMMARIZER_SERVICE`.

## 10. Messaging Port (transport-agnostic port, `packages/shared-kernel/src/messaging/interfaces/`)

**Rule:** `I{Noun}` for the interface, file `{noun}.interface.ts`. The `Service` suffix is NOT
required as it is in group 9 — this isn't "calling an AI provider/external service", it's a pure
messaging contract (publish / receive an integration event / dead-letter), so keeping the accurate
role noun (`Publisher`, `Handler`, `Producer`) is more natural than forcing it into `Service`.

| Example | File |
|---|---|
| `IMessagePublisher`, `ITransportPublisher` | `message-publisher.interface.ts` |
| `IIntegrationEventHandler` | `event-handler.interface.ts` |
| `IDeadLetterProducer` | `dead-letter.interface.ts` |

⚠️ **Does NOT apply to the two groups below, which are easy to confuse because they also "look like
ports":**

- **Structural typing that mirrors an external library's shape**
  (`packages/shared-kernel/src/messaging/kafka-shapes/`): `MinimalConsumer`, `MinimalKafkaMessage`,
  `MinimalEachMessagePayload`, `MinimalProducer`, `MinimalDlqConsumer` — NO `I` prefix, despite
  playing a technically similar role, because these are reduced (duck-typed subset) versions of
  types from one specific library (kafkajs), not concepts the domain defines. An `I` would wrongly
  imply a domain port whose adapter can be swapped at will.
- **Pure DTO/data shapes with no behaviour**: `CloudEvent`, `DeadLetterInput` — they describe the
  DATA accompanying a call, not the contract itself, so they need no `I`.

The deciding question: *"is this type a concept the domain defines itself (with methods, potentially
several implementing adapters), or just a reduction of an external library's API / pure data?"* —
domain-defined with behaviour → group 10 (`I` prefix); reduced from an external lib, or pure data →
no `I`.

**History:** found on 2026-07-31 when the user re-read the publisher/consumer/DLQ-replay flow and
noticed `DeadLetterPort` was the ONLY name in `messaging/interfaces/` not following `I{Noun}` like
the other three interfaces (no `I` prefix, and a `Port` suffix no other interface in that directory
used) — renamed to `IDeadLetterProducer`, and this rule written at the same time so group 9
(AI-provider ports) doesn't get misapplied to messaging ports or vice versa.

## ⚠️ How to apply this file

- **The rules here apply to NEW code.** The exceptions listed under each group are known technical
  debt — don't mass-rename while merely reading past them; fix one only when another legitimate
  reason is already touching that exact file (avoid a PR mixing a pure rename with a logic change,
  which is hard to review and hard to revert).
- When creating a class in one of the groups above and unsure what to name it, ask that group's
  decision question (§1 has the worked example) — do NOT copy the closest-looking name found via
  Ctrl+F, because that name might itself be one of the exceptions listed above.
