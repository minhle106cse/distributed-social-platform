# 🛡️ Security & Access Control (Bảo mật & Giới hạn chịu tải)

Bảo mật là ưu tiên hàng đầu, đặc biệt khi hệ thống lưu trữ dữ liệu cảm xúc (Emotion) của người dùng.

---

## 1. Xác thực và Phân quyền (Authentication & RBAC)
- **Access Token:** Sử dụng JWT, thời gian sống ngắn (Short-lived) khoảng 15 phút.
- **Refresh Token:** Lưu dưới dạng HTTP-Only, Secure Cookie (Không lưu trong LocalStorage để chống XSS). Áp dụng cơ chế **Refresh Token Rotation** (Đổi token mỗi lần sử dụng) để chống Replay Attack.
- **CORS:** Chỉ cho phép Domain của Frontend (VD: `https://garden.com`) gọi tới API, block mọi request từ Origin lạ.

## 2. Rate Limiting (Chống Spam)
Sử dụng Redis (Throttler) để áp dụng Rate Limit theo IP hoặc UserID:
- **API Check-in (Habit):** Tối đa `5 request / 1 phút` cho mỗi User. (Tránh cày EXP ảo).
- **API Gacha Roll:** Tối đa `10 request / 1 phút`. (Chống script quay đồ).
- **API Public (Login, Register):** Tối đa `5 request / 5 phút` cho cùng 1 IP (Chống Brute Force).

## 3. Data Privacy (Bảo vệ dữ liệu cảm xúc)
- **Tách biệt dữ liệu:** Dữ liệu Nhật ký tâm trạng (Emotion Logs) của hệ thống RAG/AI phải được tách riêng khỏi thông tin định danh (PII). Khi AI đọc vector của nhật ký, nó chỉ thấy `user_uuid` chứ không thấy tên thật hay email.
- **Khóa AI Agent:** AI (System Runtime Agent) hoàn toàn **Read-only** đối với CSDL chính. Mọi thao tác nó muốn làm (Tặng đồ, gửi thông báo) phải qua một gRPC call nội bộ có token nội bộ cực kỳ khắt khe, không được quyền `UPDATE` trạng thái bảng `KarmaWallet` hay `Habit` trực tiếp bằng SQL.
