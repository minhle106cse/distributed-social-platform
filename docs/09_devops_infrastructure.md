# 🐳 DevOps & Local Infrastructure (Quy chuẩn Môi trường)

Hướng dẫn setup môi trường Local và quy chuẩn quản lý Monorepo bằng Turborepo.

---

## 1. Cấu trúc Thư mục Monorepo (Turborepo)
- `apps/`
  - `web/`: Next.js Web App (Frontend).
  - `core-api/`: NestJS API Backend xử lý Logic Nghiệp vụ.
  - `auth-service/`: Fastify Microservice (Identity).
- `packages/`
  - `shared-kernel/`: Abstraction, Interface, Types chung.
  - `logger/`: Common logging package (Pino).
  - `event-contracts/`: Định nghĩa Schema cho Kafka Events.

## 2. Docker Compose (Local Environment)
Yêu cầu phải có Docker Desktop và Node.js v18+.
Để khởi động toàn bộ hạ tầng (Không bao gồm API Code):
```bash
docker-compose up -d
```
Hệ thống sẽ chạy:
- **Postgres (5432):** Database.
- **Redis (6379):** Caching & WebSockets.
- **Kafka (9092) & Zookeeper (2181):** Event Broker.
- **Elasticsearch (9200):** Full-text Search.

## 3. Environment Variables (Biến môi trường)
Tất cả các file `.env` không được commit lên Git. Cần copy từ `.env.example`.
Các biến bắt buộc cho Backend:
```env
# Database
DATABASE_URL="postgresql://root:rootpassword@localhost:5432/core_db?schema=public"

# Redis
REDIS_HOST="localhost"
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS="localhost:9092"
KAFKA_CLIENT_ID="core-api-client"

# JWT Auth
JWT_SECRET="super-secret-key"
JWT_EXPIRATION="15m"
```

## 4. CI/CD Pipeline Flow
1. **Lint & Type Check:** Chạy `pnpm turbo run lint type-check` trên các PR.
2. **Test:** Chạy Unit & Integration Test (`pnpm turbo run test`).
3. **Build:** Chạy `pnpm turbo run build` để đóng gói các App.
4. **Deploy:** Deploy `apps/web` lên Vercel, và build Docker Image cho `apps/core-api` push lên AWS ECR.
