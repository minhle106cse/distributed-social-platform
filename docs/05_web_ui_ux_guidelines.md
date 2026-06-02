# 🎨 Web UI/UX Guidelines (GrowthGarden V2)

Tài liệu này định nghĩa các tiêu chuẩn thiết kế Trải nghiệm Người dùng (UX) và Giao diện (UI) dành riêng cho nền tảng Web của GrowthGarden V2, đảm bảo trải nghiệm "Cozy & Healing" mượt mà nhất.

---

## 1. Công nghệ Frontend (Web Tech Stack)
Thay vì sử dụng các công nghệ Mobile như Flutter hay React Native, hệ thống sẽ được xây dựng trên hệ sinh thái Web hiện đại:
- **Framework:** **Next.js (React)**. Hỗ trợ SSR để load nhanh hồ sơ khu vườn, tối ưu SEO nếu người dùng muốn chia sẻ khu vườn công khai.
- **State Management:** **Zustand** kết hợp với **React Query**. Zustand lưu trữ trạng thái hiển thị (ví dụ: trạng thái Cây Vệ Thần, Streak hiện tại), trong khi React Query đóng vai trò cốt lõi để thực hiện **Optimistic Updates** (cập nhật giao diện lập tức trước khi gọi API).
- **Styling & Animation:** **TailwindCSS** kết hợp với **Framer Motion**. Framer Motion sẽ xử lý các "Vi tương tác" (Micro-interactions) như lấp lánh tưới cây, mưa rơi, hiệu ứng rã đông Hibernation.
- **Thông báo (Push Notifications):** Thay thế APNs/FCM bằng **Web Push API** và **Service Workers** để gửi thông báo tưới cây ngay cả khi người dùng đã đóng tab trình duyệt.

---

## 2. Kiến trúc Trực quan (Visual Architecture)

### 2.1. Bố cục Desktop (Responsive Layout)
Giao diện không dùng cơ chế cuộn dọc (Infinite Scroll) vô tận như mạng xã hội truyền thống để tránh gây mệt mỏi.
- **Center Canvas (Khu vườn):** Chiếm 70% diện tích màn hình trung tâm. Đây là không gian Isometric Grid (Lưới 2D) để người dùng trang trí, kéo thả Cây Vệ Thần và vật phẩm.
- **Right Panel (Emotion Check-in):** Chiếm 30% bên phải. Hiển thị Widget điểm danh cảm xúc hôm nay (chọn A–F và tùy chọn nhập Note). Khi click Check-in, một luồng sáng bắn từ panel sang khu vườn, Cây Vệ Thần lấp lánh nhận EXP.

### 2.2. Kỹ thuật Render Khu Vườn (Isometric Garden)
Để tối ưu tốc độ phát triển MVP (Minimum Viable Product):
- **Không dùng WebGL/Canvas (PixiJS/Three.js):** Việc dùng Canvas sẽ tốn kém chi phí tính toán và khó làm responsive trên các trình duyệt cũ.
- **Giải pháp - CSS Grid 2D:** Sử dụng hệ thống tọa độ X, Y do backend trả về (`PlantGuardian` và `InventoryItem` metadata), Frontend render một `div` lưới CSS Grid. Vật phẩm là các ảnh PNG/SVG trong suốt đặt vào lưới bằng `grid-column` và `grid-row`, kết hợp `z-index` để tạo chiều sâu (Layering). Thao tác trang trí vườn được thực hiện qua **HTML5 Drag and Drop API**.

---

## 3. Xử lý Trạng thái UI (UI State Handling)

### 3.1. Trạng thái Cây Vệ Thần (PlantGuardian States)
Mỗi trạng thái của cây đều có ngôn ngữ hình ảnh riêng biệt và nhất quán:
- **`SEED`:** Hình hạt giống nhỏ xíu, nhấp nháy nhẹ nhàng. Text chú thích: *"Hành trình của bạn đang bắt đầu..."*
- **`GROWING`:** Cây xanh tươi, glow nhẹ, có hiệu ứng hạt bụi lơ lửng. Đây là trạng thái "khỏe mạnh" bình thường.
- **`HIBERNATING`:** Cây bị bao phủ bởi lớp băng tinh thể (CSS `filter: hue-rotate + brightness`). Cỏ dại mọc xung quanh. Nút "Rã Đông" (tốn Karma) hiển thị nổi bật.
- **`DEAD`:** Cây màu xám, nứt vỡ. Streak bị reset. Nút "Bắt đầu lại" xuất hiện.
- **`ANCIENT`:** Cây cổ thụ tỏa sáng với hiệu ứng rực rỡ (Framer Motion particle burst). Animation chúc mừng mốc chuỗi (7, 21, 66 ngày thực tế).

### 3.2. Hiệu ứng Thời tiết (Emotion Weather)
Thời tiết trong vườn phản chiếu cảm xúc (EmotionGrade) được log của ngày hôm đó:
- **Trời nắng (A/B - Tích cực):** Nền vàng nhạt, có hiệu ứng hạt bụi (Dust particles) bay lơ lửng chậm rãi.
- **Trời mưa (D/E - Buồn):** Nền xanh đen, sử dụng CSS Animation thả các hạt mưa. Cây cối tự động nhận hiệu ứng "Được tưới" — đây là cơ chế Healing ẩn dụ cho những ngày khó khăn.
- **Sương mờ (C - Trung tính):** Nền trắng sữa nhạt, hiệu ứng sương nhẹ.
- **Bão (F - Tệ nhất):** Nền xám tối, sấm sét yếu. Hệ thống tự động gợi ý NPC ghé thăm để động viên.

### 3.3. Khu Phố & Công Trình Chung (Neighborhood UI)
- **Thanh Năng lượng Monument:** Hiển thị thanh progress bar ở góc Khu phố, fill dần lên khi các thành viên điểm danh. Khi đầy, animation Rương Co-op rơi xuống với hiệu ứng ánh sáng đặc biệt.
- **Avatar Hàng xóm:** Hiển thị mini avatar của các thành viên xung quanh Khu phố. Avatar mờ dần nếu người đó không điểm danh nhiều ngày (áp lực trách nhiệm nhẹ nhàng).
- **Badge Thị trưởng:** Icon vương miện nhỏ trên avatar Thị trưởng. Nếu Thị trưởng sắp mất chức (offline >10 ngày), badge nhấp nháy cảnh báo nhẹ.

### 3.4. Hiệu ứng Gacha & Pity System
- **Mở Rương:** Animation lấp lánh xoay tròn chạy **ngay lập tức** nhờ Seed-based RNG Client-side. Không có độ trễ (Latency).
- **Không ra Key (Pity):** Sau hiệu ứng mở rương, một "Mảnh vỡ Không gian" nhỏ bay ra và rơi vào thanh tiến trình Pity (hiển thị X/100). Cảm giác "ít nhất tôi có thứ gì đó" quan trọng về mặt tâm lý.
- **Đúc Key:** Khi đủ 100 mảnh, thanh Pity sáng lên, nút "Đúc Key" xuất hiện với hiệu ứng rực rỡ.

### 3.5. Không gian Cao cấp (Key-Unlocked Areas)
- **Chuyển đổi Không gian (Garden Switcher):** User có nhiều vùng đất sẽ có nút dạng "Bản đồ nhỏ" (Minimap) để chuyển đổi mượt mà giữa các không gian (Khu vườn chính, Nhà Kính Tuyết, Vườn Trên Mây).
- **Theme Độc Quyền:** Mỗi vùng đất có bảng màu (CSS Tokens) và họa tiết nền (Background Pattern) riêng biệt. Ví dụ: Nhà Kính Tuyết có hiệu ứng tuyết rơi tĩnh, Vườn Trên Mây có nền mây trôi bồng bềnh.

### 3.6. Optimistic UI & Offline Queue (Trải nghiệm Không Gián đoạn)
- Khi User bấm "Check-in" cảm xúc lúc mất mạng (ví dụ đi tàu điện ngầm), giao diện tuyệt đối không được hiện lỗi "Mất kết nối".
- **Optimistic Update:** React Query lập tức cập nhật state cục bộ. Cây sẽ lấp lánh và thanh EXP tăng lên ngay lập tức trên UI.
- **Offline Queue:** Ở dưới nền, thao tác này được lưu vào **IndexedDB** thông qua Service Worker. Khi trình duyệt phát hiện thiết bị có mạng trở lại (`navigator.onLine == true`), hệ thống tự động đẩy mảng dữ liệu từ Local Queue lên API `/sync/offline-queue` của Backend để đồng bộ âm thầm.
- **Xử lý OCC Conflict:** Nếu Server phát hiện xung đột phiên bản (ví dụ bạn bè vừa tưới hộ trong lúc offline), Karma được hoàn về Pending Stash và UI hiển thị pop-up dễ thương thay vì báo lỗi.

---

## 4. Quyền Riêng Tư (Privacy-First UX)
- Ứng dụng **tuyệt đối không** yêu cầu quyền Location (Web Geolocation API) để tránh gây lo lắng cho người dùng.
- Việc đồng bộ Timezone chỉ chạy ngầm bằng cách so sánh `Date.now()` của trình duyệt (Browser) với Timestamp của Server mỗi khi người dùng truy cập trang web. Nếu phát hiện lệch giờ do đi du lịch, một Pop-up nhỏ nhắn (không xâm lấn) sẽ hiện lên ở góc màn hình hỏi xem User có muốn đổi múi giờ không.
- Tính năng tìm kiếm bạn bè bằng tên tự do bị **vô hiệu hóa hoàn toàn**. Kết bạn chỉ qua QR/Link mời để tránh quấy rối.
