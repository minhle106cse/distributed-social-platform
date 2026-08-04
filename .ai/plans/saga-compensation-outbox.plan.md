# Plan — "Kho" cho saga compensation thất bại (SagaCompensationOutbox)

- **Ngày:** 2026-07-30 · **Trạng thái:** ĐÃ IMPLEMENT toàn bộ 3 phần (owner chốt: cả 3 làm luôn,
  §3.2 chọn hướng (a) idempotency-key xuyên qua gRPC — "cái kỹ sư thường làm" cho đúng lớp bài toán
  này — + (b) job cảnh báo làm lưới an toàn). `npx turbo typecheck test`: **19/19 task xanh**.
  **CHƯA CHẠY ĐƯỢC END-TO-END** — 2 bảng mới (`SagaCompensation` ở core-api, `GrpcIdempotencyRecord`
  + cột `User.provisionedViaSaga` ở auth-service) mới chỉ `prisma generate` (client codegen), CHƯA
  `db push` vì không có Postgres sống trong session này. Phải chạy `npm run db:push` ở cả
  `apps/core-api` và `apps/auth-service` trước khi deploy/smoke-test.
- **Bối cảnh:** Trong lúc thảo luận ADR-0001, phát hiện `CommandBus.runSaga` khi compensation
  (`ctx.onCompensate`) tự nó fail thì chỉ `logger.error(...)` rồi bỏ qua — không có nơi nào lưu lại
  để xử lý lại sau. Log là để trace, không phải kho lưu trữ. Cần một "kho" đúng nghĩa, giống Outbox
  (cho message gửi đi) và DLQ (cho message nhận vào) đã có sẵn trong repo.

---

## 0. Đã sửa ngay (không cần chờ quyết định) — bug thật, không phải thiết kế

`CommandBus.runTransactional` gọi `handler.afterCommit?.(command, result)` **không có try/catch**.
Nếu `afterCommit` (audit log) throw, một command **đã commit thành công** vẫn trả lỗi ra ngoài cho
client — đúng thứ nguyên tắc "lỗi phụ không được che lỗi chính" mà chính saga compensation đã áp
dụng, nhưng `afterCommit` lại quên áp dụng cho chính nó. Đã bọc try/catch + await (phòng
`afterCommit` async ném lỗi thành unhandled rejection), thêm 2 test. Xem
`packages/shared-kernel/src/cqrs/command-bus.ts`.

---

## 1. Đối chiếu với pattern đã có, để không phát minh hình dạng mới

| | Outbox (gửi đi) | DLQ (nhận vào) | Compensation (đề xuất) |
|---|---|---|---|
| Lưu ở đâu | Bảng `OutboxEvent` (Postgres) | Topic `<topic>.DLQ` (Kafka) | Bảng mới `SagaCompensation` (Postgres) |
| Trạng thái | PENDING → INFLIGHT → PROCESSED / FAILED_DLQ | (Kafka tự giữ, không có status) | PENDING → INFLIGHT → DONE / FAILED_DLQ |
| Ai xử lý lại | `PollingPublisherService` (poll liên tục) | **Không ai** — xem §3.1 | `SagaCompensationReaperService` (mới, `@Interval`) |
| Ai phục hồi crash giữa chừng | `OutboxReaperService` (stale INFLIGHT → PENDING) | N/A | Cùng cơ chế, gộp vào reaper trên |

Thiết kế dưới đây **cố tình bám sát khuôn Outbox** (đã có, đã chứng minh chạy đúng), không dựng
pattern mới.

## 2. Thiết kế

### 2.1 Vấn đề với closure

`ctx.onCompensate(undo: () => Promise<void>)` hiện nhận một **closure** — chỉ sống trong bộ nhớ của
đúng request đó. Muốn lưu vào DB để xử lý lại sau (kể cả sau khi process crash) thì phải lưu **dữ
liệu**, không lưu được hàm. Nên phải đổi sang mô tả bằng dữ liệu:

```typescript
// packages/shared-kernel/src/cqrs/interfaces/saga-context.interface.ts
export interface CompensationAction {
  /** Khớp key trong registry của reaper — xem §2.3. Hằng số, không suy diễn tự do. */
  readonly type: string
  /** Đủ dữ liệu để dựng lại lệnh undo từ registry, không cần closure gốc. */
  readonly payload: Record<string, unknown>
}

export interface SagaContext {
  dispatch<R = void>(command: ICommand): Promise<R>
  // Bắt buộc truyền action MÔ TẢ ĐƯỢC, không chỉ closure — ép tác giả saga trả lời
  // "nếu compensation này tự nó fail, ai chạy lại được nó?" ngay lúc viết, giống cách
  // `compensation: 'registered'|'not-needed'` đã ép trả lời "có bù trừ không?".
  onCompensate(action: CompensationAction, undo: () => Promise<void>): void
}
```

### 2.2 `CommandBus.runSaga` — ghi kho khi compensation tự fail

```typescript
for (const { action, undo } of [...compensations].reverse()) {
  try {
    await undo()
  } catch (compensationError) {
    this.logger.error({...}, `Compensation step failed for ${command.name}`)
    await this.compensationStore?.recordFailed(action, compensationError) // MỚI
  }
}
```

`compensationStore` là port mới (`ISagaCompensationStore`, optional constructor param — giống
`onRetryableError` — service không có saga nào thì không cần wire).

### 2.3 Bảng + registry chạy lại

```prisma
model SagaCompensation {
  id          String   @id @default(uuid())
  sagaCommand String   // 'ProvisionOrgCommand' — để triage biết thuộc saga nào
  actionType  String   // 'cancel-provisioned-user' | 'archive-org' | ...
  payload     Json
  status      SagaCompensationStatus @default(PENDING)
  attempts    Int      @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("saga_compensations")
}
enum SagaCompensationStatus { PENDING INFLIGHT DONE FAILED_DLQ }
```

Reaper cần biết **cách chạy lại** mỗi `actionType` — đây là chỗ khác Outbox (Outbox luôn làm đúng 1
việc: publish Kafka; DLQ luôn làm đúng 1 việc: isolate). Compensation có nhiều loại hành động khác
nhau, nên cần một registry nhỏ, sống trong chính core-api:

```typescript
// core-api/.../saga-compensation.registry.ts
const runners: Record<string, (payload: any) => Promise<void>> = {
  'cancel-provisioned-user': (p) => authProvisioningClient.cancelProvisionedUser(p.userId),
  'archive-org': (p) => commandBus.execute(new ArchiveOrgCommand(p.orgId)),
}
```

`ArchiveOrgCommand` đã tự có retry (transactional). `cancel-provisioned-user` gọi thẳng gRPC client
(giống connect hiện tại), circuit breaker đã có sẵn ở tầng client đó.

Reaper (`SagaCompensationReaperService`, y hệt khuôn `OutboxReaperService`): poll PENDING/FAILED
còn ngân sách attempts, tra registry theo `actionType`, chạy, `DONE` hoặc bump `attempts` /
`FAILED_DLQ` khi hết ngân sách — **giống hệt** `IOutboxDispatchRepository.markFailed`.

### 2.4 Việc cần sửa ở `provision-org.handler.ts`

```typescript
ctx.onCompensate(
  { type: 'cancel-provisioned-user', payload: { userId } },
  async () => { await this.authProvisioningClient.cancelProvisionedUser(userId) },
)
...
ctx.onCompensate(
  { type: 'archive-org', payload: { orgId } },
  async () => { await ctx.dispatch(new ArchiveOrgCommand(orgId)) },
)
```

Chỉ thêm tham số mô tả — logic chạy lần đầu (đường happy path, không fail) **không đổi gì**.

---

## 3. Audit: còn chỗ nào cần "kho" mà có thể bị miss?

Rà toàn bộ điểm hệ thống gọi ra ngoài / phụ thuộc at-least-once, để trả lời đúng câu hỏi bạn hỏi.

### 3.1 DLQ hiện tại — có kho, nhưng KHÔNG có ai đọc lại (mới phát hiện, đáng nói)

Verify bằng grep: **không có consumer nào cho topic `<topic>.DLQ`** trong toàn repo.
`DeadLetterProducer` ghi rất rõ trong comment của chính nó: *"isolated for triage instead of
dropped"* — tức là thiết kế BAN ĐẦU đã coi DLQ là "để con người xem tay", không phải "sẽ tự động
chạy lại". Đây có cùng đặc điểm bạn vừa chỉ ra ở compensation: có kho, không có cách lấy lại tự động.

**Cần bạn quyết:** đây là lựa chọn có chủ đích (DLQ = con người triage) hay cũng là 1 lỗ cần đóng
giống compensation? Nếu muốn đóng, mẫu hình y hệt: 1 consumer group đọc riêng `*.DLQ`, ghi vào bảng
tương tự `SagaCompensation` (status PENDING/DONE/FAILED_DLQ-lần-2), có UI/CLI để replay tay hoặc
tự động theo lịch.

### 3.2 Lỗ mới, có thể nghiêm trọng hơn câu hỏi gốc — bước ĐẦU của saga bị "mất phản hồi"

`provision-org.command.ts` đã có comment tự nhận vấn đề này (*"but the response was lost"*), và cơ
chế giảm nhẹ hiện tại là idempotency-key ở tầng HTTP (`IdempotencyInterceptor`). Nhưng đọc kỹ thì
interceptor đó **không giải quyết được** đúng ca này:

1. Client gọi `POST /admin/orgs` với idempotency-key K.
2. `ProvisionOrgHandler.execute()` gọi gRPC `provisionUser(email)` — **auth-service xử lý xong,
   commit user thật** — nhưng response bị mất trên đường về (network partition/timeout).
3. `await` phía core-api ném lỗi timeout. Vì lỗi xảy ra **TRƯỚC** dòng `ctx.onCompensate(...)` đầu
   tiên (compensation chỉ được đăng ký sau khi `await` trả về THÀNH CÔNG), **không có compensation
   nào từng được đăng ký cho user vừa tạo**. Saga báo fail, `IdempotencyInterceptor` xoá idempotency
   record (vì handler fail) để cho phép retry hợp lệ.
4. Client thấy lỗi, tự retry với cùng key K → chạy lại từ đầu → gọi `provisionUser(email)` lần 2 →
   **email đã tồn tại** → `UserAlreadyExistsError` → saga fail lần nữa, **vẫn không compensation
   nào chạm tới user mồ côi từ bước 2**.

Kết quả: 1 user "provisioned" vĩnh viễn mồ côi trong auth-service, không org nào, không cách nào hệ
thống tự dọn — **khác hẳn** ca "compensation fail" (ít nhất còn ghi được vào kho); đây là ca
"compensation chưa từng có cơ hội được đăng ký".

Đây không phải lỗi implement, là khoảng hở logic — idempotency-key chỉ bảo đảm KHÔNG chạy lại toàn
bộ handler 2 lần nếu response gốc còn giữ được (`response !== null`), nhưng ca này response gốc
CHƯA BAO GIỜ được ghi (handler fail trước khi tới `tap()`), nên interceptor xoá record và cho chạy
lại — đúng thiết kế của nó, chỉ là thiết kế đó không bao phủ ca "bước đầu saga mơ hồ kết quả".

**2 hướng vá, cần bạn chọn (đánh đổi khác nhau, không tự chọn hộ):**

- **(a) Làm `provisionUser` idempotent theo email cho đúng ca này** — nếu email đã có user
  `emailVerified: false` được tạo trong N phút gần đây (dấu hiệu "vừa provision nhưng chưa hoàn
  tất"), trả về CHÍNH user đó thay vì `UserAlreadyExistsError`. Vá đúng gốc, nhưng đổi ngữ nghĩa
  "unique email" thành có điều kiện thời gian — cần cẩn thận không mở lỗ cho ai đó dò email đã đăng
  ký.
- **(b) Job dọn rác định kỳ** — quét user `emailVerified: false` + không có membership nào sau N
  giờ, tự huỷ hoặc cảnh báo. Không sửa đúng gốc (vẫn có khoảng thời gian mồ côi), nhưng đơn giản
  hơn nhiều, và tần suất saga này chạy rất thấp (chỉ System Admin tạo org mới) nên rủi ro thực tế
  nhỏ.

### 3.3 Những chỗ ĐÃ RÀ, không cần kho thêm

- **Credit spend/grant/refund** — thuần transactional, không gọi ra ngoài, không có saga nào ở đây.
- **Event handler ghi DB** (notification-service, search-service) — không gọi cross-service theo
  kiểu "phải biết kết quả mới đi tiếp"; lỗi permanent đã có DLQ (dù DLQ tự nó là §3.1).
- **`afterCommit`/audit log** — không cần kho riêng: bản thân `logAudit` chỉ ghi cục bộ (pino →
  stdout), độ tin cậy đưa nó lên Elasticsearch là việc của tầng log-shipper (Filebeat/Fluent Bit,
  đang deferred) — không phải app tự gọi network, khác hẳn Outbox/gRPC nên không cùng loại rủi ro.

---

## 4. Câu hỏi cần bạn chốt trước khi code

1. **§3.1** — DLQ có cần thêm reprocessor tự động không, hay giữ nguyên "để con người triage" như
   thiết kế ban đầu?
2. **§3.2** — chọn hướng (a) idempotent-by-email hay (b) job dọn rác định kỳ cho lỗ "mất phản hồi ở
   bước đầu saga"? (hoặc cả hai — (b) làm lưới an toàn cho (a))
3. **Phần 2 (SagaCompensationOutbox)** — làm luôn, hay để riêng 1 đợt sau ADR-0001 commit? (khác
   Wave 4 lần trước — đây là tính năng MỚI, không phải dọn trùng lặp, nên tách hẳn khỏi diff
   ADR-0001 có lẽ hợp lý hơn)

---

## 5. Đã triển khai thực tế (2026-07-30)

Owner chốt cả 3 câu làm luôn. §3.2 chọn hướng khác với 2 lựa chọn (a)/(b) đề xuất ban đầu trong plan
— thay vì khớp email+time-window (fragile) hoặc chỉ dọn rác, dùng **idempotency-key xuyên suốt qua
gRPC** (đúng cách Stripe/AWS giải quyết lớp bài toán "RPC có thể đã thành công nhưng mất phản hồi"),
cộng job cảnh báo (b) làm lưới an toàn thứ hai — không phải chọn 1 trong 2, mà dùng đúng công cụ
chính + giữ lưới an toàn phụ.

### Wave A — SagaCompensationOutbox
- shared-kernel: `CompensationAction` (mô tả bằng dữ liệu thay vì closure), `SagaContext.onCompensate(action, undo)`,
  `ISagaCompensationStore` port, `CommandBus` ghi nhận compensation fail vào store thay vì chỉ log.
- core-api: bảng `SagaCompensation` (PENDING→INFLIGHT→DONE/FAILED_DLQ, khuôn y hệt `OutboxEvent`),
  `SagaCompensationRegistry` (map actionType → runner, đăng ký từ `PlatformAdminModule.onModuleInit`),
  `SagaCompensationReaperService` (poll + retry + reap stale claim, gộp 2 job của Outbox thành 1 vì
  tần suất thấp).
- `ProvisionOrgHandler` — 2 `ctx.onCompensate` đã có descriptor (`cancel-provisioned-user`, `archive-org`).

### Wave B — DLQ auto-reprocessor
- shared-kernel: `DlqReplayConsumer` — consumer riêng cho `<topic>.DLQ`, track `x-dlq-replay-count`
  header, republish RAW bytes (không deserialize — DLQ có thể chứa đúng poison-pill JSON hỏng) về
  topic gốc (`x-original-topic` header `DeadLetterProducer` đã ghi sẵn), pacing delay mặc định 60s,
  bỏ cuộc sau `maxReplays` (mặc định 3) kèm metric.
- Wired vào notification-service (2 topic DLQ) + search-service (1 topic DLQ), consumer group riêng
  biệt hoàn toàn với consumer chính.

### Wave C — Idempotent provisionUser
- `proto/org-provisioning.proto` — thêm `idempotency_key` vào `ProvisionUserRequest`, đã `proto:gen`.
- core-api: `PlatformAdminController` đọc header `X-Idempotency-Key`, xuyên qua `ProvisionOrgCommand`
  → `ProvisionOrgHandler` → `AuthProvisioningClient.provisionUser(email, idempotencyKey)`.
- auth-service: bảng `GrpcIdempotencyRecord` (key, userId, expiresAt — **KHÔNG lưu password
  plaintext**), `ProvisionUserHandler` — key trùng thì cấp lại temp password MỚI cho user cũ thay vì
  tạo user thứ 2 hoặc cố phát lại secret cũ; cột `User.provisionedViaSaga` để job cảnh báo phân biệt
  được user tạo qua saga với user tự đăng ký (cả hai đều `emailVerified:false` mãi mãi vì chưa có
  luồng verify email thật).
- `OrphanedProvisionedUserWatcherService` (thật ra là `startOrphanedProvisionedUserWatcher`,
  `setInterval` thuần vì auth-service không có NestJS DI) — hourly, CHỈ log warn + Gauge metric, **cố
  tình không tự xoá** — auth-service không có tín hiệu "org tạo thành công chưa" đáng tin để tự động
  hoá an toàn.

### Việc còn lại trước khi dùng thật
1. **`npm run db:push`** ở `apps/core-api` và `apps/auth-service` — schema mới mới chỉ `prisma
   generate` (client TypeScript), CHƯA áp lên DB thật (không có Postgres sống trong session này).
2. Xác nhận biến môi trường mới có giá trị hợp lý cho từng service (đều có default hợp lý, không bắt
   buộc set tay): `SAGA_COMPENSATION_*` (core-api), `KAFKA_DLQ_*` (notification/search-service).
3. Regenerate lại `apps/*/dist` nếu build production trước khi deploy (build hiện tại chỉ verify qua
   `tsc --noEmit`, chưa chạy `npm run build` thật cho service nào trong đợt này).
