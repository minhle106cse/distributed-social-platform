# Folder Structure SOP — Distributed Social Platform

> **Đây là tài liệu bất biến (Immutable Directive).**
> Mọi service trong monorepo này PHẢI tuân thủ cấu trúc này.
> Agent KHÔNG ĐƯỢC phép tự ý tạo file/folder lệch khỏi cấu trúc mà không có sự chấp thuận của owner.

## Canonical `src/` Structure

```
src/
├── @types/                          # Augmented global type declarations (e.g. fastify.d.ts)
├── bootstrap/                       # App wiring: server setup, plugin registration, swagger
│   ├── fastify.ts                   # Fastify instance + plugin registration
│   ├── server.ts                    # listen(), graceful shutdown
│   └── swagger.ts                   # OpenAPI / Swagger setup
├── common/                          # Cross-cutting ABSTRACTIONS only — NO infrastructure code
│   │                                # ⚠️ Error base classes KHÔNG nằm ở đây — dùng packages/shared-kernel/src/errors/
│   ├── cqrs/                        # Command/Query bus abstractions & middlewares (PURE POJO ONLY)
│   │   ├── index.ts                 # ICommand, ICommandHandler, CommandBus, IEvent, EventBus
│   │   └── middlewares/             # NO @Injectable or NestJS decorators allowed here
│   │       ├── logging.middleware.ts
│   │       ├── retry.middleware.ts
│   │       └── transaction.middleware.ts
│   └── database/                    # DB abstractions only
│       ├── transaction-manager.interface.ts
│       └── transaction.context.ts
├── config/                          # Environment config loading & validation
├── container/                       # Manual DI wiring (bắt buộc vì Fastify không có DI)
│   ├── infra.ts                     # Wires infrastructure deps (repositories, services, logger)
│   └── application.ts               # Wires application layer (CommandBus, QueryBus, Handlers)
├── infrastructure/                  # Concrete implementations — framework-specific code ĐI VÀO ĐÂY
│   ├── database/
│   │   └── prisma/
│   │       ├── prisma.client.ts
│   │       ├── prisma-transaction-manager.ts
│   │       └── prisma-transient-error.ts
│   ├── http/                        # Fastify/HTTP-specific middleware, decorators, hooks
│   │   ├── decorators/
│   │   │   ├── authenticate.decorator.ts
│   │   │   └── authorize.decorator.ts
│   │   ├── filter/
│   │   │   └── global-error-handler.ts
│   │   └── hooks/
│   │       ├── http-logging.hook.ts
│   │       └── http-response.hook.ts

├── modules/                         # Feature modules — business logic by domain
│   └── <domain>/
│       ├── application/             # Application Layer (Orchestration & CQRS)
│       │   ├── commands/            # Command Handlers (Write Model)
│       │   ├── queries/             # Query Handlers (Read Model)
│       │   └── repositories/        # Query Repository Interfaces (returns DTOs)
│       ├── domain/                  # Domain Layer (Core Business Rules)
│       │   ├── entities/            # Aggregate Roots & Entities
│       │   ├── value-objects/       # Immutable Value Objects
│       │   └── repositories/        # Command Repository Interfaces (returns Entities)
│       ├── infrastructure/          # Infrastructure Layer (Concrete Implementations)
│       │   ├── mappers/             # Domain <-> Persistence Mappers
│       │   └── repositories/        # Concrete Prisma Repositories (Flat structure, both queries/commands)
│       └── presentation/            # UI/Delivery Layer
│           ├── routes/              # HTTP Routes (Fastify)
│           └── schemas/             # Zod Validation Schemas
├── app.ts                           # Root Fastify app factory
├── main.ts                          # Entrypoint (local)
└── main.lambda.ts                   # Entrypoint (AWS Lambda)
```

---

## ⛔ Forbidden Patterns — NEVER DO

| Sai lầm | Tại sao sai |
|---|---|
| Đặt filter/interceptor/hook Fastify vào `common/` | `common/` chỉ chứa ABSTRACTION, không chứa infrastructure framework cụ thể |
| Đặt Prisma module/service vào thư mục riêng `prisma/` ở root src | Prisma là infrastructure detail → phải nằm trong `infrastructure/database/prisma/` |
| Đặt logger concrete implementation vào `common/logger/` | `common/` chứa interface, implementation dùng chung đã nằm trong `packages/shared-kernel` |
| Đặt `ILogger` interface bên trong một service app (e.g. `auth-service/src/common/logger.ts`) | Interface dùng chung phải nằm trong `packages/shared-kernel` |
| Đặt error base classes vào `common/errors/` trong service | Tất cả error base classes (`AppError`, `DomainError`, `ApplicationError`, `InfrastructureError`, `ResponseFormatError`) đều nằm trong `packages/shared-kernel/src/errors/` — import từ `@distributed-social-platform/shared-kernel` |
| Tạo folder ngoài 5 thành phần chính khi không có lý do cụ thể | Phá vỡ tính nhất quán giữa các service |

---

## 5 Thành Phần Chính & Trách Nhiệm

| Thư mục | Vai trò | Được phép import |
|---|---|---|
| `bootstrap/` | Khởi động app, đăng ký plugin Fastify | `infrastructure/`, `config/`, `container/` |
| `common/` | Abstractions, interfaces, pure utilities | `packages/shared-kernel` ONLY |
| `config/` | Env loading, validation (Zod) | `packages/shared-kernel` |
| `infrastructure/` | Framework-specific implementations (Prisma, Fastify hooks, Pino) | `common/`, `packages/shared-kernel` |
| `modules/` | Business logic theo từng domain | `common/`, `packages/shared-kernel` |
| `container/` | Manual DI wiring (Fastify không có DI) | `infrastructure/`, `modules/`, `packages/shared-kernel` |

---

## core-api vs auth-service — Trạng Thái Đồng Bộ

> Trạng thái tính đến 2026-06-01: `core-api` đã được refactor thành công để tuân thủ kiến trúc chuẩn.

- Toàn bộ các component infra (Prisma, Logger, HTTP Interceptors, Filters) đã được di dời từ `common/` sang `infrastructure/`.
- CQRS buses ở `common/cqrs/` đã trở thành Pure POJO, framework module được đẩy sang `infrastructure/cqrs/`.
- **Lưu ý:** `core-api` là NestJS app nên sử dụng `infrastructure/http/interceptors` thay vì `hooks` (như trong Fastify thuần của `auth-service`), và dùng cơ chế DI Module của NestJS thay vì thư mục `container/` thủ công.

---

## Khi Agent Tạo File Mới

**Checklist bắt buộc trước khi tạo bất kỳ file nào:**

1. File này là **abstraction/interface** hay **implementation**?
   - Interface → `common/`
   - Implementation (có import Prisma/Fastify/Pino/...) → `infrastructure/`
2. File này là **framework-specific HTTP concern** (filter, hook, decorator)?
   - → `infrastructure/http/`
3. File này là **cross-service contract**?
   - → `packages/shared-kernel`
4. File có thuộc về một **feature domain** cụ thể?
   - → `modules/<domain>/`
5. Cấu trúc của service này có đồng bộ với auth-service chưa?
   - Đối chiếu với bảng 5 thành phần chính ở trên trước khi commit.
