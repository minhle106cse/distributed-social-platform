# SOP: Unit Testing & Coverage Standard

> [!NOTE]
> This directive sets the unit-testing standard for every microservice in the project — code
> coverage, a consistent architecture, and the TypeScript/ESM obstacles you have to get past.
> Distilled after a self-annealing loop on Auth Service.

## 🎯 Goal

One agreed way to organise test files, mock objects, path aliases, and handle ESM libraries, so the
technical errors that show up when running Jest don't have to be rediscovered — and so an AI agent
and a developer stay in sync on how it's done.

## 📜 Required Test Architecture

### 1. Co-location strategy

- A test file (`*.spec.ts`) MUST sit **directly next to** its source file (e.g. `login.handler.ts`
  → `login.handler.spec.ts`).
- **Forbidden**: collecting unit tests into a `test/` or `tests/` folder at the service root. A
  `test/` folder scaffolded by a framework CLI is deleted, or kept exclusively for E2E tests
  (if any).

### 2. TypeScript mocking standard

- When mocking dependencies (repositories, services) to test a handler/use-case, use the
  type-safe cast:

```typescript
let mockPasswordService: jest.Mocked<PasswordService>;

beforeEach(() => {
  mockPasswordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as jest.Mocked<PasswordService>;
});
```

- This fully avoids strict TypeScript complaining about missing private/inherited properties of the
  real interface or class.

### 3. Import path alias rule (`@/`)

- Long relative paths are forbidden (e.g. `../../../../errors/auth.error`). Any import reaching
  outside the local directory cluster MUST use the `@/` alias.
- The service's `package.json` must configure Jest to resolve it:

```json
"jest": {
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/$1"
  }
}
```

### 4. Native ESM libraries (e.g. `uuid`)

- Many modern libraries have moved fully to ESM. Jest (running Node/CommonJS) then throws
  `SyntaxError: Unexpected token 'export'`.
- **Fix**: don't waste time swapping loaders — use `jest.mock` at module level, at the top of the
  spec file:

```typescript
jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid-v7')
}));
```

### 5. Testing the ESM package (`shared-kernel`) — different from a service

- Services (`apps/*`) are CommonJS → ts-jest's default config is fine.
- `packages/shared-kernel` is **ESM** (`"type": "module"` + NodeNext `tsconfig` + `.js`-suffixed
  imports). Jest runs a CJS runtime → ts-jest must be forced to emit CommonJS, otherwise you get
  `SyntaxError: Cannot use import statement`.
- Required config in shared-kernel's `package.json`:

```json
"jest": {
  "transform": {
    "^.+\\.(t|j)s$": ["ts-jest", {
      "diagnostics": { "ignoreCodes": [151002] },
      "tsconfig": { "module": "CommonJS", "moduleResolution": "node" }
    }]
  },
  "moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" }
}
```

  - The `tsconfig` override forces CommonJS (you must switch `moduleResolution` to `node` as well,
    or TS5110 fires because NodeNext requires `module: NodeNext`).
  - `moduleNameMapper` strips the `.js` so ts-jest resolves to the `.ts` source.
- **Keep specs out of the build**: add `"exclude": ["**/*.spec.ts"]` to the published package's
  `tsconfig.json` so test code never ships into `dist/`.

### 6. Required Jest config for EVERY service that consumes `shared-kernel` (core-api, notification-service, search-service, …)

- `shared-kernel` is ESM (NodeNext, `.js`-suffixed imports). Any class using the
  `@CommandHandler`/`@QueryHandler` decorators imports a constant from `shared-kernel` at
  **runtime** (not `import type`) — so writing a test for that handler triggers
  `SyntaxError: Unexpected token 'export'` if the Jest config is missing the two pieces below. This
  is a pre-existing config gap, not a bug in the test.
- Required in `package.json` → `jest`:

```json
"transform": {
  "^.+\\.(t|j)s$": ["ts-jest", {
    "diagnostics": { "ignoreCodes": [151002] },
    "tsconfig": { "module": "CommonJS", "moduleResolution": "node", "resolvePackageJsonExports": false }
  }]
},
"moduleNameMapper": {
  "^@/(.*)$": "<rootDir>/$1",
  "^(\\.{1,2}/.*)\\.js$": "$1",
  "^@distributed-social-platform/shared-kernel$": "<rootDir>/../../../packages/shared-kernel/src/index.ts",
  "^uuid$": "uuid"
},
"transformIgnorePatterns": ["node_modules/(?!uuid)"]
```

- `resolvePackageJsonExports: false` is only needed if the service's own tsconfig sets
  `resolvePackageJsonExports: true` (TS5098 when forcing `moduleResolution: node`).
- Full detail and reasoning: `.ai/memory/gotchas.jsonl`, "core-api had zero working Jest config…".
