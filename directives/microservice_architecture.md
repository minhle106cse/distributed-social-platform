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

5. **`src/main.lambda.ts`** (AWS Lambda Entrypoint)
   - Bắt buộc cài đặt thư viện `@fastify/aws-lambda`.
   - Gọi `createApp()`.
   - Trả về proxy handler bằng `awsLambdaFastify(instance)`.
   - Export `handler` để AWS API Gateway/Lambda kích hoạt.

## 🛠️ Quy Trình Tự Động / Execution
Nếu phát hiện một microservice vi phạm cấu trúc này, Agent phải:
1. Báo cáo các điểm sai lệch.
2. Tự động refactor lại các file về đúng cấu trúc trên.
3. Đảm bảo config Fastify được sao chép y hệt như tiêu chuẩn.
4. Chạy `npm run build` để xác nhận tính toàn vẹn.
