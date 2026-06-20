# QA Standard & Active Reflection

**Mục đích:** Hướng dẫn các Agent không bao giờ báo cáo "hoàn thành" một nhiệm vụ nếu chưa có bước kiểm định độc lập (Auto-Evaluation). 

Đây là quá trình nâng cấp Agent từ Cấp độ 3 (Reactive) lên Cấp độ 4/5 (Reflective).

## Nguyên tắc 1: Luôn giả định Code có lỗi (Zero Trust)
Bất kể bạn viết một file Python script trong `execution/` hay sửa code trong dự án (`apps/`), bạn không bao giờ được phép cho rằng code đó sẽ chạy đúng ngay lần đầu. 
- Mọi logic thêm mới phải đi kèm với Unit Test.
- Mọi sửa đổi vào luồng nghiệp vụ hiện tại phải chạy lại toàn bộ Unit Tests hiện có (`npm run test` hoặc `pytest`).

## Nguyên tắc 2: Active Reflection (Tự phản biện)
Trước khi đưa ra kết luận hoàn tất, hãy trải qua chu trình sau:
1. **Lập giả thuyết (Hypothesis):** Chức năng này làm gì? Đầu vào là gì? Đầu ra mong đợi là gì?
2. **Kích hoạt chạy thử (Test run):** Cố ý đưa một tham số sai để xem hàm có handle error tốt không. Đưa tham số đúng để xem dữ liệu output.
3. **Phân tích (Reflection):** Output có thực sự khớp với giả thuyết không? Có warning nào in ra terminal không? (Nếu có warning TS hoặc linter, phải fix ngay, không bỏ qua).

## Nguyên tắc 3: Auto-Evaluation (Chấm điểm tự động)
Nếu bạn được giao một Task phức tạp (vd: Xây dựng Module X), hãy thiết lập một file `verification_script.py` hoặc `.ts` để tự động:
- Gọi API endpoint vừa tạo.
- Query lại Database xem dữ liệu đã được lưu đúng chưa.
- Kiểm tra các liên kết (relationships) xem có hợp lệ không.
Nếu `verification_script` pass, bạn mới được báo cáo Done.

## Workflow Cụ thể khi hoàn thành 1 Task:
1. Code feature / Fix bug.
2. Viết / Cập nhật Test case.
3. Chạy `npm run test` hoặc lệnh test tương ứng. Đọc log cẩn thận.
4. Nếu FAIL → Quay lại bước 1.
5. Nếu PASS → Nếu cấu trúc phức tạp, chạy verification script trên môi trường Harness.
6. Khi hoàn toàn yên tâm:
   - Append lessons vào `.ai/memory/<category>.jsonl` (bắt buộc nếu có gotcha mới)
   - Cập nhật directive liên quan nếu có pattern mới được thiết lập
   - Báo cáo Done với user
