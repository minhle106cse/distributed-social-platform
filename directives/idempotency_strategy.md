# SOP: Idempotency Strategy for Event Consumers

> Delivery trong hệ này là **at-least-once** (outbox republish, reaper reset INFLIGHT, redeliver khi commit offset fail). Mọi handler PHẢI an toàn khi cùng một event chạy lại. Directive này chốt *cách* đảm bảo điều đó, *ở đâu*, và *khi nào* phải đổi cách.
>
> Đọc cùng `eventing_patterns.md` (§4 Inbound). Nguồn: Idempotent Receiver (EIP, Hohpe & Woolf); Inbox/Outbox (microservices.io).

---

## Quyết định (2026-07-02)

**Dedup đặt tại điểm ghi DB — KHÔNG dùng bảng inbox/ProcessedEvent tập trung.**

Lý do: mọi side effect hiện thời là *ghi DB, cùng database với hiệu ứng*. Với ràng buộc đó, `INSERT … ON CONFLICT DO NOTHING` (hoặc upsert/delete theo PK) cho idempotency **nguyên tử theo bản chất** — dedup-key và hiệu ứng là **một câu lệnh**, không có khe hở crash. Một bảng inbox riêng tách dedup khỏi hiệu ứng thành 2 câu → phải bọc transaction để ghép lại → phức tạp hơn mà không an toàn hơn. Đây là dạng *chặt nhất* của Idempotent Receiver, không phải bản rút gọn.

> `Kafka exactly-once (EOS)` KHÔNG áp dụng ở đây: EOS chỉ đúng cho read-process-write mà "write" quay lại Kafka. Hiệu ứng của ta ghi ra Postgres — Kafka transaction không kéo lệnh ghi Postgres vào được. Vẫn phải idempotent writes.

---

## Hai pattern được phê duyệt (đừng tưởng là thiếu nhất quán)

Handler khai báo pattern của mình qua field `idempotency` (bắt buộc, xem Enforcement):

| `idempotency` | Khi nào dùng | Cơ chế |
|---|---|---|
| `natural-key` | Hiệu ứng là set-membership (theo PK) | upsert / delete by PK → re-apply là no-op tự nhiên. KHÔNG cần `event.id`. |
| `dedup-constraint` | Hiệu ứng là **append** (không tự idempotent) | Unique key trên `event.id` (`sourceEventId`) + `ON CONFLICT DO NOTHING` → re-apply chèn 0 row. |
| `none` | Chỉ cho handler thật sự read-only/no-op | **Bị `EventRouter.register` từ chối** nếu handler có side effect. |

Ví dụ hiện có: `FollowCreated/Removed` = `natural-key` (upsert/delete `space_followers` theo `[spaceId,userId]`); `ItemPublished` fan-out = `dedup-constraint` (`@@unique([recipientUserId, sourceEventId])`).

---

## Enforcement — invariant được ÉP BUỘC, không được NHỚ

Rủi ro thật không phải handler hôm nay, mà là **handler tương lai quên** làm idempotent (vd `reputationRepo.increment(+10)` → redeliver → +20). Không được để reviewer "để ý". Hai lớp cứng:

1. **Compile-time (chính):** `IIntegrationEventHandler.idempotency` là field **bắt buộc** (shared-kernel `messaging/event-router.ts`). Handler thiếu → `error TS2420` khi typecheck. Không compile nổi = không tồn tại.
2. **Boot-time (belt & suspenders):** `EventRouter.register()` ném nếu `idempotency === 'none'` → app không boot được với handler không an toàn, fail loud ngay startup thay vì âm thầm hỏng ở lần redeliver đầu.

Đây theo đúng triết lý dự án: *bất biến bằng TYPE (compile-time) hơn runtime guard* (xem `domain_modeling.md`).

---

## Observability (làm thất bại thầm lặng lộ ra)

Dedup hỏng theo 2 kiểu vô hình: **false negative** (lọt trùng → data phình) và **false positive** (ăn nhầm event thật → mất notification). Metrics ở `notification-service` (`/metrics`, prom-client):

- `notification_dedup_skipped_total` — spike = producer republish loạn / partition key sai; ~0 mãi sau deploy = dedup có thể không chạy như tưởng.
- `notification_dlq_total{reason}` — bất kỳ rate > 0 nào cũng cần triage.
- `notification_handler_retry_total{eventType}` — retry transient trước khi DLQ.

---

## Tripwire — XEM LẠI quyết định này NGAY khi:

- một handler làm side effect **ra hệ thống ngoài** (email, push mobile, payment, gọi service khác), **hoặc**
- một handler làm side effect **không idempotent tự nhiên** mà không có dedup-constraint (counter, số dư, ledger tăng dần).

Lúc đó `ON CONFLICT` không cứu được → phải nâng cấp.

### Đường lùi (đã kiểm tra là RẺ — lý do dám chọn đơn giản)

Thêm Transactional Inbox như một **decorator bọc `EventRouter`**, KHÔNG đụng một dòng handler:

```typescript
class IdempotentRouter {
  async route(event) {
    if (await this.inbox.seen(event.id)) return
    await this.txManager.run(async () => {
      await this.inner.route(event)      // hiệu ứng
      await this.inbox.mark(event.id)    // + đánh dấu — CÙNG transaction, cùng DB
    })
  }
}
```

Điều kiện đúng: side effect của handler và `inbox.mark` phải cùng một DB transaction. Với side effect ra hệ thống ngoài → dùng idempotency-key trên chính lời gọi đó thay vì inbox.

### YAGNI — vì sao KHÔNG dựng inbox bây giờ

Chưa có side effect ngoài DB nào. Dựng inbox lúc này = thêm bảng (phải TTL/prune) + thêm write + thêm transaction cho một rủi ro chưa tồn tại — và **kém an toàn hơn** `ON CONFLICT` một-câu. Chọn đơn giản ở đây là quyết định có kỷ luật (đường lùi đã chứng minh rẻ), không phải lười.

---

## 🔗 Liên quan
- `eventing_patterns.md` §4 — outbox, dispatch, retry→DLQ
- `resilience_patterns.md` §1 — Idempotency (bản gốc, HTTP layer)
- `domain_modeling.md` — triết lý "type over runtime guard"
