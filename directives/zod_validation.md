# SOP: Validation & Swagger Standards

> [!NOTE]
> This directive sets the schema-validation standard and the automatic Swagger API documentation
> generated from Zod, across the whole monorepo.

## 🎯 Goal

Every API validates its input/output strictly (type-safe), and the Swagger documentation always
stays in sync with the real code. Never hand-write Swagger.

## 📜 Rules

### 1. Zod is always the single source of truth

Whether a microservice uses plain Fastify or NestJS, Zod is the only library allowed for defining
data schemas.

- Do not use `class-validator` (slow, and fiddly to configure).
- Do not use `typebox` (already standardised on Zod).

### 2. Schema file format

- Location: `src/modules/<module-name>/presentation/schemas/<action>.schema.ts`
- `body`, `querystring`, `params` and `response` must be grouped into one larger configuration
  object (the route schema).

**Standard example (Fastify):**

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

### 3. Wiring the schema into routes / controllers

- **Fastify**: use object spreading (`...loginSchema`)

```typescript
fastify.post('/login', {
  schema: {
    description: 'Login to app',
    tags: ['auth'],
    ...loginSchema // TRICK: spread it to load the whole body/response set at once
  }
}, handler)
```

- **NestJS**: use the `nestjs-zod` library to build the DTO (`createZodDto`) plus a global
  `ZodValidationPipe`.

**Standard example (NestJS):**

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

// The DTO used in the controller — validated automatically by the global ZodValidationPipe
export class CreateKnowledgeItemDto extends createZodDto(CreateKnowledgeItemSchema) {}
```

```typescript
// Controller — no @UsePipes needed, and no hand-written type on @Body()
@Post()
async create(@Body() dto: CreateKnowledgeItemDto) {
  // dto is already validated and correctly typed
}
```

> `ZodValidationPipe` is registered globally in `server.ts`
> (`app.useGlobalPipes(new ZodValidationPipe())`). No per-controller `@UsePipes` required.

### 4. Zod is the ONLY place input is validated — domain/entity does NOT validate input

> ⛔ **RULE (settled):** all input validation (presence, format, length, range, non-blank) lives
> **only** in Zod, at the **input boundary**. **Forbidden**: `if (!x.trim()) throw`, or any input
> check inside an entity factory / domain code.

- **Why:** one source of truth for input validation → no drift, no validating in two places. The
  domain **TRUSTS** that input is already clean by the time it arrives.
- **Every input door has Zod**, not just HTTP: HTTP body/params/query, **event consumers** (Kafka),
  and commands — validated with Zod *before* an entity is constructed. (That is what lets the
  domain avoid defending itself on non-HTTP paths.)
- A factory only enforces **type/structural invariants** (e.g. the compile-time
  `ManageableOrgRole = Exclude<OrgRole,'OWNER'>`) plus intention-revealing construction — it does
  NOT validate input values. See `domain_modeling.md` §1.
- **DB constraints** (`NOT NULL`, unique, FK, enum) are the final net, not a substitute for Zod.

> ⚠️ **Non-blank gotcha — `.trim()` ordering matters:**
> - `z.string()` accepts both `""` and `"   "`. `z.string().min(1)` still lets `"   "` through
>   (length 3 ≥ 1).
> - ✅ Correct: `z.string().trim().min(1)` — `.trim()` transforms FIRST → `"   "` → `""` → fails.
>   Bonus: normalises leading/trailing whitespace before storage.
> - ❌ Wrong: `z.string().min(1).trim()` — checks the raw string (passes), then trims, storing `""`.

## 🛠️ Execution & Automation

When writing a new API:

1. Create the schema file first.
2. Use the execution script (if one exists) or copy the standard syntax from an existing API.
3. Check Swagger `/docs` by hand or via a unit test to confirm the schema renders correctly.
