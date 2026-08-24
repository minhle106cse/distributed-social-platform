# Plan — thống nhất ranh giới domain của auth-service theo core-api

> Trạng thái: **CHƯA THỰC HIỆN** — dựng 2026-08-24 theo yêu cầu của owner ("thống nhất theo core-api").
> Không đụng logic. Toàn bộ là di chuyển khai báo + sửa đường import + 1 dòng eslint.

## 1. Vấn đề

Hai service khai báo ranh giới domain **ngược nhau**, cả hai đều cố ý ở thời điểm viết:

| Service | domain được import `@/common/**`? | Câu trong `eslint.config.mjs` |
|---|---|---|
| core-api | ❌ cấm | *"chỉ shared-kernel + relative cùng domain"* |
| auth-service | ✅ cho phép | *"chỉ shared-kernel + **common/** + relative"* |

Hệ quả thực tế: cùng một loại artefact (error class do domain throw) nằm ở hai chỗ khác nhau tuỳ
service, và `naming_conventions.md` §6 phải mô tả **hai** luật thay vì một.

Owner chọn: **thống nhất theo core-api** (chặt hơn — domain chỉ phụ thuộc chính nó + shared-kernel).

## 2. Đo đạc — cơ sở của plan

⚠️ **Sửa lại một khẳng định sai của tôi trong cùng ngày.** Tôi đã kết luận auth-service "bị buộc"
phải để error ở `common/` vì `auth.error` được dùng bởi domain của **hai** module (auth + user).
Đúng ở cấp **file**, sai ở cấp **class** — và cấp class mới là cấp quyết định. Đo lại bằng script
(`grep` từng class qua toàn bộ service, bỏ spec):

**Không có class nào bị throw bởi domain của 2 module.** Ca khó không tồn tại.

### 2.1 — 7 class phải chuyển vào `modules/<x>/domain/`

| Class | Đang ở | Chuyển tới | Còn ai dùng ngoài domain |
|---|---|---|---|
| `InvalidCredentialsError` | `common/errors/auth.error.ts` | `modules/auth/domain/auth.error.ts` | `auth/application` (login.handler) |
| `InvalidAuthProviderError` | `common/errors/auth.error.ts` | `modules/auth/domain/auth.error.ts` | — |
| `RefreshTokenRevokedError` | `common/errors/auth.error.ts` | `modules/auth/domain/auth.error.ts` | — |
| `RefreshTokenExpiredError` | `common/errors/auth.error.ts` | `modules/auth/domain/auth.error.ts` | — |
| `RoleInactiveError` | `common/errors/rbac.error.ts` | `modules/rbac/domain/rbac.error.ts` | — |
| `AuthMethodNotFoundError` | `common/errors/auth.error.ts` | `modules/user/domain/user.error.ts` | `auth/application` (login.handler) |
| `UserCannotLoginError` | `common/errors/user.error.ts` | `modules/user/domain/user.error.ts` | `user/application` (get-me.handler) |

Chú ý `AuthMethodNotFoundError`: **tên nói "auth" nhưng người throw là `user.entity.ts`**. Đi theo
người throw, không đi theo tên — nếu thấy ngược mắt thì đó là dấu hiệu tên class đặt sai, xử lý
riêng, đừng để nó lái vị trí file.

### 2.2 — 10 class ở nguyên `common/errors/` (không có consumer nào ở domain)

`ForbiddenError`, `UnauthorizedError`, `RefreshTokenNotFoundError`, `RefreshTokenUsedError`
(auth.error) · `RoleNotFoundError`, `RoleAlreadyExistsError`, `InvalidPermissionCodeError`
(rbac.error) · `UserNotFoundError`, `UserAlreadyExistsError`, `IdempotencyKeyConflictError`
(user.error).

### 2.3 — Blast radius

5 file domain + 4 file ngoài domain (`login.handler.ts`, `get-me.handler.ts`, và spec tương ứng),
cộng 3 file `common/errors/*.ts` bị cắt bớt. **Không file nào đổi logic.**

## 3. Các bước

1. **Tạo 3 file domain error** — `modules/auth/domain/auth.error.ts`,
   `modules/rbac/domain/rbac.error.ts`, `modules/user/domain/user.error.ts`. Mỗi file chỉ chứa các
   class ở bảng §2.1, `extends ApplicationError` (import từ shared-kernel — domain được phép).
2. **Xoá 7 class đó khỏi `common/errors/*.ts`**, giữ nguyên 10 class còn lại.
3. **Sửa import** ở 9 file (§2.3). Một import **liên module** mới xuất hiện:
   `auth/application/commands/login/login.handler.ts` → `@/modules/user/domain/user.error`
   (cho `AuthMethodNotFoundError`). Hợp lệ: block application của auth-service cấm
   `@/modules/*/infrastructure/**` và `@/modules/*/presentation/**`, **không** cấm `domain/**`. Đây
   là coupling **hiện rõ** thay cho coupling cũ giấu sau `common/`.
4. **Siết eslint** — thêm `'@/common/**'` vào group cấm của block
   `files: ['src/modules/*/domain/**/*.ts']` trong `apps/auth-service/eslint.config.mjs`, sửa message
   bỏ chữ "+ common/". Sau bước này `check:arch` check D **tự động** bắt đầu enforce cho
   auth-service (nó đọc chính file config này), kể cả đường vòng relative.
5. **Cập nhật tài liệu**: `naming_conventions.md` §6 rút từ 3 dòng còn 2 (bỏ dòng ngoại lệ
   auth-service); `folder_structure_sop.md` bảng boundary; `.ai/PROJECT_STATUS.md`;
   `.ai/memory/architecture.jsonl`.

## 4. Điểm cần quyết trước khi code

| # | Vấn đề | Khuyến nghị |
|---|---|---|
| 1 | Sau khi tách, tồn tại **cả** `common/errors/auth.error.ts` **lẫn** `modules/auth/domain/auth.error.ts` — trùng basename | **Giữ nguyên `{module}.error.ts` ở cả hai chỗ.** Vị trí đã phân biệt ý nghĩa, `check:arch` check I chỉ cho phép đúng 2 chỗ đó, và đẻ thêm một pattern tên file thứ hai (`auth.domain-error.ts`) thì tệ hơn |
| 2 | `AuthMethodNotFoundError` sang `modules/user/domain/` dù tên mang chữ "auth" | Chuyển theo người throw. Nếu muốn đổi tên (`UserHasNoAuthMethodError`) thì làm **commit riêng**, đừng trộn rename với move |
| 3 | Làm ngay hay sau khi commit 150 path đang dở | **Sau.** Đây là refactor thuần vị trí; trộn vào đống hiện tại làm diff không review được |

## 5. Xác minh

- `npx turbo run typecheck lint format:check test --filter=@distributed-social-platform/auth-service`
  — kỳ vọng 30 suites / 123 tests xanh như baseline.
- `npm run check:arch` — phải xanh, và **phải chứng minh nó thật sự enforce**: bơm lại một import
  `'../../../../common/errors/auth.error'` vào một domain entity → phải fail; revert → xanh.
- Bơm ngược một import alias `@/common/errors/...` vào domain → `npx eslint` phải fail.

## 6. Rollback

Thuần di chuyển khai báo; `git checkout -- apps/auth-service` là đủ. Không migration, không đổi
contract, không đổi hành vi runtime.

## 7. References & Compliance

| Nguồn đã đọc | Rút ra điều gì |
|---|---|
| `directives/naming_conventions.md` §6 | Luật vị trí file error hiện hành (quyết định bởi *ai throw*), và bảng 3 dòng mà plan này rút xuống 2 |
| `directives/folder_structure_sop.md` § Enforcement + § Where An Abstraction Lives | Bảng ranh giới từng tầng; `common/` = abstraction cross-cutting của một service |
| `apps/core-api/eslint.config.mjs` (block `src/modules/*/domain/**`) | Chuẩn đích: danh sách cấm gồm `@/common/**` |
| `apps/auth-service/eslint.config.mjs` (block `src/modules/*/domain/**`) | Trạng thái hiện tại: cho phép `common/`, cần thêm đúng 1 dòng |
| `scripts/check-repo-placement.cjs` check D + check I | Check D đọc eslint của từng service → siết eslint là đủ, không phải sửa script; check I ràng file error chỉ được ở `common/errors/` hoặc `modules/*/domain/` |
| `packages/shared-kernel/src/errors/` (`ls`) | Base class thật sự tồn tại: `AppError`, `ApplicationError`, `InfrastructureError`, `UnreachableError`, `ResponseFormatError` — **không có `DomainError`**, nên domain error vẫn `extends ApplicationError` |
| `.ai/memory/architecture.jsonl` #110 | Bài học "khi đúng một file vi phạm một rule, kiểm tra rule trước khi sửa file" — chính là thứ đã ngăn tôi dọn nhầm 5 file auth-service |
