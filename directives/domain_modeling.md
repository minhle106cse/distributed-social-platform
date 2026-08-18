# SOP: Domain Modeling — Entity Factories & Persistence Boundary

> Applies to **every domain entity** in both services. Goal: entities are always
> **valid-by-construction**, with a clear split between **where to validate (WRITE)** and
> **where to trust (READ)**.

## 0. Entity = mutable + individual `_fields` (canonical style)

> This is the SETTLED style for both services. Reference implementation: `auth-service`
> (`role.entity.ts`, `refresh-token.entity.ts`). core-api (`modules/tenant`) has been realigned to
> match it.

- An entity is **mutable** and stores **individual private fields** (`private _id: string`,
  `private _role: OrgRole`), assigned in the constructor (`this._id = props.id`). Do **NOT** use a
  props-bag (`private readonly props: Props`).
- **Behaviour methods MUTATE in-place and enforce a rule on the same identity**, returning `void` —
  never `return new Entity(...)`:
  - ✅ `changeRole(role: ManageableOrgRole) { this._role = role }`, `invite.accept(userId)`,
    `token.revoke()`, `role.assignPermissions()` (dedupes).
  - ❌ `changeRole(role): Entity { return new Entity({ ...this.props, role }) }` (immutable
    "clone-on-change").
- **Mutable-typed** fields (`Date`, arrays) → **defensively clone at EVERY entry/exit point**:
  constructor, getter, **and any mutator that receives a collection**
  (`assignRoles(roles) { this._roles = [...roles] }` — not `this._roles = roles`). Cloning on the
  way in while the getter returns `this._x` directly (or a setter stores the caller's reference
  directly) is **half a measure** — the caller can still mutate internal state.
  - `Date`: `this._x = new Date(props.x.getTime())` / `return new Date(this._x.getTime())`
    (null-safe).
  - **Array = clone the container SHELL, do NOT deep-clone the elements** → `return [...this._arr]`
    (shallow). The point is to stop `getter.push()/splice()/sort()` from changing the internal
    collection's structure (adding/removing elements), NOT to protect each element. Because the
    elements are **immutable VOs/children** (`AuthIdentity` readonly fields, `UserProfile` sealed),
    sharing element references is safe — only the array shell needs cloning.
- **The real rule is about the SHAPE returned, not "mutable or not":**

  | Returns | Handling | Why |
  |---|---|---|
  | Array (collection) | clone the shell `[...this._x]` | an array is a mutable container → block add/remove, even if elements are immutable |
  | `Date` | clone `new Date(...)` | `Date` is a mutable object |
  | Single child entity (`profile`) | return directly | one reference, no container to guard; the exact identity is needed for `assignProfile`/`profile.update()` to compose |
  | Primitive (`string`/`number`/`boolean`) | return directly | already immutable, copy-by-value |

  > ⚠️ An array of **child entities** (e.g. `profiles: UserProfile[]`) **still** does `return [...]`
  > — even though `UserProfile` is immutable — because the point is protecting the *array*, not the
  > elements. "Return a single child entity directly" applies only to **one** single reference.
- **Identity: the entity OWNS its own id — the factory generates `v7()`, it does NOT accept an `id`
  from the caller.** (Underlying rule: "no sentinel, `entity.id == row.id`"; the way to get there is
  factory-generated v7.)
  - ✅ Use `v7()` (the `uuid` package) in the factory — time-ordered, good for B-tree index
    locality. The mapper persists that same id on INSERT. Examples: auth
    (`User`/`Role`/`Permission`) and core-api (`Organization`/`Space`/`Membership`/`OrgInvite`).
  - ❌ **FORBIDDEN: generating the id in the controller / caller** (`crypto.randomUUID()` in the
    controller, then passed into the command/factory). It's both the wrong layer (presentation
    deciding domain identity) and commonly the wrong version (random v4 instead of v7).
  - ❌ **FORBIDDEN: a sentinel `id: ''`** "for the DB to fill in later" (entity↔row divergence).
  - **Client needs the id immediately?** → the **handler RETURNS `entity.id`**, and the controller
    uses that value (`const id = await commandBus.execute<Cmd, string>(...)`). A CQRS handler
    returning a value is an established pattern here (`createInvite` returns a token).
    **Idempotency** uses `IdempotencyRecord` (the `Idempotency-Key` header), not an upfront id.
- **Why:** this is mainstream DDD (Evans — entities are mutable with identity/continuity; only
  Value Objects are immutable) and consistent with `event_sourcing.md` (`apply` mutates:
  `this.balance += amount`). Immutable + props-bag is a **debatable style choice, NOT a default
  "best practice"** — don't label it as one.
- The mapper's `toPersistence` reads through **getters** (`org.id`, `org.name`) — no
  `toSnapshot()`/props-bag needed.

## 0.1 `entities/` vs `aggregates/` — when to branch

> **There is no separate `aggregates/` folder — everything lives in `domain/entities/`.** The
> reasoning (settled after re-checking the DDD terminology): "aggregate root" is a **role**
> (consistency boundary + the single door for mutation), not a distinct kind of object —
> `Organization`/`Membership` are aggregate roots too, even though they aren't event-sourced. What
> genuinely differs between `CreditAccount` and the rest is a **second axis, independent of the
> "is it an aggregate root?" axis**: the storage mechanism — is state stored directly (one row) or
> derived from history (folding events)? Naming the folder "aggregates" tagged axis 1 when the
> thing that needed marking was axis 2 → the fix: **mark axis 2 with a file suffix**
> (`.aggregate.ts`), not with a folder. Real example:
> `modules/credit/domain/entities/credit-account.aggregate.ts`.
>
> **Two axes, independent of each other — don't conflate them when reasoning:**
> | Axis | Question | Value |
> |---|---|---|
> | 1. DDD role | "Is this an aggregate root?" | Always YES for every entity in `entities/` — not a distinguishing factor |
> | 2. Storage mechanism | "Is state stored directly, or derived from history?" | Ordinary entity = directly; event-sourced entity (`.aggregate.ts` suffix) = derived from events |
>
> Applied rule: **only use the `.aggregate.ts` suffix / the event-sourced pattern when the module is
> genuinely event-sourced** per the scope settled in `event_sourcing.md` (currently: Credit Economy;
> future: Reputation). Don't choose event-sourcing for a CRUD module just because it feels
> "important"/"complex" — business importance is not the criterion; needing
> replay-history-as-source-of-truth is.

The concrete differences on axis 2 (verified against the real code, not theory):

| | Ordinary entity (state-based) | Event-sourced entity (`.aggregate.ts` suffix) |
|---|---|---|
| How state is stored | current fields, overwritten in place (`UPDATE`) | folded from an event stream, never overwritten (`INSERT`-only) |
| What `rehydrate()` means | build the entity from **one DB row** (receives complete `props`) | **replay** — fold via `apply(event)` over each event in the stream |
| What `version` is for | row-level OCC, optional (`UPDATE ... WHERE version = expectedVersion`) | **mandatory** — it is the event's sequence number; OCC via `@@unique([aggregateId, version])` on INSERT |
| Mutating methods | mutate the field directly, `void` (`changeRole()`) | internally call `raise()` → create a new event → `apply()` folds it into state, and push it onto `uncommitted[]` |
| Extra requirements | none | `getUncommittedEvents()` (the repository reads it to persist), and an `open()` factory instead of `create()` (opening an empty wallet, not "creating" in the business sense) |

What is **absolutely identical** between the two — axis 1 doesn't change no matter what axis 2 does
(this is the genuinely "shared standard" part, applying to EVERY entity in `domain/entities/`
whether or not it carries the `.aggregate.ts` suffix): a private constructor, construction through a
static factory (never `new` from outside), **no setters** (mutate through intention-revealing
methods), business logic inside instance methods, and an `id` the domain generates itself (never
accepted from the caller, never a sentinel).

## 1. The factory enforces invariants at creation (Intention-Revealing)

- `create()` must **NOT** be a pass-through accepting a free discriminator (role/type/status). Split
  the factory by **variant**, baking the rule in:
  - ✅ `Membership.createOwner()` (the ONLY door to OWNER) vs
    `Membership.createMember(role: ManageableOrgRole)`
  - ❌ `Membership.create({ role?: OrgRole })` — the caller decides the role with no rule →
    privilege escalation.
- **Security-relevant invariant → prefer a TYPE (compile-time) over a runtime guard.**
  `ManageableOrgRole = Exclude<OrgRole, 'OWNER'>` makes "create/change to OWNER" a **compile error**,
  with no need for `if (role === OWNER) throw`.
- **Input validation (presence / format / length / range) does NOT belong in the factory/entity.**
  ⛔ **RULE:** all input validation is **Zod's job at EVERY input boundary** (HTTP, event consumer,
  command) — see `zod_validation.md`. The factory does **not** `if (!x.trim()) throw`; it only holds
  **structural/type invariants** (e.g. the compile-time `ManageableOrgRole`) plus
  intention-revealing construction. Every input door validates with Zod **BEFORE** an entity is
  built → the domain **TRUSTS** that input is already clean (single source of truth = Zod, never
  validated in two places).

### Naming the factory — ONE rule: `create<Variant>`, never `createFor<UseCase>`

> The factory name describes the **entity's variant** (what is created), NOT the **caller's
> use-case** (what it's created for). Use-case is the application layer's business; the entity must
> not know about it.

- **Only one creation path → plain `create()`.** Don't invent a suffix when there is no second
  variant to distinguish from (speculative generality). Examples: `Organization.create`,
  `Space.create`, `Permission.create`, `User.create`, `RefreshToken.create`, `AuthIdentity.create`.
- **Two or more creation paths → name them ALL by variant, and DROP the plain `create`.** Leaving a
  bare `create` next to named factories reads as an ambiguous "implicit default". Correct example:
  `Membership.createOwner` / `createMember` (with no `Membership.create`).
- ❌ **FORBIDDEN: `createFor<UseCase>`** (`createForRegister`, `createForLogin`). A use-case is not
  a variant — `RefreshToken` has only one way to be created but is used in both login and
  refresh-rotation, so tagging it "ForLogin" is both redundant and wrong. When a real variant
  exists, name it along the **entity's own axis of variation**: e.g. by auth mechanism →
  `User.createWithPassword` / `User.createWithOAuth`.
- **Test before naming something `create*`:** "Does this call produce a NEW identity that never
  existed before?" — No (you're loading/reading) → that's `rehydrate`/a query, don't call it
  `create`.

## 2. Validate on WRITE — TRUST on READ (the boundary)

> This is the boundary most often gotten wrong.

- Data is validated **once, on the WRITE side**: **Zod at the input boundary** (HTTP + event
  consumer) + **DB constraints** (enum / unique / FK / NOT NULL). The factory does **NOT** validate
  input — it only holds type/structural invariants (§1).
- **The READ side (`rehydrate` / `mapper.toDomain`) must TRUST persistence — do NOT re-validate
  logic.**
  - "Logically invalid" data on read is **impossible** (the write side + DB enums already guarantee
    it).
  - If data really is corrupt → that is an **infrastructure incident (ACID)**, not something the
    domain should re-check on every read.
- ❌ Wrong: `role: toOrgRole(row.role)` — a throwing validator on read (over-engineering, runs on
  every read, guards against something that can't happen).
- ✅ Right: `role: row.role` (the Prisma enum type already guarantees it), or narrowing with
  `row.role as ManageableOrgRole` (trusting the write-side invariant) **with a comment**.
- **The mapper's row type is the Prisma enum type** — don't downcast it to `string` and cast back.
  (Downcasting to `string` is exactly what creates the dangerous cast — fix the root by using the
  right type, don't add a validator on top of a wrong one.)

## 3. Every entity has its own Mapper

- `infrastructure/mappers/<entity>.mapper.ts` with `toDomain` + `toPersistence`. The repository
  **delegates** to the mapper — no inline `rehydrate(...)`.

## ⚠️ Forbidden

| Wrong | Right |
|---|---|
| Props-bag `private readonly props` + `return new Entity(...)` on every change | Individual private fields + in-place behaviour mutation (`this._x = ...`) |
| `create()` pass-through accepting a free role/type, with no rule | Variant-specific factories + type constraints |
| `createFor<UseCase>` (`createForRegister`, `createForLogin`) | `create()` (one path) or `create<Variant>` (≥2, all named) |
| `if (role === OWNER) throw` for a static invariant | `Exclude<OrgRole,'OWNER'>` (compile-time) |
| `if (!x.trim()) throw` / validating input inside the entity/factory | Validate input in the **Zod schema** (boundary); the factory only holds type invariants |
| Generating the id in the controller/caller (`randomUUID()` passed into a command) | The factory generates `v7()`; the handler does `return entity.id` if the client needs it |
| Validate-on-read inside `mapper.toDomain` / `rehydrate` | Trust persistence; narrow with a typed cast |
| Mapper types the row as `string` then does `as OrgRole` | Type the row with the Prisma enum and assign directly |
| Inline `rehydrate(...)` inside the repository | A separate `<entity>.mapper.ts` |

## 🔗 Related

- `directives/folder_structure_sop.md` — layer boundaries (lint-enforced).
- `directives/multi_tenancy.md` — Org RBAC, OWNER implicit-all.
- `directives/event_sourcing.md` — rehydrating from an event stream (same principle: applying an
  event = trust, don't re-validate).
- `.ai/memory/conventions.jsonl` — the specific lessons (#47 layering, #48 write-validate/read-trust).
