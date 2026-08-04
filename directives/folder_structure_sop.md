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
│       │   ├── events/             # Integration-event Handlers (consumer services) †
│       │   └── repositories/        # Query Repository Interfaces (returns DTOs)
│       ├── domain/                  # Domain Layer (Core Business Rules) — PURE TS, no NestJS
│       │   ├── entities/            # Aggregate Roots & Entities
│       │   ├── value-objects/       # Immutable Value Objects
│       │   ├── services/           # Domain services + OUTBOUND service ports (interfaces) †
│       │   └── repositories/        # Command Repository Interfaces (returns Entities)
│       ├── infrastructure/          # Infrastructure Layer (Concrete Implementations)
│       │   ├── mappers/             # Domain <-> Persistence Mappers
│       │   ├── consumers/          # Kafka consumers (event-driven services) †
│       │   ├── services/           # Concrete adapters implementing domain service ports †
│       │   └── repositories/        # Concrete Prisma Repositories (Flat structure, both queries/commands)
│       └── presentation/            # UI/Delivery Layer
│           ├── routes/              # HTTP Routes (Fastify) / controllers (NestJS)
│           └── schemas/             # Zod Validation Schemas

# † Mở rộng owner-approved 2026-07-02 cho service consumer/AI (notification, search):
#   - application/events/     : handler cho integration event (IIntegrationEventHandler)
#   - domain/services/        : domain service THUẦN (vd TextChunker — KHÔNG @Injectable/NestJS)
#                               + PORT dịch vụ outbound (interface: IEmbeddingService, ISummarizerService)
#   - infrastructure/services/: adapter cụ thể của port (HttpEmbedding, ClaudeSummarizer, GeminiSummarizer…)
#   - infrastructure/consumers/: Kafka consumer (KnowledgeIndexerConsumer, NotificationEventsConsumer)
#   Service projection/search KHÔNG có domain entity → domain/ chỉ có services/ (không entities/repositories).
#   ⚠️ domain/ pure TS: domain service THUẦN bỏ @Injectable (Nest vẫn DI-instantiate class 0-tham-số).
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

> Trạng thái tính đến 2026-06-25: `core-api` tuân thủ kiến trúc chuẩn, ngang `auth-service` về layering, và **đã được lint enforce** (xem §Enforcement bên dưới).

- Toàn bộ các component infra (Prisma, Logger, HTTP Interceptors, Filters) đã được di dời từ `common/` sang `infrastructure/`.
- CQRS buses ở `common/cqrs/` đã trở thành Pure POJO, framework module được đẩy sang `infrastructure/cqrs/`.
- **Re-audit `modules/tenant` (2026-06-25):** sửa 3 vi phạm còn sót — `OrgGuard`/`TenantInterceptor` rời `common/` về `infrastructure/http/`; `OrgGuard` đi qua `IMembershipRepository` thay vì query Prisma thẳng; handler dùng `MembershipNotFoundError` thay vì `NotFoundException`. Dọn coupling: `org-permissions.ts` về `modules/tenant/domain/` (hết cycle domain↔common), `OrgContext` tách khỏi guard.
- **Lưu ý:** `core-api` là NestJS app nên sử dụng `infrastructure/http/interceptors` thay vì `hooks` (như trong Fastify thuần của `auth-service`), và dùng cơ chế DI Module của NestJS thay vì thư mục `container/` thủ công.

---

## 🔒 Enforcement — Lint-Enforced Boundaries (core-api)

> Tài liệu mô tả **ý định**; lint mới **bắt buộc**. Các ranh giới dưới đây được enforce qua
> `@typescript-eslint/no-restricted-imports` trong `apps/core-api/eslint.config.mjs`
> (bản `@typescript-eslint/` để bắt cả `import type` — type-only dependency xuyên layer vẫn là dependency).
> Vi phạm = **lint fail tại commit/CI**, kèm message tiếng Việt chỉ rõ cách sửa.

| Layer (`files`) | Cấm import | Được phép |
|---|---|---|
| `modules/*/domain/**` | NestJS, Fastify, Prisma/`@/generated`, mọi tầng ngoài (`@/common`, `@/infrastructure`, application/infra/presentation của module) | shared-kernel + relative cùng domain |
| `modules/*/application/**` | ORM/DB/HTTP infra; **HTTP exceptions** (`NotFoundException`…) từ `@nestjs/common` | repo interface; `@/infrastructure/cqrs` (decorators); `@nestjs/common` DI (`@Injectable`/`@Inject`) |
| `modules/*/presentation/**` | Prisma/`@/generated`, `@/infrastructure/database` | đẩy qua CommandBus/QueryBus |
| `common/**` | `@/modules`, `@/infrastructure`, NestJS, Fastify, Prisma | shared-kernel + relative |

**Ngoại lệ đã chốt (KHÔNG phải vi phạm):** `@Injectable()` / `@Inject()` / `@CommandHandler()` trong application layer là **idiom DI hợp lệ của NestJS** — chỉ HTTP exception mới bị cấm ở application. Đây là khác biệt framework, không phải lệch kiến trúc.

**Quy trình khuyến nghị khi tạo module mới trong core-api:** bật/khớp lint boundary *trước*, code *sau* — để chính cổng lint chặn ngay trong lúc sinh code, thay vì phát hiện khi audit về sau.

**Gate chất lượng (cả monorepo):** `npm run check` = `turbo run typecheck lint format:check` (read-only). `typecheck` = `tsc --noEmit` mỗi workspace — bắt lỗi biên dịch mà lint/format bỏ sót (lint chỉ bắt rule, không bắt TS2322…). Sửa nhanh: `npm run lint:fix` + `npm run format`.

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
6. (core-api) Chạy `npm run lint` trước khi commit — boundary rules ở §Enforcement sẽ tự chặn nếu đặt sai layer / import xuyên tầng.
