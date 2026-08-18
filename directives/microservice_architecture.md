# SOP: Microservice Architecture & Bootstrap Standard

> [!NOTE]
> This directive defines the mandatory bootstrap architecture standard for every microservice in the system (both NestJS and plain Fastify), ensuring 100% semantic consistency and deployability on AWS Lambda.

## 🎯 Goal
Ensure every newly created or refactored microservice strictly follows the `createApp()` structure and keeps entrypoints clearly separated.

## 📜 The Mandatory Architecture

Every microservice in `apps/` must follow this file structure:

1. **`src/bootstrap/server.ts`**
   - Contains `buildServer()`.
   - Responsible for creating the web framework instance (`NestFactory.create` or a Fastify instance), attaching the logger and global pipes, and calling the configuration setup logic.

2. **`src/bootstrap/fastify.ts`**
   - Contains `setupFastify(app)`.
   - Must register the standard security and optimisation plugin set:
     - `@fastify/cors`: `{ origin: config.corsOrigins, credentials: true }` — **do NOT use `['*']`**; load it from an env var (`CORS_ORIGINS`) to avoid the security hole (memory entry #8)
     - `@fastify/helmet`
     - `@fastify/compress`: `{ encodings: ['gzip', 'deflate', 'br'] }`
     - **Rate limiting**: mandatory — but **the tool differs by framework** (see the dedicated section below).

   - **Rate limiting — pick the NATIVE tool for the framework.** Each tool handles **both a global default and per-route limits** by itself, so each service uses **ONE** mechanism (never mixed):

     | Service | Tool | Global default | Per-route |
     |---|---|---|---|
     | **Plain Fastify** (auth-service) | `@fastify/rate-limit` | `register(rateLimit, { max: 100, timeWindow: '1 minute' })` | `config.rateLimit` on each route |
     | **NestJS** (core-api) | `@nestjs/throttler` | `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` | `@Throttle({ default: { ttl, limit } })`; `@SkipThrottle()` for `/health` and `/metrics` |

     - ⛔ Do **NOT** use `@fastify/rate-limit` in a NestJS app — controllers don't expose Fastify's `config.rateLimit`, so per-route limits can't be set. Use `@nestjs/throttler` instead (one single mechanism, without `@fastify/rate-limit` alongside it).
     - A **429** in either framework goes through the error filter → the same `buildErrorBody` (`code: TOO_MANY_REQUESTS`), keeping the response format uniform.
     - Production with multiple replicas: the throttler needs `ThrottlerStorageRedis` (in-memory is only correct for a single instance).

3. **`src/app.ts`**
   - Imports `buildServer` from `bootstrap/server.ts`.
   - Exports `createApp()`, returning the fully assembled application instance.
   - Contains no port-listening logic.
   - **If the service has more than one transport** (HTTP + gRPC, HTTP + a worker consumer, …): `createApp()` **takes an already-built `Application` as a parameter**, and does NOT call `buildInfra`/`buildApplication` inside itself — see "Composition Root" below.

4. **`src/main.ts`** (the local entrypoint)
   - Contains `bootstrap()`.
   - **Is this process's only composition root** — `buildInfra()`+`buildApplication()` are called **exactly once** here, then `application` is passed down to every transport (`createApp(application, logger)` for HTTP, `startGrpcServer(application.CommandBus, logger)` for gRPC if present, and so on) — no transport builds its own copy.
   - Calls `app.listen({ port, host: '0.0.0.0' })`.
   - **MUST** have a `.catch` that logs and `process.exit(1)`s when bootstrap fails.
   - A long-running service (not Lambda) registers graceful shutdown (`SIGTERM`/`SIGINT`) here — see `resilience_patterns.md` §5.

5. **`src/main.lambda.ts`** (the AWS Lambda entrypoint)
   - Requires the `@fastify/aws-lambda` library.
   - **Its own composition root for the Lambda process** — it calls `buildInfra()`+`buildApplication()` itself (not shared with `main.ts`; this is a completely different process/runtime), then `createApp(application, logger)`.
   - Returns a proxy handler via `awsLambdaFastify(instance)`.
   - Exports `handler` for AWS API Gateway/Lambda to invoke.
   - **MUST** use the proper `APIGatewayProxyEvent`/`Context` types from `aws-lambda` — never `any`.

## 🧩 Composition Root — build the DI graph exactly once per process

**The problem:** when a service has several transports (HTTP + gRPC, HTTP + a Kafka consumer, …), it's easy to let each transport call `buildInfra()`+`buildApplication()` on its own "because it's convenient while writing" — creating 2+ independent `CommandBus`/`QueryBus` instances, each re-newing every handler/repository instance inside the same process. It usually still works (because the underlying Prisma client is a module-level singleton) but that is **safety by luck**, not by design — and it offers no guarantee once other state appears later (an in-memory cache, a separate connection pool, …).

**Rule:** each process (`main.ts`, `main.lambda.ts`, `worker.ts`, …) builds the DI graph (`buildInfra`+`buildApplication`) **exactly once**, at the top of `bootstrap()`, then passes `application` (or parts of it, like `application.CommandBus`) down to **every** transport in that process. `app.ts`'s `createApp()` takes `application` as a parameter rather than building it — it is no longer the composition root, only the place that attaches the HTTP transport to an existing graph.

**A legitimate exception:** `main.ts` and `main.lambda.ts` are two **different processes** (a long-running server vs a serverless invocation) — each building its own composition root is correct, not duplication to be merged. The duplication to avoid is **within one process**.

## 🔧 Bootstrap Checklist

When creating a new service or reviewing one, check every point below:

| Item | Plain Fastify | NestJS |
|---|---|---|
| `genReqId` from the `x-request-id` header | `Fastify({ genReqId: ... })` | `new FastifyAdapter({ genReqId: ... })` |
| Conditional logger (test vs prod) | `...(isTest ? { logger: false } : { loggerInstance })` | `new FastifyAdapter({ logger: false })` + nestjs-pino |
| `bodyLimit` | `2 * 1024 * 1024` (2MB) | `10 * 1024 * 1024` (10MB, because of uploads) |
| Env validation | A Zod schema validating **every** critical var | A `validate()` function with a Zod schema |
| `/health` | `{ config: { skipResponseWrapper: true } }` + a DB check | `@Res()` to bypass the interceptor + a DB check |
| `/metrics` | `{ config: { skipResponseWrapper: true } }` + prom-client | `@Res()` to bypass the interceptor + manual Prometheus formatting |
| Bootstrap error | `.catch(err => { console.error; process.exit(1) })` | the same |

## ⚠️ Gotchas

- **Fastify logger**: do NOT pass both `logger` and `loggerInstance` — use `...(isTest ? { logger: false } : { loggerInstance })`. Violating this → `FST_ERR_LOG_LOGGER_AND_LOGGER_INSTANCE_PROVIDED`.
- **Fastify response hook**: the `/health` and `/metrics` routes must set `config: { skipResponseWrapper: true }` (Fastify) or use `@Res()` (NestJS) to bypass the response wrapper — otherwise they throw `ResponseFormatError` → 500.
- **Env validation**: `JWT_PUBLIC_KEY` and `DATABASE_URL` must be validated at startup — never a silent `|| ''` fallback.

## 📦 Shared HTTP Utilities — MANDATORY

Every microservice must use these 3 utility functions from `shared-kernel` rather than implementing its own response shape:

```ts
// Error handler (Fastify) / Exception filter (NestJS)
import { buildErrorBody, httpStatusToCode } from '@distributed-social-platform/shared-kernel'
reply.status(status).send(buildErrorBody({ code, message, details, requestId: req.id }))

// Response wrapper (a Fastify hook) / a NestJS interceptor
import { buildSuccessBody } from '@distributed-social-platform/shared-kernel'
return buildSuccessBody({ data, message, requestId: req.id })
```

**Why**: auth-service (Fastify hooks) and core-api (NestJS interceptors/filters) use different mechanisms → if each service built its own response shape, they would drift over time. Only `shared-kernel` is the single source of truth.

## 🛠️ Automated procedure / Execution
If a microservice is found violating this structure, the agent must:
1. Report the deviations.
2. Automatically refactor the files back to the structure above.
3. Ensure the Fastify config is copied exactly as standardised.
4. Ensure the internal directory structure (`src/modules/[module]/domain`, `application`, `infrastructure`, `presentation`) follows Hexagonal Architecture absolutely (as specified in `directives/cqrs_pattern.md`), applied identically to BOTH plain Fastify and NestJS.
5. Run `npm run build` to confirm integrity.
