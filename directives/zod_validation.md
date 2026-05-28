# SOP: Validation & Swagger Standards

> [!NOTE]
> Directive này quy định chuẩn thiết kế Schema Validation và tự động tạo Swagger API Documentation bằng Zod cho toàn bộ Monorepo.

## 🎯 Goal
Đảm bảo 100% các API đều được validate đầu vào/ra một cách chặt chẽ (Type-safe) và tài liệu Swagger luôn đồng bộ với code thật. Không viết Swagger thủ công.

## 📜 Luật Lệ (Rules)

### 1. Luôn sử dụng Zod làm Single Source of Truth
Bất kể microservice dùng Fastify thuần hay NestJS, Zod là thư viện duy nhất được phép dùng để định nghĩa Data Schema.
- Không dùng `class-validator` (chậm và cấu hình lằng nhằng).
- Không dùng `typebox` (đã thống nhất chuyển sang Zod).

### 2. Định dạng file Schema
- Nơi lưu trữ: `src/modules/<module-name>/presentation/schemas/<action>.schema.ts`
- Phải gom nhóm cả `body`, `querystring`, `params` và `response` vào chung một cấu hình lớn (Route Schema).

**Ví dụ chuẩn (Fastify):**
```typescript
export const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
  response: {
    200: z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
    })
  }
}
```

### 3. Cách cắm Schema vào Routes / Controller
- **Fastify**: Sử dụng object spreading (`...loginSchema`)
```typescript
fastify.post('/login', {
  schema: {
    description: 'Login to app',
    tags: ['auth'],
    ...loginSchema // TRICK: Trải mảng để nạp toàn bộ body/response vào
  }
}, handler)
```
- **NestJS**: Sử dụng thư viện `nestjs-zod` để tạo DTO (`createZodDto`) và `@UseZodGuard`.

## 🛠️ Execution & Tự động hoá
Nếu viết API mới:
1. Tạo schema file trước.
2. Dùng Execution script (nếu có) hoặc copy cú pháp chuẩn từ các API hiện tại.
3. Test Swagger `/docs` bằng tay hoặc qua Unit Test để đảm bảo schema hiển thị đúng.
