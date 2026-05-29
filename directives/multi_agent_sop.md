# Multi-Agent Collaboration SOP (Level 4)

**Mục đích:** Khi một User Request có độ phức tạp cao, đòi hỏi phải đọc qua hàng nghìn dòng tài liệu, phân tích nhiều logs cùng lúc hoặc tìm kiếm thông tin bên ngoài diện rộng, việc xử lý toàn bộ bằng một Orchestrator duy nhất sẽ gây quá tải bộ nhớ ngữ cảnh (Context Window) hoặc làm Agent mất tập trung vào mục tiêu chính (Drift).

Hướng dẫn này áp dụng cơ chế Multi-Agent (Cộng tác Đa tác tử).

## Quy tắc Điều phối (Orchestration Routing)

### 1. Nhận diện Task lớn (Task Decomposition)
Khi gặp yêu cầu nghiên cứu, đọc hiểu codebase lạ, phân tích log phức tạp:
- Thay vì tự dùng lệnh `cat` hay đọc toàn bộ file bằng tool mặc định, Orchestrator phải ngắt công việc đó ra thành một bài toán nhỏ độc lập.

### 2. Sử dụng Sub-Agent
Trong môi trường hệ thống này, bạn có thể được cung cấp công cụ `invoke_subagent` (hoặc các plugin agent chuyên trách).
Hãy truyền đạt rõ cho Sub-agent:
- **Ngữ cảnh:** "Bạn đang xử lý phần nào của hệ thống?"
- **Mục tiêu:** "Cần đọc hiểu file X và trả lời cho tôi biết hàm Y thực hiện kết nối database thế nào."
- **Định dạng trả về:** "Chỉ trả về 1 list các bước hoặc một file JSON, không dài dòng".

### 3. Hội tụ kết quả (Aggregation)
Sau khi Sub-agent trả về kết quả, Orchestrator đọc kết quả, tổng hợp lại vào file kế hoạch `implementation_plan.md` hoặc `task.md` của riêng mình và ra quyết định tiếp theo.

## Các Role Phổ biến (Tham khảo cho tương lai):
- **Planner Agent:** Chuyên nhận requirement thô, tạo task breakdown.
- **Coder Agent:** Nhận input cực kỳ chi tiết (từ Planner) để chỉ tập trung viết mã.
- **Reviewer/QA Agent:** Dùng để đối chiếu output sinh ra với tiêu chuẩn trong `directives/`.

Bằng cách tuân thủ SOP này, toàn bộ hệ thống trở nên phân tán, chịu lỗi tốt hơn và xử lý được lượng ngữ cảnh lớn gấp nhiều lần.
