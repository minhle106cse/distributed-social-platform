# 🧭 ADR — Architecture Decision Records

**Một ADR ghi lại MỘT quyết định kiến trúc: bối cảnh lúc quyết, phương án đã cân nhắc, phương án bị
bác và VÌ SAO bị bác.** Đây là loại tài liệu thứ tư bên cạnh 3 loại trong `docs/README.md`
(🟦 product intent / 🟩 living spec / 🟨 review artifact).

## Vì sao cần, khi `docs/` và `directives/` đã có

| | Trả lời câu hỏi |
|---|---|
| `directives/` | *"Viết code thế nào cho đúng?"* — luật hiện hành |
| `docs/NN_*.md` | *"Hệ thống là gì, chạy ra sao?"* — spec hiện hành |
| `docs/adr/` | *"Vì sao lại chọn thế này, và đã bác cái gì?"* — **lý do lịch sử** |

Directive nói *luật là gì*; ADR nói *vì sao luật đó thắng các lựa chọn khác*. Sáu tháng sau không ai
nhớ vì sao không chọn cách phổ biến hơn — và không có ADR thì người kế tiếp (hoặc AI agent) sẽ
"sửa lại cho giống chuẩn chung" đúng cái đã bị cố ý bác bỏ.

## Quy ước

- Tên file: `NNNN-kebab-title.md`, số tăng dần, **không tái sử dụng số**.
- Status: `Proposed` → `Accepted` → (`Superseded by ADR-XXXX` | `Deprecated`). **Không xoá ADR cũ** —
  ADR bị thay thế vẫn là bản ghi lịch sử; đánh dấu `Superseded`, đừng sửa nội dung gốc.
- Bắt buộc có mục **Alternatives considered** kèm lý do bác — ADR không có mục này thì vô dụng.
- Mỗi khẳng định về "thực tiễn ngành" phải có **nguồn dẫn được**, không viết theo cảm tính.

## Danh mục

| ADR | Tiêu đề | Status |
|---|---|---|
| [0001](0001-transaction-retry-boundary.md) | Ranh giới Transaction & Retry — Unit of Work + suy từ chữ ký + fail-fast lúc boot | Accepted (2026-07-29) |

## Danh sách hiện có

| ADR | Chủ đề | Status |
|---|---|---|
| [0001](0001-transaction-retry-boundary.md) | Ranh giới Transaction & Retry — Unit of Work, suy từ kiểu handler, fail-fast lúc boot | Accepted, **partially superseded by 0002** (§5 TxScopeToken/registry và §9.2 outbox port split) |
| [0002](0002-placement-rule-and-outbox-as-capability.md) | Vị trí abstraction quyết bởi consumer; Outbox thành capability của shared-kernel | Accepted |
