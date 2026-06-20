# SOP: Microservice Architecture & Bootstrap Standard

> [!NOTE]
> Directive này quy định tiêu chuẩn thiết kế kiến trúc khởi chạy (Bootstrap) bắt buộc cho tất cả các microservices trong hệ thống (bao gồm cả NestJS và Fastify thuần) để đảm bảo đồng bộ 100% về mặt ngữ nghĩa và khả năng deploy trên AWS Lambda.

## 🎯 Goal
Đảm bảo mọi microservice mới tạo ra hoặc được refactor đều phải tuân thủ nghiêm ngặt cấu trúc `createApp()` và tách biệt rõ ràng các entrypoints.

## 📜 Kiến Trúc Bắt Buộc

Mọi microservice trong `apps/` phải tuân theo cấu trúc file sau:

1. **`src/bootstrap/server.ts`**
   - Chứa hàm `buildServer()`.
   - Chịu trách nhiệm khởi tạo web framework instance (NestFactory.create hoặc Fastify instance), gắn logger, global pipes, và gọi các logic setup cấu hình.

2. **`src/bootstrap/fastify.ts`**
   - Chứa hàm `setupFastify(app)`.
   - Bắt buộc phải khai báo bộ plugin bảo mật và tối ưu tiêu chuẩn:
     - `@fastify/cors`: `{ origin: config.corsOrigins, credentials: true }` — **KHÔNG dùng `['*']`**, phải load từ env var (`CORS_ORIGINS`) để tránh lỗ hổng bảo mật (memory entry #8)
     - `@fastify/helmet`
     - `@fastify/compress`: `{ encodings: ['gzip', 'deflate', 'br'] }`
     - `@fastify/rate-limit`: `{ max: 100, timeWindow: '1 minute' }`

3. **`src/app.ts`**
   - Import `buildServer` từ `bootstrap/server.ts`.
   - Export hàm `createApp()` trả về application instance đã hoàn thiện.
   - Không chứa logic listen port ở đây.

4. **`src/main.ts`** (Local Entrypoint)
   - Chứa hàm `bootstrap()`.
   - Gọi `const app = await createApp()`.
   - Gọi `app.listen({ port, host: '0.0.0.0' })`.
   - **BẮT BUỘC** có `.catch` để log và `process.exit(1)` khi bootstrap fail.

5. **`src/main.lambda.ts`** (AWS Lambda Entrypoint)
   - Bắt buộc cài đặt thư viện `@fastify/aws-lambda`.
   - Gọi `createApp()`.
   - Trả về proxy handler bằng `awsLambdaFastify(instance)`.
   - Export `handler` để AWS API Gateway/Lambda kích hoạt.
   - **BẮT BUỘC** dùng proper types `APIGatewayProxyEvent`, `Context` từ `aws-lambda` — không dùng `any`.

## 🔧 Bootstrap Checklist

Khi tạo service mới hoặc review, kiểm tra tất cả các điểm sau:

| Hạng mục | Fastify thuần | NestJS |
|---|---|---|
| `genReqId` từ `x-request-id` header | `Fastify({ genReqId: ... })` | `new FastifyAdapter({ genReqId: ... })` |
| Logger conditional (test vs prod) | `...(isTest ? { logger: false } : { loggerInstance })` | `new FastifyAdapter({ logger: false })` + nestjs-pino |
| `bodyLimit` | `2 * 1024 * 1024` (2MB) | `10 * 1024 * 1024` (10MB, vì upload) |
| Env validation | Zod schema validate **tất cả** critical vars | `validate()` function với Zod schema |
| `/health` | `{ config: { skipResponseWrapper: true } }` + DB check | `@Res()` bypass interceptor + DB check |
| `/metrics` | `{ config: { skipResponseWrapper: true } }` + prom-client | `@Res()` bypass interceptor + manual Prometheus format |
| Bootstrap error | `.catch(err => { console.error; process.exit(1) })` | idem |

## ⚠️ Gotchas

- **Fastify logger**: KHÔNG truyền cả `logger` và `loggerInstance` cùng lúc — dùng `...(isTest ? { logger: false } : { loggerInstance })`. Vi phạm → `FST_ERR_LOG_LOGGER_AND_LOGGER_INSTANCE_PROVIDED`.
- **Fastify response hook**: Route `/health` và `/metrics` phải có `config: { skipResponseWrapper: true }` (Fastify) hoặc dùng `@Res()` (NestJS) để bypass response wrapper — nếu không sẽ throw `ResponseFormatError` → 500.
- **Env validation**: `JWT_PUBLIC_KEY` và `DATABASE_URL` phải validate tại startup — không dùng `|| ''` fallback silent.

## 📦 Shared HTTP Utilities — BẮT BUỘC

Mọi microservice phải dùng 3 utility functions từ `shared-kernel` thay vì tự implement response shape:

```ts
// Error handler (Fastify) / Exception filter (NestJS)
import { buildErrorBody, httpStatusToCode } from '@distributed-social-platform/shared-kernel'
reply.status(status).send(buildErrorBody({ code, message, details, requestId: req.id }))

// Response wrapper (Fastify hook) / NestJS interceptor
import { buildSuccessBody } from '@distributed-social-platform/shared-kernel'
return buildSuccessBody({ data, message, requestId: req.id })
```

**Lý do**: auth-service (Fastify hooks) và core-api (NestJS interceptors/filters) dùng cơ chế khác nhau → nếu mỗi service tự build response shape sẽ drift theo thời gian. Chỉ `shared-kernel` là nguồn sự thật duy nhất.

## 🛠️ Quy Trình Tự Động / Execution
Nếu phát hiện một microservice vi phạm cấu trúc này, Agent phải:
1. Báo cáo các điểm sai lệch.
2. Tự động refactor lại các file về đúng cấu trúc trên.
3. Đảm bảo config Fastify được sao chép y hệt như tiêu chuẩn.
4. Đảm bảo cấu trúc thư mục bên trong (`src/modules/[module]/domain`, `application`, `infrastructure`, `presentation`) tuân thủ tuyệt đối quy tắc Hexagonal Architecture (như đã quy định tại `directives/cqrs_pattern.md`), áp dụng đồng bộ cho CẢ Fastify thuần và NestJS.
5. Chạy `npm run build` để xác nhận tính toàn vẹn.
