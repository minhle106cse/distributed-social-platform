# 📋 SYSTEM USE CASES (GrowthGarden V2)

Tài liệu này đặc tả các luồng tương tác giữa User và System theo định hướng "Cozy & Healing". Dựa vào đây để đội ngũ QA/Developer nắm bắt luồng nghiệp vụ thực tế.

---

## 1. THÓI QUEN & GAMIFICATION (Habit & Garden)

### UC1.1: Trải nghiệm Check-in Thói quen Tích cực (Build Habit)
- **Pre-condition:** Hôm nay user A có thói quen "Đọc sách 30 phút". Mầm cây đang ở trạng thái `GROWING`.
- **Action:** User A click hoàn thành thói quen trên Web App.
- **Expected Result:** UI bắn tia sáng tưới vào cây. Cây nhận điểm EXP. Nếu đủ EXP, cây tiến hóa sang cấp độ tiếp theo. Backend lưu `Habit` và bắn event `HABIT_COMPLETED` vào bảng `EventOutbox`.

### UC1.2: Xử lý Trạng thái "Ngái ngủ" (Grace Period)
- **Pre-condition:** Đã qua 00:00 ngày mới, nhưng chưa tới 10:00 sáng. User chưa check-in hôm qua.
- **Action:** User A truy cập Web App lúc 8:00 sáng.
- **Expected Result:** Cây hiển thị icon `ZZZ` (Ngái ngủ) qua mask mờ. User A click check-in hồi tố cho ngày hôm qua. Cây lập tức tỉnh dậy (bỏ mask), nhận EXP bình thường và không bị héo úa. 

### UC1.3: Dọn dẹp Mùa Xuân (Spring Cleaning)
- **Pre-condition:** User A bỏ app 10 ngày. Trạng thái User là `HIBERNATING`. Toàn bộ vườn bị "Băng phong".
- **Action:** User A quay lại, hoàn thành thói quen "Đọc sách" liên tục trong 3 ngày.
- **Expected Result:** Ngày thứ 3 hoàn thành, hệ thống tự động rã đông toàn bộ khu vườn. Cây cối trở về trạng thái bình thường mà không bị trừ cấp độ.

### UC1.4: Trải nghiệm Thói quen Từ bỏ (Quitting Habit) & Cây Vệ thần
- **Pre-condition:** User A thiết lập thói quen "Không uống trà sữa" (Type: QUIT). Cây Vệ thần đang ở trạng thái `GROWING`.
- **Action 1 (Thành công):** User A KHÔNG làm gì cả. Khi hệ thống điểm danh lúc 00:00 (thông qua Cronjob/Kafka), hệ thống xác nhận không có event vi phạm trong ngày.
- **Expected Result 1:** Cây Vệ thần nhận EXP và sinh ra hiệu ứng "Khiên Năng Lượng".
- **Action 2 (Phá giới):** User A lỡ uống trà sữa và bấm nút "Report Lapse" trên UI.
- **Expected Result 2:** Cây lập tức chuyển sang trạng thái `POISONED` (Trúng độc). User phải tiêu Karma để gọi API `/cure` (Giải độc), nếu không cây sẽ không thể phát triển vào ngày hôm sau.

---

## 2. SOCIAL HEALING (Tương tác Chữa lành)

### UC2.1: Tưới hộ Cây (Empathetic Watering)
- **Pre-condition:** User B (bạn của A) hôm nay bận rộn, chưa check-in. Cây của B sắp héo.
- **Action:** User A ghé thăm khu vườn của B, bấm "Tưới nước" giúp B.
- **Expected Result:** Cây của B sống sót qua hôm đó. User A nhận được điểm `Karma` như một phần thưởng vì lòng tốt. Giới hạn tưới hộ: 3 lần/tháng đối với 1 người bạn cụ thể.

### UC2.2: Xử lý "Ghost Branch" (Cây thần Đồng đội)
- **Pre-condition:** Nhóm 5 người cùng góp nước trồng "Cây Thần". User C trong nhóm đột nhiên biến mất 4 ngày (AFK).
- **Action:** Cronjob kiểm tra hoạt động nhóm.
- **Expected Result:** Hệ thống biến phần đóng góp của C thành "Ghost Branch" (Cành tinh linh - trong suốt). Nhóm 4 người còn lại vẫn có thể tiếp tục trồng cây thần mà không bị block. Khi C quay lại và hoàn thành chuỗi 3 ngày, Ghost Branch mới phục hồi thành cành thật.

### UC2.3: Xây dựng Mạng lưới Xã hội Khép kín
- **Pre-condition:** User A muốn tìm bạn bè để tương tác.
- **Action 1 (Invite):** User A tạo Link/Mã QR Invite và gửi cho User B qua tin nhắn riêng. User B bấm vào Link.
- **Action 2 (Match-making):** User A bật tính năng "Tìm bạn cùng mục tiêu". Hệ thống quét các user ẩn danh đang trồng cùng loại Guardian Plant "Không uống trà sữa" và đề xuất kết bạn.
- **Expected Result:** Hai user trở thành bạn bè và có thể thấy Khu vườn của nhau. Tính năng tìm kiếm bằng tên tự do bị vô hiệu hóa hoàn toàn để tránh quấy rối.

---

## 3. KINH TẾ BỀN VỮNG (Economy & Gacha)

### UC3.1: Gacha Hạt Giống Hiếm
- **Pre-condition:** User A có 500 `Karma`.
- **Action:** User A dùng 100 `Karma` để quay Gacha lấy Hạt giống.
- **Expected Result:** Lệnh mua được bọc trong `Saga Pattern`. Trừ 100 Karma. Nếu rơi ra "Bonsai Khởi Nguyên", vật phẩm tự động được gán `isSoulbound = true` và đưa vào Inventory. Không thể chuyển nhượng vật phẩm này cho bất kỳ ai.

### UC3.2: Tái chế Vật Phẩm (Stardust System)
- **Pre-condition:** User A có 1 chậu cây dư thừa.
- **Action:** A chọn "Tái chế" chậu cây.
- **Expected Result:** Vật phẩm bị xóa khỏi Inventory. User nhận được `StardustSpring` (Bụi mùa giải hiện tại). Nếu hết mùa giải (Season kết thúc), bụi này tự động convert thành `LegacyStardust` (Giảm 50% giá trị).

### UC3.3: Chạm ngưỡng Cày Karma (Global Daily Cap)
- **Pre-condition:** User A đã kiếm đủ 500 Karma trong ngày hôm nay.
- **Action:** User A tiếp tục check-in hoàn thành 1 thói quen (Build Habit).
- **Expected Result:** Hành động check-in vẫn lưu thành công. Cây nhận EXP lớn lên bình thường. Tuy nhiên, API trả về `karmaEarned: 0` do đã chạm ngưỡng Daily Cap. UI hiện popup thông báo: "Bạn đã làm rất tốt hôm nay, nhưng túi Karma đã đầy rồi! Hãy nghỉ ngơi nhé."

### UC3.4: Đăng ký Gói Sinh tồn (Premium Subscription)
- **Pre-condition:** User A muốn trồng thêm thói quen thứ 6, nhưng Khu vườn 1 đã chật (giới hạn 5 cây).
- **Action:** User A thanh toán gói Premium qua cổng thanh toán.
- **Expected Result:** Hệ thống nâng `UserTier` lên `PREMIUM`. User A được mở khóa khu "Nhà kính tuyết" (Khu vườn 2) và tính năng "AI Phân tích Chuyên sâu". Tuyệt đối không nhận được vật phẩm Gacha hay Karma từ giao dịch này.

---

## 4. XỬ LÝ BACKGROUND (Cronjob & AI Sourcing)

### UC4.1: Đồng bộ Log cho AI (UserAuditLog)
- **Action:** Khi User hoàn thành một Habit, hoặc báo cáo Cảm xúc (Emotion).
- **Expected Result:** Thay vì lưu chung vào bảng nghiệp vụ làm nặng DB, hệ thống tách riêng và ghi dữ liệu dạng JSONB vào bảng `UserAuditLog`. AI Agent (Langchain/MCP) sau đó sẽ query bảng này theo dạng Timeseries để phân tích chu kỳ cảm xúc của User mà không gây ảnh hưởng (Lock) tới các giao dịch tài chính hay thói quen hiện tại.
