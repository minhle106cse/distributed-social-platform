# SOP: Agent Memory (Experience Buffer)

> [!IMPORTANT]
> Directive này quy định khi nào và cách Agent phải tương tác với Experience Buffer (`.tmp/agent_memory.json`) thông qua `execution/memory_manager.py`.

---

## 📋 Khi nào phải SEARCH Memory?

**BẮT BUỘC search trước khi bắt tay vào các loại task sau:**

| Loại Task | Lý do |
|---|---|
| Debug lỗi TypeScript/Prisma/Jest | Lỗi này có thể đã gặp trước đó |
| Thiết kế pattern mới (CQRS, Repository, Middleware) | Xem có bài học hoặc anti-pattern đã ghi nhận chưa |
| Cấu hình hạ tầng (Docker, Prisma schema, JWT) | Có nhiều gotcha được log sẵn |
| Refactor kiến trúc | Tránh lặp lại sai lầm về Hexagonal boundaries |

**Cách search:**
```bash
docker exec agent-sandbox python execution/memory_manager.py search --query "prisma transaction hexagonal"
```
> Dùng nhiều keyword không cần exact match. Ví dụ: `"CQRS middleware retry"`, `"jest esm import"`.

---

## 📝 Khi nào phải LOG Memory?

**BẮT BUỘC log SAU KHI giải quyết thành công:**

- Lỗi build/test không hiển nhiên
- Gotcha về thư viện hoặc framework (vd: Prisma v7 breaking change)
- Pattern/Anti-pattern kiến trúc phát hiện trong quá trình làm việc
- Bất kỳ vấn đề nào mất hơn 10 phút để giải quyết

**Cách log:**
```bash
docker exec agent-sandbox python execution/memory_manager.py log \
  --error "Mô tả vấn đề gặp phải" \
  --solution "Cách giải quyết cụ thể" \
  --context "File hoặc module liên quan"
```

---

## 📃 Khi nào LIST Memory?

Dùng để tổng quan hoặc kiểm tra memory trong quá trình thanh tra:
```bash
# 5 entries mới nhất
docker exec agent-sandbox python execution/memory_manager.py list --limit 5

# Toàn bộ
docker exec agent-sandbox python execution/memory_manager.py list
```

---

## ⚙️ Quy Trình Đầu Phiên (Session Start Protocol)

Khi nhận một task phức tạp (liên quan đến cấu trúc, lỗi khó, hoặc pattern mới), thứ tự bắt buộc:

1. **Search memory** với 2-3 keyword liên quan đến task.
2. Đọc kết quả và điều chỉnh approach.
3. Thực thi.
4. **Log** bài học sau khi hoàn thành (nếu có điều gì đáng nhớ).

---

## ⚠️ Quy tắc an toàn

- Không bao giờ chạy `python execution/memory_manager.py` trực tiếp trên host.
- Luôn dùng `docker exec agent-sandbox python execution/memory_manager.py`.
- File memory tại `.tmp/agent_memory.json` không được commit vào Git (đã có trong `.gitignore`).
