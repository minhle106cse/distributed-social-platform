# Auto-Tool Generation SOP

**Mục đích:** Khi Agent Orchestrator gặp một tác vụ lặp đi lặp lại hoặc cần truy xuất dữ liệu từ API/Web mà trong `execution/` chưa có công cụ nào đáp ứng, Agent được cấp quyền (và khuyến khích) tự viết ra các script (tools) mới để sử dụng lâu dài. Đây là bước đệm tiến lên Cấp độ 5.

## Vòng lặp tự xây dựng công cụ (Tool Builder Loop)

Khi bạn quyết định tạo ra một Tool mới, hãy tuân thủ nghiêm ngặt 4 bước sau:

### 1. Phân tích Yêu cầu (Tool Spec)
- Tool này nhận đầu vào là gì? (Ví dụ: `URL`, `keyword`, `JSON`).
- Tool này trả về đầu ra là gì? (Phải luôn là JSON hoặc dữ liệu cấu trúc rõ ràng lưu vào `.tmp/`).
- Tool này có cần gọi API bên ngoài hay sử dụng library nào không?

### 2. Viết Code theo Chuẩn (Execution Standard)
Tạo một file `.py` mới trong thư mục `execution/`.
Luôn tuân thủ các quy tắc sau khi viết tool:
- Bắt buộc phải import và sử dụng `utils.py` cho mục đích đọc biến môi trường (`load_env`) và ghi file kết quả (`write_intermediate`).
- Bắt buộc xử lý Try-Catch toàn diện (bắt `Exception` chung hoặc các exceptions cụ thể) để tool KHÔNG BAO GIỜ bị crash ngầm. Nếu lỗi, in ra log có cấu trúc để Agent có thể đọc được.
- Code phải Deterministic (tính xác định) - truyền cùng input phải luôn trả về cùng output.

### 3. Tự viết Unit Test (Sandbox Evaluation)
Ngay sau khi viết file `tool.py`, hãy viết một file nhỏ tên là `test_tool.py` trong `.tmp/`.
- File test này sẽ mock các request nếu cần thiết.
- Gọi vào `tool.py` với tham số test.
- Chạy script test này thông qua Docker Harness (`docker exec -it agent-sandbox python /usr/src/app/.tmp/test_tool.py`).

### 4. Đăng ký Tool
Nếu test pass:
1. Bổ sung docstring hoàn chỉnh trên đầu file tool mới.
2. Thêm file đó vào danh mục công cụ (có thể ghi chú vào một file `execution/README.md` nếu có).
3. Bắt đầu gọi nó trong luồng Orchestration để giải quyết yêu cầu của User.

> **CẢNH BÁO:** Không tạo các tool chạy vô tận (while True) không có timeout. Mọi HTTP request phải có tham số `timeout=10` (hoặc số giây phù hợp) để tránh treo hệ thống Harness.
