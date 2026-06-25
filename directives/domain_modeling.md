# SOP: Domain Modeling — Entity Factories & Persistence Boundary

> Áp cho **mọi domain entity** ở cả 2 service. Mục tiêu: entity luôn **valid-by-construction**,
> và phân định rõ **nơi validate (WRITE)** vs **nơi tin tưởng (READ)**.

## 1. Factory enforce invariant lúc tạo (Intention-Revealing)

- `create()` **KHÔNG** được là pass-through nhận discriminator tự do (role/type/status). Tách factory theo **kịch bản**, baked rule vào:
  - ✅ `Membership.createOwner()` (cửa DUY NHẤT ra OWNER) vs `Membership.createMember(role: ManageableOrgRole)`
  - ✅ `User.createForRegister(props, passwordService)` (hash password trong factory), `RefreshToken.createForLogin(...)`
  - ❌ `Membership.create({ role?: OrgRole })` — caller tự quyết role, không rule → leo thang quyền.
- **Bất biến bảo mật → ưu tiên TYPE (compile-time) hơn runtime guard.** `ManageableOrgRole = Exclude<OrgRole, 'OWNER'>` khiến "tạo/đổi sang OWNER" thành **lỗi biên dịch**, không cần `if (role === OWNER) throw`.
- **Required field** → guard non-blank ngay trong factory (self-protecting cho path KHÔNG qua Zod: event handlers, seeders).

## 2. Validate khi GHI — TIN khi ĐỌC (the boundary)

> Đây là ranh giới hay bị làm sai nhất.

- Data được validate **một lần ở WRITE-side**: entity factory (§1) + Zod (HTTP boundary) + **DB constraint** (enum / unique / FK).
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
| `create()` pass-through nhận role/type tự do, không rule | Factory chuyên biệt theo kịch bản + type constraint |
| `if (role === OWNER) throw` cho bất biến tĩnh | `Exclude<OrgRole,'OWNER'>` (compile-time) |
| Validate-on-read trong `mapper.toDomain` / `rehydrate` | Tin persistence; narrow bằng typed cast |
| Mapper type row là `string` rồi `as OrgRole` | Type row bằng Prisma enum, gán thẳng |
| `rehydrate(...)` inline trong repository | Tách `<entity>.mapper.ts` |

## 🔗 Liên quan

- `directives/folder_structure_sop.md` — layer boundaries (lint-enforced).
- `directives/multi_tenancy.md` — Org RBAC, OWNER implicit-all.
- `directives/event_sourcing.md` — rehydrate từ event stream (cùng nguyên tắc: apply event = trust, không re-validate).
- `.ai/memory/conventions.jsonl` — các lesson cụ thể (#47 layering, #48 write-validate/read-trust).
