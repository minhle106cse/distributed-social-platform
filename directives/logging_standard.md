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

## Logger Hierarchy — ROOT một lần, CHILD mọi nơi (BẮT BUỘC)

> ⚠️ Gotcha đã cắn (2026-06-28): mỗi lần gọi `createLogger()` tạo **một bộ pino transport RIÊNG** (worker thread pretty + connection Elasticsearch riêng). Gọi `createLogger()` ad-hoc trong feature code = nhân bản kết nối ES + mất `requestId` correlation. Đó KHÔNG phải child logger.

**Mô hình đúng (1 root → N child, chung 1 transport):**

| Vai trò | Cách làm | Gọi ở đâu |
|---|---|---|
| **ROOT** logger (1 transport / process) | `createLogger('<service>')` | **CHỈ 1 nơi**: composition root |
| **CHILD** logger (mọi component) | DI, không tự tạo | service/middleware/handler |

- **core-api (NestJS):** root = `LoggerModule.forRootAsync({ pinoHttp: { logger: createLogger('core-api') } })` trong `app.module.ts` (duy nhất). Mọi nơi khác **inject** child logger:
  ```ts
  import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
  constructor(@InjectPinoLogger(XxxService.name) private readonly logger: PinoLogger) {}
  ```
  `@InjectPinoLogger(name)` gắn field `context: name` → Kibana filter `serviceContext: core-api` + `context: XxxService`. CQRS middleware nhận PinoLogger qua `inject: [PinoLogger]` ở `cqrs.module.ts` cũng là child này.
- **auth-service (Fastify):** root tạo 1 lần ở bootstrap (`loggerInstance`), child qua `logger.child({ context })`.
- ⛔ **CẤM** `const logger = createLogger('foo')` ở module scope / trong feature code. `createLogger` chỉ dùng ở composition root.

### Field `context` — taxonomy & cách gắn

Mỗi log line nên có `context` để filter Kibana cùng với `serviceContext` (= tên service từ root).

- **Cross-service shared contexts** (pattern tồn tại ở CẢ auth-service + core-api): khai báo MỘT lần trong `shared-kernel/src/logger/log-context.ts` (`LogContext`), dùng y hệt ở mọi service → query `context: "CommandBus"` trải mọi service. Hiện có: `CommandBus`, `QueryBus`, `RetryMiddleware`, `TransactionMiddleware`, `EventBus` (CQRS in-process), `EventRouter` (cross-service integration-event dispatch), `HttpLayer` (interceptor/hook), `ExceptionFilter` (global error).
- **Cách gắn:**
  - CQRS middleware (shared-kernel): tự đính `this.logger.info({ context: LogContext.X }, msg)` → object-first. Nhờ vậy **không cần** set context ở composition root; core-api vẫn giữ `requestId` (PinoLogger lấy per-request logger lúc log), auth-service nhận field qua root.
  - NestJS service app-local: `@InjectPinoLogger(XxxService.name)` (vd KafkaProducerService, PollingPublisherService) → context = tên class, self-maintaining, KHÔNG cho vào `LogContext`.
  - HTTP payload / `req.log`: thêm `context` vào object truyền vào log call.
- `ILogger` (shared-kernel) có overload object-first (`info(obj, msg?)`) khớp cả pino lẫn nestjs-pino — đó là cách đính structured field.

### Bảo mật log — Redaction (BẮT BUỘC) + payload ở debug

- **Redaction áp ở cấp LOGGER, KHÔNG per-method** → mọi level (`info/warn/error/debug/fatal/trace`) đều bị mask, child logger kế thừa redact của root. Nó KHÔNG gắn riêng với debug; đặt payload ở debug chỉ là quyết định độc lập về volume.
- **Root logger `createLogger` có `redact`** (pino, in-process TRƯỚC mọi transport) mask secret ở MỌI log dù object shape gì: `password/newPassword/currentPassword/token/accessToken/refreshToken/secret/authorization/cookie` + biến thể `*.x` (1 cấp lồng) + `req(uest).headers.authorization/cookie`. Censor = `[REDACTED]`. Paths = single source `LOG_REDACT_PATHS` (test `redact.spec.ts` khoá hành vi).
- ⚠️ **2 GIỚI HẠN của redaction (phải biết):**
  1. **Chỉ mask đúng path khai báo, theo độ sâu.** `*.password` chỉ bắt 1 cấp lồng (`input.password`), KHÔNG bắt sâu hơn (`a.b.password`). Lồng sâu hơn phải khai báo path tường minh.
  2. **Chỉ mask FIELD trong object, KHÔNG mask chuỗi message.** `logger.info(\`pw=${pw}\`)` SẼ leak vì pw nằm trong string. → LUÔN truyền dữ liệu qua object (`logger.info({ pw }, 'msg')`), TUYỆT ĐỐI không nội suy secret vào message string.
- **Payload command:** `LoggingMiddleware` log `input: command` ở **`debug`** (im prod, tránh body-volume), KHÔNG ở info. An toàn vì redaction đã mask secret → đọc log debug vẫn biết command chạy với input gì (password đã thành `[REDACTED]`).
- ⚠️ Khi thêm secret field mới (vd `apiKey`), thêm path vào `LOG_REDACT_PATHS` — KHÔNG dựa vào "nhớ đừng log".
- Muốn input ở prod cho 1 command cụ thể → log domain identifier an toàn trong HANDLER (vd `{itemId, spaceId}`), KHÔNG hạ debug→info ở middleware chung.

### Audit toàn repo (2026-07-21) — xác nhận invariant "1 logger/process", đủ 8 context

Verify lại bằng cách đọc code thật (không suy đoán) cho câu hỏi: *"mỗi app có đúng 1 logger instance, chỉ khác nhau ở `context` không?"* — **đúng 100%, không có ngoại lệ.**

**`createLogger()` — số lần gọi mỗi process:**

| Service | Composition root | Ghi chú |
|---|---|---|
| core-api | `app.module.ts:53`, trong `LoggerModule.forRootAsync` | 1 lần |
| notification-service | `app.module.ts:29` | 1 lần |
| search-service | `app.module.ts:27` | 1 lần |
| worker-service | `app.module.ts:18` | 1 lần — worker là NestJS (Kafka consumer, không HTTP) nên vẫn qua `LoggerModule.forRootAsync`, chỉ khác `autoLogging`/`customAttributeKeys` không áp dụng (không có HTTP request nào để gắn) |
| auth-service | `main.ts:26` VÀ `main.lambda.ts:15` | 2 lệnh gọi nhưng ở **2 process khác nhau** (Fastify server vs AWS Lambda handler, không bao giờ chạy chung) — không vi phạm |

**`LoggerModule.forRootAsync({ pinoHttp: { logger: createLogger(name) } })`** (4 service NestJS) — `pinoHttp.logger` nhận **thẳng instance** `createLogger()` trả về, không tự tạo logger riêng. nestjs-pino chỉ decorate thêm request-lifecycle (gắn `req.log`, `autoLogging.ignore` bỏ qua `/health`/`/metrics`, đổi tên field `req/res/err`→`request/response/error` qua `customAttributeKeys`) — không phải nguồn logger thứ 2.

**`@InjectPinoLogger(ClassName.name)`** — không tạo instance mới. nestjs-pino gọi `rootLogger.logger.child({ context: ClassName })` nội bộ, cache theo DI token — mọi child logger cùng 1 pino instance/transport/redact gốc, chỉ field `context` đổi.

**Bảng đầy đủ 8 cross-service context** (`LogContext`, `packages/shared-kernel/src/logger/log-context.ts:15-29`):

| `LogContext` | String | Tầng | Ví dụ nơi log (file:line) |
|---|---|---|---|
| `COMMAND_BUS` | `CommandBus` | CQRS middleware | `shared-kernel/src/cqrs/middleware/logging.middleware.ts:10,15,23,30` |
| `QUERY_BUS` | `QueryBus` | CQRS bus | `shared-kernel/src/cqrs/query-bus.ts:26,29` |
| `RETRY` | `RetryMiddleware` | CQRS middleware | `shared-kernel/src/cqrs/middleware/retry.middleware.ts:67` |
| `TRANSACTION` | `TransactionMiddleware` | CQRS middleware | `shared-kernel/src/cqrs/middleware/transaction.middleware.ts:18,26,32` |
| `EVENT_BUS` | `EventBus` | CQRS in-process event | `shared-kernel/src/cqrs/event-bus.ts:14,16,21` |
| `EVENT_ROUTER` | `EventRouter` | Kafka integration-event | `shared-kernel/src/messaging/event-router.ts:81`; `resilient-consumer.ts:124,144,163,184`; dùng cả ở `notification-service`/`search-service` `dead-letter.producer.ts:62` |
| `HTTP` | `HttpLayer` | HTTP transport | `core-api`/`notification-service`/`search-service` `http-logging.interceptor.ts:27`; `auth-service` `http-logging.hook.ts:12` |
| `EXCEPTION` | `ExceptionFilter` | Unhandled exception | `core-api`/`notification-service`/`search-service` `global-exception.filter.ts:66`; `auth-service` `global-error.handler.ts:33` |

**Logger app-local** (KHÔNG vào `LogContext`, tự dùng tên class qua `@InjectPinoLogger(Xxx.name)`) — 18 file trong core-api/notification-service/search-service, ví dụ `KafkaProducerService`, `PollingPublisherService`, `IdempotencyCleanupService`, `MembershipVerificationGrpcService`, `GrpcServerBootstrap`, mọi `*Caller` class (circuit breaker wrapper).

**"Logger lạc đàn" — không tìm thấy.** Grep `new PinoLogger(`, `pino(`, `console.*`, `new Logger(` toàn repo: `pino(...)` chỉ xuất hiện đúng 1 nơi (`shared-kernel/src/logger/index.ts:125`, bên trong `createLogger`). `console.*` chỉ xuất hiện ở catch-block bao ngoài `bootstrap()` trong `main.ts` mỗi service (khi chính logger chưa kịp khởi tạo hoặc bootstrap fail — fallback hợp lý, không phải logger song song) và trong script độc lập (`auth-service/prisma/seed.ts`, không chạy trong runtime process).

### Buses & logger — verbosity theo bản chất từng bus

Mức log KHÔNG đồng đều giữa 3 bus; nó tỉ lệ với (tác động ghi × giá trị audit) và NGHỊCH với tần suất:

| Bus | Nhận logger? | Mức log | Lý do |
|---|---|---|---|
| `CommandBus` | KHÔNG (log qua `LoggingMiddleware`) | `info` lifecycle (executing→success+duration) + `error` | ghi, 1 handler, caller chờ, đáng audit, tần suất thấp |
| `QueryBus` | **CÓ** `new QueryBus(logger)` | chỉ `debug` (name+duration) | đọc, tần suất CAO, HTTP-layer đã log request; info nữa = nhiễu. Không log error (domain error = 4xx bình thường; lỗi bất ngờ do ExceptionFilter log) |
| `EventBus` | **CÓ** `new EventBus(logger)` | `error` khi handler fail + `debug` dispatch | fan-out fire-and-forget; lỗi bị NUỐT nên `error` là tín hiệu duy nhất. KHÔNG `info` success (fan-out N handler = spam) |

- ⛔ KHÔNG copy nguyên `info` executing/success của CommandBus sang Query/Event. Query đọc nhiều → debug; Event fan-out → chỉ error + debug.
- `EventBus`/`QueryBus` BẮT BUỘC truyền logger ở composition root: auth-service `new XxxBus(infra.logger)`; core-api `useFactory: (logger: PinoLogger) => new XxxBus(logger), inject: [PinoLogger]`. `CommandBus` vẫn `useValue: new CommandBus()` (không cần logger).
- Bus vẫn là pure POJO — `ILogger` là abstraction của shared-kernel, không vi phạm `cqrs_pattern.md`.

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
