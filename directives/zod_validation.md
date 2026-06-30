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
- **NestJS**: Sử dụng thư viện `nestjs-zod` để tạo DTO (`createZodDto`) và `ZodValidationPipe` (global).

**Ví dụ chuẩn (NestJS):**
```typescript
// modules/knowledge/presentation/schemas/create-knowledge-item.schema.ts
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const CreateKnowledgeItemSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  spaceId: z.string().uuid(),
  tags: z.array(z.string()).optional().default([]),
})

// DTO dùng trong Controller — tự động validate bởi ZodValidationPipe global
export class CreateKnowledgeItemDto extends createZodDto(CreateKnowledgeItemSchema) {}
```

```typescript
// Controller — KHÔNG cần @UsePipes hay @Body() với type thủ công
@Post()
async create(@Body() dto: CreateKnowledgeItemDto) {
  // dto đã được validate và typed đúng
}
```

> `ZodValidationPipe` được đăng ký global trong `server.ts` (`app.useGlobalPipes(new ZodValidationPipe())`).
> Không cần thêm `@UsePipes` ở từng controller.

### 4. Zod là nơi DUY NHẤT validate input — domain/entity KHÔNG validate input

> ⛔ **RULE (đã chốt):** Mọi validation đầu vào (presence, format, length, range, non-blank) **chỉ** nằm ở Zod tại **input boundary**. **Cấm** `if (!x.trim()) throw` hay bất kỳ kiểm tra input nào trong entity factory / domain.

- **Lý do:** một nguồn sự thật duy nhất cho input validation → không drift, không validate 2 nơi. Domain **TIN** rằng input đã sạch khi tới tay nó.
- **Mọi cửa nhận input đều có Zod**, không chỉ HTTP: HTTP body/params/query, **event consumer** (Kafka), command — validate bằng Zod *trước* khi dựng entity. (Nhờ vậy domain không cần tự thủ cho path non-HTTP.)
- Factory chỉ giữ **bất biến type/structural** (vd `ManageableOrgRole = Exclude<OrgRole,'OWNER'>` compile-time) + intention-revealing — KHÔNG validate giá trị input. Xem `domain_modeling.md` §1.
- **DB constraint** (`NOT NULL`, unique, FK, enum) là lưới cuối cùng, không thay cho Zod.

> ⚠️ **Gotchá non-blank — thứ tự `.trim()` quan trọng:**
> - `z.string()` chấp nhận cả `""` lẫn `"   "`. `z.string().min(1)` vẫn cho `"   "` lọt (length 3 ≥ 1).
> - ✅ Đúng: `z.string().trim().min(1)` — `.trim()` biến đổi TRƯỚC → `"   "` → `""` → fail. Bonus: chuẩn hoá khoảng trắng đầu/cuối khi lưu.
> - ❌ Sai: `z.string().min(1).trim()` — check trên chuỗi gốc (pass) rồi mới trim → lưu `""`.

## 🛠️ Execution & Tự động hoá
Nếu viết API mới:
1. Tạo schema file trước.
2. Dùng Execution script (nếu có) hoặc copy cú pháp chuẩn từ các API hiện tại.
3. Test Swagger `/docs` bằng tay hoặc qua Unit Test để đảm bảo schema hiển thị đúng.
