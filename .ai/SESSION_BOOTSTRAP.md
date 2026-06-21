# Session Bootstrap — Cortex

> Paste prompt này vào đầu mỗi session mới để AI nắm context nhanh.

---

## Prompt (copy nguyên dòng dưới)

```
Đây là project Cortex — B2B AI Knowledge Hub (RAG + Hybrid Search + Credit Economy).
Monorepo Turborepo + TypeScript. Architecture: Hexagonal + CQRS + Event Sourcing + Multi-tenancy.

Bước 1 — đọc ngay bây giờ:
- .ai/KNOWLEDGE_INDEX.md (toàn bộ — source of truth duy nhất)
- .ai/PROJECT_STATUS.md (trạng thái phase hiện tại)

Bước 2 — trước khi code bất kỳ thứ gì:
- Đọc directive liên quan trong directives/ (multi_tenancy.md, folder_structure_sop.md, cqrs_pattern.md...)
- Nếu task phức tạp: search .ai/memory/*.jsonl cho gotchas liên quan

Snapshot tiến độ (có thể stale — luôn kiểm tra lại KNOWLEDGE_INDEX §2):
- Overall ~22% · Phase 0 ✅ · Phase 1 🟡 ~55%
- Đã xong: auth (JWT RS256 + refresh rotation), RBAC, user (auth-service), tenant (core-api)
- NEXT: knowledge-module (core-api) — schema có sẵn, chưa có code
- Phases 2–8: chưa bắt đầu

Hard rules (không cần đọc lại, nhớ luôn):
- Chạy python/node → docker exec agent-sandbox ... (KHÔNG chạy trực tiếp host, KHÔNG dùng -it)
- Không infra code trong common/ · Không console.log · Không autoincrement() PK · Không CORS ['*']
- Mọi entity: UUID PK, camelCase code / snake_case DB, soft delete bằng deletedAt
- Sau task: log .ai/memory/<category>.jsonl + update directives/ + update PROJECT_STATUS.md nếu phase đổi

Task hôm nay: [mô tả task ở đây]
```

---

## Hướng dẫn dùng

1. Copy toàn bộ block trên
2. Thay dòng cuối `Task hôm nay: [mô tả task ở đây]` thành task thật
3. Paste vào đầu session mới

Thời gian AI cần để nạp context sau prompt này: **1 lần đọc KNOWLEDGE_INDEX (~4,000 tok)** thay vì grep mò cả codebase.
