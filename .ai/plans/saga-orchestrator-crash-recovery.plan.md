# Plan — Saga orchestrator tự sập giữa chừng (durable saga journal + recovery)

- **Ngày:** 2026-08-04 · **Trạng thái:** CHỜ OWNER CHỐT SCOPE (chưa code gì)
- **Bối cảnh:** Trong lúc review `CommandBus` (bỏ cờ `compensation`, thêm `dispatches` +
  `NestedSagaDispatchError`), owner đặt câu hỏi: *"service đang chạy saga mà sập ngay chính
  orchestrator — không phải service khác — thì orchestrator cũng không ghi lại được gì để
  re-process. Kafka lỗi có outbox, producer lỗi có DLQ, gRPC lỗi có saga store; còn orchestrator
  lỗi thì hình như mất luôn."* — **Đúng. Đây là lỗ hổng thật, và nó khác loại với 3 cái kia.**
- **Nguồn:** `docs/adr/0001-transaction-retry-boundary.md` §6b/§9b/§9c,
  `.ai/plans/saga-compensation-outbox.plan.md` (2026-07-30, đã implement).

---

## 1. Vì sao 3 cái "kho" đang có KHÔNG cứu được ca này

Điểm chung của outbox / DLQ / saga-compensation-store: chúng xử lý **lỗi mà process vẫn còn sống**.
Có exception ném ra ⇒ code chạy tới được `catch` ⇒ ghi được vào kho. Orchestrator tự sập là loại
lỗi khác hẳn: **không có exception nào cả**, process biến mất giữa 2 dòng lệnh.

| Loại lỗi | Process orchestrator | Ai ghi lại | Có tự hồi phục? |
|---|---|---|---|
| Kafka publish fail | còn sống | `OutboxEvent` (ghi TRƯỚC khi publish, trong cùng tx) | ✅ `PollingPublisherService` |
| Consumer xử lý fail | còn sống | Topic `<topic>.DLQ` | ✅ `DlqReplayConsumer` |
| gRPC fail / compensation closure tự throw | còn sống | `SagaCompensation` (ghi TRONG `catch`) | ✅ `SagaCompensationReaperService` |
| **Orchestrator OOM / SIGKILL / pod evicted** | **chết** | **không ai** | ❌ **mất trắng** |

Lý do kỹ thuật nằm ở đúng 1 dòng — [command-bus.ts:163](../../packages/shared-kernel/src/cqrs/command-bus.ts):

```typescript
const compensations: Array<{ action: CompensationAction; undo: () => Promise<void> }> = []
```

Mảng này sống trong **heap của process đang chạy**. Nó chỉ được đẩy ra ngoài (qua
`ISagaCompensationStore.recordFailed`) khi **cả hai** điều kiện xảy ra: (1) `handler.execute` throw,
và (2) closure `undo()` trong vòng `for` cũng throw. Tức `SagaCompensation` hiện tại là *"kho cho
compensation đã cố chạy nhưng tự nó fail"*, **không phải** *"nhật ký ghi trước để process khác đọc
lại"*. Outbox làm đúng thứ hai (ghi row PENDING **trước** khi publish); saga thì không.

## 2. Cửa sổ mất mát — mốc thời gian thật của `ProvisionOrgHandler`

[provision-org.handler.ts](../../apps/core-api/src/modules/platform-admin/application/commands/provision-org/provision-org.handler.ts):

```
t0  execute() bắt đầu                                    → chưa có gì durable
t1  authClient.provisionUser(email, K)  ──────► auth-service COMMIT user thật
t2  ctx.onCompensate({cancel-provisioned-user, {userId}}) → chỉ push vào mảng in-memory
t3  ctx.dispatch(CreateOrgCommand)      ──────► core_db COMMIT org + OWNER membership
t4  ctx.onCompensate({archive-org, {orgId}})              → chỉ push vào mảng in-memory
t5  logAudit + return
```

**Sập trong khoảng t1→t2** (kể cả đang chờ network ở t1): user đã tồn tại thật trong auth-service,
mảng compensation chết theo process, **không dòng nào trong `saga_compensations` được ghi**. Lưới an
toàn duy nhất hiện có là `OrphanedProvisionedUserWatcherService` bên auth-service — nhưng nó **chỉ
log warn + Gauge**, cố tình không tự xoá (đúng như plan 2026-07-30 đã quyết: auth-service không có
tín hiệu đáng tin để tự động hoá). Nghĩa là: phát hiện được, **không tự dọn được**.

### 2.1 Ca tệ hơn — sập trong khoảng t3→t4 + client retry hợp lệ ⇒ **hỏng dữ liệu**, không chỉ mồ côi

1. Sập sau khi org + OWNER membership đã COMMIT. Client không nhận được response.
2. Client retry với **cùng** `X-Idempotency-Key` K (đúng hành vi được khuyến khích).
3. `provisionUser(email, K)` → auth-service tra `GrpcIdempotencyRecord`, trả về **CHÍNH userId cũ**.
4. `ctx.dispatch(CreateOrgCommand)` → **slug đã tồn tại** từ lần 1 → unique violation → saga fail.
5. Bus chạy compensation: `cancelProvisionedUser(userId)` → user vẫn `emailVerified:false` →
   **hard-delete** (đúng hợp đồng ghi trong [org-provisioning.proto:14-16](../../proto/org-provisioning.proto)).
6. Kết quả: **org của lần 1 vẫn sống, OWNER membership trỏ tới một user vừa bị xoá cứng.**

Đây không còn là "rác mồ côi" mà là **org không ai administer được** — đúng thứ mà §9b.1 của ADR đã
từng vá một lần (bằng `archive-org` compensation), nhưng lần này lỗ đến từ hướng khác: compensation
của lần chạy 2 phá dữ liệu của lần chạy 1, vì **không lần chạy nào biết lần kia từng tồn tại**.

> Ghi chú: bản thân việc này cũng cho thấy idempotency-key hiện chỉ bảo vệ ở lớp gRPC downstream
> (auth-service), chưa bảo vệ ở lớp saga instance (core-api). Journal ở §4 đóng luôn lỗ này.

## 3. Nguyên tắc thiết kế (chốt trước, rồi mới tới schema)

1. **Write-ahead, không write-behind.** Bản ghi "tôi sắp làm X, undo của X là Y" phải nằm trên đĩa
   **TRƯỚC** khi X xảy ra. Đây đúng là điều Outbox đã làm và saga đang không làm.
2. **Descriptor phải suy được từ dữ liệu biết TRƯỚC khi gọi.** Đây là điểm mấu chốt, và nó khả thi
   với cả 2 bước của saga hiện tại:
   - bước 1: undo theo **idempotency key K** (`cancel-provisioned-user-by-key`), không theo `userId`
     do response trả về → đăng ký được trước khi gọi ⇒ **cửa sổ t1→t2 biến mất**.
   - bước 2: undo theo **slug** (đã biết từ đầu, đã unique) thay vì `orgId` do DB sinh ra ⇒ cửa sổ
     t3→t4 biến mất.
   Nếu một bước nào đó **không** suy được descriptor trước khi gọi, thì cửa sổ là **không thể đóng**
   — phải khai báo và chấp nhận, không giả vờ đã đóng (xem §6).
3. **Compensation phải idempotent.** Recovery là at-least-once: reaper có thể chạy undo trùng với
   chính process gốc (nếu nó chỉ *chậm* chứ chưa chết). `archive-org` (soft-delete) vốn idempotent;
   `cancel-provisioned-user` cần đảm bảo "đã xoá rồi → trả `cancelled:false`, không throw".
4. **Fencing thay vì cầu may.** Khi reaper tiếp quản một saga instance, nó bump `epoch`. Process gốc
   (nếu còn sống) ghi có điều kiện `WHERE epoch = :epoch_của_tôi`; 0 dòng ⇒ nó đã mất quyền ⇒ dừng,
   log to, **không tự chạy compensation nữa**. Idempotency (nguyên tắc 3) là lưới thứ hai, fencing
   là lưới thứ nhất.
5. **Nổ to lúc boot, không im lặng lúc chạy.** Service đăng ký handler `kind: 'saga'` mà chưa wire
   journal ⇒ `CommandBus.register` throw ngay lúc khởi động — cùng tinh thần
   `NestedSagaDispatchError` / `UnknownHandlerKindError` vừa làm ở §9c.

## 4. Thiết kế đề xuất

### 4.1 Schema (core-api — DB của chính orchestrator)

```prisma
model SagaInstance {
  id             String             @id @default(uuid(7))
  sagaCommand    String             @map("saga_command")       // 'ProvisionOrgCommand'
  // Khoá chống chạy trùng Ở TẦNG SAGA (khác GrpcIdempotencyRecord của auth-service,
  // vốn chỉ chống trùng ở tầng RPC). Đóng luôn ca §2.1.
  idempotencyKey String?            @unique @map("idempotency_key")
  commandPayload Json               @map("command_payload")    // để triage / replay tay
  status         SagaInstanceStatus @default(RUNNING)
  // Fencing token: reaper bump khi tiếp quản; process gốc ghi có điều kiện theo giá trị này.
  epoch          Int                @default(0)
  startedAt      DateTime           @default(now()) @map("started_at")
  finishedAt     DateTime?          @map("finished_at")
  lastError      String?            @map("last_error")
  steps          SagaStep[]

  @@index([status, startedAt])
  @@map("saga_instances")
}

model SagaStep {
  id         String         @id @default(uuid(7))
  sagaId     String         @map("saga_id")
  seq        Int                                    // undo theo thứ tự NGƯỢC của seq
  actionType String         @map("action_type")     // key vào SagaCompensationRegistry (ĐÃ CÓ)
  payload    Json
  status     SagaStepStatus @default(PENDING_UNDO)
  attempts   Int            @default(0)
  lastError  String?        @map("last_error")
  saga       SagaInstance   @relation(fields: [sagaId], references: [id], onDelete: Cascade)

  @@unique([sagaId, seq])
  @@map("saga_steps")
}

enum SagaInstanceStatus { RUNNING COMPENSATING COMPLETED COMPENSATED FAILED_DLQ }
enum SagaStepStatus     { PENDING_UNDO COMPENSATED FAILED }
```

> **`saga_steps` bao trùm `saga_compensations` hiện tại** (một compensation fail in-process chỉ là
> step ở `status: FAILED, attempts: n`). Đề xuất **gộp, xoá bảng cũ** thay vì nuôi 2 bảng gần trùng
> nghĩa — plan 2026-07-30 ghi bảng đó **chưa từng `db push`**, nếu vẫn vậy thì gộp gần như miễn phí.
> → **Cần verify trạng thái DB trước khi quyết** (câu hỏi 2 ở §8).

### 4.2 Thay đổi API ở shared-kernel

```typescript
// saga-context.interface.ts — onCompensate thành async
export interface SagaContext {
  dispatch<R = void>(command: ICommand): Promise<R>
  /** PHẢI await: hàng đợi undo giờ nằm trên đĩa, không phải trong RAM. Gọi nó TRƯỚC
   *  khi gây side effect (descriptor suy từ dữ liệu đã biết) là thứ làm saga sống sót
   *  được khi chính process này chết — xem §3.2 của plan. */
  onCompensate(action: CompensationAction, undo: () => Promise<void>): Promise<void>
}

// port mới, cùng khuôn ISagaCompensationStore
export interface ISagaJournal {
  begin(sagaCommand: string, payload: unknown, idempotencyKey?: string):
    Promise<{ sagaId: string; epoch: number }>
  appendStep(sagaId: string, epoch: number, seq: number, action: CompensationAction): Promise<void>
  markStepCompensated(sagaId: string, seq: number): Promise<void>
  finish(sagaId: string, epoch: number, status: 'COMPLETED' | 'COMPENSATED' | 'FAILED_DLQ',
         error?: unknown): Promise<void>   // throw LeaseLostError nếu epoch không khớp
}
```

`runSaga` sau khi sửa (trình tự, không phải code cuối):

```
begin()  ────────────► row RUNNING trên đĩa
try  handler.execute(command, ctx)
       └─ mỗi await ctx.onCompensate(...) = 1 INSERT saga_steps (await thật, trước side effect)
     finish(COMPLETED)                       ← ghi có điều kiện theo epoch
catch
     finish(COMPENSATING) → chạy undo ngược → markStepCompensated từng bước
                          → finish(COMPENSATED | FAILED_DLQ)
```

### 4.3 Recovery reaper

Mở rộng [saga-compensation-reaper.service.ts](../../apps/core-api/src/infrastructure/saga-compensation/saga-compensation-reaper.service.ts)
(đừng đẻ service mới — nó đã là "job dọn saga" rồi):

1. Poll `saga_instances WHERE status IN (RUNNING, COMPENSATING) AND started_at < NOW() - :maxSagaDurationMs`,
   `FOR UPDATE SKIP LOCKED` (y hệt `claimPendingBatch` đang có), **bump `epoch`**, set `COMPENSATING`.
2. Duyệt `saga_steps` của instance đó theo `seq` GIẢM DẦN, `status = PENDING_UNDO`:
   `SagaCompensationRegistry.get(actionType)(payload)` — **registry đã tồn tại và đã đúng hình dạng
   cần dùng**, đây là phần đắt nhất mà đợt 2026-07-30 đã làm sẵn.
3. Xong hết → `COMPENSATED`. Step nào cạn `attempts` → `FAILED` + instance `FAILED_DLQ` + alert.

**Ai chạy reaper nếu chính core-api vừa chết?** Replica khác, hoặc chính nó sau khi restart — state
nằm ở Postgres nên không phụ thuộc process nào còn sống. (Postgres chết thì ngoài phạm vi plan này.)

**Chọn timeout thế nào:** mọi bước đều có deadline chặn trên (gRPC deadline + tx timeout), nên
`maxSagaDurationMs = Σ deadline các bước + biên` là đủ, **chưa cần heartbeat**. Heartbeat chỉ cần khi
xuất hiện saga có bước dài/không chặn trên — ghi vào directive để lần sau ai thêm saga biết mà xét.

### 4.4 Đóng ca §2.1 (crash + retry ⇒ hỏng dữ liệu)

`SagaInstance.idempotencyKey @unique`: `begin()` gặp key đã tồn tại thì **không tạo instance mới** —
tra trạng thái instance cũ và trả về theo đó (`COMPLETED` → trả kết quả cũ / báo đã xong;
`RUNNING` → 409 "đang xử lý"; `COMPENSATED` → cho chạy lại). Lần retry ở bước 3 của kịch bản §2.1
không bao giờ đi tới `CreateOrgCommand` nữa ⇒ không có compensation nào phá org lần 1.

### 4.5 Observability (đang thiếu hẳn, không chỉ cho phần mới)

Đối chiếu thực tế: outbox **có** metric + alert (`core_api_outbox_dead_letter_total`,
`core_api_outbox_backlog`, recording rule `outbox:dead_letter_rate5m`, Grafana rule
`cortex-outbox-dead-letter`). `saga_compensations` hiện **không có metric nào, không có alert nào** —
grep chỉ ra log line. Tức là hôm nay compensation cạn retry → `FAILED_DLQ` → **im lặng tuyệt đối**.

Đề xuất (WHAT/threshold là phần owner chốt, HOW là phần tôi làm):
- `core_api_saga_instances_recovered_total{sagaCommand}` — Counter: saga bị reaper tiếp quản. **Bất kỳ
  giá trị > 0 nào cũng đáng nhìn** — nó nghĩa là đã có một lần orchestrator chết giữa saga.
- `core_api_saga_dead_letter_total{sagaCommand,actionType}` — Counter: step cạn attempts.
- `core_api_saga_backlog{status}` — Gauge: đếm theo status (giống `outbox_backlog`).
- Alert clone khuôn `cortex-outbox-dead-letter`.

## 5. Các wave triển khai

| Wave | Nội dung | Chặn wave sau? |
|---|---|---|
| **1. Journal core** | schema `saga_instances`/`saga_steps` (+ gộp/bỏ `saga_compensations`), `ISagaJournal` port, `runSaga` ghi write-ahead, `onCompensate` → async, `register()` throw nếu có saga mà thiếu journal | ✅ |
| **2. Recovery** | mở rộng reaper: claim stale instance + bump epoch + undo ngược qua `SagaCompensationRegistry`, `LeaseLostError` phía process gốc | ✅ (vô nghĩa nếu thiếu W1) |
| **3. Đóng cửa sổ** | `cancel-provisioned-user-by-key` (đổi `proto/org-provisioning.proto` + `ProvisionUserHandler`), `archive-org-by-slug`, `ProvisionOrgHandler` đăng ký compensation **trước** side effect; `SagaInstance.idempotencyKey @unique` | ❌ (W1+W2 đã có giá trị độc lập) |
| **4. Observability** | 3 metric + alert rule §4.5 | ❌ |
| **5. Tài liệu** | ADR §9d, `directives/cqrs_pattern.md` §4 (luật "compensation phải idempotent + đăng ký trước side effect"), `.ai/memory/architecture.jsonl` | ❌ nhưng **bắt buộc cùng task** theo After-Task Protocol |

## 6. Ranh giới KHÔNG đóng được — phải nói thẳng, đừng giả vờ

- **Không có atomicity giữa 1 lần ghi DB và 1 lần gọi remote.** Write-ahead chỉ đổi *hướng* của rủi
  ro: từ "side effect tồn tại mà không ai biết" (mất mát) thành "có bản ghi undo cho việc có thể chưa
  từng xảy ra" (undo thừa) — chấp nhận được **chỉ khi** compensation idempotent (nguyên tắc 3).
- **Bước nào không suy được descriptor trước khi gọi** thì cửa sổ vẫn còn; phải ghi rõ tại chỗ + trong
  directive, không im lặng.
- **Reaper tiếp quản nhầm một saga chỉ đang chậm** vẫn có thể xảy ra nếu timeout đặt sai; fencing +
  idempotency giới hạn hậu quả, không xoá bỏ được nó.
- **Đây không phải Temporal.** Không có replay deterministic, không có versioning workflow. Nó là
  "persistent saga log + compensation-based recovery" — đúng tầng mà Axon `SagaStore` /
  MassTransit `SagaRepository` / NServiceBus saga persistence đang đứng, và đủ cho 1 saga trong hệ.

## 7. Test

- **Unit (shared-kernel):** thứ tự ghi journal (begin trước execute; appendStep trước khi undo tồn
  tại); `finish` sai epoch → `LeaseLostError`; saga đăng ký mà thiếu journal → `register()` throw.
- **Integration (core-api, cần Postgres):** dựng sẵn instance `RUNNING` + 2 step với `started_at` lùi
  quá timeout → chạy reaper → assert undo chạy **ngược seq**, instance `COMPENSATED`. Đây là cách mô
  phỏng "process đã chết" **trung thực và chạy được**, không cần kill process thật.
- **Smoke (thủ công, cho câu chuyện portfolio):** `docker kill` core-api đúng lúc giữa t1–t3 (chèn
  delay tạm), restart, xem reaper tự dọn. Ghi lại làm chất liệu cho
  `docs/linkedin_posts_plan.md`.

## 8. Câu hỏi cần owner chốt trước khi code

1. **Scope tới đâu?** — (A) chỉ W1+W2 (journal + recovery, vẫn còn cửa sổ nhỏ ở §2 vì compensation
   vẫn đăng ký sau side effect); (B) **W1→W3 (đề xuất)** — đóng luôn cửa sổ + ca hỏng dữ liệu §2.1;
   (C) toàn bộ W1→W5.
2. **`saga_compensations` đã `db push` chưa?** Nếu chưa → gộp thẳng vào `saga_steps`, xoá bảng +
   `PrismaSagaCompensationRepository` cũ. Nếu rồi → cần bước migrate dữ liệu (gần như chắc chắn rỗng).
3. **`maxSagaDurationMs` = bao nhiêu?** Cần con số deadline gRPC hiện tại + tx timeout để tính; đây
   là quyết định WHAT (ngưỡng) nên là của owner, tôi đề xuất mặc định 5 phút.
4. **`FAILED_DLQ` của saga báo động qua kênh nào**, và ngưỡng ra sao — clone y khuôn
   `cortex-outbox-dead-letter` hay khác?
5. **Đổi `proto/org-provisioning.proto`** (thêm undo-by-idempotency-key) có chấp nhận trong đợt này
   không? Nó là cái làm cho W3 đóng được cửa sổ t1→t2; không đổi proto thì W3 chỉ đóng được một nửa.
