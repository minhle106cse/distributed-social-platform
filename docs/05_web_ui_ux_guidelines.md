# 🎨 Web UI/UX Guidelines (GrowthGarden V2)

Tài liệu này định nghĩa các tiêu chuẩn thiết kế Trải nghiệm Người dùng (UX) và Giao diện (UI) dành riêng cho nền tảng Web của GrowthGarden V2, đảm bảo trải nghiệm "Cozy & Healing" mượt mà nhất.

---

## 1. Công nghệ Frontend (Web Tech Stack)
Thay vì sử dụng các công nghệ Mobile như Flutter hay React Native, hệ thống sẽ được xây dựng trên hệ sinh thái Web hiện đại:
- **Framework:** **Next.js (React)**. Hỗ trợ SSR để load nhanh hồ sơ khu vườn, tối ưu SEO nếu người dùng muốn chia sẻ khu vườn công khai.
- **State Management:** **Zustand** kết hợp với **React Query**. Zustand lưu trữ trạng thái hiển thị (ví dụ: trạng thái Ngái ngủ), trong khi React Query đóng vai trò cốt lõi để thực hiện **Optimistic Updates** (cập nhật giao diện lập tức trước khi gọi API).
- **Styling & Animation:** **TailwindCSS** kết hợp với **Framer Motion**. Framer Motion sẽ xử lý các "Vi tương tác" (Micro-interactions) như nảy hạt giống, mưa rơi, và hiệu ứng rã đông.
- **Thông báo (Push Notifications):** Thay thế APNs/FCM bằng **Web Push API** và **Service Workers** để gửi thông báo tưới cây ngay cả khi người dùng đã đóng tab trình duyệt.

---

## 2. Kiến trúc Trực quan (Visual Architecture)

### 2.1. Bố cục Desktop (Responsive Layout)
Giao diện không dùng cơ chế cuộn dọc (Infinite Scroll) vô tận như mạng xã hội truyền thống để tránh gây mệt mỏi.
- **Center Canvas (Khu vườn):** Chiếm 70% diện tích màn hình trung tâm. Đây là không gian Isometric Grid (Lưới 2D) để người dùng trang trí, kéo thả các chậu cây và vật phẩm. 
- **Right Panel (Habit Tracker):** Chiếm 30% bên phải. Hiển thị danh sách các Thói quen (Habits) cần check-in hôm nay. Khi click hoàn thành một habit ở panel phải, một luồng sáng (animation) sẽ bắn từ panel sang khu vườn và tưới nước cho cái cây tương ứng.

### 2.2. Kỹ thuật Render Khu Vườn (Isometric Garden)
Để tối ưu tốc độ phát triển MVP (Minimum Viable Product):
- **Không dùng WebGL/Canvas (PixiJS/Three.js):** Việc dùng Canvas sẽ tốn kém chi phí tính toán và khó làm responsive trên các trình duyệt cũ.
- **Giải pháp - CSS Grid 2D:** Sử dụng hệ thống tọa độ X, Y do backend trả về (`Placement` model), Frontend sẽ render một `div` lưới CSS Grid (ví dụ 6x6). Các vật phẩm là các ảnh PNG/SVG có nền trong suốt được đặt vào lưới bằng thuộc tính `grid-column` và `grid-row`, kết hợp `z-index` để tạo chiều sâu (Layering). Thao tác trang trí vườn được thực hiện qua **HTML5 Drag and Drop API**.

---

## 3. Xử lý Trạng thái UI (UI State Handling)

### 3.1. Trạng thái "Ngái ngủ" (Sleepy UI State)
Để che giấu độ trễ của cơ chế Ân xá (Grace Period) từ 00:00 đến 10:00 sáng:
- Frontend sẽ không gọi API cập nhật trạng thái "Héo úa" ngay khi qua ngày mới.
- Thay vào đó, Zustand store sẽ chuyển trạng thái của toàn bộ cây cối sang `PENDING_SLEEPY`.
- UI sẽ áp dụng một lớp mask mờ (CSS `filter: brightness(0.8)`) và thêm một icon "ZZZ" (Framer Motion bồng bềnh) trên đầu các mầm cây.
- **Early Bird Override:** Nếu user tương tác (Click tưới cây) trước 10h sáng, trạng thái Sleepy bị vỡ, trả lại UI rực rỡ bình thường.

### 3.2. Hiệu ứng Thời tiết (Emotion Weather)
Thời tiết trong vườn phản chiếu tâm trạng (Emotion) được log của ngày hôm đó:
- **Trời nắng (Happy):** Nền vàng nhạt, có hiệu ứng hạt bụi (Dust particles) bay lơ lửng chậm rãi.
- **Trời mưa (Sad/Gloomy):** Nền xanh đen, sử dụng CSS Animation thả các hạt mưa. Cây cối tự động nhận hiệu ứng "Được tưới" mà user không cần làm task (Cơ chế Healing).

### 3.3. Cây Vệ Thần (Guardian Plant - Quitting Habit)
- **Khiên Năng Lượng:** Thay vì hiệu ứng tia sáng lớn lên, Cây Vệ Thần (đại diện cho thói quen từ bỏ) sẽ được bao bọc bởi một lớp viền (glow) màu xanh lam nhạt (CSS `box-shadow` hoặc SVG filter) biểu thị trạng thái an toàn.
- **Trúng Độc (Poisoned):** Nếu user báo cáo phá giới, cây không héo mà chuyển sang màu tím sậm, xung quanh có hiệu ứng bọt khí độc. Nút "Giải Độc" (Cure) sẽ hiển thị nổi bật bên cạnh, yêu cầu tiêu hao Karma.

### 3.4. Giới Hạn Cày Karma (Daily Cap)
- Khi user đạt mức trần Karma trong ngày, thanh tiến trình (Progress Bar) của ví Karma sẽ nhấp nháy chuyển sang màu Vàng (Gold/Maxed).
- Các hành động check-in tiếp theo vẫn hiển thị tia sáng tưới cây, nhưng thay vì hiện popup `+10 Karma`, UI sẽ hiện popup `Max Limit Reached` một cách nhẹ nhàng.

### 3.5. Không gian Premium (Nhà Kính / Vườn Trên Mây)
- **Chuyển đổi Không gian (Garden Switcher):** Với user Premium có nhiều khu vườn, cung cấp một nút bấm dạng "Bản đồ nhỏ" (Minimap) để chuyển đổi mượt mà giữa các không gian (Garden 1, Garden 2).
- **Theme Độc Quyền:** Các khu vườn Premium sẽ có bảng màu (CSS Tokens) và họa tiết nền (Background Pattern) riêng biệt, ví dụ như hiệu ứng tuyết rơi tĩnh hoặc mây trôi.

### 3.6. Optimistic UI & Offline Queue (Trải nghiệm Không Gián đoạn)
- Khi user bấm "Check-in" thói quen lúc mất mạng (ví dụ đi tàu điện ngầm), giao diện tuyệt đối không được hiện lỗi "Mất kết nối".
- **Optimistic Update:** React Query lập tức cập nhật state cục bộ. Cây sẽ lấp lánh và thanh EXP tăng lên ngay lập tức trên UI.
- **Offline Queue:** Ở dưới nền, thao tác này được lưu vào **IndexedDB** thông qua Service Worker. Khi trình duyệt phát hiện thiết bị có mạng trở lại (`navigator.onLine == true`), hệ thống tự động đẩy mảng dữ liệu từ Local Queue lên API `/sync/offline-queue` của Backend để đồng bộ âm thầm.

---

## 4. Quyền Riêng Tư (Privacy-First UX)
- Ứng dụng **tuyệt đối không** yêu cầu quyền Location (Web Geolocation API) để tránh gây lo lắng cho người dùng.
- Việc đồng bộ Timezone chỉ chạy ngầm bằng cách so sánh `Date.now()` của trình duyệt (Browser) với Timestamp của Server mỗi khi người dùng truy cập trang web. Nếu phát hiện lệch giờ do đi du lịch, một Pop-up nhỏ nhắn (không xâm lấn) sẽ hiện lên ở góc màn hình hỏi xem user có muốn đổi múi giờ không.
