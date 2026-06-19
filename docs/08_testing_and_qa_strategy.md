# 🧪 CHIẾN LƯỢC TESTING (TESTING & QA STRATEGY)

> 📖 **[English Version](./en/08_testing_and_qa_strategy.md)**

Kiến trúc **Cortex** dùng Event Sourcing (credit), CQRS, Saga, Idempotency, Hybrid Retrieval và Multi-tenancy. Chiến lược testing tập trung vào **tính toàn vẹn sổ cái credit (Ledger Integrity)**, **cô lập tenant (Tenant Isolation)**, **chất lượng tìm kiếm (Search Relevance)**, và **sức bền hệ thống phân tán (Distributed Resiliency)**.

> Tham chiếu chuẩn: `directives/testing_standard.md` (co-location `*.spec.ts`, mock `jest.Mocked<Interface>`, path alias `@/`).

---

## 1. Unit Testing — Pure Business Logic

Test logic thuần — không đụng DB, không đụng Framework.

### Kịch bản
- **OCC Versioning:** update với `version` cũ → ném `OccConflictError`.
- **Credit Ledger (replay):**
  - Replay `[Purchased +100, Spent -5, Refunded +5]` → balance = 100.
  - Edge: refund nhiều hơn spent (không được âm) → invariant guard.
- **Reciprocal Rank Fusion:** trộn 2 danh sách rank → thứ tự hợp nhất đúng công thức RRF.
- **Reputation rules:** accept answer → +N điểm; verified → +M; vote rút lại → trừ đúng.
- **Idempotency key resolver:** cùng key → cùng kết quả cached.

---

## 2. Integration Testing (Testcontainers)

Dùng **Testcontainers** dựng Postgres(+pgvector), Redis, Kafka thật.

- **Outbox atomicity:** publish document → `knowledge_items` + `outbox_events` cùng commit; rollback thì cả hai biến mất.
- **Re-index/Re-embed consumer:** phát `DocumentPublished` → ES có doc + `embeddings` có vector (mock AI embedding deterministic).
- **OCC race:** 2 update đồng thời cùng `version` → đúng 1 thành công, 1 nhận 409.
- **pgvector search:** insert embeddings, query → trả đúng top-K cosine, **scoped orgId**.

---

## 3. Saga & Resiliency Testing

| Kịch bản | Kỳ vọng |
|---------|---------|
| **AI-Query Saga happy path** | reserve → RAG OK → commit spend; balance giảm đúng |
| **AI-Query Saga refund** | RAG fail (Circuit OPEN) → refund; balance KHÔNG đổi |
| **Bounty Saga** | accept → award + reputation + notify; fail giữa chừng → refund stake |
| **Circuit Breaker** | 5 lỗi liên tiếp → OPEN → fallback keyword; sau 30s → HALF-OPEN |
| **DLQ** | message lỗi schema → vào `*-dlq`, worker không crash; replay được |
| **Idempotency** | gửi cùng key 2 lần → 1 lần trừ credit |

---

## 4. Tenant Isolation Testing (Bảo mật B2B — bắt buộc)

- User org A query knowledge/search/credit → **0 record của org B** (403 / empty).
- **AI Data Boundary:** RAG cho org A **không bao giờ** lấy embedding của org B vào context (kiểm tra retrieval filter `org_id`).
- Quota: vượt seat / AI rate-limit của org A không ảnh hưởng org B (noisy-neighbor).

---

## 5. Search Relevance Testing (Golden Set)

- Bộ **golden queries** (query → expected top-K item).
- Đo **Recall@K** và **MRR** cho: keyword-only, semantic-only, hybrid (RRF).
- **Regression gate:** sau thay đổi pipeline / sau Phase 7 migration, relevance KHÔNG được giảm dưới ngưỡng.

---

## 6. Ledger Integrity (Tài sản quan trọng nhất)

- Property test: với chuỗi event ngẫu nhiên hợp lệ, `Sum(events) == BalanceSummary`.
- **Rebuild test:** xóa Read Model → replay Event Store → balance identical.
- **Nightly cron** (Phase 8): verify mọi org; drift → alert + auto-rebuild.

---

## 7. Load & Performance (K6 — Phase 8)

| Test | Threshold |
|------|-----------|
| Search throughput | 1000 concurrent → P99 < 500ms |
| OCC stress | 10 concurrent edit 1 doc → đúng 1 thành công |
| AI rate-limit | vượt quota → 429 đúng, không trừ credit |
| Credit double-spend | 100 concurrent spend cùng key → no double-spend |
| Cache stampede | 100 concurrent hot key → 1 lần rebuild |

---

## 8. QA Gate (theo `directives/qa_standard.md`)

> **Zero Trust:** luôn giả định code có lỗi. **Không** report "Done" nếu chưa có bước verify tự động chạy qua.

- Mọi PR: unit + integration pass, coverage ngưỡng tối thiểu.
- Mọi tính năng tốn credit: phải có test Saga refund + Idempotency.
- Mọi endpoint core-api: phải có test tenant isolation.
