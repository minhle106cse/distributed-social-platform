# SOP: Agent Memory (Experience Buffer) v2

> [!IMPORTANT]
> Directive này quy định khi nào và cách Agent phải tương tác với Knowledge System.
> **Hệ thống mới**: Tri thức nằm trong `.ai/` thay vì phụ thuộc Docker cho mọi thao tác.

---

## 📋 Tổng Quan Hệ Thống Tri Thức

```
.ai/
├── KNOWLEDGE_INDEX.md    ← ĐỌC TRƯỚC TIÊN mỗi phiên (auto-generated)
├── knowledge_builder.py  ← Script tạo/cập nhật KNOWLEDGE_INDEX.md
└── memory/               ← Kinh nghiệm phân loại (JSONL format)
    ├── errors.jsonl       # Error → Solution pairs
    ├── architecture.jsonl # Architecture decisions  
    ├── conventions.jsonl  # Coding conventions
    └── gotchas.jsonl      # Framework/library gotchas
```

---

## ⚙️ Quy Trình Đầu Phiên (Session Start Protocol)

Khi bắt đầu conversation mới, **BẮT BUỘC theo thứ tự**:

1. **Đọc `.ai/KNOWLEDGE_INDEX.md`** — Toàn bộ context dự án ngay lập tức
2. **Nếu task phức tạp**: Đọc thêm file `.ai/memory/*.jsonl` liên quan
3. **Đọc `directives/*.md`** liên quan đến khu vực code sẽ thay đổi

> **Ưu điểm so với v1**: Không cần Docker đang chạy để đọc tri thức. Agent đọc file trực tiếp.

---

## 📋 Khi nào phải SEARCH Memory?

**BẮT BUỘC đọc memory files trước khi bắt tay vào các loại task sau:**

| Loại Task | File cần đọc |
|---|---|
| Debug lỗi TypeScript/Prisma/Jest | `errors.jsonl` + `gotchas.jsonl` |
| Thiết kế pattern mới (CQRS, Repository, Middleware) | `architecture.jsonl` |
| Cấu hình hạ tầng (Docker, Prisma schema, JWT) | `gotchas.jsonl` |
| Refactor kiến trúc | `architecture.jsonl` + `conventions.jsonl` |
| Viết code mới trong module | `conventions.jsonl` |

**Cách search**: Đọc trực tiếp file JSONL hoặc dùng `grep_search` tool.

---

## 📝 Khi nào phải LOG Memory?

**BẮT BUỘC log SAU KHI giải quyết thành công:**

- Lỗi build/test không hiển nhiên → `errors.jsonl`
- Gotcha về thư viện hoặc framework → `gotchas.jsonl`
- Pattern/Anti-pattern kiến trúc → `architecture.jsonl`
- Convention mới được thiết lập → `conventions.jsonl`
- **Quyết định thiết kế quan trọng** (chọn approach A thay vì B) → `architecture.jsonl`
- Bất kỳ vấn đề nào mất hơn 10 phút để giải quyết

**Hai format entry:**

Format cho lỗi/bug (reactive):
```json
{"id": 26, "timestamp": "2026-06-13T20:00:00+07:00", "error": "Mô tả vấn đề", "solution": "Cách giải quyết", "context": "File/module liên quan"}
```

Format cho quyết định thiết kế (proactive — khi chọn một approach và bỏ qua approach khác):
```json
{"id": 27, "timestamp": "2026-06-13T20:00:00+07:00", "decision": "Mô tả quyết định", "rationale": "Lý do chọn", "alternatives": "Các lựa chọn đã bỏ qua và lý do loại", "context": "File/module liên quan"}
```

---

## 🔄 Cập Nhật Knowledge Index

Khi directives thay đổi đáng kể hoặc nhiều memory entries mới được thêm, chạy:

```bash
# Nếu agent-sandbox đang chạy:
docker exec agent-sandbox python .ai/knowledge_builder.py

# Nếu sandbox không chạy (thường gặp trong local dev):
python .ai/knowledge_builder.py
```

> **Khi nào cần chạy**: Sau khi sửa bất kỳ file nào trong `directives/`, append nhiều entries vào memory, hoặc thêm module mới vào `apps/`.

Lệnh này sẽ re-scan toàn bộ `directives/`, `docs/`, `.ai/memory/`, `apps/`, `packages/` và tạo lại `KNOWLEDGE_INDEX.md`.

---

## 🔄 Tự Động Hóa Tri Thức (Self-Annealing Loop)

**QUY TẮC SỐNG CÒN (KHÔNG ĐỢI USER NHẮC NHỞ):**
Nếu trong quá trình refactor hoặc code, một design pattern mới được chốt, hoặc một ranh giới kiến trúc (architectural boundary) được làm rõ, Agent **BẮT BUỘC** phải tự động:
1. Ghi bài học đó vào `.ai/memory/<category>.jsonl` — dùng format `decision` nếu là quyết định thiết kế chủ động
2. Mở file `.md` liên quan trong thư mục `directives/` (hoặc tạo mới nếu cần) và cập nhật quy tắc đó ngay lập tức
3. **Nếu thay đổi giải quyết hoặc mâu thuẫn với bất kỳ nội dung nào trong `docs/*.md`** (review findings, API contracts, schema docs) → cập nhật file `docs/` đó luôn
4. Việc này phải được diễn ra **TRƯỚC KHI** báo cáo task hoàn thành

---

## ⚠️ Quy tắc an toàn

- Không bao giờ chạy `python` trực tiếp trên host — luôn dùng `docker exec agent-sandbox python`
- **KHÔNG dùng `-it` flag** trong docker exec (gây lỗi TTY trong automation)
- File memory tại `.ai/memory/` không được commit vào Git (đã có trong `.gitignore`)
- `KNOWLEDGE_INDEX.md` và `knowledge_builder.py` ĐƯỢC commit (shared knowledge)
