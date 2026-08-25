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
| `MembershipVerificationGrpcCaller` | The breaker `MembershipVerifier` calls through (gRPC) |

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

> The rule names the class that speaks the contract — usually the ts-proto **generated** stub. When a
> hand-written class wraps that stub with policy of its own (caching, deadlines, metadata), name it for
> what it *does*, not for the proto service: `MembershipVerifier` wraps the generated
> `MembershipVerificationClient` and is NOT called `...Client`, precisely so the two are
> distinguishable at a glance.

## 4. Repository (Domain interface + Infrastructure impl)

**The standard rule (core-api, search-service, notification-service):**

- Interface: `I{Entity}Repository` (domain layer, sitting next to the `{ENTITY}_REPOSITORY` DI token,
  a `Symbol`)
- Implementation: `Prisma{Entity}Repository implements I{Entity}Repository`
- A separate query side (CQRS, returning DTOs instead of Entities): the `.query-repository.ts`
  suffix / `I{Entity}QueryRepository`

**⚠️ A `Prisma*Repository` class does NOT always have an interface (2026-08-24).** The rule above
describes the standard case — a repository that is a real port. When EVERY consumer of a repository
lives inside `infrastructure/` there is no port and no interface, and the class keeps the
`Prisma{X}Repository` name anyway: it is still a repository, just not a ported one. Live examples:
`PrismaOutboxRepository` (consumers: PollingPublisher/Reaper/Cleanup/MetricsReporter) and the
reaper/cleanup half of `PrismaSagaCompensationRepository`. Do not read `implements` into the name,
and do not "restore" a missing interface — `resilience_patterns.md` §6.1, enforced by
`npm run check:arch` check F.

**⚠️ `.query-repository.ts` is reserved for `application/repositories/` ports only — do NOT use it for a
domain-layer READ port.** Found 2026-08-20: `ISearchChunkReader` and `IOrgRolePermissionReader` are
both plain READ ports (no entity, no mapper — see `cqrs_pattern.md`'s repository-placement rule for
the domain-vs-application litmus test), but their Prisma implementations had been named
`Prisma{X}QueryRepository`/`*.query-repository.ts` anyway, borrowing the nearest-looking suffix. That
suffix means something specific (an application-layer port returning a DTO straight to a query
handler) and implies a location (`application/repositories/`) — using it for a domain-consumed reader is
misleading about both.

**Decision rule** — this file names things; `cqrs_pattern.md` decides WHERE they go via a 2-step
procedure (step 1 = has a write method? → domain; step 2 = read-only, does `domain/` import it?).
Read that first, then name per the two cases below. Placement is machine-checked by
`npm run check:arch`; naming is not, so the cases below still need a human eye.

**Naming for a repo that only reads (no entity/mapper):**

1. Does the interface itself live in `domain/repositories/` because a **domain-layer class** consumes
   it (a domain service, not just a query handler)? → it is a domain READ port. Name the interface
   `I{X}Reader` (already the convention: `IOrgRolePermissionReader`, `ISearchChunkReader`), and name its
   Prisma impl `Prisma{X}Reader{Repository}` / `{x}-reader.repository.ts` — **never** `.query-repository`.
   Example: `PrismaOrgRolePermissionReaderRepository` (`prisma-org-role-permission-reader.repository.ts`),
   fixed 2026-08-20 (was `PrismaOrgRolePermissionQueryRepository`).
2. Does NOTHING in `domain/` import the interface — only an `application/` class (a query handler, or
   an application service like `SearchKnowledgeService`) does? → it's a genuine application query-repo.
   Move the interface itself to `application/repositories/{module}.query-repository.ts`, keep the standard
   `I{Entity}QueryRepository` naming. Example: `ISearchChunkReader` moved from
   `domain/repositories/search-chunk.repository.ts` to
   `application/repositories/search-chunk.query-repository.ts` (its impl file, already named
   `prisma-search-chunk.query-repository.ts`, needed no rename — only its import path changed).

The full architectural reasoning (why domain-consumed reads can't simply move to `application/` even
though they "look like" a query-repo) is in `cqrs_pattern.md`'s repository-placement section — read
that first before reclassifying a new one.

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

**Vị trí + tên file — MỘT MỐI, không ngoại lệ (chốt 2026-08-24):**

> `modules/{module}/domain/{module}.error.ts` — mỗi module đúng **một** file lỗi, tên file trùng tên
> module, **số ít** (`error`, không phải `errors`).

Không còn `common/errors/`. Thư mục đó đã bị xoá ở cả 3 service có nó; 8 file được gom về `domain/`
của module sở hữu, và **cả 4 service giờ đều cấm `modules/*/domain/**` import `@/common/**`** —
nên `common/` không còn là lựa chọn hợp lệ nữa, chứ không phải "một trong hai chỗ".

Hiện trạng sau khi gom: `auth.error.ts`, `rbac.error.ts`, `user.error.ts` (auth-service) ·
`knowledge.error.ts`, `engagement.error.ts`, `tenant.error.ts`, `platform-admin.error.ts`,
`credit.error.ts` (core-api) · `notification.error.ts` (notification-service).

**Class thuộc module nào thì đi theo NGƯỜI THROW, không theo tên class.** Ví dụ thật:
`AuthMethodNotFoundError` mang chữ "auth" nhưng người throw là `user.entity.ts` → nó nằm trong
`modules/user/domain/user.error.ts`. Thấy ngược mắt thì đó là dấu hiệu **tên class** đặt sai — sửa
tên bằng một commit riêng, đừng để nó lái vị trí file.

**Base class:** `ApplicationError`, kể cả với error do domain throw — không phải lựa chọn thẩm mỹ:
`GlobalExceptionFilter` chỉ map `instanceof ApplicationError` sang status code, mọi base khác rơi
xuống 500. `shared-kernel/src/errors/` có **`AppError`, `ApplicationError`, `InfrastructureError`,
`UnreachableError`, `ResponseFormatError` — không có `DomainError`** (một dòng cũ trong
`folder_structure_sop.md` từng nhắc tới nó; class đó chưa bao giờ tồn tại).

**Machine-checked:** `npm run check:arch` check I (đúng một vị trí, tên khớp module, số ít) và
check D (domain không được import `@/common/**` — kể cả bằng đường vòng relative, thứ mà eslint
không thấy vì nó khớp chuỗi literal).

⚠️ **Mục này từng SAI, và cách nó sai đáng nhớ.** Nó bắt **mọi** error phải ở `common/errors/`, rồi
liệt kê đúng một file không tuân theo được — `credit.errors.ts`, do `credit-account.aggregate.ts`
throw — như là *"known exception, NOT yet fixed, wrong on two counts"*. Nửa "plural" đúng; **nửa
"sai vị trí" là chẩn đoán sai**: `@/common/**` nằm trong ban-list của tầng domain, nên làm theo
directive thì aggregate không import nổi error của chính nó. credit là module duy nhất có domain
throw error nên là chỗ duy nhất mâu thuẫn lộ ra — và nó bị ghi thành "cẩu thả" thay vì "hai rule đá
nhau". Cùng hình dạng với vụ `folder_structure_sop.md` ↔ `cqrs_pattern.md` mâu thuẫn ~6 tuần hồi
2026-07. **Khi đúng MỘT file "vi phạm" một rule, kiểm tra rule trước khi sửa file.**

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
suffix). **The adapter class implementing the port keeps the same `Service` suffix as the interface**
(mirrors group 4's `Prisma{Entity}Repository implements I{Entity}Repository` — the impl's name is the
interface's suffix with the mechanism prefixed on): `{Provider}{Capability}Service`.

| Example | File | Token | Adapter(s) |
|---|---|---|---|
| `IEmbeddingService` | `embedding.service.ts` | `EMBEDDING_SERVICE` | `HttpEmbeddingService` |
| `ISummarizerService` | `summarizer.service.ts` | `SUMMARIZER_SERVICE` | `ClaudeSummarizerService`, `GeminiSummarizerService` |

⚠️ **Does NOT apply to a PURE domain service with no interface** (makes no outbound call, needs no
swappable adapter) — e.g. `TextChunker` (`text-chunker.ts`, `domain/services/`) has no `I` prefix and
no `Service` suffix, because it isn't a port. The deciding question: *"can this class have more than
one swappable implementation (different adapters behind one interface)?"* — yes → group 9 (a port);
no → name it freely by its domain meaning, with no obligation to use `.service.ts`. When a pure domain
service's file/class DO drift apart (agent-noun class, verb-phrase filename, or vice versa), the
FILENAME should match the CLASS — e.g. `resolve-org-permissions.ts` → `org-permission-resolver.ts`
(fixed 2026-08-20, class was always `OrgPermissionResolver`; same precedent as `TextChunker` living in
`text-chunker.ts`, not a verb-phrase file).

**History:** found on 2026-07-24 when the user (learning RAG, reading the code for the first time)
asked why `embedding.service.ts` (`IEmbeddingService`) and `summarizer.ts` (`ISummarizer`) were named
differently despite playing the same port role — group 9 had never been written down as a rule until
then, even though `folder_structure_sop.md` listed both names as examples without noticing the
inconsistency. Standardised on `I{X}Service` and renamed
`summarizer.ts`→`summarizer.service.ts`, `ISummarizer`→`ISummarizerService`,
`SUMMARIZER`→`SUMMARIZER_SERVICE`.

**Follow-up 2026-08-20:** the interface/file/token rename above never covered the ADAPTER class name —
audit found `HttpEmbeddingService` (kept `Service`) next to `ClaudeSummarizer`/`GeminiSummarizer`
(dropped it), a real inconsistency between 2 adapters of the SAME port shape in the SAME service.
Renamed `ClaudeSummarizer`→`ClaudeSummarizerService` (`claude-summarizer.ts`→
`claude-summarizer.service.ts`), same for Gemini — now 100% consistent with `HttpEmbeddingService`.

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

## 11. Application Service (a class doing application-layer orchestration with no CommandBus/QueryBus)

**Rule:** `{Verb}{Noun}Service`, file `{verb}-{noun}.service.ts`, living in `application/queries/` (or
`application/` for a service with no query-repo) — this is what a query handler would be called if the
service HAD a bus to dispatch through.

Only applies where group 5 (Command/Query Handler) genuinely does not apply — i.e. `rag_ai_integration.md`'s
documented exception (search-service has no CommandBus/QueryBus because its only write is a Kafka event,
not an HTTP command; see `resilience-defense-curriculum-progress.md`/`kafka-rag-learning-progress.md` for
the full reasoning). Do NOT name a class this way just to dodge naming a `Query`/`Handler` pair when a bus
IS available — that is group 5's job.

| Example | Why not group 5 |
|---|---|
| `SearchKnowledgeService` (`application/queries/search-knowledge.service.ts`) | Called directly via NestJS DI from `SearchController` — no `QueryBus`, no `SearchKnowledgeQuery` object exists to pair a `Handler` name with. |

**Found 2026-08-20:** the user noticed `IndexKnowledgeHandler` (event side, correctly named — dispatched
through `EventRouter`) sitting next to `SearchKnowledgeService` (query side) and asked whether the
asymmetry was a naming mistake. It isn't — but until this entry, naming_conventions.md had no rule
covering `application/queries/*.service.ts` at all, so the name looked arbitrary rather than
deliberate. This group exists so the next reader has a rule to point to instead of re-deriving the
"no bus" reasoning from scratch.

Also fixed the same day, in the adjacent auth-service naming debt this audit surfaced:
`ImpPasswordService`/`ImpTokenService` (`Imp` = "implementation", says nothing about mechanism, the
exact violation naming_conventions.md's intro warns against) → renamed to `Argon2PasswordService`
(`argon2-password.service.ts`, uses the `argon2` package) and `JwtTokenService`
(`jwt-token.service.ts`, uses `jsonwebtoken` + RS256/HS256) — matching how every other adapter in the
repo is named after its real mechanism (`HttpEmbeddingService`, `PrismaXRepository`,
`ElasticsearchKeywordRepository`).

## 12. `presentation/` controller subfolder — always nested under `controllers/`

**Rule:** `presentation/controllers/{name}.controller.ts` — matches `folder_structure_sop.md`'s spec
(`presentation/routes/` for Fastify, `controllers/` for NestJS), and matches `presentation/schemas/`
already being nested the same way in every service.

**Fixed 2026-08-20:** search-service and notification-service had their single controller sitting
directly under `presentation/{name}.controller.ts` (flat), while core-api's 6 modules were already
correctly nested under `presentation/controllers/`. Moved
`search.controller.ts`→`presentation/controllers/search.controller.ts` and
`notification.controller.ts`→`presentation/controllers/notification.controller.ts` (relative import
depth changed by one level in both — `../` → `../../` for application imports, `./schemas/` → `../schemas/`).

## ⚠️ How to apply this file

- **The rules here apply to NEW code.** The exceptions listed under each group are known technical
  debt — don't mass-rename while merely reading past them; fix one only when another legitimate
  reason is already touching that exact file (avoid a PR mixing a pure rename with a logic change,
  which is hard to review and hard to revert).
- When creating a class in one of the groups above and unsure what to name it, ask that group's
  decision question (§1 has the worked example) — do NOT copy the closest-looking name found via
  Ctrl+F, because that name might itself be one of the exceptions listed above.
