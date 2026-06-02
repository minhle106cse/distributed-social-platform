# 📐 Design System & Assets (Isometric Grid 2D)

Tài liệu quy định các thông số kỹ thuật (Specs) dành cho team Design và UI/UX để đảm bảo khi cắt HTML/CSS Grid sẽ khớp hoàn hảo.

---

## 1. Hệ tọa độ (Grid System)
- **Kiến trúc Vườn:** Lưới CSS Grid `6x6` (Tối đa 36 ô).
- **Kích thước một ô (Cell/Tile size):**
  - Mặc định: `128x128px` (trên Desktop).
  - Responsive: Thu nhỏ còn `64x64px` trên Mobile.
- **Tỉ lệ Isometric:** Góc nghiêng tiêu chuẩn 2:1 (Tương đương góc nghiêng 26.565 độ).

## 2. Tiêu chuẩn xuất File (Asset Export Specs)
- **Định dạng:** `.PNG` nền trong suốt (hoặc SVG nếu asset đơn giản dạng vector).
- **Bounding Box:** Kích thước bức ảnh phải vừa khít với lưới lưới để tiện đặt vị trí. Ví dụ chậu cây chiếm 1 ô thì export ảnh `128x128px` (chứa luôn bóng đổ - drop shadow trong nền).
- **Layering (Chiều sâu 2.5D):** 
  - Các vật phẩm phải được vẽ thêm mảng Tối/Sáng theo một nguồn sáng duy nhất (Ví dụ: Ánh sáng chiếu từ góc trên bên trái xuống).
  - Shadow (bóng râm) nên để alpha thấp (VD: opacity 30%) để hòa vào màu nền thời tiết.

## 3. UI Tokens (Bảng màu)
Thay vì sử dụng màu tĩnh, hệ thống sẽ sử dụng **CSS Variables** để đổi theo hiệu ứng Thời tiết (Weather).
- Nền nắng (SUNNY): `var(--bg-sunny)` -> `#FFF9E6`
- Nền mưa (RAINY): `var(--bg-rainy)` -> `#2B3B4C`
- Màu chữ chính: `var(--text-primary)` -> `#1C1C1E` cho sáng, `#F5F5F7` cho tối.
- Màu nhấn (Accent - Nút check-in): `var(--accent-color)` -> `#4ADE80` (Màu xanh hy vọng).

## 4. Animation Guidelines
- **Framer Motion specs:**
  - Nảy mầm: `spring` type, stiffness: 200, damping: 10.
  - Tưới nước: SVG Path animation, ease-in-out.
