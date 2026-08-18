# SOP: Database & Prisma Standard

> [!NOTE]
> This directive sets the database-schema design and Prisma ORM conventions for the whole
> microservices project — consistent data types, indexing, and clone/deploy safety.

## 🎯 Goal

One agreed standard for naming conventions, primary-key type, the soft-delete mechanism, and the
auto-generation scripts for the Prisma Client.

## 📜 Required Architecture & Conventions

### 1. Naming Conventions

- **Model Name:** PascalCase (e.g. `User`, `RefreshToken`).
- **Field Name:** camelCase (e.g. `createdAt`, `fullName`).
- **Database Column/Table:** MUST use the `@map` / `@@map` attribute to map down to `snake_case` in
  the database. This keeps the DB readable by plain-SQL conventions while TS code stays camelCase.

```prisma
model RefreshToken {
  id        String   @id @default(uuid())
  tokenHash String   @unique @map("token_hash")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("refresh_tokens")
}
```

### 2. Primary Keys

- **Never use** `autoincrement()` in a distributed (microservices) system.
- Primary keys are always `String`, generated with `uuid()` or `cuid()`, to avoid ID collisions when
  scaling the database or merging data.

```prisma
id String @id @default(uuid())
```

### 3. Data Lifecycle (Soft Delete)

- Avoid hard `DELETE`. Use a `deletedAt DateTime? @map("deleted_at")` column on important models
  (Organization, Space, KnowledgeItem, …). (Distinct from `isActive` = temporarily disabled — see
  the lesson in `KNOWLEDGE_INDEX`.)
- **The `deletedAt: null` filter is AUTOMATIC, never hand-written in a repository.** Both services
  have a Prisma Client Extension (`$extends` in `PrismaService`) that auto-injects `deletedAt: null`
  for the models listed in `SOFT_DELETE_MODELS`, on `findUnique`/`findFirst`/`findMany`/`count`
  only.
  - auth-service: `infrastructure/database/prisma/prisma.client.ts` (`['User','Role','Permission']`).
  - core-api: `infrastructure/database/prisma/prisma.service.ts` (`['Organization','Space']`) —
    **composition**: `rawClient` (lifecycle, raw SQL) + `client` (extended); repositories use
    `getTx() ?? this.prisma.client`; the transaction manager calls `this.prisma.client.$transaction`
    so `tx` inherits the filter too.
  - ⚠️ **Adding a new soft-deletable model → ADD its name to `SOFT_DELETE_MODELS`** (only models
    that genuinely have a `deletedAt` column, or the query errors).
  - **Escape hatch:** pass a `deletedAt` key explicitly in `where` (even `undefined`) → the
    extension does NOT override it → use this for restore flows / looking up deleted records.
  - **Limitation:** the extension does NOT filter `update`/`updateMany`/`delete`, and does not touch
    raw SQL — be deliberate about write operations.
- **A field that is UNIQUE and soft-deletable → use a PARTIAL unique index, not a full `@unique`.**
  `@@unique([slug], where: { deletedAt: null })` (requires `previewFeatures = ["partialIndexes"]` in
  the generator block). Why: a full `@unique` counts deleted rows too → (1) the slug is "burned"
  permanently, and (2) it diverges from the application check (`findBySlug` only sees live rows), so
  creating a new one reports "available" while the DB throws `P2002`. A partial index enforces
  uniqueness ONLY over non-deleted rows → the slug is released on delete and matches the app check.
  Example: `Organization.slug`. (Prisma `db push` can create it; a partial unique does NOT appear in
  `WhereUniqueInput`, so query it with `findFirst`, not `findUnique`.)

### 4. Prisma Client Generation

- Prisma emits its typings into `node_modules` or a custom directory (e.g. `src/generated`). That
  directory is not committed to Git (blocked by `.gitignore`), so it causes "Cannot find module"
  errors when a developer clones the repo or runs a fresh Docker build.
- **Required**: a `postinstall` script in the `package.json` of every microservice using Prisma:

```json
"scripts": {
  "postinstall": "npx prisma generate"
}
```

### 5. Prisma v7+ — `prisma.config.ts` (BREAKING CHANGE)

> [!WARNING]
> As of **Prisma v7**, the `url = env("DATABASE_URL")` property inside `schema.prisma`'s
> `datasource` block is **no longer supported** (error code `P1012`). This is a significant
> breaking change.

**Required standard for every service on Prisma v7+:**

1. **`schema.prisma`** — NO `url`:

```prisma
datasource db {
  provider = "postgresql"
}
```

2. **`prisma.config.ts`** — declare the URL here (supports the Neon DB connection pool):

```typescript
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // The Prisma CLI always needs a direct connection to run DB push/migrate.
    // In production (Neon) it takes DIRECT_URL; on local Docker it falls back to DATABASE_URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  }
})
```

3. **Runtime client init**: when constructing `PrismaClient` in code, pass the pooled URL
   (`DATABASE_URL`) to the constructor:

```typescript
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})
```

### 6. Port Conflict — Docker Postgres

> [!IMPORTANT]
> Port `5432` (default Postgres) is commonly taken by a host-installed Postgres. This project uses
> **port `15432`** to avoid the conflict. Standard config:

- `docker-compose.yml`: `"${DB_PORT:-15432}:5432"`
- root `.env`: `DB_PORT=15432`
- each service's `.env`: `DATABASE_URL=...@localhost:15432/...`
