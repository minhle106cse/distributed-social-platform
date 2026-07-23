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
  - *Prod mode:* `createLogger` writes JSON to stdout only (`pino/file`, `destination: 1`) — no direct ES push. Xem "Production log shipping" bên dưới.
- Never `console.log`.

### Production log shipping — FluentBit thay vì push thẳng từ app (BLUEPRINT, 2026-07-25)

**Trạng thái thật, không giả định:** `apps/*` **chưa có Dockerfile nào** trong repo (kiểm tra 2026-07-25) — nghĩa là chưa có container thật để tail log. Phần dưới đây là blueprint chuẩn bị sẵn cho lúc containerize app, **KHÔNG phải đã deploy** — `docker-init/fluent-bit/` tồn tại, service `fluent-bit` trong `docker-compose.yml` nằm dưới profile `prod-logging-blueprint` (không tự chạy).

**Vì sao cần đổi khỏi push thẳng (`pino-elasticsearch`) cho production:** push thẳng từ app = app tự chịu trách nhiệm buffer/retry khi ES down, coupling trực tiếp business process với log sink. Đây là lý do chính đáng nêu sẵn trong comment của `createLogger` (`logger/index.ts`) từ trước — giờ mới có kế hoạch cụ thể để thực thi.

**Thiết kế:**
- App KHÔNG đổi format log — vẫn JSON qua stdout như prod mode hiện tại (`destination: 1`). Docker's `json-file` log driver (mặc định) tự bọc mỗi dòng thành `{"log": "<json>\n", "stream": "stdout", "time": "..."}`.
- `docker-init/fluent-bit/fluent-bit.conf`: `tail` input đọc `/var/lib/docker/containers/*/*.log` → `parser` filter giải nén field `log` (JSON lồng JSON) → `es` output, `Write_Operation create` (bắt buộc cho data stream, giống `opType:'create'` app đang dùng).
- **Routing audit/operational KHÔNG cần xử lý gì thêm ở FluentBit** — verified thật: ghi doc vào `dsp-logs` mà KHÔNG chỉ định pipeline vẫn bị reroute đúng nhờ `index.default_pipeline` đã gắn ở index template (xem mục "Tách vật lý ở tầng ES" phía trên). FluentBit chỉ cần biết ghi vào `dsp-logs`, không cần biết gì về audit routing.

**Khi nào wire cho thật:** khi `apps/*` có Dockerfile + chạy trong container (task riêng, KHÔNG làm ngầm trong đợt logging này — chạm CI/CD/deploy, phạm vi lớn hơn nhiều). Lúc đó: bỏ `profiles: ["prod-logging-blueprint"]`, mount `/var/lib/docker/containers` đúng path thật của host chạy Docker (path này giả định Docker daemon Linux — Docker Desktop/WSL2 khác, cần verify lại path khi có container thật).

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

### ⛔ SỬA LỚN 2026-07-25 — cấm hoàn toàn context ngầm định (classname), mọi log PHẢI dùng `LogContext` tường minh

User phản đối đúng: hệ thống trước đó có **2 nguồn cùng set field `context`** — (1) `@InjectPinoLogger(ClassName.name)`/`logger.child({context: ClassName.name})` tự động, và (2) field `context: LogContext.X` truyền tay trong từng log call. Đây là setup 2 nơi cho cùng 1 việc — không phải fallback có chủ đích, mà là tàn dư của thư viện, và có 2 hậu quả thật (verify bằng pino/nestjs-pino thật, không suy đoán):

1. **NestJS (`nestjs-pino`)**: `PinoLogger.call()` làm `Object.assign({context: this.context}, firstArg)` — nếu log call CÓ truyền `context` tường minh, nó thắng, còn `@InjectPinoLogger(ClassName.name)` trở thành dead code nhìn như có tác dụng nhưng không hề.
2. **auth-service (pino thuần)**: `logger.child({context: X})` rồi gọi `logger.warn({context: Y}, msg)` → JSON output có **field `context` bị ghi 2 LẦN** (`"context":"X","context":"Y"`) — JSON sai kỹ thuật, chỉ đúng nhờ may mắn (parser lấy giá trị cuối).

**Luật mới, áp dụng toàn repo**: MỌI log call, ở MỌI service, PHẢI truyền `context: LogContext.X` tường minh — không có ngoại lệ, không dựa vào bất kỳ cơ chế tự động nào (`child()`, `@InjectPinoLogger(name)`'s auto-context). Nếu 1 class cần giá trị context chưa có sẵn → **thêm mới vào `log-context.ts`**, kể cả khi hiện tại chỉ 1 service dùng — không tạo context ngầm định qua tên class nữa, dù chỉ 1 service.

**3 giá trị mới thêm** (trước đó dùng classname ngầm hoặc hoàn toàn không có context):
- `CIRCUIT_BREAKER` — `shared-kernel/src/resilience/circuit-breaker.ts`, dùng chung bởi MỌI `*Caller` wrapper (Claude/Gemini/Ollama/Elasticsearch/gRPC callers ở cả search-service lẫn core-api) — sửa 1 chỗ, cascade tự động tới tất cả.
- `OUTBOX` — `PollingPublisherService` + `OutboxReaperService` + `KafkaProducerService` (core-api) — cùng 1 pipeline "DB row → Kafka topic", gộp 1 context để filter ra cả pipeline cùng lúc thay vì 3 mảnh rời.
- `IDEMPOTENCY` — `IdempotencyInterceptor` + `IdempotencyCleanupService` (core-api).
- `LIFECYCLE` — process start/shutdown (`main.ts` mọi service) — không phải request/dispatch boundary nhưng vẫn cần context như mọi log khác.

**Bug phụ tìm ra khi sửa `main.ts`**: `logger.error(err, 'Error during shutdown')` (dùng `nestjs-pino`'s `Logger` class, KHÔNG phải `PinoLogger`) — class này bắt chước `LoggerService` của Nest (`error(message, trace?, context?)`), coi optionalParam CUỐI CÙNG là `context`, không phải message. Verify bằng pino thật: chuỗi `'Error during shutdown'` bị hiểu nhầm thành `context`, dòng log KHÔNG CÓ `msg` nào cả — message biến mất hoàn toàn. Sửa: khi cần cả message lẫn context tường minh, message phải nằm TRONG object (`{err, msg: '...'}`), context là optionalParam cuối.

**auth-service — bỏ hẳn `.child({context: ClassName.name})`** (`container/application.ts`, `LoginHandler`/`RegisterHandler`/`RefreshHandler`) — cả 3 handler chỉ gọi `logAudit()` (đã tự set `context: LogContext.AUDIT`), nên child-binding chỉ tạo ra JSON lỗi (context 2 lần) mà không có tác dụng gì. Xoá luôn `ChildCapableLogger` interface (không còn nơi nào dùng `.child()` nữa) — `buildInfra()` quay về nhận `ILogger` thường.

**Bug độc lập tìm thấy giữa chừng, không liên quan context nhưng chặn hết test**: `redactLogMethodHook` (`logger/index.ts`) thiếu từ khoá `export` dù JSDoc ngay phía trên nói rõ "Exported... so tests can build..." — khiến `redact.spec.ts` fail biên dịch. Sửa 1 dòng.

Verified: `tsc --noEmit` sạch + test xanh cả 5 package sau toàn bộ đợt sửa — shared-kernel 74/74, core-api 142/142, auth-service 107/107, notification-service 33/33, search-service 52/52.

### Field `context` — taxonomy & cách gắn

Mỗi log line nên có `context` để filter Kibana cùng với `serviceContext` (= tên service từ root).

- **Cross-service shared contexts** (pattern tồn tại ở CẢ auth-service + core-api): khai báo MỘT lần trong `shared-kernel/src/logger/log-context.ts` (`LogContext`), dùng y hệt ở mọi service → query `context: "CommandBus"` trải mọi service. Hiện có: `CommandBus`, `QueryBus`, `RetryMiddleware`, `TransactionMiddleware`, `EventBus` (CQRS in-process), `EventRouter` (cross-service integration-event dispatch), `HttpLayer` (interceptor/hook), `ExceptionFilter` (global error).
- **Cách gắn:**
  - CQRS middleware (shared-kernel): tự đính `this.logger.info({ context: LogContext.X }, msg)` → object-first. Nhờ vậy **không cần** set context ở composition root; core-api vẫn giữ `requestId` (PinoLogger lấy per-request logger lúc log), auth-service nhận field qua root.
  - NestJS service app-local: `@InjectPinoLogger(XxxService.name)` (vd KafkaProducerService, PollingPublisherService) → context = tên class, self-maintaining, KHÔNG cho vào `LogContext`.
  - HTTP payload / `req.log`: thêm `context` vào object truyền vào log call.
- `ILogger` (shared-kernel) có overload object-first (`info(obj, msg?)`) khớp cả pino lẫn nestjs-pino — đó là cách đính structured field.

### Correlation-id — `trace_id`/`span_id`/`parent_span_id` tự động, KHÔNG opt-in (2026-07-22)

Xem `resilience_patterns.md` §7 cho toàn bộ thiết kế W3C Trace Context (RECEIVE luôn tự sinh trace, SEND không bao giờ tự sinh, `parentSpanId` cho quan hệ nhân-quả). Phần liên quan trực tiếp tới logger:

**Lịch sử — bản đầu để opt-in, phát hiện sai:** `traceLogFields()` ban đầu là hàm phải tự gọi thủ công ở từng log call (`...traceLogFields()`). Audit thực tế (grep toàn bộ 3 repo) phát hiện **chỉ 2 file** gọi nó — `GlobalExceptionFilter`, `globalErrorHandler`, và `LoggingMiddleware` đều **quên**. Nghĩa là gần như toàn bộ log nghiệp vụ bình thường không hề có `trace_id`, đi ngược mục tiêu chính của cả feature.

**Sửa — cùng cơ chế đã dùng cho `deepRedact`:** `logger/index.ts` có thêm `traceLogMethodHook` (pino `hooks.logMethod`), tự động gắn `trace_id`/`span_id`/`parent_span_id` vào **MỌI** log call, không cần call site nào tự nhớ. Chain vào `redactLogMethodHook` sẵn có (pino chỉ nhận đúng 1 `hooks.logMethod`, nên 2 hook compose lại thành 1). `traceLogFields` giờ **không còn export public** — chỉ dùng nội bộ trong `logger/index.ts`, đúng nguyên tắc "chỉ export cái thật sự có consumer".

- No-op (không thêm field) khi không có trace context active (ví dụ log lúc process khởi động, trước khi có request/message nào tới) — không log field rỗng.
- Áp dụng cho MỌI logger instance kể cả `@InjectPinoLogger(Xxx.name)` (child logger) — hook nằm ở tầng root pino, `.child()` kế thừa hook của root, không cần wiring riêng ở từng service.
- `TraceContextMiddleware` (mở ALS) hiện có ở **core-api, auth-service, search-service, notification-service** — tất cả 4 service có HTTP layer. `worker-service` không có HTTP nên N/A. Ban đầu chỉ core-api/auth-service có (lúc mới build correlation-id), search-service/notification-service bị bỏ sót — vá cùng đợt audit 2026-07-22 (xem mục "Audit" bên dưới).

⚠️ **TRIPWIRE (2026-07-25) — đây KHÔNG phải distributed tracing thật, đừng nhầm:** `trace_id`/`span_id`/`parent_span_id` hiện chỉ là field chèn vào TỪNG DÒNG LOG (dùng để filter/nối log rời rạc trong Kibana bằng tay). KHÔNG có khái niệm span thật (start/end/duration, cây cha-con), KHÔNG có backend visualize (Jaeger/Tempo). Để có waterfall view thật cần: cài OpenTelemetry SDK vào từng service, instrument HTTP/gRPC/Kafka/Prisma, dựng OTel Collector + Jaeger/Tempo — việc này CHẠM APP CODE nhiều service, không phải chỉ infra config, và **chưa làm, chưa lên kế hoạch cụ thể**. Đừng silently coi correlation-id hiện tại là "đã có tracing" khi review lại sau này.

### Bảo mật log — Redaction (BẮT BUỘC) + payload ở debug

- **Redaction áp ở cấp LOGGER, KHÔNG per-method** → mọi level (`info/warn/error/debug/fatal/trace`) đều bị mask, child logger kế thừa redact của root. Nó KHÔNG gắn riêng với debug; đặt payload ở debug chỉ là quyết định độc lập về volume.
- **Root logger `createLogger` có `redact`** (pino, in-process TRƯỚC mọi transport) mask secret ở MỌI log dù object shape gì: `password/newPassword/currentPassword/token/accessToken/refreshToken/secret/authorization/cookie` + biến thể `*.x` (1 cấp lồng) + `req(uest).headers.authorization/cookie`. Censor = `[REDACTED]`. Paths = single source `LOG_REDACT_PATHS` (test `redact.spec.ts` khoá hành vi).
- **PII cũng bị mask (thêm 2026-07-22):** `email`, `username` nằm chung `SENSITIVE_LOG_KEYS` với secret → mask ở MỌI cấp/độ sâu (qua `deepRedact` hook), không chỉ secret. **Đánh đổi có chủ đích:** email/username giờ `[REDACTED]` trong MỌI log kể cả log cố ý — **định danh user trong log bằng `userId`, KHÔNG bao giờ bằng email**. (Mask toàn bộ, không partial kiểu `j***@b.com`: cơ chế redact là all-or-nothing per key; partial cần per-field censor riêng, hoãn tới khi có nhu cầu thật thấy 1 phần email trong log.) Thêm PII field mới (số điện thoại, địa chỉ…) → thêm vào `SENSITIVE_LOG_KEYS`, đừng dựa "nhớ đừng log".
- ⚠️ **2 GIỚI HẠN của redaction (phải biết):**
  1. **Chỉ mask đúng path khai báo, theo độ sâu.** `*.password` chỉ bắt 1 cấp lồng (`input.password`), KHÔNG bắt sâu hơn (`a.b.password`). Lồng sâu hơn phải khai báo path tường minh.
  2. **Chỉ mask FIELD trong object, KHÔNG mask chuỗi message.** `logger.info(\`pw=${pw}\`)` SẼ leak vì pw nằm trong string. → LUÔN truyền dữ liệu qua object (`logger.info({ pw }, 'msg')`), TUYỆT ĐỐI không nội suy secret vào message string.
- **Payload command:** `LoggingMiddleware` log `input: command` ở **`debug`** (im prod, tránh body-volume), KHÔNG ở info. An toàn vì redaction đã mask secret → đọc log debug vẫn biết command chạy với input gì (password đã thành `[REDACTED]`).
- ⚠️ Khi thêm secret field mới (vd `apiKey`), thêm path vào `LOG_REDACT_PATHS` — KHÔNG dựa vào "nhớ đừng log".

⚠️ **TRIPWIRE (2026-07-25) — log-volume sampling: đã xét, KHÔNG build, vì chưa có gap thật.** Đọc thẳng `resilience/circuit-breaker.ts`: `execute()` khi `state === 'open'` chỉ `throw` ngay (dòng 56/60), KHÔNG gọi logger — circuit mở không tạo log storm. Đọc `messaging/resilient-consumer.ts`: retry bị chặn bởi `maxRetries` hữu hạn/message + DLQ, không phải vòng lặp vô hạn — volume tăng lúc dependency down là tín hiệu cần thấy (đúng lúc cần audit trail nhất), không phải rò rỉ. Nếu sau này có case burst thật (VD: 1 client cố tình gửi payload lỗi lặp lại ở tầng KHÔNG có rate-limiter, hoặc 1 dependency flap liên tục làm breaker đóng/mở lặp), quay lại đây trước khi build — đừng lặp lại pattern "xây trước khi có consumer thật" đã bị bắt ở audit-log/`ILogger.child()`.
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
| `GRPC` | `GrpcLayer` | gRPC transport | `core-api` `membership-verification.grpc-service.ts`; `auth-service` `auth-provisioning.grpc-service.ts` — thêm 2026-07-22, xem audit dưới |
| `EXCEPTION` | `ExceptionFilter` | Unhandled exception | `core-api`/`notification-service`/`search-service` `global-exception.filter.ts:66`; `auth-service` `global-error.handler.ts:33` |

**Logger app-local** (KHÔNG vào `LogContext`, tự dùng tên class qua `@InjectPinoLogger(Xxx.name)`) — 18 file trong core-api/notification-service/search-service, ví dụ `KafkaProducerService`, `PollingPublisherService`, `IdempotencyCleanupService`, `MembershipVerificationGrpcService`, `GrpcServerBootstrap`, mọi `*Caller` class (circuit breaker wrapper).

**"Logger lạc đàn" — không tìm thấy.** Grep `new PinoLogger(`, `pino(`, `console.*`, `new Logger(` toàn repo: `pino(...)` chỉ xuất hiện đúng 1 nơi (`shared-kernel/src/logger/index.ts:125`, bên trong `createLogger`). `console.*` chỉ xuất hiện ở catch-block bao ngoài `bootstrap()` trong `main.ts` mỗi service (khi chính logger chưa kịp khởi tạo hoặc bootstrap fail — fallback hợp lý, không phải logger song song) và trong script độc lập (`auth-service/prisma/seed.ts`, không chạy trong runtime process).

### Audit "5 điểm log chuẩn" (2026-07-22) — sau khi correlation-id lộ ra gap

Câu hỏi audit: *"nơi đặt log hiện tại là đâu, tại sao, có đồng bộ giữa các service không, đã đủ chuẩn enterprise chưa?"* Trả lời bằng cách đọc code thật (grep toàn bộ `logger.*(` + `this.#logger.` + `this.logger.` ở cả 5 service + shared-kernel), không suy đoán. Có đúng **5 điểm log chuẩn** — mọi log line trong hệ thống rơi vào 1 trong 5 điểm này, không rải rác tuỳ hứng:

| # | Điểm | Log gì | Có ở service nào |
|---|---|---|---|
| 1 | HTTP boundary (interceptor/hook) | MỌI request, tier theo status | core-api, notification-service, search-service, auth-service |
| 2 | CQRS business layer, HTTP-triggered write (`LoggingMiddleware`/`QueryBus`) | Lifecycle command/query | core-api, auth-service, notification-service |
| 2b | Event dispatch, Kafka-triggered write (`EventRouter.route()`, 2026-07-25) | Lifecycle event (executing + success/duration) — KHÔNG log lỗi ở đây, xem #3 | **core-api, notification-service, search-service — mọi consumer dùng `EventRouter`, kể cả worker-service khi có consumer đầu tiên** |
| 3 | Kafka consumer boundary (`ResilientEventConsumer`) | Poison-pill/retry/DLQ | notification-service, search-service |
| 4 | gRPC handler boundary | Trước 2026-07-22: chỉ lỗi. Từ 2026-07-22: cả thành công lẫn lỗi | core-api, auth-service |
| 5 | Global exception filter | Chỉ lỗi unhandled thật (HttpException/ApplicationError không log — tránh trùng #1) | Cả 4 service có HTTP |

### ⚠️ Bug thật, nghiêm trọng nhất tìm được (2026-07-25) — #1 (HTTP boundary) log SAI status ở cả 3 service NestJS, từ lúc viết tới giờ

**Không phải thiếu log — log SAI DỮ LIỆU**, nặng hơn mọi gap khác tìm được cùng đợt. Verify bằng app NestJS+Fastify THẬT (không mock `ExecutionContext` — mock không thể bắt được lỗi timing này):

`HttpLoggingInterceptor` (core-api/notification-service/search-service, identical code) đọc `res.statusCode` bên trong RxJS `finalize()` gắn vào `next.handle()`. `finalize()` chạy **NGAY KHI exception còn đang lan ra khỏi interceptor chain — TRƯỚC KHI** `GlobalExceptionFilter` (đăng ký `APP_FILTER`, nằm NGOÀI interceptor) kịp gọi `reply.status(...)`. Hậu quả: **mọi response có exception (404, 409, 500...) đều bị log thành `statusCode: 200` ở level `info`**, y hệt request thành công — điểm bị verify thật: request `/boom` (ném `NotFoundException`) trả về **404 thật cho client**, nhưng dòng log của interceptor ghi `statusCode: 200`. So sánh: `nestjs-pino` tự có 1 dòng log "request completed" (dùng Fastify `onResponse` hook nội bộ) — dòng đó CÓ status đúng (404) nhưng KHÔNG tự nâng level theo status (mặc định luôn `info`, project chưa cấu hình `customLogLevel`) — nên trước khi vá, **không có dòng log nào vừa đúng status vừa đúng level** cho 1 request lỗi ở core-api/notification-service/search-service.

**auth-service KHÔNG bị** — `httpLoggingHook` đăng ký qua `fastify.addHook('onResponse', ...)` (Fastify hook gốc, không qua RxJS), Fastify đảm bảo `onResponse` chạy SAU khi error handler set status xong.

**Sửa**: bỏ `finalize()`, chuyển sang lắng nghe `res.raw.once('finish', ...)` — event của Node's `http.ServerResponse` gốc, chỉ bắn sau khi response THẬT SỰ gửi xong tới client (đúng cơ chế Fastify `onResponse`/pino-http tự dùng). File: `http-logging.interceptor.ts` cả 3 service, code giống hệt nhau.

**Verify sau khi vá (app thật, không mock)**: `/boom` → log `statusCode: 404, level: 40 (warn)` đúng thật; `/ok` → `statusCode: 200, level: 30 (info)` đúng thật. Spec mới: `http-logging.interceptor.spec.ts` (core-api) — dựng `NestFactory.create` + Fastify thật + inject request thật, không mock `ExecutionContext`, vì đây chính là lỗi mock không bắt được.

**Bài học lớn nhất đợt audit này**: unit test dùng mock `ExecutionContext`/`reply` sẽ KHÔNG BAO GIỜ bắt được lỗi thứ tự thực thi giữa interceptor và filter — phải test bằng app thật (`NestFactory.create` + adapter thật + `.inject()`) mới lộ ra. Trước khi tin 1 "cửa ngõ" log là đúng, phải hỏi: test hiện có (nếu có) verify bằng mock hay bằng hành vi runtime thật?

### ⚠️⚠️ Bug thứ 2, NẶNG HƠN bug #1 — `GlobalExceptionFilter` không hề log được lỗi thật, từ lúc viết tới giờ (phát hiện khi user hỏi lại "có duplicate với HTTP log không")

**Câu hỏi dẫn tới phát hiện**: user hỏi dòng `req.log.error({context: EXCEPTION, err: exception}, 'Unhandled exception')` có bị trùng với log của `HttpLoggingInterceptor` không. Verify bằng app thật (ném 1 `Error` KHÔNG phải `HttpException`/`ApplicationError`, tức nhánh unhandled thật) — kết quả: **dòng "Unhandled exception" hoàn toàn không xuất hiện trong log**, dù code chắc chắn có chạy tới đó (proof: stack trace của dòng log khác cho thấy `GlobalExceptionFilter.catch` đã chạy qua dòng SAU nó).

**Nguyên nhân, xác nhận từng bước bằng debug trực tiếp trên code thật (không đoán):**
1. `req.log.error(...)` không throw, `req.log` có hàm `.error` thật — nhưng `req.log.level` và `req.log.bindings()` đều `undefined` → **`req.log` KHÔNG PHẢI pino instance thật**, chỉ là 1 stub im lặng.
2. Đọc thẳng source `node_modules/nestjs-pino/LoggerModule.js`: `nestjs-pino` gắn logger qua **Express-style middleware + AsyncLocalStorage** (`storage.run(new Store(log), next)`), KHÔNG gán trực tiếp `req.log` theo cách FastifyRequest expect.
3. Đọc `node_modules/nestjs-pino/PinoLogger.js`: `PinoLogger`/`Logger` (inject qua DI, dùng ở MỌI nơi khác trong codebase — `HttpLoggingInterceptor`, mọi `@InjectPinoLogger`) đọc logger qua `storage.getStore()?.logger` — **ĐÚNG cơ chế ALS**, hoạt động chuẩn.
4. `req.log` (truy cập trực tiếp property, KHÔNG qua DI) dưới Fastify+nestjs-pino **không resolve đúng** — Fastify tự có `request.log` riêng (decorator có sẵn của framework), và middleware Express-style của nestjs-pino không ghi đè được nó theo cách `req.log.xxx()` mong đợi.
5. **`auth-service` KHÔNG bị** — verified riêng: nó truyền thẳng `loggerInstance: logger` (instance pino THẬT) vào constructor của `Fastify()`, nên `request.log`/`req.log` ở auth-service CHÍNH LÀ pino instance thật, không qua lớp tương thích nào.

**Hậu quả trước khi vá**: ở **core-api, notification-service, search-service** — MỌI lỗi thật sự không mong đợi (null pointer, type error, bug bất kỳ không phải `HttpException`/`ApplicationError`) từng xảy ra trong 3 service này **không hề để lại 1 dòng log nào có message/stack trace thật**. Chỗ duy nhất còn sót lại là dòng "request errored" tự động của `pino-http`, nhưng dòng đó chứa 1 error TỔNG HỢP do chính pino-http tạo ra (`"failed with status code 500"`) — KHÔNG phải exception gốc, vô dụng để debug.

**Sửa**: đổi `req.log.error(...)` → inject `PinoLogger` qua `@InjectPinoLogger(GlobalExceptionFilter.name)` (thêm `@Injectable()` cho filter), gọi `this.logger.error(...)` — đúng pattern DI mọi class khác trong codebase đã dùng đúng từ đầu. Áp dụng cả 3 service (core-api/notification-service/search-service).

**Verify sau khi vá** (app thật, ném `Error` thật): dòng `context: "ExceptionFilter"` xuất hiện với `err.message: "unexpected null pointer somewhere"` (message thật) và `err.stack` trỏ đúng vào hàm gây lỗi. Spec mới `global-exception.filter.spec.ts` (cả 3 service, dựng app thật) khoá lại 2 điều: (1) exception thật được log với message/stack đúng, (2) `HttpException` KHÔNG bị log trùng ở filter này (giữ đúng thiết kế "tránh trùng #1").

**Trả lời câu hỏi gốc của user (có duplicate không?):** KHÔNG — sau khi vá, 2 log phục vụ mục đích khác nhau, join được qua `req.id`: `HttpLayer` (mọi request, status+duration, KHÔNG có stack trace) vs `ExceptionFilter` (CHỈ lỗi thật sự không mong đợi, CÓ message+stack, không có ở đâu khác). Đúng tinh thần "Dual-Logging Philosophy" đã có sẵn trong doc này (HTTP layer vs Business layer) — không phải log thừa.

**Bài học rút ra, áp dụng rộng hơn phạm vi file này**: `req.log`/`req[X]` (truy cập trực tiếp property trên request object) là pattern KHÔNG AN TOÀN dưới NestJS+Fastify+nestjs-pino — chỉ dùng DI (`@InjectPinoLogger`/`Logger`) để lấy logger, kể cả trong Guard/Filter/bất kỳ đâu, dù `req.log.xxx()` "trông có vẻ chạy được" (không throw) vẫn có thể là stub câm. Nếu thấy code mới nào dùng `req.log`/`request.log` trực tiếp ở core-api/notification-service/search-service (KHÔNG áp dụng cho auth-service, nơi `req.log` là thật) — đó là dấu hiệu cần kiểm tra lại bằng app thật, không tin bằng mắt.

**Sửa lại 2026-07-25 — #2 tách thành #2/#2b, không còn "search-service không có CQRS nên thiếu log":** bản trước gộp nhầm "dispatch command HTTP" với "dispatch event Kafka" vào chung khái niệm CQRS bus, kết luận sai rằng search-service thiếu 1 tầng log vì "không có bus". Thực ra event dispatch (`EventRouter`) VỐN ĐÃ dùng chung ở mọi service từ trước — chỉ là bản thân `EventRouter.route()` chưa tự log (chỉ log khi KHÔNG tìm thấy handler). Thêm log dispatch trực tiếp vào `EventRouter.route()` (giống hệt `LoggingMiddleware` làm cho CommandBus: info lúc bắt đầu, info+duration lúc xong, KHÔNG log lỗi vì `ResilientEventConsumer` đã log retry/DLQ ở tầng trên — tránh trùng) → mọi consumer của `EventRouter` tự động đồng bộ, không cần biết service đó có CommandBus/QueryBus hay không. **Bug thật lộ ra khi sửa:** notification-service có 3 event handler (`item-published`, `follow-removed`, `follow-created`) **hoàn toàn chưa từng có business-layer log** — rộng hơn gap đã tìm thấy ở search-service ngày 2026-07-22 (lúc đó chỉ vá tay 1 handler, không vá tại nguồn).

**4 gap tìm ra, đã sửa cả 4 (không để lại "chưa cần" nếu không có lý do YAGNI thật):**

1. **Correlation-id chỉ phủ 2/4 service có HTTP** — `TraceContextMiddleware` lúc mới build (cùng đợt với resilience_patterns.md §7) chỉ nối vào core-api/auth-service, quên search-service/notification-service. Sửa: thêm `TraceContextMiddleware` y hệt vào 2 service còn lại (`app.module.ts` + file middleware riêng, theo đúng convention "NestJS-specific infra nhân bản mỗi service" đã dùng cho `OrgAwareThrottlerGuard`).
2. **gRPC boundary bất đối xứng** — HTTP/Kafka log cả thành công lẫn lỗi, gRPC chỉ log lỗi. Thêm `LogContext.GRPC` + log `info` lúc RPC thành công ở cả 2 gRPC service (`checkMembership`, `provisionUser`, `cancelProvisionedUser`) — không log secret (`temporaryPassword` không vào log, chỉ `userId`).
3. **search-service vi phạm chính "Dual-Logging Philosophy" của tài liệu này** — không dùng CQRS bus (`rag_ai_integration.md` — quyết định kiến trúc có chủ đích) nên không có business-layer log tự động. Trước đó chỉ có 3 dòng `warn` khi degrade (ES down/RAG down/embedding down) — request chạy khoẻ mạnh không có log nghiệp vụ nào. Thêm log thủ công tương đương business-layer vào `SearchKnowledgeService.search()` và `IndexKnowledgeHandler.handle()` — 2 operation tốn kém nhất hệ thống (AI/embedding calls), trước đó lại là 2 chỗ có ít observability nhất. **Mức log tuân đúng "Buses & logger" rule bên dưới, KHÔNG đồng đều:** `search()` là READ (query) → happy-path ở **`debug`** (HTTP layer đã log request; info nữa = nhiễu — đúng lý do QueryBus ở debug), degrade vẫn ở `warn`; `IndexKnowledgeHandler` là WRITE/indexing tần suất thấp + tốn kém → hoàn tất ở **`info`** (analog với command). ⚠️ Bản đầu để `search()` completed ở `info` — SAI, tự bắt lỗi khi audit lại: query không được info-log happy-path. Đã sửa xuống debug.
4. **`traceLogMethodHook` chưa doc** — xem mục "Correlation-id" phía trên.

**Kết luận:** hệ thống ĐÃ có rule rõ ràng từ trước (không phải tự do tuỳ hứng như audit ban đầu lo ngại), nhưng rule đó chưa được áp dụng ĐỒNG ĐỀU 100% — chủ yếu vì các service được xây ở các thời điểm khác nhau, feature mới (correlation-id) build xong quên lan ra hết. Bài học: mỗi khi thêm 1 cơ chế logging mới áp cho "mọi service", phải tự hỏi *"đã check đủ cả 5 service chưa, hay chỉ check 2 service đang sửa dở"* — đúng lỗi đã mắc ở gap #1.

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

## Audit Log — tag `context` ở app, tách vật lý ở ES layer (2026-07-22 rút gọn → 2026-07-25 tách lại đúng cách)

**Vấn đề gốc:** hệ thống event-sourced sẵn có (`CreditEvent`/`ReputationEvent`) đã LÀ audit trail cho tiền/điểm — nhưng KHÔNG có gì tương đương cho sự kiện bảo mật thuần (login thành công/thất bại, refresh-token bị replay). Trước đây (nếu có log) trộn chung với log operational, không lọc riêng được.

**⚠️ Lịch sử — bản đầu XÂY RỒI GỠ TRONG CÙNG NGÀY, đọc để không lặp lại:** bản đầu dựng hẳn `createAuditLogger()` — 1 pino instance riêng, ES index riêng (`dsp-audit-logs`), bypass hẳn `deepRedact` để giữ PII. Sau khi tự phản biện (đúng bài học đã có: *"cái này có tên/tài liệu chuẩn hay tự tổng hợp?"* — xem §1.4 `resilience_patterns.md` cho tiền lệ y hệt): concept "audit log tách biệt" có thật, nhưng phần **tạo ra giá trị thật** của nó — access control riêng — KHÔNG được xây, chỉ ghi lại thành tripwire. Nghĩa là: 1 pino instance mới + 1 ES index mới + 1 exception phá chính PII policy vừa xây, đổi lấy lợi ích bảo mật = 0 (ai đọc `dsp-logs` vẫn đọc được `dsp-audit-logs`, không có gì ngăn). Đúng dạng "cồng kềnh không hiệu quả" — **đã gỡ trong cùng ngày**, quay về dùng logger operational sẵn có.

**Giải pháp cuối — `logAudit()` (`shared-kernel/src/logger/audit.ts`), dùng CHUNG logger operational:**
- Không có logger/pino instance/ES index riêng — `logAudit(logger, event)` chỉ là 1 lời gọi `logger.warn()`/`logger.info()` bình thường, gắn `context: LogContext.AUDIT` để lọc được trong Kibana (`context: "AuditLog"`) — **đúng cơ chế `context` taxonomy đã có sẵn cho `HttpLayer`/`CommandBus`/...**, không phát minh gì mới.
- Level: `outcome: 'failure'` → `warn` (bất thường nhưng không phải lỗi hệ thống — đúng kỷ luật level đã có: 4xx không phải `error`); `outcome: 'success'` → `info`.
- **PII: KHÔNG bypass redaction.** `actorEmailHash` = `sha256(email)`, không log email thô — vẫn correlate được "cùng 1 tài khoản bị nhắm tới nhiều lần" (2 lần gọi cùng email → cùng hash) mà không vi phạm chính PII policy vừa xây cho phần còn lại của hệ thống. Đây là cách giải quyết đúng tension "audit cần biết ai bị nhắm tới" vs "PII phải mask" — không cần ngoại lệ.

**Shape `AuditEvent`:** `action` (dot-namespace, vd `auth.login`), `outcome` (`success`/`failure`), `actorUserId` (null nếu chưa xác định danh tính), `actorEmailHash` (optional, đã hash), `targetUserId` (khi action tác động lên user KHÁC actor), `ip`, `metadata` (vẫn KHÔNG redact vì đi qua cùng logger operational — nhưng đã redact ở tầng logger rồi, chỉ cần không tự ý nhét PII chưa hash vào đây).

### Tách vật lý ở tầng ES (2026-07-25) — lấp đúng lỗ hổng đã nêu lúc gỡ

Lúc gỡ bản đầu (2026-07-22), lý do chính là: tách hạ tầng riêng mà **không có access-control riêng** = tốn thêm hạ tầng, lợi ích bảo mật = 0. Giờ access-control riêng đã có thật, nên tách lại — nhưng tách ở **tầng Elasticsearch**, không phải tầng app, để `logAudit()`/`AuditEvent`/mọi call site giữ nguyên, không cõng thêm độ phức tạp nào:

- **`docker-init/elasticsearch/ingest-pipeline-log-router.json`** — ingest pipeline `dsp-log-router` gắn làm `default_pipeline` của data stream `dsp-logs`. Có 1 processor `reroute`: doc nào có `context == 'AuditLog'` bị chuyển sang data stream `dsp-audit-logs` TRƯỚC khi ghi — app luôn ghi vào `dsp-logs`, không biết gì về việc này.
- **2 role ES** (`docker-init/elasticsearch/role-dsp-ops-reader.json` / `role-dsp-audit-reader.json`) — `dsp_ops_reader` chỉ đọc `dsp-logs*`, `dsp_audit_reader` chỉ đọc `dsp-audit-logs*`. Đây là RBAC **index-level**, có sẵn ở ES Basic license (miễn phí) — KHÔNG dùng Document-Level Security (field-level filter trong cùng 1 index), vì DLS chỉ có ở Platinum trở lên.
- **Verify thật, không chỉ đọc config**: bơm 1 doc `context:HttpLayer` và 1 doc `context:AuditLog` qua cùng pipeline → xác nhận doc đầu vào `.ds-dsp-logs-*`, doc sau vào `.ds-dsp-audit-logs-*`. Xác nhận ma trận 403/200 đúng cả 2 chiều qua ES REST API.
- **2 user THẬT, đăng nhập được vào Kibana ngay trên local docker-compose (2026-07-25, sửa lại sau khi bị hỏi lại)** — lần verify đầu tiên tôi tạo 2 user test rồi XOÁ ngay sau khi test, để lại role tồn tại nhưng KHÔNG có user thật nào dùng được — đúng kiểu "hạ tầng đúng nhưng không dùng được" mà bị nhắc lại. Sửa: `docker-init/elasticsearch/setup.sh` giờ tạo VĨNH VIỄN `dsp_ops_viewer` (role `dsp_ops_reader`) và `dsp_audit_viewer` (role `dsp_audit_reader`), password qua `DSP_OPS_READER_PASSWORD`/`DSP_AUDIT_READER_PASSWORD` trong `.env`. Cả 2 role có thêm Kibana feature privilege (`feature_discover.read`) để dùng được Discover trong UI, không chỉ ES REST API.
- **Bug thật phát hiện khi verify Kibana (không liên quan trực tiếp audit-log, nhưng chặn hoàn toàn việc verify):** Kibana trong `docker-compose.yml` cấu hình dùng user `elastic` (superuser) để tự kết nối ES — ES 8.x **từ chối boot Kibana** với lỗi `"elastic" is forbidden. This is a superuser account`. Kibana crash-loop ngay từ trước, không liên quan gì tới thay đổi lần này — chỉ lộ ra vì đây là lần đầu ai đó thực sự khởi động Kibana để kiểm tra. Sửa: dùng built-in service account `kibana_system` (password set qua `setup.sh`, env `KIBANA_SYSTEM_PASSWORD`) đúng chuẩn ES 8.x, không phải superuser.
- **Verify Kibana thật, qua đúng API Discover dùng (`/internal/bsearch`, strategy `es`), không phải suy luận từ REST thô:** `dsp_ops_viewer` search `dsp-logs` → trả về document thật; search `dsp-audit-logs` → `_shards.total: 0`, 0 hit (ES lọc sạch, không phải lỗi — đúng hành vi bảo mật). `dsp_audit_viewer` ngược lại đúng y hệt. Test cả 2 chiều, cả 2 role.
- **Cách tự kiểm tra (bạn, không cần đọc code):** `docker compose --profile monitoring up -d kibana elasticsearch-setup`, mở `http://localhost:5601`, đăng nhập bằng `dsp_ops_viewer`/`DSP_OPS_READER_PASSWORD` (hoặc `dsp_audit_viewer`/`DSP_AUDIT_READER_PASSWORD` từ `.env`) → Discover → chọn Data View "dsp-logs (operational)" hoặc "dsp-audit-logs (security)" (đã tạo sẵn qua Kibana Data Views API, không cần tự tạo). 2 data view này chỉ là "cửa sổ xem", quyền đọc THẬT vẫn do role ES quyết định — chọn nhầm data view mà không có quyền sẽ ra danh sách rỗng, không phải lỗi.
- **Bootstrap**: `docker-init/elasticsearch/setup.sh` (idempotent, toàn PUT) chạy qua service `elasticsearch-setup` trong `docker-compose.yml` — 1 lần khi ES healthy, không phải bước tay.
- **Đổi nhỏ bắt buộc ở app**: `createLogger` (`logger/index.ts`) đổi field timestamp mặc định của pino (`time`, epoch ms) thành `@timestamp` (ISO string) — ES data stream yêu cầu field này. Không đổi gì khác.
- **ILM/retention (2026-07-25, cùng đợt)**: `dsp-logs-ilm` (14 ngày — high volume, low long-term value) và `dsp-audit-logs-ilm` (90 ngày — investigation value sống lâu hơn) gắn qua `index.lifecycle.name` ở mỗi index template. Cả 2 chỉ có hot→delete (rollover 1d/5gb → xoá), không có warm/cold vì scale hiện tại chưa cần. 90 ngày là default hợp lý, KHÔNG phải số đã certify theo compliance thật — nếu có yêu cầu compliance cụ thể sau này thì sửa `ilm-policy-dsp-audit-logs.json`, không sửa code app. Verified thật: ghi 1 doc → `GET dsp-logs/_ilm/explain` xác nhận `policy: dsp-logs-ilm, phase: hot`.
- ⚠️ **Khác bản đầu ở đúng 1 điểm quyết định, nhớ điểm này khi có ai hỏi lại "sao không giống lần trước bị gỡ":** bản đầu tách ở APP (pino instance riêng, bypass redact) mà KHÔNG có RBAC → tốn hạ tầng, lợi ích 0. Bản này tách ở ES (app không đổi gì ngoài 1 dòng timestamp) VÀ có RBAC thật đi kèm → đúng thứ tự "giá trị trước, hạ tầng sau" mà lần trước làm ngược.

**Áp dụng mẫu ở auth-service (2026-07-22)** — 3 điểm, không audit tất cả mọi thứ:
- `auth.login` — cả success VÀ 3 nhánh failure (user not found / no local-auth method / wrong password), mỗi nhánh audit TRƯỚC khi throw
- `auth.register` — chỉ success (đăng ký trùng email KHÔNG audit — form public, chưa có actor identity để correlate, low-signal so với login/refresh)
- `auth.refresh_reuse_detected` — **sự kiện quan trọng nhất trong cả đợt vá**: refresh-token bị dùng lại là tín hiệu token bị đánh cắp thật (attacker replay token mà user thật đã rotate qua), không phải hành vi user bình thường

**Nguyên tắc chọn nơi audit (áp dụng khi lan ra service khác):** chỉ audit sự kiện (a) đã có `actor` xác định được (userId hoặc ít nhất email), (b) có giá trị điều tra thật nếu bị lạm dụng (không phải mọi lỗi 4xx), (c) chưa được cover bởi event-sourced ledger sẵn có (credit/reputation). KHÔNG audit tràn lan mọi command — đúng tinh thần "log tại boundary có giá trị" đã áp cho logging thường.

### Áp dụng ở core-api (2026-07-25) — 3 điểm, đều là privilege-escalation vector

Áp đúng 3-part test ở trên cho `apps/core-api`:

| Action | Handler | Lý do audit |
|---|---|---|
| `org.member_role_updated` | `UpdateMemberRoleHandler` | Đổi role của 1 thành viên trong org — privilege escalation nếu bị lạm dụng |
| `org.role_permissions_updated` | `UpdateRolePermissionsHandler` | Đổi permission SET của 1 role — ảnh hưởng MỌI thành viên giữ role đó, blast radius lớn hơn 1 dòng trên |
| `platform.org_provisioned` | `ProvisionOrgHandler` | Mutation blast-radius cao nhất hệ thống (comment sẵn trên `ProvisionOrgCommand`) — cross-service, tạo user thật ở auth-service. Audit cả `success` VÀ `failure` (khác 2 dòng trên chỉ audit success) vì đây là saga có compensation — cần thấy cả case compensation fail (orphan user cần dọn tay). |

**⚠️ Gap thật phát hiện KHI làm việc này, không phải đi tìm riêng:** cả 3 route handler (`org.controller.ts`, `platform-admin.controller.ts`) **không hề capture `@CurrentUser()`** trước đó — nghĩa là actor của 1 role/permission change chưa từng được thread qua command. Không audit được "ai" nếu không biết "ai" trước. Đã sửa: thêm `actorUserId` vào cả 3 command (`UpdateMemberRoleCommand`, `UpdateRolePermissionsCommand`, `ProvisionOrgCommand`) + `@CurrentUser()` ở cả 3 route. Đây LÀ điều kiện tiên quyết cho việc audit, không phải scope creep — audit log với `actorUserId: null` vô nghĩa.

Verified: `tsc --noEmit` core-api clean, `jest` toàn bộ core-api 47/47 suite — 134/134 test (bao gồm 3 test audit mới, cộng test đã có cho 3 handler đều pass sau khi đổi constructor arity + inject logger).

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
5. **New HTTP-facing service** → wire `TraceContextMiddleware` (copy from an existing service, `configure()`/`MiddlewareConsumer`, registered `forRoutes('*')`) — do this for EVERY service with HTTP, not just the one you're currently touching (2026-07-22 gap: built once, forgot to replicate to 2/4 services).
6. **New Kafka consumer** → MUST use `ResilientEventConsumer` + `EventRouter` (shared-kernel), never a hand-rolled `eachMessage` loop — inherits poison-pill/retry/DLQ logging AND dispatch logging (`EventRouter.route()`, 2026-07-25) for free, no per-handler log to write.
   - ⚠️ **TRIPWIRE — worker-service, verified 2026-07-25:** `apps/worker-service/src/modules/` is EMPTY — chỉ có scaffold (`infrastructure/kafka/kafka-client.service.ts`, `kafka.module.ts`), CHƯA có consumer thật nào. **Setup PHẢI giống hệt notification-service/search-service, trừ đúng phần HTTP** (worker-service không có HTTP server) — không phải "worker-service khác nên setup khác":
     - Root logger + redact + `@timestamp` + `traceLogMethodHook` — đã đúng sẵn, tự động.
     - `ResilientEventConsumer` + `EventRouter.register()` — bắt buộc, giống mọi consumer khác. Dispatch log (executing/success+duration) tự động có qua `EventRouter`, không tự viết.
     - Trace context — KHÔNG có `TraceContextMiddleware` (HTTP-only), nhưng vẫn có `trace_id`/`span_id`/`parent_span_id` qua `startTraceContext(event.traceparent)` bên trong `ResilientEventConsumer` (đọc từ CloudEvent, không phải HTTP header) — cùng cơ chế, khác điểm vào.
     - Phần DUY NHẤT bỏ vì không áp dụng: `TraceContextMiddleware`, `HttpLayer` boundary log, `OrgAwareThrottlerGuard` — gắn với HTTP server mà worker-service không có. Không bỏ gì khác.
7. **New gRPC server handler** → log BOTH success (`LogContext.GRPC`, `info`) and failure (`error`) — mirror the HTTP/Kafka boundary, don't log failures only.
8. **Event handler dispatched via `EventRouter`** (any service, HTTP or not) → dispatch-level log (executing/success+duration) is automatic via `EventRouter.route()` — do NOT hand-write a duplicate generic log per handler. A handler MAY still add its own domain-specific log on top (extra fields EventRouter can't know, e.g. `chunkCount`) — same relationship as a CommandHandler adding domain detail on top of `LoggingMiddleware`'s generic line.
9. **New security-relevant handler** (auth, role/permission change, provisioning) → check the 3-part test in "Audit Log" above before adding `logAudit()` calls — not every 4xx is audit-worthy, only actor-identified + investigation-value + not already covered by an event-sourced ledger.
10. **NEVER use `req.log`/`request.log` directly in core-api/notification-service/search-service** (2026-07-25 — this exact pattern silently dropped every unhandled-exception log since `GlobalExceptionFilter` was written, see "Bug thứ 2" above). Always inject `PinoLogger`/`Logger` via `@InjectPinoLogger`/constructor DI, in Filters/Guards/anywhere — not just Handlers/Services. `req.log` is only real in auth-service (plain Fastify, `loggerInstance` passed directly). A call not throwing does NOT mean it logged — verify any new `req.log`-style code with a real app test (`NestFactory.create` + real adapter + `.inject()`), never trust a mocked `ExecutionContext`/`reply`.
11. **EVERY log call passes `context: LogContext.X` explicitly, no exceptions** (2026-07-25, see the dedicated section above for why `@InjectPinoLogger(ClassName.name)`'s auto-context and `.child({context})` are both banned, not just discouraged). Need a context that doesn't exist yet? Add it to `log-context.ts` — even for a single-service concern, never fall back to an implicit class name.
