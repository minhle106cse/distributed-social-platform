# CQRS Middleware Pipeline with AsyncLocalStorage

**Date**: May 2026  
**Target**: `@distributed-social-platform/auth-service`  
**Status**: ✅ IMPLEMENTED — See `apps/auth-service/src/common/cqrs/` and `apps/auth-service/src/infrastructure/`

---

## Problem

In a strict Hexagonal Architecture, the Application layer (Command Handlers) uses Domain Repositories via Interfaces. It does not know about the database connection or ORM.

When implementing cross-cutting concerns like Transactions using a `CommandBus` Middleware, most ORMs (like Prisma) require you to pass a transaction client (`tx`) explicitly to the repository functions (e.g. `tx.user.create()`).  
Doing this forces us to change the Repository Interface to accept a Prisma-specific object, which **completely breaks Hexagonal Architecture** and pollutes the Domain layer with Infra concerns.

---

## Solution: ITransactionManager + AsyncLocalStorage

Two decoupling layers work together:

1. **`ITransactionManager`** (in `common/database/`) — an abstract interface so `TransactionMiddleware` never imports Prisma.
2. **`AsyncLocalStorage`** (in `common/database/transaction.context.ts`) — implicitly passes the transaction client through the call stack without altering function signatures.

### 1. The Abstract Interface (`common/database/transaction-manager.interface.ts`)
```typescript
export interface ITransactionManager {
  run<R>(callback: () => Promise<R>): Promise<R>;
}
```

### 2. The Context Manager (`common/database/transaction.context.ts`)
```typescript
import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaClient } from '@/generated';

export type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const transactionContext = new AsyncLocalStorage<PrismaTransactionClient>();

export function getTx(): PrismaTransactionClient | undefined {
  return transactionContext.getStore();
}

export function runInTransaction<R>(tx: PrismaTransactionClient, callback: () => Promise<R>): Promise<R> {
  return transactionContext.run(tx, callback);
}
```

### 3. The Middleware (`common/cqrs/middlewares/transaction.middleware.ts`)
> ⚠️ This middleware NEVER imports Prisma. It only knows `ITransactionManager`.
```typescript
export class TransactionMiddleware implements ICommandMiddleware {
  constructor(
    private readonly transactionManager: ITransactionManager, // Abstract — NOT PrismaClient
    private readonly logger: ILogger,
  ) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    if (!command.options?.transactional) {
      return next(); // Skip if command didn't opt in
    }
    return this.transactionManager.run(async () => {
      const result = await next();
      return result;
    });
  }
}
```

### 4. The Infra Implementation (`infrastructure/database/prisma/prisma-transaction-manager.ts`)
```typescript
export class PrismaTransactionManager implements ITransactionManager {
  constructor(private readonly prisma: PrismaClient) {}

  run<R>(callback: () => Promise<R>): Promise<R> {
    return this.prisma.$transaction(
      (tx) => runInTransaction(tx, callback),
      { timeout: 10000 }
    );
  }
}
```

### 5. The Repository (Infra Layer)
```typescript
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(user: User): Promise<void> {
    const db = (getTx() ?? this.prisma) as PrismaClient; // 💡 Gets tx if inside transaction, else uses default client
    const data = UserMapper.toCreatePersistence(user);
    await db.user.create({ data });
  }
}
```

### 6. Composition Root (`container/usecases.ts`)
> This is the ONLY file in the entire codebase that knows both sides (abstract + concrete).
```typescript
const transactionManager = new PrismaTransactionManager(infra.prisma); // Infra knows Prisma
commandBus.use(new TransactionMiddleware(transactionManager, infra.logger)); // Middleware only knows Interface
```

---

## Command Metadata Pattern

Each command declares which middleware behaviors it opts into via `options`:

```typescript
export class RefreshCommand implements ICommand {
  readonly name = 'RefreshCommand';
  /**
   * MUST be transactional: marks old token as used AND creates new one.
   * If create fails without transaction, user loses access permanently.
   */
  readonly options: CommandOptions = { transactional: true, retryable: true };
  constructor(...) {}
}
```

Middlewares check `command.options` at runtime and skip themselves if not applicable:
```typescript
if (!command.options?.transactional) return next(); // Bypass instantly
```

---

## Retry Middleware

The `RetryMiddleware` is ORM-agnostic via an injected predicate:

```typescript
export class RetryMiddleware implements ICommandMiddleware {
  constructor(
    private readonly logger: ILogger,
    private readonly isTransientError: (error: unknown) => boolean, // Injected predicate
    private readonly maxRetries = 3,
    private readonly baseDelayMs = 100,
  ) {}
}
```

The Prisma-specific predicate (`isPrismaTransientError`) lives in `infrastructure/database/prisma/` and is injected at the Composition Root.

**Key Property:** When `RetryMiddleware` retries a command, it calls `next()` again — which re-triggers `TransactionMiddleware` — which starts a **brand new** DB transaction for the retry attempt. This is automatic and consistent.

---

## Final Pipeline Order

```
CommandBus.execute(command)
  → LoggingMiddleware      (always applies)
  → RetryMiddleware        (if command.options.retryable)
  → TransactionMiddleware  (if command.options.transactional)
  → Handler.execute()
```

The order is critical: Retry wraps Transaction so a retry creates a fresh transaction.
