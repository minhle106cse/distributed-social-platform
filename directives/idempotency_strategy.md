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

## 0. Tầng Producer (client/gửi) — lớp riêng, KHÔNG giải quyết được bài toán ở tầng Consumer (2026-07-14)

Toàn bộ file này (từ đây trở xuống) nói về **consumer**. Nhưng có 1 lớp idempotency khác, hẹp hơn nhiều, nằm ở phía **producer**:

```typescript
// kafka-producer.service.ts, dead-letter.producer.ts — cả 2
this.producer = kafkaClient.client.producer({ idempotent: true })
```

`idempotent: true` là tính năng gốc của Kafka (producer ID + sequence number per-partition) — chặn **broker-level duplicate do chính giao thức gửi gây ra**: producer gửi message, broker nhận thành công nhưng ACK bị mất trên đường về, producer (không biết ACK đã mất) tự động retry gửi lại → 2 bản y hệt trong Kafka nếu không bật cờ này. Bật lên, broker tự nhận ra "message tôi đã có rồi" nhờ sequence number, loại bỏ bản trùng — code app không cần biết gì thêm.

**Giới hạn — comment tại `kafka-producer.service.ts` ghi rõ:**
```typescript
// acks=all + maxInFlightRequests≤5). Note delivery is still at-least-once overall
// (the outbox poll loop can re-publish after a crash), so any future consumer
// must be idempotent — the dedup guard lives on the consumer side, not here.
```
`idempotent: true` **không** chặn được trường hợp `PollingPublisherService` crash giữa chừng, restart, rồi publish lại **đúng row outbox đó** (là 1 lần publish "mới" hoàn toàn dưới góc nhìn producer, không phải network-retry) — trùng lặp này nằm ở tầng ứng dụng, producer-flag không biết gì về nó. Toàn hệ thống vẫn là **at-least-once**, không phải exactly-once — đây chính là lý do phần dưới (tầng consumer) tồn tại và bắt buộc.

---

## Hai pattern được phê duyệt (đừng tưởng là thiếu nhất quán)

Handler khai báo pattern của mình qua field `idempotency` (bắt buộc, xem Enforcement):

| `idempotency` | Khi nào dùng | Cơ chế |
|---|---|---|
| `natural-key` | Hiệu ứng là set-membership (theo PK) | upsert / delete by PK → re-apply là no-op tự nhiên. KHÔNG cần `event.id`. |
| `dedup-constraint` | Hiệu ứng là **append** (không tự idempotent) | Unique key trên `event.id` (`sourceEventId`) + `ON CONFLICT DO NOTHING` → re-apply chèn 0 row. |
| `none` | Chỉ cho handler thật sự read-only/no-op | **Bị `EventRouter.register` từ chối** nếu handler có side effect. |

Ví dụ hiện có: `FollowCreated/Removed` = `natural-key` (upsert/delete `space_followers` theo `[spaceId,userId]`); `ItemPublished` fan-out = `dedup-constraint` (`@@unique([recipientUserId, sourceEventId])`); `IndexKnowledge` (search-service) = `natural-key` (pgvector `replaceForItem(itemId,...)` + ES `indexItem` upsert theo `id`, cả 2 đều theo khoá nghiệp vụ).

### Quy tắc quyết định — khi nào bảng cần thêm cột `sourceEventId`

Audit toàn bộ 4 handler hiện có (2026-07-14): **chỉ đúng 1 bảng** (`notifications`) có cột `sourceEventId`. 3 nơi ghi còn lại (`space_followers` ×2, pgvector+Elasticsearch) **không cần**.

Câu hỏi quyết định: **"1 lần event xảy ra có tạo ra dòng MỚI (append) hay không, và nếu có, dữ liệu nghiệp vụ tự nó có đủ để phân biệt 'lần đầu' với 'redeliver của đúng lần đó' không?"**

- Hiệu ứng là **upsert/set/delete theo khoá nghiệp vụ có sẵn** (follow theo `[spaceId,userId]`, chunk theo `itemId`) → khoá đó đã tự nhiên idempotent, redeliver ghi đè/replace đúng chỗ cũ → **KHÔNG cần** `sourceEventId`.
- Hiệu ứng là **append** (tạo N dòng mới, như fan-out notification cho N follower) và **không có** tổ hợp field nghiệp vụ nào phân biệt được "dòng này từ lần xử lý đầu" với "dòng này từ redeliver" → **PHẢI mượn `event.id`** (thứ duy nhất khác nhau giữa 2 event thật, giống nhau giữa 2 lần redeliver cùng 1 event) làm 1 phần `@@unique`.

Thêm `sourceEventId` "cho chắc" vào bảng không cần (như `space_followers`) là dư thừa — PK tự nhiên đã giải quyết xong, thêm cột chỉ tăng surface không tăng an toàn.

### `dedup-constraint` dễ nhầm với `unique-constraint` (CQRS, `resilience_patterns.md` §1.4) — cùng cơ chế DB, khác câu hỏi

Cả 2 đều là `@@unique` + chặn insert trùng — nhưng khoá mang ý nghĩa khác hẳn:

```prisma
// dedup-constraint (Kafka) — khoá gồm sourceEventId, định danh 1 LẦN EVENT XẢY RA
@@unique([recipientUserId, sourceEventId])

// unique-constraint (CQRS, vd Organization.slug) — khoá là 1 THỰC THỂ NGHIỆP VỤ,
// không liên quan gì tới "request/event nào"
@@unique([slug])
```

Phép test phân biệt: khoá đó định danh **1 lần xảy ra cụ thể** (event/request instance — 2 event khác nhau thật KHÔNG BAO GIỜ trùng được khoá này, vì `event.id` luôn khác nhau) hay định danh **1 danh tính nghiệp vụ** (2 hành động độc lập hoàn toàn có thể tình cờ chọn trùng giá trị, như 2 admin cùng chọn `slug: "acme"`)? Loại đầu → idempotency (trả lời "chạy lại có sao không"). Loại sau → concurrency (trả lời "2 cái khác nhau đụng nhau có sao không").

### Vì sao Kafka không có trục "concurrency" song song như CQRS

`CommandSafety` (CQRS) có 2 trục vì HTTP request đến từ bất kỳ đâu, có thể chạm cùng dữ liệu **thật sự đồng thời** — phải tự dựng OCC/unique-constraint để chặn. Kafka thì khác — do cách chọn **partition key**:

```typescript
// follow.entity.ts
static streamKey(userId: string, targetType: FollowTargetType, targetId: string): string {
  return `${userId}:${targetType}:${targetId}`
}
// follow-target.handler.ts — dùng làm aggregateId/partition key của outbox event
aggregateId: Follow.streamKey(command.userId, command.targetType, command.targetId)
```

Mọi event về **cùng 1 quan hệ nghiệp vụ** luôn route vào **cùng 1 partition**; trong 1 consumer group, 1 partition chỉ do đúng 1 consumer xử lý tại 1 thời điểm — Kafka **tự động serialize** việc xử lý các event cùng khoá, miễn phí, nhờ đúng cách chọn partition key. Đây là lý do `IIntegrationEventHandler` chỉ cần khai `idempotency`, không có field concurrency song song nào — cái CQRS phải tự dựng bằng tay thì transport Kafka đã cho sẵn, với điều kiện partition key được chọn đúng theo khoá nghiệp vụ (xem `eventing_patterns.md §4.1` — checklist chọn `aggregateId`).

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
- `eventing_patterns.md` §4 — outbox, dispatch, retry→DLQ; §4.1 checklist chọn `aggregateId`/partition key (quyết định luôn cả việc có bị "đụng độ đồng thời" ở tầng consumer hay không)
- `resilience_patterns.md` §1 — bảng tổng 5 kỹ thuật idempotency (HTTP + Kafka) và khi nào chọn cái nào; `natural-key`/`dedup-constraint` ở đây là 2 trong số đó, HTTP idempotency-key (§1.1 bên đó) là kỹ thuật riêng cho tầng HTTP. §1.4 có `CommandConcurrency` (`occ`/`unique-constraint`/`none`) — trục KHÔNG tồn tại song song ở file này (xem "Vì sao Kafka không có trục concurrency" ở trên) vì lý do khác hẳn CQRS, đừng nhầm `dedup-constraint` với `unique-constraint` dù cùng cơ chế `@@unique`
- `domain_modeling.md` — triết lý "type over runtime guard"
