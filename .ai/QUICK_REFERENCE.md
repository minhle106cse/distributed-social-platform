> ⚠️ **Cached summary** — `directives/` là nguồn authority. Khi sửa directive liên quan, sync lại file này (nó được inject vào KNOWLEDGE_INDEX §4). Trước đây block này hardcode trong `knowledge_builder.py`; nay tách ra markdown để editable + diffable.

These are the most frequently needed rules, extracted from directives:

### Folder Structure (`folder_structure_sop.md`)
```
src/
├── @types/           # Augmented global types
├── bootstrap/        # App wiring: server, plugins, swagger
├── common/           # ABSTRACTIONS ONLY — NO infrastructure code
│   ├── cqrs/         # Pure POJO command/query bus & middlewares
│   ├── database/     # DB abstractions (ITransactionManager, AsyncLocalStorage context)
│   └── errors/       # Domain/Application error base classes
├── config/           # Env loading & validation (Zod)
├── container/        # Manual DI wiring (Fastify only, NestJS uses Modules)
├── infrastructure/   # Concrete implementations (Prisma, Fastify hooks, Pino logger)
├── modules/          # Feature modules by domain
│   └── <domain>/
│       ├── domain/           # Entities, Value Objects, Repo Interfaces (PURE TS)
│       ├── application/      # Command/Query Handlers (orchestration via interfaces)
│       ├── infrastructure/   # Concrete repos (PrismaXxxRepository), mappers
│       └── presentation/     # Routes/Controllers, Zod schemas
├── app.ts            # Root app factory (createApp)
├── main.ts           # Local entrypoint (listen)
└── main.lambda.ts    # AWS Lambda entrypoint
```

### CQRS Pipeline (`cqrs_pattern.md`)
- Pipeline order: `LoggingMiddleware → RetryMiddleware → TransactionMiddleware → Handler`
- Retry wraps Transaction → each retry gets a fresh DB transaction
- Commands opt-in via `options: { transactional: true, retryable: true }`
- TransactionMiddleware uses `ITransactionManager` (abstract) + `AsyncLocalStorage`
- Repositories use `getTx() ?? this.prisma` — zero signature changes

### Database (`database_standard.md`)
- Primary keys: UUID (`@default(uuid())`), NEVER `autoincrement()`
- Naming: camelCase in code, `@map("snake_case")` in DB
- Soft delete: `deletedAt DateTime?` for important models
- Prisma v7: NO `url` in `schema.prisma`, use `prisma.config.ts`
- Port: `15432` (not default 5432)

### Testing (`testing_standard.md`)
- Co-location: `*.spec.ts` next to source file
- Mock pattern: `jest.Mocked<Interface>` with `as unknown as` cast
- ESM libraries: `jest.mock('uuid', () => ({ v7: jest.fn(() => 'mock-uuid') }))`
- Path alias: `@/` mapped via `moduleNameMapper`

### Validation (`zod_validation.md`)
- Zod is the ONLY validation library (no class-validator, no typebox)
- Schema location: `modules/<module>/presentation/schemas/<action>.schema.ts`

### Logging (`logging_standard.md`)
- Dual-layer: HTTP hooks + CQRS LoggingMiddleware
- Use `createLogger(serviceName)` from shared-kernel
- NEVER `console.log`

### Security
- CORS origins from env vars, NEVER `['*']`
- Mandatory: `@fastify/helmet`, `@fastify/compress`, `@fastify/rate-limit`
