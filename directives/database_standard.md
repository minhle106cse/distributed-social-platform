# SOP: Database & Prisma Standard

> [!NOTE]
> Directive này quy định chuẩn thiết kế Database Schema và thao tác với Prisma ORM cho toàn bộ dự án Microservices, đảm bảo tính nhất quán về kiểu dữ liệu, index, và an toàn khi clone/deploy.

## 🎯 Goal
Thống nhất chuẩn quy ước đặt tên (Naming Conventions), kiểu khóa chính (Primary Keys), cơ chế Soft Delete, và cấu trúc script tự động sinh (Auto-generation scripts) cho Prisma Client.

## 📜 Kiến Trúc & Quy Ước Bắt Buộc

### 1. Naming Conventions (Quy ước đặt tên)
- **Model Name:** PascalCase (VD: `User`, `RefreshToken`).
- **Field Name:** camelCase (VD: `createdAt`, `fullName`).
- **Database Column/Table:** Bắt buộc sử dụng attribute `@map` hoặc `@@map` để ánh xạ xuống Database dưới định dạng `snake_case`. Điều này giúp Database dễ nhìn hơn theo chuẩn SQL thuần, đồng thời code TS vẫn giữ được camelCase.
```prisma
model RefreshToken {
  id        String   @id @default(uuid())
  tokenHash String   @unique @map("token_hash")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("refresh_tokens")
}
```

### 2. Primary Keys (Khóa chính)
- **Tuyệt đối không dùng** `autoincrement()` cho các hệ thống phân tán (Microservices).
- Khóa chính luôn luôn dùng định dạng `String` với hàm gen `uuid()` hoặc `cuid()` để tránh đụng độ ID khi scale database hoặc merge data.
```prisma
id String @id @default(uuid())
```

### 3. Vòng đời dữ liệu (Soft Delete)
- Hạn chế sử dụng Hard Delete (`DELETE` vật lý) trong Database.
- Thay vào đó, thiết lập cột `deletedAt DateTime? @map("deleted_at")` cho các model quan trọng (Post, Comment, Profile).
- Mọi logic query ở Repo đều phải có filter `deletedAt: null`.

### 4. Prisma Client Generation
- Prisma xả thư viện typing ra `node_modules` hoặc thư mục tùy chỉnh (e.g. `src/generated`). Do thư mục này không được đưa lên Git (bị block bởi `.gitignore`), nó sẽ gây lỗi "Cannot find module" nếu có Dev clone code về hoặc chạy Docker build mới.
- **Bắt buộc** cài đặt script `postinstall` trong `package.json` của mọi Microservice có dùng Prisma:
```json
"scripts": {
  "postinstall": "npx prisma generate"
}
```

### 5. Prisma v7+ — `prisma.config.ts` (BREAKING CHANGE)
> [!WARNING]
> Từ **Prisma v7**, thuộc tính `url = env("DATABASE_URL")` trong khối `datasource` của `schema.prisma` **không còn được hỗ trợ** (lỗi code `P1012`). Đây là breaking change quan trọng.

**Chuẩn bắt buộc cho mọi service dùng Prisma v7+:**

1. **`schema.prisma`** — KHÔNG có `url`:
```prisma
datasource db {
  provider = "postgresql"
}
```

2. **`prisma.config.ts`** — Khai báo URL tại đây (Hỗ trợ Neon DB Connection Pool):
```typescript
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Prisma CLI luôn cần kết nối trực tiếp (Direct Connection) để chạy DB Push/Migrate.
    // Ở Production (Neon), nó sẽ lấy DIRECT_URL. Ở Local Docker, nó fallback về DATABASE_URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  }
})
```

3. **Runtime Client Init**: Khi khởi tạo PrismaClient trong code, truyền URL có pool (DATABASE_URL) vào constructor:
```typescript
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})
```

### 6. Port Conflict — Docker Postgres
> [!IMPORTANT]
> Port `5432` (default Postgres) thường bị chiếm bởi Postgres cài sẵn trên máy host. Dự án này dùng **port `15432`** để tránh xung đột. Cấu hình chuẩn:
- `docker-compose.yml`: `"${DB_PORT:-15432}:5432"`
- `.env` gốc: `DB_PORT=15432`
- `.env` mỗi service: `DATABASE_URL=...@localhost:15432/...`
