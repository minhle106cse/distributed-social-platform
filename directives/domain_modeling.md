# SOP: Domain Modeling — Entity Factories & Persistence Boundary

> Áp cho **mọi domain entity** ở cả 2 service. Mục tiêu: entity luôn **valid-by-construction**,
> và phân định rõ **nơi validate (WRITE)** vs **nơi tin tưởng (READ)**.

## 0. Entity = mutable + individual `_fields` (canonical style)

> Đây là style ĐÃ CHỐT cho cả 2 service. Tham chiếu gốc: `auth-service` (`role.entity.ts`, `refresh-token.entity.ts`). core-api (`modules/tenant`) đã realign theo style này.

- Entity là **mutable**, lưu **từng field private** (`private _id: string`, `private _role: OrgRole`), gán trong constructor (`this._id = props.id`). **KHÔNG** dùng props-bag (`private readonly props: Props`).
- **Behavior method MUTATE in-place + enforce rule trên cùng identity**, trả `void` — KHÔNG `return new Entity(...)`:
  - ✅ `changeRole(role: ManageableOrgRole) { this._role = role }`, `invite.accept(userId)`, `token.revoke()`, `role.assignPermissions()` (dedupe).
  - ❌ `changeRole(role): Entity { return new Entity({ ...this.props, role }) }` (immutable "clone-on-change").
- Field kiểu **mutable** (`Date`, array) → **clone phòng thủ MỌI CỬA VÀO/RA**: constructor, getter, **và mutator nhận collection** (`assignRoles(roles) { this._roles = [...roles] }` — không `this._roles = roles`). Clone-in mà getter trả thẳng `this._x` (hoặc setter lưu thẳng reference của caller) là **nửa vời** — caller vẫn mutate được state nội bộ.
  - `Date`: `this._x = new Date(props.x.getTime())` / `return new Date(this._x.getTime())` (null-safe).
  - **Array = clone VỎ container, KHÔNG deep-clone phần tử** → `return [...this._arr]` (shallow). Mục đích là chặn `getter.push()/splice()/sort()` sửa cấu trúc collection nội bộ (thêm/bớt phần tử), KHÔNG phải bảo vệ từng phần tử. Vì phần tử là **VO/child immutable** (`AuthIdentity` readonly fields, `UserProfile` đóng kín) nên chia sẻ reference phần tử là an toàn — chỉ vỏ array mới cần clone.
- **Quy tắc thực sự = theo HÌNH DẠNG trả về, không phải "mutable hay không":**

  | Trả về | Xử lý | Vì sao |
  |---|---|---|
  | Array (collection) | clone vỏ `[...this._x]` | array là container mutable → chặn add/remove, dù phần tử immutable |
  | `Date` | clone `new Date(...)` | Date là object mutable |
  | Single child entity (`profile`) | trả thẳng | 1 reference, không có container để thủ; cần đúng identity để `assignProfile`/`profile.update()` compose |
  | Primitive (`string`/`number`/`boolean`) | trả thẳng | bất biến sẵn, copy-by-value |

  > ⚠️ Một mảng **child entity** (vd `profiles: UserProfile[]`) **vẫn** `return [...]` — dù `UserProfile` immutable — vì lý do là bảo vệ *mảng*, không phải phần tử. "Single child entity trả thẳng" chỉ áp cho **một** reference đơn.
- **Định danh: entity SỞ HỮU id của chính nó — factory sinh `v7()`, KHÔNG nhận `id` từ caller.** (Rule nền: "không sentinel, `entity.id == row.id`"; cách đạt = factory sinh v7.)
  - ✅ Dùng `v7()` (package `uuid`) trong factory — time-ordered, tốt cho B-tree index locality. Mapper persist chính id đó lúc INSERT. VD: cả auth (`User`/`Role`/`Permission`) lẫn core-api (`Organization`/`Space`/`Membership`/`OrgInvite`).
  - ❌ **CẤM sinh id ở controller / caller** (`crypto.randomUUID()` trong controller rồi truyền vào command/factory). Vừa lệch tầng (presentation quyết identity của domain), vừa hay dùng sai version (v4 random thay vì v7).
  - ❌ **CẤM sentinel `id: ''`** "để DB thay sau" (divergence entity↔row).
  - **Client cần id ngay?** → **handler TRẢ `entity.id` về**, controller dùng giá trị đó (`const id = await commandBus.execute<Cmd, string>(...)`). CQRS handler trả giá trị là pattern đã dùng sẵn (createInvite trả token). **Idempotency** dùng `IdempotencyRecord` (Idempotency-Key header), KHÔNG dựa vào id-upfront.
- **Lý do:** đây là DDD chính thống (Evans — entity mutable + identity/continuity; chỉ Value Object mới immutable) và đồng bộ với `event_sourcing.md` (`apply` mutate: `this.balance += amount`). Immutable + props-bag là **lựa chọn style gây tranh cãi, KHÔNG phải "best practice" mặc định** — đừng tự dán nhãn vậy.
- Mapper `toPersistence` đọc qua **getter** (`org.id`, `org.name`), KHÔNG cần `toSnapshot()`/props-bag.

## 1. Factory enforce invariant lúc tạo (Intention-Revealing)

- `create()` **KHÔNG** được là pass-through nhận discriminator tự do (role/type/status). Tách factory theo **biến thể**, baked rule vào:
  - ✅ `Membership.createOwner()` (cửa DUY NHẤT ra OWNER) vs `Membership.createMember(role: ManageableOrgRole)`
  - ❌ `Membership.create({ role?: OrgRole })` — caller tự quyết role, không rule → leo thang quyền.
- **Bất biến bảo mật → ưu tiên TYPE (compile-time) hơn runtime guard.** `ManageableOrgRole = Exclude<OrgRole, 'OWNER'>` khiến "tạo/đổi sang OWNER" thành **lỗi biên dịch**, không cần `if (role === OWNER) throw`.
- **Input validation (presence / format / length / range) KHÔNG nằm trong factory/entity.** ⛔ **RULE:** toàn bộ validate input là việc của **Zod ở MỌI input boundary** (HTTP, event consumer, command) — xem `zod_validation.md`. Factory **không** `if (!x.trim()) throw`; nó chỉ giữ **bất biến cấu trúc / type** (vd `ManageableOrgRole` compile-time) + intention-revealing. Mỗi cửa nhận input validate bằng Zod **TRƯỚC** khi dựng entity → domain **TIN** input đã sạch (single source of truth = Zod, không validate 2 nơi).

### Naming factory — MỘT luật duy nhất: `create<Variant>`, KHÔNG `createFor<UseCase>`

> Tên factory mô tả **biến thể của entity** (cái gì được tạo), KHÔNG mô tả **use-case của caller** (tạo để làm gì). Use-case là việc của application layer; entity không được biết tới nó.

- **Chỉ 1 đường tạo → `create()` trơn.** Đừng bịa suffix khi không có biến thể thứ 2 để phân biệt (speculative generality). VD: `Organization.create`, `Space.create`, `Permission.create`, `User.create`, `RefreshToken.create`, `AuthIdentity.create`.
- **Có ≥2 đường tạo → đặt tên HẾT theo biến thể, BỎ `create` trơn.** Để lẫn một `create` trơn cạnh các factory có tên = "default ngầm" mơ hồ. VD đúng: `Membership.createOwner` / `createMember` (không có `Membership.create`).
- ❌ **Cấm `createFor<UseCase>`** (`createForRegister`, `createForLogin`). Use-case không phải biến thể — `RefreshToken` chỉ có một cách tạo nhưng được dùng ở cả login lẫn refresh-rotation, nên gắn "ForLogin" vừa thừa vừa sai. Khi có biến thể thật, đặt theo **trục biến thiên của entity**: vd theo cơ chế auth → `User.createWithPassword` / `User.createWithOAuth`.
- **Phép thử trước khi đặt tên `create*`:** "Lời gọi này có sinh ra một identity MỚI chưa từng tồn tại không?" — Không (đang load/đọc) → đó là `rehydrate`/query, đừng gọi là `create`.

## 2. Validate khi GHI — TIN khi ĐỌC (the boundary)

> Đây là ranh giới hay bị làm sai nhất.

- Data được validate **một lần ở WRITE-side**: **Zod ở input boundary** (HTTP + event consumer) + **DB constraint** (enum / unique / FK / NOT NULL). Factory **KHÔNG** validate input — chỉ giữ bất biến type/structural (§1).
- **READ-side (`rehydrate` / `mapper.toDomain`) phải TIN persistence — KHÔNG re-validate logic.**
  - Data "sai logic" khi đọc ra là **bất khả thi** (write-side + DB enum đã đảm bảo).
  - Nếu data thật sự corrupt → đó là **sự cố hạ tầng (ACID)**, KHÔNG phải việc domain re-check mỗi lần read.
- ❌ Sai: `role: toOrgRole(row.role)` — throwing validator on read (over-engineering, chạy mỗi read, phòng thứ không xảy ra).
- ✅ Đúng: `role: row.role` (Prisma enum type đã đảm bảo), hoặc narrow `row.role as ManageableOrgRole` (tin write-invariant) **có comment**.
- **Type row của mapper = Prisma enum type**, KHÔNG hạ xuống `string` rồi cast. (Chính việc hạ xuống `string` mới tạo ra cast nguy hiểm — sửa gốc là dùng đúng type, không phải thêm validator.)

## 3. Mỗi entity có Mapper riêng

- `infrastructure/mappers/<entity>.mapper.ts` với `toDomain` + `toPersistence`. Repository **delegate** vào mapper, KHÔNG `rehydrate(...)` inline.

## ⚠️ Forbidden

| Sai | Đúng |
|---|---|
| Props-bag `private readonly props` + `return new Entity(...)` mỗi lần đổi | Field private riêng + behavior mutate in-place (`this._x = ...`) |
| `create()` pass-through nhận role/type tự do, không rule | Factory chuyên biệt theo biến thể + type constraint |
| `createFor<UseCase>` (`createForRegister`, `createForLogin`) | `create()` (1 đường tạo) hoặc `create<Variant>` (≥2, đặt tên hết) |
| `if (role === OWNER) throw` cho bất biến tĩnh | `Exclude<OrgRole,'OWNER'>` (compile-time) |
| `if (!x.trim()) throw` / validate input trong entity/factory | Validate input ở **Zod schema** (boundary); factory chỉ giữ bất biến type |
| Sinh id ở controller/caller (`randomUUID()` truyền vào command) | Factory sinh `v7()`; handler `return entity.id` nếu client cần |
| Validate-on-read trong `mapper.toDomain` / `rehydrate` | Tin persistence; narrow bằng typed cast |
| Mapper type row là `string` rồi `as OrgRole` | Type row bằng Prisma enum, gán thẳng |
| `rehydrate(...)` inline trong repository | Tách `<entity>.mapper.ts` |

## 🔗 Liên quan

- `directives/folder_structure_sop.md` — layer boundaries (lint-enforced).
- `directives/multi_tenancy.md` — Org RBAC, OWNER implicit-all.
- `directives/event_sourcing.md` — rehydrate từ event stream (cùng nguyên tắc: apply event = trust, không re-validate).
- `.ai/memory/conventions.jsonl` — các lesson cụ thể (#47 layering, #48 write-validate/read-trust).
