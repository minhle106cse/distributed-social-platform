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
- Never `console.log`.

## Shared HTTP Utilities (shared-kernel)

To prevent response shape drift between services (auth-service dùng Fastify hooks, core-api dùng NestJS interceptors/filters), tất cả **business logic** của HTTP layer phải dùng chung từ `@distributed-social-platform/shared-kernel`.

**Source files**:
- `packages/shared-kernel/src/http/response.ts` — pure contracts: `BaseMeta`, `ErrorResponse`, `SuccessResponse`, `ApiResponse`
- `packages/shared-kernel/src/http/response.utils.ts` — factory functions: `buildErrorBody()`, `buildSuccessBody()`, `httpStatusToCode()`
- `packages/shared-kernel/src/errors/response-format.error.ts` — `ResponseFormatError` (thrown khi handler trả về sai type)

**Naming convention**:
- `ApiResponse` — data class route handlers trả về (thay `HttpResponseBuilder`)
- `ResponseFormatError` — lỗi infrastructure khi handler vi phạm contract (thay `HttpResponseError`)

| Utility | Import | Dùng ở |
|---|---|---|
| `httpStatusToCode(status)` | `shared-kernel` | Mọi exception filter/handler — map HTTP status → semantic code string |
| `buildErrorBody({ code, message, details, requestId })` | `shared-kernel` | Mọi error handler/filter — trả về `ErrorResponse` chuẩn |
| `buildSuccessBody({ data, message, requestId })` | `shared-kernel` | Mọi response wrapper — trả về `SuccessResponse` chuẩn |

**Tuyệt đối không** tự build `{ success, message, error, meta }` inline trong hook/interceptor/filter. Phải gọi hàm từ shared-kernel.

Response shape chuẩn (bất biến):
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
