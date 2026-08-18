# Observability & Logging Standard

**Date**: May 2026  
**Target**: All microservices  
**Status**: ✅ IMPLEMENTED (Standardized across services)

## The Dual-Logging Philosophy

In a strict Hexagonal / CQRS Architecture, logging is split into two distinct layers. This separation of concerns ensures that observability is precise, transport-agnostic, and easy to profile.

We mandate the use of **two independent logs** for every user action:

### 1. HTTP Layer Log (Fastify Request Logger)
**Location**: `src/infrastructure/http/hooks/http-logging.hook.ts`

- **Purpose**: To observe the network/transport layer.
- **What it logs**: HTTP Protocol metrics (Method, Route, URL, Status Code, IP Address, User-Agent, and the total duration of the HTTP Request).
- **Why it is needed**:
  - Acts as the "gatekeeper" log.
  - Monitors API endpoint health and HTTP routing.
  - Helps the Load Balancer / API Gateway track 400s (Client Errors) and 500s (Server Errors).
  - Determines the overall latency experienced by the client (Network + Framework overhead + Business Logic).

### 2. Business Layer Log (CQRS Middleware Logger)
**Location**: `src/common/cqrs/middlewares/logging.middleware.ts`

- **Purpose**: To observe the core business logic (Application Layer).
- **What it logs**: Command/Query name, execution payload, and the execution time of the specific Handler logic.
- **Why it is needed**:
  - **Transport Agnostic**: If a Command is triggered by a Message Queue (Kafka/RabbitMQ), a cron job, or gRPC rather than HTTP, this log still perfectly captures the business action.
  - **Deep Profiling**: By comparing this log's duration with the HTTP log's duration, developers can pinpoint bottlenecks. (e.g., If HTTP took 100ms but Command took 20ms, the system is losing 80ms to network latency, middleware, serialization, or auth guards, not the database).

## Standard Output Format

Always use structured JSON logging in production. 
Do not pollute the console with unstructured strings. 

- Use the shared `createLogger(serviceName)` utility from `@distributed-social-platform/shared-kernel`.
  - *Note for dev mode:* `createLogger` uses `pino-pretty` for console output and directly pushes to Elasticsearch via `pino-elasticsearch`.
  - *Prod mode:* `createLogger` writes JSON to stdout only (`pino/file`, `destination: 1`) — no direct ES push. See "Production log shipping" below.
- Never `console.log`.

### Production log shipping — FluentBit instead of pushing straight from the app (BLUEPRINT, 2026-07-25)

**The real status, not an assumption:** `apps/*` has **no Dockerfile at all** in the repo (checked 2026-07-25) — meaning there is no real container to tail logs from. What follows is a blueprint prepared for when the apps are containerised, **NOT something already deployed** — `docker-init/fluent-bit/` exists, and the `fluent-bit` service in `docker-compose.yml` sits behind the `prod-logging-blueprint` profile (so it doesn't start on its own).

**Why we need to move away from pushing directly (`pino-elasticsearch`) in production:** pushing straight from the app means the app itself is responsible for buffering/retrying when ES is down, coupling the business process directly to the log sink. That is the legitimate reason already stated in `createLogger`'s comment (`logger/index.ts`) — there is now a concrete plan to act on it.

**The design:**
- The app does NOT change its log format — still JSON to stdout, as in the current prod mode (`destination: 1`). Docker's `json-file` log driver (the default) wraps each line as `{"log": "<json>\n", "stream": "stdout", "time": "..."}`.
- `docker-init/fluent-bit/fluent-bit.conf`: a `tail` input reads `/var/lib/docker/containers/*/*.log` → a `parser` filter unwraps the `log` field (JSON nested in JSON) → an `es` output with `Write_Operation create` (required for a data stream, matching the `opType:'create'` the app already uses).
- **Audit/operational routing needs NO extra handling in FluentBit** — genuinely verified: writing a doc into `dsp-logs` WITHOUT specifying a pipeline still gets rerouted correctly, thanks to the `index.default_pipeline` attached to the index template (see "Physical separation at the ES layer" above). FluentBit only needs to know to write to `dsp-logs`; it needs to know nothing about audit routing.

**When to wire it up for real:** once `apps/*` have Dockerfiles and run in containers (a separate task, and NOT to be slipped into a logging pass — it touches CI/CD/deploy, a much larger scope). At that point: drop `profiles: ["prod-logging-blueprint"]`, and mount `/var/lib/docker/containers` at the real path on whichever host runs Docker (that path assumes a Linux Docker daemon — Docker Desktop/WSL2 differs, so re-verify the path once real containers exist).

## Logger Hierarchy — ROOT once, CHILD everywhere (MANDATORY)

> ⚠️ A gotcha already hit (2026-06-28): every call to `createLogger()` creates a **SEPARATE pino transport set** (its own pretty worker thread + its own Elasticsearch connection). Calling `createLogger()` ad-hoc in feature code duplicates the ES connection and loses `requestId` correlation. That is NOT a child logger.

**The correct model (1 root → N children, sharing one transport):**

| Role | How | Called where |
|---|---|---|
| **ROOT** logger (1 transport / process) | `createLogger('<service>')` | **ONE place only**: the composition root |
| **CHILD** logger (every component) | DI, never self-created | service/middleware/handler |

- **core-api (NestJS):** root = `LoggerModule.forRootAsync({ pinoHttp: { logger: createLogger('core-api') } })` in `app.module.ts` (the only one). Everywhere else **injects** a child logger:
  ```ts
  import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
  constructor(@InjectPinoLogger(XxxService.name) private readonly logger: PinoLogger) {}
  ```
  `@InjectPinoLogger(name)` attaches a `context: name` field → Kibana filter `serviceContext: core-api` + `context: XxxService`. The CQRS middleware receiving `PinoLogger` via `inject: [PinoLogger]` in `cqrs.module.ts` is also one of these children.
- **auth-service (Fastify):** the root is created once at bootstrap (`loggerInstance`), children via `logger.child({ context })`.
- ⛔ **FORBIDDEN**: `const logger = createLogger('foo')` at module scope / in feature code. `createLogger` is composition-root only.

### ⛔ MAJOR CHANGE 2026-07-25 — implicit context (class name) is now completely banned; every log MUST use an explicit `LogContext`

The user's objection was correct: the previous system had **two sources setting the same `context` field** — (1) `@InjectPinoLogger(ClassName.name)`/`logger.child({context: ClassName.name})` automatically, and (2) a hand-passed `context: LogContext.X` field in each log call. That is two places doing one job — not a deliberate fallback, but a leftover from the library, and it had two real consequences (verified against real pino/nestjs-pino, not guessed):

1. **NestJS (`nestjs-pino`)**: `PinoLogger.call()` does `Object.assign({context: this.context}, firstArg)` — if the log call DOES pass an explicit `context`, that one wins, and `@InjectPinoLogger(ClassName.name)` becomes dead code that looks load-bearing but isn't.
2. **auth-service (plain pino)**: `logger.child({context: X})` followed by `logger.warn({context: Y}, msg)` → the JSON output contains the `context` field **TWICE** (`"context":"X","context":"Y"`) — technically malformed JSON, correct only by luck (parsers take the last value).

**The new rule, applied repo-wide**: EVERY log call, in EVERY service, MUST pass `context: LogContext.X` explicitly — no exceptions, and never relying on any automatic mechanism (`child()`, `@InjectPinoLogger(name)`'s auto-context). If a class needs a context value that doesn't exist yet → **add it to `log-context.ts`**, even if only one service uses it today — no more implicit context via class name, not even for a single service.

**Three new values added** (previously using an implicit class name, or having no context at all):
- `CIRCUIT_BREAKER` — `shared-kernel/src/resilience/circuit-breaker.ts`, shared by EVERY `*Caller` wrapper (Claude/Gemini/Ollama/Elasticsearch/gRPC callers in both search-service and core-api) — fix it in one place, and it cascades automatically to all of them.
- `OUTBOX` — `PollingPublisherService` + `OutboxReaperService` + `KafkaProducerService` (core-api) — one "DB row → Kafka topic" pipeline, grouped under one context so the whole pipeline can be filtered at once instead of as three separate fragments.
- `IDEMPOTENCY` — `IdempotencyInterceptor` + `IdempotencyCleanupService` (core-api).
- `LIFECYCLE` — process start/shutdown (`main.ts` in every service) — not a request/dispatch boundary, but it still needs a context like every other log.

**A secondary bug found while fixing `main.ts`**: `logger.error(err, 'Error during shutdown')` (using `nestjs-pino`'s `Logger` class, NOT `PinoLogger`) — that class mimics Nest's `LoggerService` (`error(message, trace?, context?)`), treating the LAST optional param as `context`, not as the message. Verified with real pino: the string `'Error during shutdown'` was misread as `context`, and the log line had NO `msg` at all — the message vanished entirely. Fix: when you need both a message and an explicit context, the message must live INSIDE the object (`{err, msg: '...'}`), with context as the final optional param.

**auth-service — dropped `.child({context: ClassName.name})` entirely** (`container/application.ts`, `LoginHandler`/`RegisterHandler`/`RefreshHandler`) — all three handlers only call `logAudit()` (which already sets `context: LogContext.AUDIT`), so the child binding only produced malformed JSON (context twice) with no benefit. The `ChildCapableLogger` interface was deleted as well (nothing calls `.child()` any more) — `buildInfra()` went back to taking a plain `ILogger`.

**An independent bug found along the way, unrelated to context but blocking every test**: `redactLogMethodHook` (`logger/index.ts`) was missing the `export` keyword even though the JSDoc right above it explicitly says "Exported... so tests can build..." — which made `redact.spec.ts` fail to compile. A one-line fix.

Verified: `tsc --noEmit` clean and tests green across all 5 packages after the whole pass — shared-kernel 74/74, core-api 142/142, auth-service 107/107, notification-service 33/33, search-service 52/52.

### The `context` field — taxonomy & how to attach it

Every log line should carry a `context` for filtering in Kibana, alongside `serviceContext` (= the service name from the root).

- **Cross-service shared contexts** (patterns existing in BOTH auth-service and core-api): declared ONCE in `shared-kernel/src/logger/log-context.ts` (`LogContext`) and used identically in every service → a query for `context: "CommandBus"` spans all services. Currently: `CommandBus`, `QueryBus`, `RetryMiddleware`, `TransactionMiddleware`, `EventBus` (CQRS in-process), `EventRouter` (cross-service integration-event dispatch), `HttpLayer` (interceptor/hook), `ExceptionFilter` (global error).
- **How to attach it:**
  - CQRS middleware (shared-kernel): attaches it itself, `this.logger.info({ context: LogContext.X }, msg)` → object-first. That is why **no** context needs setting at the composition root; core-api still keeps `requestId` (PinoLogger resolves the per-request logger at log time), and auth-service gets the field via the root.
  - NestJS service, app-local: `@InjectPinoLogger(XxxService.name)` (e.g. KafkaProducerService, PollingPublisherService) → context = the class name, self-maintaining, NOT added to `LogContext`.
  - HTTP payload / `req.log`: add `context` to the object passed into the log call.
- `ILogger` (shared-kernel) has an object-first overload (`info(obj, msg?)`) compatible with both pino and nestjs-pino — that is how structured fields get attached.

### Correlation-id — `trace_id`/`span_id`/`parent_span_id`, automatic, NOT opt-in (2026-07-22)

See `resilience_patterns.md` §7 for the full W3C Trace Context design (RECEIVE always generates a trace, SEND never generates one, `parentSpanId` for causal relationships). The part directly relevant to the logger:

**History — the first version was opt-in, and that turned out to be wrong:** `traceLogFields()` was originally a function you had to call manually in each log call (`...traceLogFields()`). A real audit (grepping all 3 repos) found **only 2 files** calling it — `GlobalExceptionFilter`, `globalErrorHandler` and `LoggingMiddleware` had all **forgotten**. Which meant nearly every ordinary business log had no `trace_id` at all, defeating the whole point of the feature.

**The fix — the same mechanism already used for `deepRedact`:** `logger/index.ts` gained a `traceLogMethodHook` (a pino `hooks.logMethod`) that automatically attaches `trace_id`/`span_id`/`parent_span_id` to **EVERY** log call, with no call site needing to remember. It chains onto the existing `redactLogMethodHook` (pino accepts exactly one `hooks.logMethod`, so the two hooks compose into one). `traceLogFields` is now **no longer publicly exported** — used only internally inside `logger/index.ts`, per the "only export what genuinely has a consumer" principle.

- It is a no-op (adds no fields) when there is no active trace context (e.g. logs during process startup, before any request/message arrives) — no empty fields logged.
- It applies to EVERY logger instance including `@InjectPinoLogger(Xxx.name)` (child loggers) — the hook lives at the root pino layer, and `.child()` inherits the root's hooks, so no per-service wiring is needed.
- `TraceContextMiddleware` (which opens the ALS) currently exists in **core-api, auth-service, search-service, notification-service** — all 4 services with an HTTP layer. `worker-service` has no HTTP, so N/A. Initially only core-api/auth-service had it (when correlation-id was first built) and search-service/notification-service were missed — patched in the same 2026-07-22 audit (see the "Audit" section below).

⚠️ **TRIPWIRE (2026-07-25) — this is NOT real distributed tracing, don't confuse the two:** `trace_id`/`span_id`/`parent_span_id` are currently just fields inserted into EACH LOG LINE (used to filter/stitch scattered logs together by hand in Kibana). There is NO real span concept (start/end/duration, a parent-child tree), and NO visualisation backend (Jaeger/Tempo). Getting a real waterfall view would require: installing the OpenTelemetry SDK in every service, instrumenting HTTP/gRPC/Kafka/Prisma, and standing up an OTel Collector + Jaeger/Tempo — that TOUCHES APP CODE across several services, not just infra config, and it is **not done and not concretely planned**. Don't silently treat today's correlation-id as "we have tracing" when reviewing this later.

### Log security — Redaction (MANDATORY) + payload at debug level

- **Redaction is applied at the LOGGER level, NOT per-method** → every level (`info/warn/error/debug/fatal/trace`) is masked, and child loggers inherit the root's redaction. It is NOT tied to debug specifically; putting payloads at debug is a separate decision about volume.
- **The root logger `createLogger` has `redact`** (pino, in-process BEFORE any transport) masking secrets in EVERY log regardless of object shape: `password/newPassword/currentPassword/token/accessToken/refreshToken/secret/authorization/cookie` + `*.x` variants (one nesting level) + `req(uest).headers.authorization/cookie`. Censor = `[REDACTED]`. The paths are a single source, `LOG_REDACT_PATHS` (with `redact.spec.ts` locking the behaviour).
- **PII is masked too (added 2026-07-22):** `email` and `username` sit in `SENSITIVE_LOG_KEYS` alongside secrets → masked at EVERY level/depth (via the `deepRedact` hook), not just secrets. **A deliberate trade-off:** email/username are now `[REDACTED]` in EVERY log, including intentional ones — **identify a user in logs by `userId`, NEVER by email**. (Full masking, not partial like `j***@b.com`: the redaction mechanism is all-or-nothing per key; partial masking would need a per-field censor, deferred until there's a real need to see part of an email in a log.) Adding a new PII field (phone number, address, …) → add it to `SENSITIVE_LOG_KEYS`; don't rely on "remember not to log it".
- ⚠️ **TWO LIMITATIONS of redaction (you must know these):**
  1. **It only masks the declared paths, at the declared depth.** `*.password` only catches one nesting level (`input.password`), NOT deeper (`a.b.password`). Deeper nesting requires an explicit path declaration.
  2. **It only masks FIELDS in an object, NOT the message string.** `` logger.info(`pw=${pw}`) `` WILL leak, because pw is inside the string. → ALWAYS pass data through the object (`logger.info({ pw }, 'msg')`), and NEVER interpolate a secret into the message string.
- **Command payloads:** `LoggingMiddleware` logs `input: command` at **`debug`** (silent in prod, avoiding body volume), not at info. This is safe because redaction has already masked the secrets → reading a debug log still tells you what input the command ran with (with the password already `[REDACTED]`).
- ⚠️ When adding a new secret field (e.g. `apiKey`), add its path to `LOG_REDACT_PATHS` — do NOT rely on "remember not to log it".

⚠️ **TRIPWIRE (2026-07-25) — log-volume sampling: considered, NOT built, because there is no real gap.** Reading `resilience/circuit-breaker.ts` directly: when `state === 'open'`, `execute()` just `throw`s immediately (lines 56/60) and never calls the logger — an open circuit does not create a log storm. Reading `messaging/resilient-consumer.ts`: retries are bounded by a finite `maxRetries` per message + the DLQ, not an infinite loop — volume rising while a dependency is down is a signal you *want* to see (exactly when the audit trail matters most), not a leak. If a genuine burst case appears later (e.g. a client deliberately sending a repeated malformed payload at a layer WITHOUT a rate limiter, or a dependency flapping so the breaker opens/closes repeatedly), come back here before building — don't repeat the "build before there's a real consumer" pattern already caught in the audit-log/`ILogger.child()` cases.
- Want the input at info level in prod for one specific command → log a safe domain identifier in the HANDLER (e.g. `{itemId, spaceId}`), do NOT lower debug→info in the shared middleware.

### Repo-wide audit (2026-07-21) — confirming the "1 logger/process" invariant, and all 8 contexts

Re-verified by reading the actual code (not guessing) for the question: *"does each app have exactly one logger instance, differing only in `context`?"* — **100% yes, no exceptions.**

**`createLogger()` — number of calls per process:**

| Service | Composition root | Note |
|---|---|---|
| core-api | `app.module.ts:53`, inside `LoggerModule.forRootAsync` | once |
| notification-service | `app.module.ts:29` | once |
| search-service | `app.module.ts:27` | once |
| worker-service | `app.module.ts:18` | once — the worker is NestJS (a Kafka consumer, no HTTP), so it still goes through `LoggerModule.forRootAsync`; only `autoLogging`/`customAttributeKeys` don't apply (there is no HTTP request to attach them to) |
| auth-service | `main.ts:26` AND `main.lambda.ts:15` | two call sites, but in **two different processes** (the Fastify server vs the AWS Lambda handler, never running together) — not a violation |

**`LoggerModule.forRootAsync({ pinoHttp: { logger: createLogger(name) } })`** (the 4 NestJS services) — `pinoHttp.logger` receives the **instance itself** returned by `createLogger()`; it does not create its own logger. nestjs-pino only decorates it with request lifecycle features (attaching `req.log`, `autoLogging.ignore` skipping `/health`/`/metrics`, renaming the `req/res/err` fields to `request/response/error` via `customAttributeKeys`) — it is not a second logger source.

**`@InjectPinoLogger(ClassName.name)`** — creates no new instance. nestjs-pino internally calls `rootLogger.logger.child({ context: ClassName })`, cached by DI token — so every child logger shares the same underlying pino instance/transport/redaction, with only the `context` field differing.

**The complete table of 8 cross-service contexts** (`LogContext`, `packages/shared-kernel/src/logger/log-context.ts:15-29`):

| `LogContext` | String | Layer | Example log site (file:line) |
|---|---|---|---|
| `COMMAND_BUS` | `CommandBus` | CQRS middleware | `shared-kernel/src/cqrs/middleware/logging.middleware.ts:10,15,23,30` |
| `QUERY_BUS` | `QueryBus` | CQRS bus | `shared-kernel/src/cqrs/query-bus.ts:26,29` |
| `RETRY` | `RetryMiddleware` | CQRS middleware | `shared-kernel/src/cqrs/middleware/retry.middleware.ts:67` |
| `TRANSACTION` | `TransactionMiddleware` | CQRS middleware | `shared-kernel/src/cqrs/middleware/transaction.middleware.ts:18,26,32` |
| `EVENT_BUS` | `EventBus` | CQRS in-process event | `shared-kernel/src/cqrs/event-bus.ts:14,16,21` |
| `EVENT_ROUTER` | `EventRouter` | Kafka integration-event | `shared-kernel/src/messaging/event-router.ts:81`; `resilient-consumer.ts:124,144,163,184`; also used in `notification-service`/`search-service` `dead-letter.producer.ts:62` |
| `HTTP` | `HttpLayer` | HTTP transport | `core-api`/`notification-service`/`search-service` `http-logging.interceptor.ts:27`; `auth-service` `http-logging.hook.ts:12` |
| `GRPC` | `GrpcLayer` | gRPC transport | `core-api` `membership-verification.grpc-service.ts`; `auth-service` `auth-provisioning.grpc-service.ts` — added 2026-07-22, see the audit below |
| `EXCEPTION` | `ExceptionFilter` | Unhandled exception | `core-api`/`notification-service`/`search-service` `global-exception.filter.ts:66`; `auth-service` `global-error.handler.ts:33` |

**App-local loggers** (NOT in `LogContext`, using their own class name via `@InjectPinoLogger(Xxx.name)`) — 18 files across core-api/notification-service/search-service, e.g. `KafkaProducerService`, `PollingPublisherService`, `IdempotencyCleanupService`, `MembershipVerificationGrpcService`, `GrpcServerBootstrap`, and every `*Caller` class (circuit breaker wrappers).

**"Stray loggers" — none found.** Grepping `new PinoLogger(`, `pino(`, `console.*`, `new Logger(` across the repo: `pino(...)` appears in exactly one place (`shared-kernel/src/logger/index.ts:125`, inside `createLogger`). `console.*` appears only in the catch block wrapping `bootstrap()` in each service's `main.ts` (where the logger itself may not have initialised yet, or bootstrap failed — a reasonable fallback, not a parallel logger) and in standalone scripts (`auth-service/prisma/seed.ts`, which doesn't run in the runtime process).

### Audit of "the 5 standard log points" (2026-07-22) — after correlation-id exposed a gap

The audit question: *"where are logs currently placed, why, are they consistent across services, and is this enterprise-grade yet?"* Answered by reading the real code (grepping every `logger.*(` + `this.#logger.` + `this.logger.` across all 5 services + shared-kernel), not guessing. There are exactly **5 standard log points** — every log line in the system falls into one of them, none scattered arbitrarily:

| # | Point | What it logs | Present in |
|---|---|---|---|
| 1 | HTTP boundary (interceptor/hook) | EVERY request, tiered by status | core-api, notification-service, search-service, auth-service |
| 2 | CQRS business layer, HTTP-triggered write (`LoggingMiddleware`/`QueryBus`) | Command/query lifecycle | core-api, auth-service, notification-service |
| 2b | Event dispatch, Kafka-triggered write (`EventRouter.route()`, 2026-07-25) | Event lifecycle (executing + success/duration) — does NOT log errors here, see #3 | **core-api, notification-service, search-service — every consumer using `EventRouter`, including worker-service once it has its first consumer** |
| 3 | Kafka consumer boundary (`ResilientEventConsumer`) | Poison-pill/retry/DLQ | notification-service, search-service |
| 4 | gRPC handler boundary | Before 2026-07-22: errors only. From 2026-07-22: both success and errors | core-api, auth-service |
| 5 | Global exception filter | Only genuinely unhandled errors (HttpException/ApplicationError are not logged — avoiding duplication with #1) | All 4 services with HTTP |

### ⚠️ The most serious real bug found (2026-07-25) — #1 (the HTTP boundary) logged the WRONG status in all 3 NestJS services, since it was written

**This isn't a missing log — it's a log with WRONG DATA**, more serious than every other gap found in the same pass. Verified with a REAL NestJS+Fastify app (not a mocked `ExecutionContext` — a mock cannot catch this timing bug):

`HttpLoggingInterceptor` (core-api/notification-service/search-service, identical code) reads `res.statusCode` inside an RxJS `finalize()` attached to `next.handle()`. `finalize()` runs **WHILE the exception is still propagating out of the interceptor chain — BEFORE** `GlobalExceptionFilter` (registered as `APP_FILTER`, OUTSIDE the interceptor) has had a chance to call `reply.status(...)`. The consequence: **every response involving an exception (404, 409, 500, …) was logged as `statusCode: 200` at `info` level**, identical to a successful request — verified concretely: a request to `/boom` (throwing `NotFoundException`) returned a genuine **404 to the client**, while the interceptor's log line recorded `statusCode: 200`. For comparison: `nestjs-pino` emits its own "request completed" line (using Fastify's internal `onResponse` hook) — that line HAS the correct status (404) but does NOT raise its level according to status (always `info` by default; the project hasn't configured `customLogLevel`) — so before the fix, **no log line had both the correct status and the correct level** for a failing request in core-api/notification-service/search-service.

**auth-service was NOT affected** — `httpLoggingHook` is registered via `fastify.addHook('onResponse', ...)` (a native Fastify hook, not RxJS), and Fastify guarantees `onResponse` runs AFTER the error handler has set the status.

**The fix**: drop `finalize()` and listen to `res.raw.once('finish', ...)` instead — an event on Node's native `http.ServerResponse`, which only fires after the response has ACTUALLY been sent to the client (the same mechanism Fastify's `onResponse`/pino-http use themselves). File: `http-logging.interceptor.ts` in all 3 services, identical code.

**Verified after the fix (real app, no mocks)**: `/boom` → logs `statusCode: 404, level: 40 (warn)`, genuinely correct; `/ok` → `statusCode: 200, level: 30 (info)`, genuinely correct. New spec: `http-logging.interceptor.spec.ts` (core-api) — builds a real `NestFactory.create` + real Fastify + injects a real request, with no mocked `ExecutionContext`, precisely because a mock is what failed to catch this.

**The biggest lesson from this audit**: a unit test with a mocked `ExecutionContext`/`reply` will NEVER catch an execution-ordering bug between an interceptor and a filter — only a real app test (`NestFactory.create` + a real adapter + `.inject()`) exposes it. Before trusting that a logging "gateway" is correct, ask: does the existing test (if any) verify via a mock, or via real runtime behaviour?

### ⚠️⚠️ Bug #2, MORE SEVERE than #1 — `GlobalExceptionFilter` never actually logged a real error, since it was written (found when the user asked "does this duplicate the HTTP log?")

**The question that led to the discovery**: the user asked whether the line `req.log.error({context: EXCEPTION, err: exception}, 'Unhandled exception')` duplicated `HttpLoggingInterceptor`'s log. Verified with a real app (throwing an `Error` that is NOT an `HttpException`/`ApplicationError`, i.e. the genuinely-unhandled branch) — the result: **the "Unhandled exception" line did not appear in the logs at all**, even though the code definitely reached it (proof: the stack trace of a different log line showed `GlobalExceptionFilter.catch` had already run past it).

**The cause, confirmed step by step by debugging directly against the real code (not guessed):**
1. `req.log.error(...)` doesn't throw, and `req.log` has a real `.error` function — but `req.log.level` and `req.log.bindings()` are both `undefined` → **`req.log` is NOT a real pino instance**, just a silent stub.
2. Reading `node_modules/nestjs-pino/LoggerModule.js` directly: `nestjs-pino` attaches the logger via **Express-style middleware + AsyncLocalStorage** (`storage.run(new Store(log), next)`), and does NOT assign `req.log` in the way a FastifyRequest expects.
3. Reading `node_modules/nestjs-pino/PinoLogger.js`: `PinoLogger`/`Logger` (injected via DI, used EVERYWHERE else in the codebase — `HttpLoggingInterceptor`, every `@InjectPinoLogger`) read the logger through `storage.getStore()?.logger` — **the correct ALS mechanism**, working properly.
4. `req.log` (direct property access, NOT via DI) under Fastify+nestjs-pino **does not resolve correctly** — Fastify has its own `request.log` (a built-in framework decorator), and nestjs-pino's Express-style middleware cannot override it in the way `req.log.xxx()` expects.
5. **auth-service was NOT affected** — separately verified: it passes the real pino instance straight into `Fastify()`'s constructor as `loggerInstance: logger`, so `request.log`/`req.log` in auth-service IS the real pino instance, with no compatibility layer in between.

**The consequence before the fix**: in **core-api, notification-service and search-service** — EVERY genuinely unexpected error (a null pointer, a type error, any bug that isn't an `HttpException`/`ApplicationError`) that ever occurred in these 3 services **left behind not a single log line with a real message or stack trace**. The only remnant was `pino-http`'s automatic "request errored" line, but that contains a SYNTHETIC error created by pino-http itself (`"failed with status code 500"`) — NOT the original exception, and useless for debugging.

**The fix**: change `req.log.error(...)` to inject `PinoLogger` via `@InjectPinoLogger(GlobalExceptionFilter.name)` (adding `@Injectable()` to the filter) and call `this.logger.error(...)` — the same DI pattern every other class in the codebase had been using correctly all along. Applied to all 3 services (core-api/notification-service/search-service).

**Verified after the fix** (real app, throwing a real `Error`): a line with `context: "ExceptionFilter"` appears carrying `err.message: "unexpected null pointer somewhere"` (the real message) and an `err.stack` pointing at the function that actually failed. A new spec, `global-exception.filter.spec.ts` (all 3 services, building a real app), locks in two things: (1) a real exception is logged with the correct message/stack, and (2) an `HttpException` is NOT duplicated in this filter (preserving the "avoid duplicating #1" design).

**Answering the user's original question (is it a duplicate?):** NO — after the fix the two logs serve different purposes and can be joined via `req.id`: `HttpLayer` (every request, status + duration, NO stack trace) vs `ExceptionFilter` (ONLY genuinely unexpected errors, WITH message + stack, available nowhere else). Exactly the "Dual-Logging Philosophy" already described in this document (HTTP layer vs Business layer) — not a redundant log.

**The lesson, applying well beyond this file**: `req.log`/`req[X]` (direct property access on the request object) is an UNSAFE pattern under NestJS+Fastify+nestjs-pino — only use DI (`@InjectPinoLogger`/`Logger`) to obtain a logger, including inside a Guard/Filter/anywhere else; even though `req.log.xxx()` "appears to work" (it doesn't throw), it can be a silent stub. If you see new code using `req.log`/`request.log` directly in core-api/notification-service/search-service (this does NOT apply to auth-service, where `req.log` is real) — that's a signal to re-check with a real app, not to trust it by eye.

**Revised 2026-07-25 — #2 split into #2/#2b, and "search-service has no CQRS so it lacks a log" is no longer true:** the previous version wrongly merged "dispatching an HTTP command" with "dispatching a Kafka event" into one CQRS-bus concept, and wrongly concluded that search-service was missing a logging layer because it "has no bus". In reality, event dispatch (`EventRouter`) was ALREADY shared across every service — it's just that `EventRouter.route()` didn't log for itself (it only logged when NO handler was found). Adding dispatch logging directly into `EventRouter.route()` (exactly as `LoggingMiddleware` does for the CommandBus: info on start, info + duration on completion, and NO error logging because `ResilientEventConsumer` already logs retry/DLQ one layer up — avoiding duplication) → every consumer of `EventRouter` is automatically consistent, regardless of whether that service has a CommandBus/QueryBus. **A real bug this exposed:** notification-service's 3 event handlers (`item-published`, `follow-removed`, `follow-created`) had **never had any business-layer log at all** — a wider gap than the one found in search-service on 2026-07-22 (which was patched by hand for a single handler, not fixed at the source).

**4 gaps found, all 4 fixed (no "not needed yet" left behind without a genuine YAGNI reason):**

1. **Correlation-id only covered 2 of the 4 HTTP services** — `TraceContextMiddleware`, when first built (in the same pass as `resilience_patterns.md` §7), was only wired into core-api/auth-service, forgetting search-service/notification-service. Fix: add the identical `TraceContextMiddleware` to the other two services (`app.module.ts` + its own middleware file, following the "NestJS-specific infra is duplicated per service" convention already used for `OrgAwareThrottlerGuard`).
2. **The gRPC boundary was asymmetric** — HTTP/Kafka log both success and failure, gRPC logged only failures. Added `LogContext.GRPC` + an `info` log on RPC success in both gRPC services (`checkMembership`, `provisionUser`, `cancelProvisionedUser`) — without logging secrets (`temporaryPassword` never enters a log, only `userId`).
3. **search-service violated this very document's "Dual-Logging Philosophy"** — it doesn't use the CQRS bus (`rag_ai_integration.md` — a deliberate architectural decision) and therefore had no automatic business-layer log. Previously there were only 3 `warn` lines on degradation (ES down / RAG down / embedding down) — a healthy request produced no business log at all. Added equivalent manual business-layer logging to `SearchKnowledgeService.search()` and `IndexKnowledgeHandler.handle()` — the two most expensive operations in the system (AI/embedding calls), which had previously been the two with the least observability. **The log levels follow the "Buses & logger" rule below and are deliberately NOT uniform:** `search()` is a READ (query) → happy path at **`debug`** (the HTTP layer already logged the request; another info line would be noise — exactly why QueryBus is at debug), with degradation still at `warn`; `IndexKnowledgeHandler` is a low-frequency, expensive WRITE/indexing operation → completion at **`info`** (analogous to a command). ⚠️ The first version had `search()` completion at `info` — WRONG, self-caught on re-audit: a query must not info-log its happy path. Lowered to debug.
4. **`traceLogMethodHook` wasn't documented** — see the "Correlation-id" section above.

**Conclusion:** the system DID already have clear rules (it was not the free-for-all the audit initially feared), but those rules had not been applied 100% UNIFORMLY — mostly because the services were built at different times, and a new feature (correlation-id) was finished without being propagated everywhere. The lesson: whenever adding a new logging mechanism that applies to "every service", ask *"have I checked all 5 services, or only the 2 I happen to be editing?"* — precisely the mistake made in gap #1.

### Buses & logger — verbosity according to each bus's nature

Log levels are NOT uniform across the 3 buses; they scale with (write impact × audit value) and INVERSELY with frequency:

| Bus | Gets a logger? | Log level | Reason |
|---|---|---|---|
| `CommandBus` | NO (logs via `LoggingMiddleware`) | `info` lifecycle (executing→success+duration) + `error` | writes, one handler, the caller waits, audit-worthy, low frequency |
| `QueryBus` | **YES**, `new QueryBus(logger)` | `debug` only (name+duration) | reads, HIGH frequency, the HTTP layer already logged the request; another info line = noise. No error logging (a domain error is an ordinary 4xx; unexpected errors are logged by the ExceptionFilter) |
| `EventBus` | **YES**, `new EventBus(logger)` | `error` when a handler fails + `debug` on dispatch | fan-out, fire-and-forget; errors are SWALLOWED, so `error` is the only signal. NO `info` on success (fan-out across N handlers = spam) |

- ⛔ Do NOT copy CommandBus's `info` executing/success onto Query/Event. Queries read frequently → debug; Event fan-out → error + debug only.
- `EventBus`/`QueryBus` MUST be given a logger at the composition root: auth-service `new XxxBus(infra.logger)`; core-api `useFactory: (logger: PinoLogger) => new XxxBus(logger), inject: [PinoLogger]`. `CommandBus` stays `useValue: new CommandBus()` (it needs no logger).
- The buses remain pure POJOs — `ILogger` is a shared-kernel abstraction, so this doesn't violate `cqrs_pattern.md`.

## Audit Log — tagged by `context` in the app, physically separated at the ES layer (2026-07-22 simplified → 2026-07-25 separated again, properly)

**The underlying problem:** the existing event-sourced system (`CreditEvent`/`ReputationEvent`) already IS an audit trail for credits/reputation — but there was NOTHING equivalent for purely security-related events (successful/failed login, a replayed refresh token). Previously (where logged at all) these were mixed in with operational logs and couldn't be filtered out separately.

**⚠️ History — the first version was BUILT AND REMOVED THE SAME DAY; read this so it isn't repeated:** the first version built a full `createAuditLogger()` — its own pino instance, its own ES index (`dsp-audit-logs`), deliberately bypassing `deepRedact` to preserve PII. After self-critique (following an existing lesson: *"does this have a real name/standard, or did I synthesise it?"* — see §1.4 of `resilience_patterns.md` for the identical precedent): the concept of "a separate audit log" is real, but the part that **creates the actual value** — separate access control — was NOT built, only recorded as a tripwire. Which meant: one new pino instance + one new ES index + one exception breaking the very PII policy just established, in exchange for a security benefit of ZERO (anyone who could read `dsp-logs` could equally read `dsp-audit-logs`; nothing prevented it). A textbook case of "cumbersome and ineffective" — **removed the same day**, reverting to the existing operational logger.

**The final solution — `logAudit()` (`shared-kernel/src/logger/audit.ts`), SHARING the operational logger:**
- No separate logger/pino instance/ES index — `logAudit(logger, event)` is just an ordinary `logger.warn()`/`logger.info()` call, attaching `context: LogContext.AUDIT` so it can be filtered in Kibana (`context: "AuditLog"`) — **using exactly the `context` taxonomy already in place for `HttpLayer`/`CommandBus`/…**, inventing nothing new.
- Level: `outcome: 'failure'` → `warn` (abnormal, but not a system error — consistent with the existing level discipline: a 4xx is not an `error`); `outcome: 'success'` → `info`.
- **PII: does NOT bypass redaction.** `actorEmailHash` = `sha256(email)`, never the raw email — you can still correlate "the same account was targeted repeatedly" (two calls with the same email → the same hash) without violating the PII policy just established for the rest of the system. This is the correct resolution of the "audit needs to know who was targeted" vs "PII must be masked" tension — no exception required.

**The `AuditEvent` shape:** `action` (dot-namespaced, e.g. `auth.login`), `outcome` (`success`/`failure`), `actorUserId` (null when identity isn't established), `actorEmailHash` (optional, pre-hashed), `targetUserId` (when the action affects a user OTHER than the actor), `ip`, `metadata` (still NOT separately redacted, since it goes through the same operational logger — but redaction already happened at the logger layer, so just don't stuff un-hashed PII in here).

### Physical separation at the ES layer (2026-07-25) — closing exactly the hole identified when the first version was removed

When the first version was removed (2026-07-22), the main reason was: separate infrastructure **without separate access control** = extra infrastructure for zero security benefit. Separate access control now genuinely exists, so the separation is back — but done at the **Elasticsearch layer**, not the app layer, so `logAudit()`/`AuditEvent`/every call site stays unchanged and carries no extra complexity:

- **`docker-init/elasticsearch/ingest-pipeline-log-router.json`** — an ingest pipeline `dsp-log-router` attached as the `default_pipeline` of the `dsp-logs` data stream. It has one `reroute` processor: any doc with `context == 'AuditLog'` is moved to the `dsp-audit-logs` data stream BEFORE being written — the app always writes to `dsp-logs` and knows nothing about this.
- **Two ES roles** (`docker-init/elasticsearch/role-dsp-ops-reader.json` / `role-dsp-audit-reader.json`) — `dsp_ops_reader` can only read `dsp-logs*`, `dsp_audit_reader` only `dsp-audit-logs*`. This is **index-level** RBAC, available on the free ES Basic licence — deliberately NOT Document-Level Security (field-level filtering within one index), because DLS requires Platinum or above.
- **Genuinely verified, not just config-read**: injected one `context:HttpLayer` doc and one `context:AuditLog` doc through the same pipeline → confirmed the first landed in `.ds-dsp-logs-*` and the second in `.ds-dsp-audit-logs-*`. Confirmed the 403/200 matrix in both directions via the ES REST API.
- **Two REAL users, able to log into Kibana on the local docker-compose (2026-07-25, corrected after being challenged)** — on the first verification pass I created two test users and DELETED them straight after testing, leaving the roles in place but with NO usable real user — exactly the "the infrastructure is right but unusable" pattern I'd been pulled up on. Fixed: `docker-init/elasticsearch/setup.sh` now permanently creates `dsp_ops_viewer` (role `dsp_ops_reader`) and `dsp_audit_viewer` (role `dsp_audit_reader`), with passwords from `DSP_OPS_READER_PASSWORD`/`DSP_AUDIT_READER_PASSWORD` in `.env`. Both roles also carry a Kibana feature privilege (`feature_discover.read`) so Discover is usable in the UI, not just the ES REST API.
- **A real bug found while verifying Kibana (not directly about audit logs, but it blocked verification entirely):** Kibana in `docker-compose.yml` was configured to connect to ES as the `elastic` user (a superuser) — ES 8.x **refuses to boot Kibana** with `"elastic" is forbidden. This is a superuser account`. Kibana had been crash-looping since before this change, unrelated to it — it only surfaced because this was the first time anyone actually started Kibana to check. Fix: use the built-in service account `kibana_system` (password set via `setup.sh`, env `KIBANA_SYSTEM_PASSWORD`), the correct ES 8.x approach, rather than a superuser.
- **Kibana genuinely verified through the exact API Discover uses (`/internal/bsearch`, strategy `es`), not inferred from raw REST:** `dsp_ops_viewer` searching `dsp-logs` → returns real documents; searching `dsp-audit-logs` → `_shards.total: 0`, 0 hits (ES filters it out cleanly — not an error, this is correct security behaviour). `dsp_audit_viewer` behaves as the exact mirror. Tested in both directions, for both roles.
- **How to check it yourself (no code reading needed):** `docker compose --profile monitoring up -d kibana elasticsearch-setup`, open `http://localhost:5601`, log in as `dsp_ops_viewer`/`DSP_OPS_READER_PASSWORD` (or `dsp_audit_viewer`/`DSP_AUDIT_READER_PASSWORD` from `.env`) → Discover → pick the Data View "dsp-logs (operational)" or "dsp-audit-logs (security)" (both pre-created via the Kibana Data Views API, nothing to set up by hand). Those two data views are only "viewing windows"; the REAL read permission is still decided by the ES role — picking a data view you lack permission for returns an empty list, not an error.
- **Bootstrap**: `docker-init/elasticsearch/setup.sh` (idempotent, all PUTs) runs via the `elasticsearch-setup` service in `docker-compose.yml` — once, when ES becomes healthy; not a manual step.
- **One small required app change**: `createLogger` (`logger/index.ts`) changes pino's default timestamp field (`time`, epoch ms) to `@timestamp` (an ISO string) — ES data streams require this field. Nothing else changed.
- **ILM/retention (2026-07-25, same pass)**: `dsp-logs-ilm` (14 days — high volume, low long-term value) and `dsp-audit-logs-ilm` (90 days — investigative value lives longer), attached via `index.lifecycle.name` on each index template. Both are hot→delete only (rollover 1d/5gb → delete), with no warm/cold phase because the current scale doesn't need one. 90 days is a reasonable default, NOT a number certified against real compliance requirements — if a specific compliance requirement appears later, edit `ilm-policy-dsp-audit-logs.json`, not the app code. Genuinely verified: wrote one doc → `GET dsp-logs/_ilm/explain` confirms `policy: dsp-logs-ilm, phase: hot`.
- ⚠️ **This differs from the first version on exactly one decisive point; remember it when someone asks "why isn't this the same thing you removed last time":** the first version separated at the APP layer (its own pino instance, bypassing redaction) WITHOUT any RBAC → extra infrastructure, zero benefit. This version separates at the ES layer (the app changes nothing but one timestamp line) AND comes with real RBAC → the correct "value first, infrastructure second" order, which the earlier attempt had backwards.

**Applied as a template in auth-service (2026-07-22)** — 3 points, not auditing everything:
- `auth.login` — both success AND all 3 failure branches (user not found / no local-auth method / wrong password), each audited BEFORE throwing
- `auth.register` — success only (a duplicate-email registration is NOT audited — it's a public form with no actor identity to correlate yet, and low-signal compared to login/refresh)
- `auth.refresh_reuse_detected` — **the single most important event in the whole patch**: a reused refresh token is a genuine signal of a stolen token (an attacker replaying a token the real user has already rotated past), not normal user behaviour

**The principle for choosing what to audit (when extending to other services):** only audit events that (a) have an identifiable `actor` (a userId, or at minimum an email), (b) have real investigative value if abused (not every 4xx), and (c) aren't already covered by the existing event-sourced ledger (credit/reputation). Do NOT audit every command indiscriminately — consistent with the "log at boundaries that carry value" principle already applied to ordinary logging.

### Applied in core-api (2026-07-25) — 3 points, all privilege-escalation vectors

Applying the 3-part test above to `apps/core-api`:

| Action | Handler | Why audit it |
|---|---|---|
| `org.member_role_updated` | `UpdateMemberRoleHandler` | Changing a member's role within an org — privilege escalation if abused |
| `org.role_permissions_updated` | `UpdateRolePermissionsHandler` | Changing a role's permission SET — affects EVERY member holding that role, a larger blast radius than the row above |
| `platform.org_provisioned` | `ProvisionOrgHandler` | The highest blast-radius mutation in the system (already noted in a comment on `ProvisionOrgCommand`) — cross-service, creating a real user in auth-service. Audits BOTH `success` AND `failure` (unlike the two rows above, which audit success only) because this is a saga with compensation — you need to see the compensation-failure case too (an orphaned user needing manual cleanup). |

**⚠️ A real gap found WHILE doing this, not by looking for it separately:** all 3 route handlers (`org.controller.ts`, `platform-admin.controller.ts`) **never captured `@CurrentUser()`** — meaning the actor of a role/permission change had never been threaded through the command at all. You cannot audit "who" without first knowing "who". Fixed: added `actorUserId` to all 3 commands (`UpdateMemberRoleCommand`, `UpdateRolePermissionsCommand`, `ProvisionOrgCommand`) plus `@CurrentUser()` on all 3 routes. This IS a prerequisite for auditing, not scope creep — an audit log with `actorUserId: null` is meaningless.

Verified: `tsc --noEmit` clean for core-api, and `jest` across all of core-api's 47 suites — 134/134 tests (including the 3 new audit tests, plus the existing tests for all 3 handlers passing after the constructor arity change + logger injection).

## Shared HTTP Utilities (shared-kernel)

To prevent response shape drift between services (auth-service uses Fastify hooks, core-api uses NestJS interceptors/filters), all HTTP-layer **business logic** must be shared from `@distributed-social-platform/shared-kernel`.

**Source files**:
- `packages/shared-kernel/src/http/response.ts` — pure contracts: `BaseMeta`, `ErrorResponse`, `SuccessResponse`, `ApiResponse`
- `packages/shared-kernel/src/http/response.utils.ts` — factory functions: `buildErrorBody()`, `buildSuccessBody()`, `httpStatusToCode()`
- `packages/shared-kernel/src/errors/response-format.error.ts` — `ResponseFormatError` (thrown when a handler returns the wrong type)

**Naming convention**:
- `ApiResponse` — the data class route handlers return (replacing `HttpResponseBuilder`)
- `ResponseFormatError` — the infrastructure error raised when a handler violates the contract (replacing `HttpResponseError`)

| Utility | Import | Used in |
|---|---|---|
| `httpStatusToCode(status)` | `shared-kernel` | Every exception filter/handler — maps an HTTP status → a semantic code string |
| `buildErrorBody({ code, message, details, requestId })` | `shared-kernel` | Every error handler/filter — returns the standard `ErrorResponse` |
| `buildSuccessBody({ data, message, requestId })` | `shared-kernel` | Every response wrapper — returns the standard `SuccessResponse` |

**Never** build `{ success, message, error, meta }` inline inside a hook/interceptor/filter. Always call the shared-kernel function.

The standard response shape (invariant):
```json
// Success
{ "success": true, "data": {}, "message": "...", "meta": { "requestId": "...", "timestamp": "...", "version": "1.0.0" } }

// Error
{ "success": false, "message": "...", "error": { "code": "NOT_FOUND", "details": [] }, "meta": { "requestId": "...", "timestamp": "...", "version": "1.0.0" } }
```

## Enforcement for AI Workflows

When an AI Agent is tasked with creating a new microservice or adding a new module:
1. Ensure `httpLoggingHook` is attached in the `fastify.ts` setup.
2. Ensure `LoggingMiddleware` is correctly applied to the `CommandBus` in the `container` initialization.
3. **DO NOT** inject `ILogger` into Domain Entities or core Domain logic unless absolutely necessary. Rely on the CQRS pipeline for observability.
4. **ALWAYS** use `buildErrorBody` / `buildSuccessBody` / `httpStatusToCode` from `shared-kernel` — never rebuild the response shape locally.
5. **New HTTP-facing service** → wire `TraceContextMiddleware` (copy from an existing service, `configure()`/`MiddlewareConsumer`, registered `forRoutes('*')`) — do this for EVERY service with HTTP, not just the one you're currently touching (2026-07-22 gap: built once, forgot to replicate to 2/4 services).
6. **New Kafka consumer** → MUST use `ResilientEventConsumer` + `EventRouter` (shared-kernel), never a hand-rolled `eachMessage` loop — inherits poison-pill/retry/DLQ logging AND dispatch logging (`EventRouter.route()`, 2026-07-25) for free, no per-handler log to write.
   - ⚠️ **TRIPWIRE — worker-service, verified 2026-07-25:** `apps/worker-service/src/modules/` is EMPTY — only scaffolding exists (`infrastructure/kafka/kafka-client.service.ts`, `kafka.module.ts`), with NO real consumer yet. **The setup MUST be identical to notification-service/search-service, except for the HTTP-specific parts** (worker-service has no HTTP server) — this is not a case of "worker-service is different so it's set up differently":
     - Root logger + redact + `@timestamp` + `traceLogMethodHook` — already correct, automatic.
     - `ResilientEventConsumer` + `EventRouter.register()` — mandatory, the same as every other consumer. Dispatch logging (executing/success+duration) comes automatically via `EventRouter`; don't hand-write it.
     - Trace context — there is NO `TraceContextMiddleware` (HTTP-only), but `trace_id`/`span_id`/`parent_span_id` still exist via `startTraceContext(event.traceparent)` inside `ResilientEventConsumer` (read from the CloudEvent, not an HTTP header) — the same mechanism, a different entry point.
     - The ONLY parts omitted, because they don't apply: `TraceContextMiddleware`, the `HttpLayer` boundary log, and `OrgAwareThrottlerGuard` — all tied to an HTTP server that worker-service doesn't have. Nothing else is omitted.
7. **New gRPC server handler** → log BOTH success (`LogContext.GRPC`, `info`) and failure (`error`) — mirror the HTTP/Kafka boundary, don't log failures only.
8. **Event handler dispatched via `EventRouter`** (any service, HTTP or not) → dispatch-level log (executing/success+duration) is automatic via `EventRouter.route()` — do NOT hand-write a duplicate generic log per handler. A handler MAY still add its own domain-specific log on top (extra fields EventRouter can't know, e.g. `chunkCount`) — same relationship as a CommandHandler adding domain detail on top of `LoggingMiddleware`'s generic line.
9. **New security-relevant handler** (auth, role/permission change, provisioning) → check the 3-part test in "Audit Log" above before adding `logAudit()` calls — not every 4xx is audit-worthy, only actor-identified + investigation-value + not already covered by an event-sourced ledger.
10. **NEVER use `req.log`/`request.log` directly in core-api/notification-service/search-service** (2026-07-25 — this exact pattern silently dropped every unhandled-exception log since `GlobalExceptionFilter` was written, see "Bug #2" above). Always inject `PinoLogger`/`Logger` via `@InjectPinoLogger`/constructor DI, in Filters/Guards/anywhere — not just Handlers/Services. `req.log` is only real in auth-service (plain Fastify, `loggerInstance` passed directly). A call not throwing does NOT mean it logged — verify any new `req.log`-style code with a real app test (`NestFactory.create` + real adapter + `.inject()`), never trust a mocked `ExecutionContext`/`reply`.
11. **EVERY log call passes `context: LogContext.X` explicitly, no exceptions** (2026-07-25, see the dedicated section above for why `@InjectPinoLogger(ClassName.name)`'s auto-context and `.child({context})` are both banned, not just discouraged). Need a context that doesn't exist yet? Add it to `log-context.ts` — even for a single-service concern, never fall back to an implicit class name.
