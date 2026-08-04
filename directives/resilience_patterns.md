# SOP: Resilience Patterns

> Hướng dẫn implement 4 pattern bảo vệ hệ thống: Idempotency, Transactional Outbox, Retry, Throttle.
> Đọc file này trước khi viết bất kỳ endpoint nào xử lý mutation quan trọng hoặc gọi external service.

---

## 📌 Khi nào đọc directive này

| Task | Pattern cần dùng |
|---|---|
| Endpoint POST/PATCH có thể bị client retry | Idempotency §1 |
| Viết Kafka consumer handler mới (nhận event, không phải publish) | `idempotency_strategy.md` (kỹ thuật #3/#4 ở §1.0 dưới đây) |
| Sau khi save DB cần publish event ra Kafka | Transactional Outbox |
| Gọi external service có thể fail tạm thời | Retry |
| Gọi external service trên hot path (user đang chờ response) — ES/Ollama/gRPC/AI | Circuit Breaker §3.1 |
| Viết route mới cần giới hạn theo org (không chỉ IP) | Rate Limiting §4.1 |
| Gọi Claude API / embedding cho nhiều item | Throttle |
| Viết `main.ts`/entrypoint mới cho 1 service | Graceful Shutdown |
| Cần trace 1 request xuyên nhiều service (HTTP→gRPC→Kafka) trong log | Correlation-id §7 |

---

## 1. Idempotency

"Idempotency" không phải 1 kỹ thuật — là 1 họ 5 kỹ thuật khác hẳn nhau về cơ chế, chi phí khác nhau. Sai lầm phổ biến nhất là nhảy thẳng lên kỹ thuật đắt nhất (idempotency-key + bảng riêng) khi kỹ thuật rẻ hơn đã đủ.

### 1.0 Chọn kỹ thuật — luôn ưu tiên cái rẻ nhất áp dụng được

| # | Kỹ thuật | Cơ chế | Khi nào dùng | Chi phí |
|---|---|---|---|---|
| 1 | **Set-semantics** | Ghi đè tuyệt đối (`status = 'X'`, `permissions = [...]`), không cộng dồn (`+= 1`) | State-machine transition, config overwrite | 0 — tự nhiên |
| 2 | **Domain guard → no-op hợp lệ** | Domain tự ném lỗi kiểu `AlreadyMemberError`/`InviteAlreadyUsedError`, caller coi là thành công | Accept-invite, register (unique constraint + catch lỗi ở domain) | 0 — chỉ cần domain model đúng |
| 3 | **DB unique constraint (natural-key)** | `@@unique([...])` — ghi và dedup là **1 câu lệnh** (`upsert`/`ON CONFLICT DO NOTHING`) | follow/vote/bookmark; Kafka consumer khi hiệu ứng là set-membership (xem `idempotency_strategy.md`) | Thấp — 1 index, không bảng phụ |
| 4 | **Dedup theo event id (dedup-constraint)** | Unique key trên `sourceEventId` khi không có business key tự nhiên | Kafka consumer khi hiệu ứng là **append** (xem `idempotency_strategy.md`) | Thấp — vẫn 1 câu lệnh atomic |
| 5 | **Idempotency-key header + bảng cache response** | Client gửi `X-Idempotency-Key`, server cache/replay response | **Chỉ khi #1–4 không áp dụng được** — tạo resource mới thật mỗi lần, không có business key, và hậu quả trùng lặp tốn kém thật (tiền, AI compute, cross-service saga) | Cao nhất — bảng riêng, write phụ, cron TTL |

### ⚠️ 5 kỹ thuật KHÔNG loại trừ nhau ở tầng thuộc tính code — chọn theo thứ tự ưu tiên nhân-quả, không phải checklist (2026-07-14)

> **Cập nhật (cùng ngày, sau đó):** phần dưới đây mô tả cách suy luận (đọc code, tìm cơ chế nào quyết định trước) — **lý luận vẫn đúng và hữu ích khi tự đọc code**, nhưng field `safety.primaryReplayGuard` mà nó nhắc tới đã **bị xoá hoàn toàn** khỏi `CommandOptions` (xem §1.4 — audit lại phát hiện đây không phải pattern senior thật dùng, chỉ là tự tổng hợp). Đọc phần này như **bài tập tư duy** ("làm sao đọc code để biết cơ chế nào là chính"), không phải mô tả 1 field còn tồn tại trong code.

User phát hiện đúng: `set-semantics`/`domain-guard`/`natural-key` **không phải** 3 nhánh rẽ tách biệt trong code — 1 handler thật hoàn toàn có thể mang **nhiều đặc điểm cùng lúc**. Ví dụ `AcceptInviteHandler`:
```typescript
if (invite.isUsed()) throw new InviteAlreadyUsedError()   // đặc điểm domain-guard: THROW
if (existing) throw new AlreadyMemberError()               // domain-guard, 1 lần nữa

await this.membershipRepo.save(membership)   // upsert theo (orgId,userId) — TỰ THÂN có đặc điểm natural-key
invite.accept(command.userId)                 // chỉ gán usedAt — TỰ THÂN có đặc điểm set-semantics
await this.inviteRepo.save(invite)
```
Dòng `invite.accept()` tự nó **có** đặc điểm set-semantics, dòng `membershipRepo.save()` tự nó **có** đặc điểm natural-key (upsert theo `orgId_userId`, lấy thẳng từ input). Nếu coi 5 giá trị là "mô tả thuộc tính đang tồn tại trong code", câu trả lời đúng cho command này là "cả 3" — mâu thuẫn với việc `safety.primaryReplayGuard` chỉ nhận 1 giá trị.

**Cách giải quyết — đổi câu hỏi từ "code này CÓ đặc điểm gì" sang "cái gì THỰC SỰ là lý do khiến gọi lại an toàn — cái nào chặn TRƯỚC, khiến mọi thứ sau nó không còn quan trọng?"** Vì thực thi tuần tự, luôn có đúng 1 câu trả lời nếu hỏi đúng cách này. Đi theo thứ tự dưới, dừng ở bước ĐẦU TIÊN khớp — nhưng phải **đọc hết** handler+repo trước khi áp dụng, không dừng ở dấu hiệu đầu tiên thấy được:

```
1. Đường thực thi khi GỌI LẠI có throw/return-sớm nào chặn TRƯỚC
   khi chạm write nào không, VÀ throw đó chỉ fire khi "việc này đã
   làm rồi" (KHÔNG fire ở lần gọi đầu tiên hợp lệ)?  → domain-guard
2. Write chính dùng upsert/updateMany/deleteMany theo khoá LẤY THẲNG
   từ input (không phải id tự sinh v7()/uuid()), VÀ cả 2 nhánh
   (chưa tồn tại / đã tồn tại) đều THỰC SỰ có thể xảy ra (không bị
   1 guard phía trước loại trừ sẵn 1 nhánh)?          → natural-key
3. Write chính chỉ là "=" lên 1 record đã ĐẢM BẢO tồn tại (qua guard
   phía trước, hoặc qua khoá surrogate đã biết)?       → set-semantics
4. Không cái nào trên áp dụng, cần chặn ở tầng HTTP?    → idempotency-key
5. Không có gì bảo vệ, nhưng chứng minh được vô hại?    → none (+ghi lý do)
```

**Bước 1 — phân biệt throw "replay-detection" với throw "validation lỗi input":** không phải mọi `throw` đều tính là domain-guard. Phép test: throw đó có fire **giống hệt nhau** ở lần gọi đầu tiên (input hợp lệ) lẫn lần gọi lặp lại không? Nếu có (vd `RoleNotFoundError` khi `roleCode` sai — fire bất kể lần đầu hay lần lặp) → đó là validation, **không tính**. Chỉ throw nào **chỉ fire khi đây chắc chắn là lần lặp lại** (vd `InviteAlreadyUsedError` — false ở lần đầu, true ở lần lặp) mới tính là domain-guard thật.

**Bước 2 — phân biệt "syntax là upsert" với "cả 2 nhánh thực sự sống":** thấy `.upsert()` trong code chưa đủ để kết luận natural-key. Ví dụ `UpdateMemberRoleCommand` gọi **đúng** `membershipRepo.save()` (cùng upsert với `accept-invite` ở trên) — nhưng có `MembershipNotFoundError` throw trước, đảm bảo record chắc chắn tồn tại → nhánh `create` của upsert **chết hẳn, không bao giờ chạm tới** trên đường đi của command này. 1 upsert với 1 nhánh chết không còn là "create-or-no-op" nữa, nó suy biến thành phép gán trần → `set-semantics`, không phải `natural-key`, dù syntax là `.upsert()`. Ngược lại, ví dụ `CreateInviteCommand` cũng gọi `.upsert({where:{id}})` nhưng `id` là `v7()` tự sinh mới mỗi lần gọi — khoá này **không tái sinh được** từ input, nên gọi lại 2 lần luôn ra 2 `id` khác nhau, nhánh `update` không bao giờ chạm tới → cũng không phải `natural-key`, rơi xuống `none`.

**5 tổ hợp đã verify có thật trong code (không phải lý thuyết suông):**

| Tổ hợp | Command | Ghi chú |
|---|---|---|
| Chỉ 1 (domain-guard) | `register` | `UserAlreadyExistsError` (replay-detection thật) + `create()` trần (id tự sinh, không phải upsert) |
| Chỉ 2 (natural-key) | `follow-target` | Không throw gì; `Follow.upsert()` theo khoá lấy thẳng từ input, cả 2 nhánh đều sống |
| 1+3, không 2 | `refresh` | `RefreshTokenUsedError` (replay-detection thật) + `update({where:{id}})` set-semantics (khoá surrogate) — repo KHÔNG có `.upsert()` nào |
| 2+3, không 1 | `cast-vote` | `KnowledgeItemNotFoundError` chỉ là validation (fire cả 2 trường hợp). Nhánh "đã vote" vừa `changeValue()` (3) vừa `upsert()` (2) trong cùng đoạn code |
| Cả 1+2+3 | `accept-invite` | Domain-guard fire trước, 2 write còn lại (natural-key + set-semantics) không bao giờ chạm tới trên đường replay |

Đây là quy tắc tổng quát cho MỌI trường hợp trông như "khớp nhiều nhãn": nhãn nào chặn/quyết định TRƯỚC theo thứ tự thực thi, nhãn đó thắng — nhưng phải xét đủ cả 3 phép test độc lập trước khi kết luận, không dừng sớm.

**Vì sao không gộp 3 giá trị đầu thành 1 (đã cân nhắc, không làm):** cả 3 (`set-semantics`/`domain-guard`/`natural-key`) đều "chỉ là kỷ luật viết code" (khác `idempotency-key` — cần hạ tầng thật). Nhưng chúng có **failure mode khác nhau** khi code sau này bị sửa — đây là lý do giữ tách, không phải để đủ số lượng:
- `natural-key` an toàn phụ thuộc **1 dòng SCHEMA** (`@@unique`) — ai đó lỡ xoá index, mất bảo vệ âm thầm, không lỗi compile/runtime nào báo. Nghi ngờ vỡ → tìm trong `schema.prisma`.
- `domain-guard` an toàn phụ thuộc **domain code** — ai đó xoá dòng `throw` trong entity, mất bảo vệ âm thầm. Nghi ngờ vỡ → tìm trong entity/domain method.
- `set-semantics` không phụ thuộc gì — luôn đúng miễn còn dùng `=`.

Nhãn tách riêng giữ được **manh mối audit** ("nghi vỡ thì tìm ở đâu") — gộp lại mất thông tin này, dù đúng là chúng không phải "lựa chọn chiến lược" như `idempotency-key`.

**Đã cân nhắc thêm 1 lần nữa: liệu nên bỏ hẳn field này (hoặc đổi thành `Set<CommandIdempotency>` liệt kê hết thuộc tính có mặt) vì các giá trị không loại trừ nhau — quyết định: KHÔNG, chỉ đổi TÊN field.** Lý do type không sai cấu trúc: nó trả lời đúng 1 câu hỏi có 1 đáp án ("cơ chế NÀO quyết định an toàn"), không phải "có những thuộc tính gì" — giống hệt HTTP status code (`404` không tuyên bố "không có sự thật nào khác đúng", nó báo cáo sự thật QUYẾT ĐỊNH response). Đổi thành `Set` sẽ đẩy việc tự suy luận waterfall sang MỌI consumer (drift test, `CommandSafetyMiddleware`) thay vì 1 người (lúc gán nhãn, có đủ ngữ cảnh) — tốn công hơn, không "trung thực hơn". Vấn đề thật chỉ là **danh xưng**: field cũ tên `idempotency` đọc vào tưởng là "thuộc tính command này có", không phải "kết luận đã ưu tiên hoá". **Đã đổi tên field từ `idempotency` → `primaryReplayGuard`** (chữ "primary" báo ngay có thể còn cơ chế khác hiện diện, field này chỉ ghi lại cái nào load-bearing) — không đổi cấu trúc/giá trị, chỉ đổi cách gọi tên để tự nó nói đúng bản chất. Đụng lại cả 37 command (chỉ đổi tên key, giá trị giữ nguyên) + `idempotency-label-drift.spec.ts` (regex) + `command-safety.middleware.spec.ts` (fixture). JSDoc trên `CommandIdempotency`/`CommandSafety` (shared-kernel) giờ có cảnh báo "KHÔNG phải danh sách thuộc tính" ngay **dòng đầu tiên**, trước mọi nội dung khác.

**Không phải idempotency dù hay bị nhầm:** OCC/versioning (`@@unique([aggregateId, version])`) giải quyết **lost update khi ghi đồng thời**, khác hẳn "đã làm việc này chưa". Hai cơ chế thường phối hợp trên cùng 1 endpoint (xem 1.3).

Kỹ thuật #3/#4 (tầng Kafka consumer) có directive riêng: `idempotency_strategy.md`. Trước đây ép bằng
field `idempotency: 'natural-key' | 'dedup-constraint' | 'none'` bắt buộc trên mọi
`IIntegrationEventHandler` (compile-time + boot-time nếu `'none'`) — **gỡ 2026-07-30**: field chỉ ép
được "có khai báo hay không", không đối chiếu được nhãn khai với hiệu ứng thật của `handle()`, nên một
handler khai láo vẫn compile/boot sạch. Xem `idempotency_strategy.md §Enforcement` cho lý do đầy đủ.
Bây giờ ghi lại bằng comment trên `handle()`, bắt ở code review. Phần dưới đây (1.1–1.3) chỉ nói về kỹ
thuật #5 — tầng HTTP.

### 1.1 Kỹ thuật #5 — HTTP idempotency-key

**Vấn đề:** Client gửi `POST /credits/spend` → timeout → retry → server xử lý 2 lần, tốn tiền 2 lần.

**Giải pháp:** Client gửi header `X-Idempotency-Key: <uuid>`. Server check key đã tồn tại chưa — nếu rồi trả lại response cũ, không xử lý lại.

**⚠️ Đã sửa (2026-07-12) — trước đây interceptor KHÔNG chặn được 2 request đồng thời cùng key, giờ đã chặn.** Bản đầu dùng pattern check-then-run: `findUnique` trước, chạy handler, `create` sau — 2 request đến đúng lúc nhau đều thấy "chưa có key" (record chỉ được ghi SAU KHI handler chạy xong) rồi **cả hai đều chạy handler thật**. Đây từng được ghi là "giới hạn đã biết, cần lớp 2 riêng bù vào" — nhưng khi verify thật (không chỉ suy đoán) bằng cách gọi `POST /spaces` 2 lần đồng thời cùng key vào Postgres thật, xác nhận **race có thật**: 2 row `Space` trùng tên được tạo (`POST /spaces` không có lớp 2 nào chặn — đã ghi đúng trong bảng "Cố ý KHÔNG thêm lớp 2" ở dưới, nghĩa là race này không hề được bù bởi cơ chế khác cho 2/5 endpoint).

**Sửa tận gốc — claim-before-execute**, thay vì check-then-run: ghi 1 row **TRƯỚC KHI** chạy handler, `response: null` (đang xử lý), dựa vào `@id` unique constraint để atomic hoá bước "giành quyền xử lý key này". Request thứ 2 đến sau sẽ thấy row đã tồn tại (dù `response` còn null) → trả lỗi `409 Conflict` ngay (fail-fast, không polling) thay vì chạy handler lần 2. Nếu handler lỗi, row claim bị xoá — key không bị "kẹt" tới hết TTL 24h cho lần retry hợp lệ sau đó.

### Schema (đã có)
```prisma
model IdempotencyRecord {
  key       String   @id               // X-Idempotency-Key header value
  response  Json?                      // NULL = đã claim, handler đang chạy
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")   // TTL 24h, cron xóa expired rows

  @@index([expiresAt])
  @@map("idempotency_records")
}
```

### Implement — NestJS Interceptor + module dùng chung

```typescript
// infrastructure/http/idempotency/idempotency.interceptor.ts
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const key = req.headers['x-idempotency-key'] as string | undefined

    if (!key || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next.handle()
    }

    const existing = await this.prisma.client.idempotencyRecord.findUnique({ where: { key } })
    if (existing) {
      if (existing.response !== null) return of(existing.response) // replay, KHÔNG chạy lại handler
      throw new ConflictException('A request with this idempotency key is already in progress')
    }

    // Claim TRƯỚC KHI chạy handler — atomic nhờ @id unique constraint.
    try {
      await this.prisma.client.idempotencyRecord.create({
        data: { key, response: Prisma.JsonNull, expiresAt: new Date(Date.now() + TTL_MS) },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A request with this idempotency key is already in progress')
      }
      throw err
    }

    return next.handle().pipe(
      tap((response) => {
        this.prisma.client.idempotencyRecord
          .update({ where: { key }, data: { response: response as Prisma.InputJsonValue } })
          .catch((err) => req.log.error({ err }, 'Failed to persist idempotency response'))
      }),
      catchError((err) =>
        // Handler lỗi → xoá claim để retry hợp lệ sau đó không bị kẹt tới hết TTL.
        from(this.prisma.client.idempotencyRecord.delete({ where: { key } }).catch(() => undefined)).pipe(
          switchMap(() => throwError(() => err)),
        ),
      ),
    )
  }
}
```

`IdempotencyInterceptor` + reaper dọn TTL (`IdempotencyCleanupService`) sống trong **`infrastructure/http/idempotency/idempotency.module.ts`**, export qua `HttpIdempotencyModule` (`@Global()`). Đăng ký **1 lần duy nhất** ở `AppModule`, mọi controller khác dùng `@UseInterceptors(IdempotencyInterceptor)` mà không cần import lại module — tránh copy-paste provider vào từng module tiêu thụ (bài học từ lần đầu chỉ đăng ký trong `CreditModule` dù phục vụ nhiều module khác).

⚠️ **Client nhận `409` khi trùng key đang xử lý phải tự retry sau, không phải lỗi cần fix ở server** — đây là hành vi đúng, không phải bug.

### 1.2 Đã áp dụng ở đâu (core-api, audit 2026-07-10)

| Endpoint | Lý do thêm |
|---|---|
| `POST /credits/grant` | Event ledger append-only, không gì chặn ghi 2 lần → cấp nhầm tiền thật |
| `POST /admin/orgs` | Saga xuyên 2 service (gRPC tạo user thật ở `auth_db` + org ở `core_db`) — blast radius lớn nhất hệ thống |
| `POST /knowledge` | Không unique constraint chặn document trùng + kích Kafka fan-out tốn embedding compute thật |
| `POST /spaces` | Không unique constraint chặn space trùng |
| `POST /knowledge/:id/publish` | Domain state tự an toàn (`publish()` set không điều kiện), nhưng outbox event append **vô điều kiện mỗi lần gọi** → retry vẫn tốn re-embed thừa nếu không chặn |

**Cố ý KHÔNG thêm** — đã an toàn bởi kỹ thuật #1–#3 sẵn có trong domain/schema, thêm interceptor là dư thừa: `follows`/`votes`/`bookmarks` (`@@unique` chặn ở DB), `accept-invite`/`register` (domain tự ném lỗi), `update-member-role`/`update-role-permissions` (ghi đè idempotent), roles/permissions CRUD ở auth-service (unique constraint hoặc ghi đè), `PATCH .../read` ở notification-service (`markAsRead()` đã idempotent), `POST .../invites` (duplicate token vô hại — không gửi email, pull-based qua link).

### 1.3 Case điển hình 2 lớp phối hợp — lưu ý phạm vi mỗi lớp khác nhau (cập nhật 2026-07-12)

Interceptor (claim-before-execute) giờ đã tự chặn **2 request CÙNG idempotency-key** đến đồng thời — không cần lớp 2 riêng cho case đó nữa. Nhưng OCC/unique-constraint dưới đây vẫn cần thiết vì bảo vệ 1 case **khác hẳn**: 2 request hợp lệ, **khác** idempotency-key (2 lần spend riêng biệt, 2 admin tạo org riêng biệt cùng lúc) — đây là concurrency ở tầng nghiệp vụ, idempotency-key không và không nên can thiệp (2 request khác key là 2 hành động khác nhau thật, không phải retry).

- `POST /credits/spend`, `POST /credits/grant` → lớp nghiệp vụ = **OCC** ở `CreditAccount` aggregate (`@@unique([aggregateId, version])`) — chặn 2 lần spend khác nhau cùng lúc làm lệch số dư
- `POST /admin/orgs` → lớp nghiệp vụ = **unique constraint trên `slug`** ở `CreateOrgCommand` — chặn 2 admin cùng tạo org trùng slug
- `POST /knowledge`, `POST /spaces` → **chưa có lớp nghiệp vụ** (không unique constraint tự nhiên nào áp được cho document/space trùng tên) — chấp nhận được vì đây là race giữa 2 hành động **khác nhau thật** của người dùng (đặt trùng tên), khác hẳn race đã sửa ở trên (2 request **giống hệt nhau** cùng key, đã đóng)

### ⛔ 1.4 `CommandOptions.safety` — XÂY RỒI GỠ TRONG CÙNG NGÀY (2026-07-14) — không dùng, đọc để không lặp lại

**Đã từng tồn tại, đã xoá hoàn toàn khỏi code** (`CommandIdempotency`/`CommandConcurrency`/`CommandSafety`/field `safety`/`CommandSafetyMiddleware`/`idempotency-label-drift.spec.ts`) sau khi user hỏi thẳng: *"những cái này senior thật có làm không, hay tôi tự chế?"*

**Việc đã xây (tóm tắt để không ai làm lại):** field bắt buộc `safety: { primaryReplayGuard, concurrency }` trên mọi command (5+3 giá trị enum), 1 middleware runtime check `occ⟹transactional`, 1 test tĩnh verify nhãn `idempotency-key` khớp interceptor, cộng 4 vòng chỉnh sửa taxonomy (waterfall priority-order, đổi tên field, worked examples) — tổng ~8 vòng hội thoại.

**Vì sao gỡ — audit đối chiếu với thực hành thật:**
- 5 pattern nền tảng thật của idempotency (Idempotency-key/Stripe, OCC/JPA `@Version`, Kafka Idempotent Receiver, Kafka idempotent producer, Transactional Outbox) đều có tên, có tài liệu tham chiếu chuẩn, sinh viên nào cũng học được — **những cái này giữ nguyên, không đụng**.
- Nhưng lớp *meta* phủ lên trên (field bắt buộc phân loại 8 giá trị + thuật toán ưu tiên hình thức hoá + test tĩnh quét regex) **không phải pattern có tên, không tìm thấy tài liệu chuẩn nào mô tả cách làm này** — tự tổng hợp ra, không phải điều senior thật làm khi review code hàng ngày. Senior thật xử lý case mơ hồ bằng 1 câu comment tại chỗ, không đúc thành field bắt buộc + thuật toán 5 bước cho toàn bộ 37 command bất kể mức rủi ro.
- Ép ceremony đồng đều lên **mọi** command (kể cả `logout`, `create-invite` — rủi ro thấp) trái với cách senior thật phân bổ rigor: chỉ nơi rủi ro cao (tiền, saga) mới đáng.

**Quyết định — xoá dứt khoát, không giữ bản rút gọn:** *"đối với những cái senior không làm thì nên xóa không nên tự làm chế thêm"* (nguyên văn). Comment prose giải thích lý do an toàn (vốn có sẵn cạnh field `safety` cũ) được **giữ lại nguyên trạng** trên từng command — đây mới là cách thật senior ghi lại quyết định: 1 câu comment tại chỗ, không phải type hệ thống hoá.

**Cùng đợt audit, tìm ra 2 lệch chuẩn thật (không phải do phiên làm việc này gây ra, tồn tại từ trước) — đã sửa:**
1. `IdempotencyInterceptor` thiếu request-fingerprint (chuẩn Stripe thật yêu cầu: reuse key với body khác phải bị từ chối, không được âm thầm trả response cache cũ). Đã thêm cột `requestHash` (`sha256(method+url+body)`) vào `IdempotencyRecord`, so sánh trước khi replay — mismatch → `422`.
2. Comment ở `kafka-producer.service.ts`/2 `dead-letter.producer.ts` khẳng định `idempotent:true` tự set `maxInFlightRequests≤5` — verify thẳng trong `node_modules/kafkajs/src`: **sai**, default là `null` (không giới hạn), không nơi nào trong code từng set nó. Đã set tường minh `maxInFlightRequests: 5` ở cả 3 producer (đúng ngưỡng Kafka khuyến nghị để idempotent producer giữ đúng thứ tự khi retry).

**Bài học giữ lại cho lần sau:** trước khi coi 1 cơ chế là "best practice", tự hỏi *"cái này có tên, có tài liệu tham chiếu chuẩn mà người khác cũng học theo không, hay tôi đang tự tổng hợp ra?"* — nếu là loại sau, dừng lại hỏi trước khi type-hoá/enforce nó trên toàn bộ codebase.

### Rules (idempotency-key interceptor — phần còn lại, vẫn đúng)
- ⛔ KHÔNG đăng ký `IdempotencyInterceptor` global qua `APP_INTERCEPTOR` — chỉ áp per-route bằng `@UseInterceptors()`, và chỉ cho mutation có side-effect tốn kém thật (xem bảng quyết định 1.0)
- ⛔ KHÔNG áp cho GET
- Interceptor tự chặn được race giữa 2 request **cùng key** (claim-before-execute) — vẫn cần xét thêm lớp nghiệp vụ (OCC/unique constraint) cho race giữa 2 request hợp lệ **khác key** (1.3)
- Key reuse với request khác (`requestHash` không khớp) → `422`, không âm thầm replay response cũ (Stripe-standard, thêm 2026-07-14)
- Handler được bảo vệ phải return body — không `void`
- TTL 24h là chuẩn, có thể giảm xuống 1h cho endpoint không quan trọng
- Cron cleanup (`IdempotencyCleanupService`, `@Cron('0 3 * * *')`) chạy 1 lần duy nhất qua `HttpIdempotencyModule` — không đăng ký lại ở module khác

---

## 2. Transactional Outbox

### Vấn đề
```
1. Save domain object vào DB ✅
2. Publish event lên Kafka ❌ (server crash)
→ DB có data nhưng Kafka không có event → inconsistency
```

### Giải pháp
Thay vì publish thẳng lên Kafka, INSERT vào bảng `outbox_events` **trong cùng transaction** với domain write. Một polling service đọc outbox và publish lên Kafka.

### Schema (đã có)
```prisma
model OutboxEvent {
  id            String       @id @default(uuid())
  aggregateType String       // "KnowledgeItem" | "CreditAccount"
  aggregateId   String
  eventType     String       // "DocumentPublished" | "CreditSpent"
  payload       Json
  status        OutboxStatus @default(PENDING)
  createdAt     DateTime     @default(now())
  processedAt   DateTime?
  @@index([status, createdAt])  // polling query dùng index này
}
enum OutboxStatus { PENDING  PROCESSED  FAILED_DLQ }
```

### Implement — viết outbox trong cùng transaction
```typescript
// Trong command handler, dùng TransactionManager
async execute(command: PublishDocumentCommand): Promise<void> {
  await this.transactionManager.run(async () => {
    // 1. Domain write
    const item = await this.knowledgeRepo.findById(command.itemId)
    item.publish()
    await this.knowledgeRepo.save(item)

    // 2. Outbox write — CÙNG transaction, không bao giờ tách ra
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: 'KnowledgeItem',
        aggregateId: item.id,
        eventType: 'DocumentPublished',
        payload: { itemId: item.id, orgId: item.orgId, spaceId: item.spaceId },
      },
    })
    // Nếu transaction fail → cả 2 rollback → không có inconsistency
  })
}
```

### Polling Publisher (Phase 2 — khi có Kafka)
```typescript
// infrastructure/outbox/outbox-publisher.service.ts
@Injectable()
export class OutboxPublisherService {
  // Chạy mỗi 1 giây, pick PENDING rows và publish lên Kafka
  @Interval(1000)
  async poll(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    for (const event of events) {
      try {
        await this.kafka.publish(event.eventType, event.payload)
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        })
      } catch {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'FAILED_DLQ' },
        })
      }
    }
  }
}
```

### Rules
- ⛔ KHÔNG publish Kafka trực tiếp trong handler — luôn qua outbox
- ⛔ Domain write và outbox write phải cùng 1 transaction
- PENDING → PROCESSED hoặc FAILED_DLQ, không bao giờ xóa row (audit trail)

---

## 3. Retry

> **[ADR-0001, 2026-07-29] SUPERSEDED — `RetryMiddleware`/`TransactionMiddleware`/`commandBus.use()`
> không còn tồn tại.** Mọi thứ dưới đây trong §3 mô tả kiến trúc CŨ — giữ nguyên làm mốc lịch sử của
> chuỗi quyết định (không sửa lén, cùng quy ước với `docs/adr/README.md`), nhưng KHÔNG mô tả code hiện
> tại. Kiến trúc hiện hành: retry + transaction sống trong MỘT thân hàm cố định của `CommandBus`
> (`withRetry` bọc ngoài `runTransactional`), transaction là `TxScope` Unit-of-Work suy từ chữ ký
> handler thay vì cờ `command.options?.transactional`. **Hai quyết định đã lập luận kỹ ở đây VẪN CÒN
> ĐÚNG và đã port nguyên vẹn sang code mới:** (1) chỉ retry `P2034`, loại trừ `P2028` để tránh
> retry-storm khi pool cạn kiệt (`isPrismaTransientError`, nay ở `packages/shared-kernel/src/resilience/
> prisma-transient-error.ts`, dùng chung cho cả 3 service thay vì copy-paste); (2) full-jitter backoff.
> Xem `docs/adr/0001-transaction-retry-boundary.md`.

### Đã có sẵn — RetryMiddleware trong CQRS pipeline (LỊCH SỬ — xem ghi chú SUPERSEDED ở trên)
```typescript
// shared-kernel/src/cqrs/middleware/retry.middleware.ts
// Tự động retry khi isPrismaTransientError() trả true
// (connection reset, deadlock, pool timeout)
this.commandBus.use(this.loggingMiddleware, this.retryMiddleware, this.transactionMiddleware)
```

### Khi nào cần retry thủ công (ngoài CQRS)
Gọi external HTTP service (Claude API, Elasticsearch):
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      // Exponential backoff: 500ms, 1000ms, 2000ms
      await new Promise(r => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)))
    }
  }
  throw new Error('unreachable')
}

// Dùng
const result = await withRetry(() => this.claudeClient.complete(prompt))
```

### ⚠️ Tự phản biện (2026-07-14) — P2028 bị loại khỏi transient set, thêm metric quan sát

User đặt đúng 3 câu hỏi buộc audit lại `isPrismaTransientError`, không chỉ tin lời chú thích cũ ("connection reset, deadlock, pool timeout" — 1 câu gộp chung, sai chỗ):

1. **"Lỗi mạng không báo về FE được à?"** — Trước tiên làm rõ phạm vi: `RetryMiddleware` chỉ retry 2 mã Prisma (`P2034`, `P2028`) — **lỗi DB nội bộ, không phải lỗi gọi ra ngoài** (gRPC/HTTP đi qua Circuit Breaker, có báo lỗi thật về client, không qua middleware này). Tiền đề không áp dụng cho phần mạng — nhưng câu hỏi vẫn đúng cho phần DB, dẫn tới finding #2.
2. **"Có nặng nề hệ thống không?"** — Có, và đây là bug thiết kế thật: `P2034` (deadlock) an toàn để retry (Postgres tự abort transaction thua, thường resolve trong mili-giây — đúng khuyến nghị Prisma docs). Nhưng `P2028` (transaction/connection API error) **có thể là dấu hiệu pool cạn kiệt** — auto-retry nó = xin lại connection từ **đúng cái pool đang cạn**, không giúp gì, còn cộng dồn tải đúng lúc hệ thống cần giảm để phục hồi (retry-storm antipattern). Trước đây gộp chung 2 mã này vào cùng 1 policy — sai.
3. **"Ít command dùng, value không?"** — Chỉ 6/37 command có `retryable: true` (5 auth-service: login/register/refresh/provision-user/cancel-provisioned-user — path danh tính tần suất cao; 1 core-api: `update-role-permissions`). Phân bổ này có lý (OLTP tần suất cao mới đáng retry deadlock) nhưng đồng nghĩa core-api gần như không nhận giá trị gì từ middleware này dù đăng ký global — chấp nhận được vì chi phí đăng ký gần 0 (1 nhánh rẽ `if (!retryable) return next()`).

**Đã sửa — `isPrismaTransientError` chỉ còn khớp `P2034`:**
```typescript
export function isPrismaTransientError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034'
  }
  return false
}
```
`P2028` giờ fail-fast, trả lỗi thật về client thay vì tự retry mù server-side. Đánh đổi: mất khả năng tự phục hồi cho 1 số connection-blip ngắn thật sự transient (không phải pool cạn) — chấp nhận được, ưu tiên không làm nặng hệ thống hơn trong lúc DB đang stress.

**Thêm metric quan sát** để quyết định này dựa trên dữ liệu thật, không phải đoán mãi: `RetryMiddleware` có thêm param cuối `onError?: (error, willRetry) => void` — **cố ý giữ ORM-agnostic** (chỉ nhận error thô + boolean đã tính sẵn), phần biết-Prisma nằm ở composition root (`recordDbTransientErrorObservation`, sống cạnh `isPrismaTransientError`). Counter `{service}_db_transient_error_total{code, retried}` — quan sát **cả P2028 lẫn P2034**, kể cả P2028 giờ không còn được retry, để trả lời "loại P2028 ra có đúng không" bằng tần suất thật thay vì phỏng đoán 1 lần.

### ⚠️ Pivot (2026-07-14) — bỏ field `retryable`, retry P2034 tự động cho MỌI command transactional

Ngay sau finding P2028 ở trên, audit tiếp câu hỏi "middleware này có đáng giữ không, ít command dùng quá" lộ ra vấn đề sâu hơn: grep `transactional: true` toàn bộ 3 service ra **18 command**, nhưng chỉ **6** có `retryable: true`. **12 command transactional còn lại — `create-org`, `spend-credits`, `grant-credits`, `refund-credits`, `publish-knowledge`, `update-knowledge`, `follow-target`, `unfollow-target`, `accept-invite`, `accept-answer`, `delete-role`, `update-profile` — deadlock (P2034) xảy ra là fail thẳng, không hề retry**, dù đã verify từng command thoả đúng điều kiện an toàn (mọi side-effect nằm trong transaction, không external call giữa handler).

Đây không phải lựa chọn rủi ro-cao-thì-bảo-vệ có chủ đích — nó là **bất đối xứng lịch sử**: 6 command đầu (path login/register auth-service) được gắn cờ sớm, phần còn lại không ai quay lại làm. `retryable` là 1 flag opt-in lặp lại đúng điều kiện mà `transactional: true` đã đảm bảo sẵn (side-effect rollback sạch) — tách nó thành field riêng chỉ tạo ra 1 chỗ để quên, không thêm được gì.

**Đã sửa — bỏ hẳn field `retryable` khỏi `CommandOptions`.** `RetryMiddleware` giờ gate theo `command.options?.transactional` trực tiếp — **mọi command `transactional: true` tự động được retry P2034**, không cần opt-in riêng:
```typescript
// shared-kernel/src/cqrs/middleware/retry.middleware.ts
async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
  if (!command.options?.transactional) {
    return next()
  }
  // ... vòng retry như cũ, không đổi backoff/jitter/onError
}
```
Kết quả: bảo vệ tăng từ 6 → 18 command, không cần sửa command nào ngoài xoá field. Command cần **loại trừ** retry dù transactional (ví dụ có external call giữa handler) buộc phải là `transactional: false` + saga bù trừ tường minh — xem `ProvisionOrgCommand` làm mẫu, comment tại chỗ giải thích vì sao.

> **Cập nhật (cùng ngày, sau đó):** `CommandSafetyMiddleware` (nhắc ở đoạn dưới đây) đã **bị xoá hoàn toàn** sau đó cùng ngày — không chỉ mất 1 invariant, cả middleware không còn tồn tại (xem §1.4). Lý do: đây là 1 phần của lớp "tự chế" bị gỡ khi audit lại thấy không khớp thực hành senior thật. Đoạn dưới giữ nguyên như 1 mốc lịch sử trong chuỗi quyết định, không mô tả code hiện tại.

**Hệ quả cho `CommandSafetyMiddleware` (LỊCH SỬ, middleware này đã bị xoá — xem update ngay trên):** invariant `retryable ⟹ transactional` (đã thêm ở §1.4 hôm trước) bị xoá theo — không phải "không còn enforce", mà **không còn field để mâu thuẫn** nữa (structurally impossible, mạnh hơn cả 1 runtime check). Chỉ còn invariant `concurrency:'occ' ⟹ transactional`, độc lập hoàn toàn với quyết định retry, vẫn giữ nguyên giá trị.

**Điều kiện an toàn của retry** (không đổi, giờ áp cho cả 18 thay vì 6): chỉ an toàn khi mọi side-effect nằm TRONG transaction bị rollback. Không retry command có publish Kafka / gọi external trực tiếp giữa handler — đó là lý do Outbox (mục 2) là tiền đề để retry-safe khi có event.

### Rules
- Retry chỉ cho **transient errors** (timeout, 503, connection reset)
- KHÔNG retry **4xx errors** (validation, auth, not found) — những lỗi này retry vô nghĩa
- Max 3 attempts, exponential backoff
- Luôn dùng Circuit Breaker bên ngoài Retry (xem `rag_ai_integration.md`)
- ⛔ Chỉ retry lỗi có bằng chứng resolve nhanh + không cộng dồn tải khi hệ thống đang stress (P2034 đạt, P2028 không — xem "Tự phản biện" ở trên). Thêm mã lỗi mới vào transient set → tự hỏi "retry lỗi này lúc hệ thống đang yếu có làm nó yếu hơn không" trước khi thêm
- ⛔ KHÔNG thêm field `retryable`/opt-in riêng cho retry — `transactional: true` đã LÀ điều kiện đủ và cần cho retry-safe; 1 command muốn KHÔNG được retry dù transactional thì đó là dấu hiệu nó không nên `transactional: true` (nên tách saga, xem `ProvisionOrgCommand`), không phải lý do thêm field mới

### Cập nhật (2026-06-22)
- **Jitter**: `RetryMiddleware` dùng *full jitter* — `delay = random(0, min(maxDelayMs, base·2^(n-1)))` thay backoff cố định, để các victim deadlock (P2034) không retry đồng pha rồi đâm lại nhau. Helper `withRetry` thủ công ở trên (ví dụ minh hoạ, **chưa có call site thật nào trong code** — nếu dùng thật cho 1 external call, áp dụng jitter tương tự).
- **Seam mở rộng**: middleware KHÔNG biết "lỗi nào là transient" — nó nhận predicate `isPrismaTransientError` inject ở composition root (`cqrs.module.ts`). Thêm loại lỗi retry-able → compose predicate ở đó, KHÔNG sửa middleware (giữ ORM-agnostic).

### ⚠️ Đính chính (2026-07-12) — OCC KHÔNG auto-retry qua middleware này, khác với những gì bản cũ của mục này viết

**[SUPERSEDED một phần bởi pivot 2026-07-14 ở trên]** — phần dưới đây mô tả field `retryable` (khi đó tồn tại trên `CommandOptions`), giờ **đã bị xoá hoàn toàn** — mọi command `transactional: true` tự động retry P2034, không còn opt-in per-command. Giữ lại nguyên văn vì lý do OCC-conflict (P2002) không được `isPrismaTransientError` coi là transient (chỉ khớp P2034) **vẫn đúng và không đổi** — `SpendCreditsCommand`/`GrantCreditsCommand` giờ CÓ được retry tự động (vì `transactional: true`), nhưng retry đó chỉ khớp P2034 (deadlock), KHÔNG khớp P2002 (OCC conflict) — 409 `CREDIT_CONCURRENCY_CONFLICT` vẫn trả thẳng ra client như mô tả dưới đây, không có gì đổi ở phần này.

Bản trước ghi "GAP phải đóng khi làm OCC" như thể auto-retry OCC conflict là việc sẽ làm qua `RetryMiddleware`. Audit lại code thật (`retryable` option trên **mọi** `*.command.ts` ở core-api) cho thấy **quyết định thật đã khác hẳn**, và không phải gap — là lựa chọn có chủ đích:

- `RetryMiddleware.execute()` (`shared-kernel`) check `command.options?.retryable` **trước tiên** — sai thì `return next()` ngay, không vào vòng retry, bất kể predicate `isPrismaTransientError` có khớp hay không.
- Grep toàn bộ `retryable` trong `apps/core-api/src/modules/**/*.command.ts` (2026-07-12): **chỉ đúng 1 command** có `retryable: true` (`UpdateRolePermissionsCommand` — ghi đè idempotent, không side-effect ngoài, an toàn tuyệt đối khi lặp lại). **Toàn bộ 23 command còn lại** — kể cả `SpendCreditsCommand`/`GrantCreditsCommand` (2 command có OCC thật) và `ProvisionOrgCommand` (có gọi gRPC ra ngoài) — đều `retryable: false`.
- Hệ quả: khi OCC conflict xảy ra thật ở `spend-credits` (đã smoke-test: 12 request đồng thời → 9 ok + 3 `CREDIT_CONCURRENCY_CONFLICT`), **`RetryMiddleware` không retry** — lỗi trả thẳng ra client dưới dạng 409, client tự quyết định gọi lại (không phải tự động, âm thầm). Đây là lựa chọn AN TOÀN HƠN auto-retry mù (đặc biệt đúng cho `ProvisionOrgCommand`, nơi comment tại `provision-org.command.ts` ghi rõ: *"retrying blindly would double-provision the owner"*).
- **`RetryMiddleware` vẫn đăng ký toàn cục** trên `CommandBus` (mọi command đều đi qua nó), nhưng vì cổng `retryable` chặn ở đầu, nó **chỉ thật sự retry cho 1/24 command**. Không phải dead code (vẫn chạy, vẫn có tác dụng cho command đó), nhưng phạm vi hẹp hơn rất nhiều so với việc "đăng ký toàn cục" gợi ý — đọc code 1 command bất kỳ không đủ để biết middleware này CÓ áp dụng hay KHÔNG, phải check field `options.retryable` trên chính command đó.

**Quy tắc khi thêm command mới**: mặc định `retryable: false`. Chỉ đặt `true` khi chắc chắn: (a) toàn bộ side-effect nằm trong 1 transaction sẽ rollback sạch khi retry, VÀ (b) không có external call (Kafka publish, gRPC, HTTP) nào chạy giữa chừng handler mà không idempotent tự nhiên. OCC-conflict (P2025) và side-effect-ngoài (gRPC) đều KHÔNG thoả điều kiện này trong thiết kế hiện tại — client-visible error + tự retry ở tầng gọi là lựa chọn đúng cho cả 2 trường hợp.
- **Điều kiện an toàn của retry**: chỉ an toàn khi mọi side-effect nằm TRONG transaction bị rollback. Không retry command có publish Kafka / gọi external trực tiếp giữa handler — đó là lý do Outbox (mục 2) là tiền đề để retry-safe khi có event.

### 3.1 Circuit Breaker — mở rộng ra ngoài AI (2026-07-12)

`CircuitBreaker` **không còn** là 1 class riêng của search-service (từng nằm ở `search-service/infrastructure/ai/circuit-breaker.ts`, gắn với AI). Đã chuyển vào **`@distributed-social-platform/shared-kernel`** (`src/resilience/circuit-breaker.ts`) vì lý do khác hẳn với `OrgAwareThrottlerGuard` (§4.1.1) — đây là **thuật toán thuần túy, không phụ thuộc framework** (constructor chỉ cần `ILogger`, interface đã có sẵn trong `shared-kernel/logger`), và giờ có **2 consumer thật ở 2 service độc lập** (search-service: AI/ES/Ollama; core-api: gRPC) — khác `ThrottlerGuard` vốn chỉ NestJS mới cần và mỗi service NestJS chỉ dùng cục bộ.

**Audit gap (2026-07-11, trước khi làm item này):** chỉ Claude/Gemini summarizer có breaker. 3 external call khác trong hot path KHÔNG có timeout lẫn breaker:

| Call | Vị trí | Vấn đề trước khi vá |
|---|---|---|
| Ollama embedding | `search-service` `HttpEmbeddingService.embedSlice()` | `fetch()` không giới hạn thời gian (Ollama treo là request treo vô hạn); không breaker; **và** `SearchKnowledgeService.search()` không `catch` lỗi embedding — 1 dependency lỗi làm chết cả search (bất đối xứng với nhánh ES vốn đã `.catch(() => [])`) |
| Elasticsearch search | `search-service` `ElasticsearchKeywordRepository.search()` | Client mặc định `requestTimeout` 30s — quá dài cho hot path; không breaker |
| gRPC provisioning | `core-api` `AuthProvisioningClient` | Đã có `deadline` (5s) chặn 1 call, nhưng KHÔNG có breaker — outage thật của auth-service vẫn khiến mỗi lần provision chờ đủ 5s rồi mới fail, không fail-fast |

**Đã vá cả 3** (timeout + breaker theo đúng discipline của Claude/Gemini — cú pháp breaker dưới đây dùng SRP caller class, xem §3.1.2; lúc vá lần đầu dùng `new CircuitBreaker()` thủ công trong constructor, thử qua `@CircuitBreak` decorator, cuối cùng chốt SRP caller class sau khi thảo luận về discoverability):
```typescript
// Ollama — timeout qua AbortSignal (Node 18+ native, không cần polyfill) + breaker qua OllamaEmbeddingCaller
private async embedSlice(texts: string[]) {
  const res = await this.caller.call(() =>
    fetch(url, { ..., signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  )
  ...
}

// Elasticsearch — requestTimeout ở tầng Client (áp cho mọi call qua client này) + breaker qua ElasticsearchSearchCaller
new Client({ ..., requestTimeout: REQUEST_TIMEOUT_MS })
async search(orgId: string, query: string, limit: number) {
  return this.caller.call(async () => { ... })
}

// gRPC — deadline đã có sẵn, breaker qua AuthProvisioningGrpcCaller
async provisionUser(email: string) {
  return this.caller.call(() => new Promise(...))
}
```

**⚠️ Lỗi ngoài dự tính (business outcome ≠ fault) — phải tách trước khi vào breaker:** cả ES (404 = "org chưa index", bình thường) và gRPC (`ALREADY_EXISTS` = email đã tồn tại, bình thường) đều có 1 nhánh lỗi KHÔNG phải sự cố hạ tầng. Nếu để nhánh đó `throw`/`reject` **bên trong** `breaker.execute()`, breaker sẽ đếm nó như 1 failure thật — dùng hết `threshold` bởi chính traffic hợp lệ (nhiều user cố tạo org trùng email → breaker tự trip dù auth-service hoàn toàn khỏe). Cách xử lý đúng — bắt lỗi "bình thường" đó và `return`/`resolve` một giá trị (không `throw`) từ bên trong hàm được bọc, rồi map lại thành exception nghiệp vụ **sau khi** `breaker.execute()` đã trả về (xem `AuthProvisioningClient.provisionUser` — resolve tagged `{ alreadyExists: true }`, unwrap sau breaker). Suýt mắc lỗi này khi viết `provisionUser` — bản đầu để `reject(new OwnerEmailAlreadyExistsError())` ngay trong executor bọc bởi breaker, tự phát hiện và sửa trước khi commit.

> **2026-08-04 — sửa tiếp 1 lỗi layering còn sót lại sau lần audit trên, do user review phát hiện:** dù đã tách `ALREADY_EXISTS` khỏi breaker đúng cách, `provisionUser` VẪN tự `throw new OwnerEmailAlreadyExistsError()` ngay trong `AuthProvisioningClient` (infra/gRPC adapter) trước khi trả về handler — một `ApplicationError` bị ném từ tầng infra, KHÔNG nhất quán với cách mọi `*AlreadyExists*Error`/`*AlreadyTaken*Error` khác trong repo được ném (`CreateOrgHandler`/`AcceptInviteHandler`: infra chỉ trả `existing` — data thô — handler ở APPLICATION layer mới `if (existing) throw ...`). Sửa: `provisionUser` giờ trả về union đã tag (`ProvisionedOwner | OwnerEmailAlreadyExists`, KHÔNG throw), `ProvisionOrgHandler.execute()` tự `if ('alreadyExists' in provisioned) throw new OwnerEmailAlreadyExistsError()` — đúng layer, đúng chỗ như 2 handler kia. Bài học: "business outcome không được trip breaker" và "adapter không được tự quyết định application error" là 2 rule tách biệt — sửa cái đầu không tự động sửa cái sau, dễ tưởng đã xong khi chỉ mới xong một nửa.

**Sửa kèm 1 bug thật phát hiện trong lúc audit — bất đối xứng graceful-degrade:** `SearchKnowledgeService.search()` chạy semantic (embedding + pgvector) và keyword (Elasticsearch) song song; nhánh keyword đã `.catch(() => [])` từ trước nhưng nhánh semantic thì KHÔNG — embedding lỗi (giờ có breaker/timeout nên lỗi *nhanh hơn*, nhưng vẫn là lỗi) từng làm chết toàn bộ query. Bọc `embedBatch()` + `chunkRepo.semanticSearch()` vào 1 private method `semanticSearch()` có `.catch()` riêng — giờ cả 2 nhánh đối xứng, search chỉ thật sự rỗng khi **cả 2** dependency cùng chết.

**Cố ý KHÔNG bọc breaker cho `ElasticsearchKeywordRepository.indexItem()`** (chỉ `search()`): indexing chạy trong Kafka consumer, đã retry→DLQ an toàn ở tầng message (`eventing_patterns.md §4`) — bọc thêm breaker ở đây là 2 cơ chế an toàn chồng lên nhau với ngữ nghĩa khác nhau, không tăng bảo vệ thật, chỉ thêm phức tạp.

### 3.1.1 2 nâng cấp thêm sau khi audit lại chính `CircuitBreaker` (2026-07-12, cùng ngày)

**A. Race condition ở HALF-OPEN — nhiều caller đồng thời tự coi mình là probe.** Bản đầu chỉ check `if (this.state === 'open')` khi vào `execute()`. Nếu N request đến đúng lúc `timeoutMs` vừa hết hạn, request đầu tiên đổi state sang `half-open` **trước khi** `await fn()` — nhưng vì đó là điểm `await` đầu tiên, N-1 request còn lại (đã gọi `execute()` trong cùng tick đồng bộ) chạy tiếp mà state đã là `half-open`, không còn khớp điều kiện `=== 'open'` nữa → **lọt qua luôn**, tất cả cùng gọi `fn()` thật — dội cả 1 chùm request vào dependency vừa mới hồi (yếu), có thể đánh sập nó lần nữa, phản tác dụng chính của circuit breaker.

Sửa bằng cách dùng chính `state === 'half-open'` làm mutex (không cần thêm field `probing` riêng — thử thêm 1 field `probing: boolean` trước, phát hiện vẫn sai vì check `state==='open'` không bắt được N-1 request kia, nên bỏ field, gộp logic vào 1 check `if (this.state === 'half-open') throw` đặt TRƯỚC check `state === 'open'`):
```typescript
async execute<T>(fn: () => Promise<T>): Promise<T> {
  if (this.state === 'half-open') throw new Error('Circuit open') // đã có 1 probe đang chạy
  if (this.state === 'open') {
    if (Date.now() - this.lastFailureTime <= this.timeoutMs) throw new Error('Circuit open')
    this.setState('half-open') // claim probe slot — đồng bộ, trước await đầu tiên
  }
  // ...await fn()...
}
```
An toàn vì toàn bộ đoạn check-và-đổi-state chạy **đồng bộ** (không có `await` nào chen giữa) — trong Node (single-threaded, event loop), 1 khối code đồng bộ không bao giờ bị 1 lời gọi khác chen vào giữa chừng, nên không cần lock/atomic thật.

Test cho case này (`circuit-breaker.spec.ts`): 1 probe chậm (chưa resolve) + 3 caller đến đồng thời → assert **chỉ 1** trong 4 thực sự gọi `fn()`, 3 còn lại fail fast với `'Circuit open'`.

**B. Không quan sát được từ bên ngoài — thêm Prometheus metrics.** Trước đó chỉ log qua pino (`warn`/`error`) — muốn biết breaker nào đang `open` phải đọc log thủ công, không alert được. Thêm 2 metric module-level (theo đúng convention `search.metrics.ts`/`notification.metrics.ts` — Counter/Gauge singleton, tự surface qua `GET /metrics` có sẵn), gắn nhãn `name` để phân biệt breaker nào (mỗi consumer truyền tên riêng lúc `new CircuitBreaker(name, logger, ...)` — tham số MỚI, bắt buộc, đứng đầu):

```typescript
const stateGauge = new Gauge({
  name: 'circuit_breaker_state', // 0=closed, 1=half-open, 2=open
  labelNames: ['name'],
})
const transitionsCounter = new Counter({
  name: 'circuit_breaker_transitions_total',
  labelNames: ['name', 'state'],
})
```

5 consumer hiện tại, mỗi cái 1 tên nhãn riêng: `claude-summarizer`, `gemini-summarizer`, `ollama-embedding`, `elasticsearch-search`, `auth-provisioning-grpc`. `circuit_breaker_state{name="ollama-embedding"} 2` → biết ngay breaker nào đang open mà không cần đọc log.

### 3.1.2 SRP caller class — thay `new CircuitBreaker()` rải rác trong adapter (2026-07-12)

**Vấn đề phát hiện qua thảo luận, không phải bug:** `new CircuitBreaker(...)` nằm trong constructor của adapter (`AuthProvisioningClient`, `ClaudeSummarizer`...) — nhìn vào `ProvisionOrgHandler` hay controller gọi nó, **không cách nào biết** có breaker hay không, phải lần xuống tận adapter mới thấy. So sánh với Kafka consumer: `KnowledgeIndexerConsumer` (`.../consumers/knowledge-indexer.consumer.ts`) bọc `ResilientEventConsumer` và nhìn rất rõ ràng — nhưng đào sâu thì `ResilientEventConsumer` cũng chỉ được `new` trong **body constructor**, hệt cơ chế cũ của Circuit Breaker, **không phải nhờ dependency injection**. Cái làm nó "lộ ra" là 2 thứ khác: **(a)** cả file `KnowledgeIndexerConsumer` chỉ làm đúng 1 việc (bọc resilient consumer), không có gì khác cạnh tranh sự chú ý, và **(b)** tên class tự mô tả (`Resilient...`, `...Indexer...`). Đây là bài học chính rút ra: **độ lộ ra không đến từ DI, đến từ "1 file/class chỉ làm đúng 1 việc + tên tự mô tả".**

**Đã thử `@CircuitBreak` decorator trước, bỏ:** hoạt động đúng (đã build, test xanh), nhưng cần `experimentalDecorators`/`emitDecoratorMetadata` mới cho `shared-kernel` (trước đó chưa từng cần), đấu với TS về generic variance (`TypedPropertyDescriptor<T>`) và private-field nominal typing (`this.logger`) — friction thật, và **chỉ áp dụng được cho code kiểu OOP/class** (không gắn được vào Fastify thuần — decorator chỉ bám được vào class method, `auth-service` viết theo style hàm, không có class để gắn).

**Giải pháp chốt — SRP caller class, đúng công thức đã chứng minh hiệu quả với `ResilientEventConsumer`:** tách phần "gọi external call qua breaker" ra **1 class riêng, nhỏ, chỉ làm đúng 1 việc, tên tự mô tả dependency nó bảo vệ** — rồi tiêm vào class nghiệp vụ như 1 dependency bình thường.

```typescript
// claude-api.caller.ts — CHỈ làm 1 việc, không có gì khác trong file này
@Injectable()
export class ClaudeApiCaller {
  private readonly breaker: CircuitBreaker
  constructor(@InjectPinoLogger(ClaudeApiCaller.name) logger: PinoLogger) {
    this.breaker = new CircuitBreaker('claude-summarizer', logger)
  }
  call<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(fn)
  }
}

// claude-summarizer.ts — giữ nguyên logic nghiệp vụ (build prompt, parse response), tiêm caller
constructor(config: ConfigService, private readonly caller: ClaudeApiCaller) {}
async summarize(query, context) {
  const response = await this.caller.call(() => this.client.messages.create({ ... }))
  ...
}
```

5 caller class tương ứng 5 external call: `ClaudeApiCaller`, `GeminiApiCaller`, `OllamaEmbeddingCaller`, `ElasticsearchSearchCaller` (search-service), `AuthProvisioningGrpcCaller` (core-api). `AuthProvisioningClient.provisionUser`/`cancelProvisionedUser` cùng tiêm 1 instance `AuthProvisioningGrpcCaller` → chia sẻ đúng 1 breaker, y hệt hành vi trước đó.

**3 lợi ích, đúng thứ tự ưu tiên khi thiết kế:**
1. **Lộ ra tại chỗ dùng, đúng công thức Consumer** — `grep -rl "CircuitBreaker(" apps/*/src/**/*.caller.ts` (hoặc đơn giản là `ls *.caller.ts`) liệt kê toàn bộ dependency có breaker, mỗi file = 1 dependency, tên file tự nói lý do tồn tại.
2. **Zero TS decorator friction** — không cần `experimentalDecorators`, không đấu generic variance/private-field typing. Áp dụng được cho cả style hàm (Fastify) lẫn OOP (NestJS) — chỉ đổi "vỏ" (class method vs closure), lõi `CircuitBreaker` vẫn 1 chỗ.
3. **Đúng Clean Architecture / Hexagonal** — caller class là 1 adapter thật, tiêm vào class nghiệp vụ như mọi dependency khác (repository, service khác) — không phải const trần lơ lửng ngoài composition root.

**Đánh đổi chấp nhận được:** tăng số file (+5, mỗi file rất nhỏ, gần như khuôn mẫu lặp lại — cố ý, đổi lấy độ rõ ràng, không phải duplication code thật cần DRY hoá) so với decorator (0 file thêm) hoặc `new CircuitBreaker()` thủ công (0 file thêm nhưng ẩn hoàn toàn).

**Quyết định "đổi lại từ decorator sau khi đã build/test xong" — cố ý, không phải lãng phí công:** ở giai đoạn build/development (khác với hệ thống production đang chạy thật), thiết kế tốt hơn được ưu tiên hơn "đã test xanh nên giữ nguyên cho đỡ tốn công sửa lại" — xem thêm nguyên tắc làm việc đã thống nhất, áp dụng cho toàn bộ curriculum này.

### Rules (Circuit Breaker)
- Mỗi external call cần bảo vệ → 1 SRP caller class riêng (`XCaller`), tên mô tả đúng dependency, chỉ chứa `CircuitBreaker` + method `call<T>(fn) => Promise<T>` — không thêm logic nghiệp vụ vào caller class
- Caller class tiêm vào class nghiệp vụ qua constructor (NestJS DI hoặc composition root thủ công như `auth-service`) — KHÔNG khai báo `const` trần ở module scope với logger "từ đâu đó"
- 2 method cùng bảo vệ 1 dependency (như `provisionUser`/`cancelProvisionedUser`) → tiêm CÙNG 1 caller instance, chia sẻ breaker — có chủ đích, không phải lỗi
- Bọc ở **call synchronous/hot-path** (user đang chờ response) — không bọc call đã an toàn nhờ cơ chế khác (Kafka retry→DLQ, background job)
- Lỗi nghiệp vụ bình thường (404 index-not-found, `ALREADY_EXISTS`...) phải được bắt và trả về **bên trong** hàm truyền vào `caller.call(fn)`, KHÔNG để lọt ra ngoài như 1 failure — nếu không breaker sẽ trip vì traffic hợp lệ
- Threshold/timeout mặc định (5 lỗi liên tiếp / 60s) đủ dùng cho mọi consumer hiện tại — chỉ đổi khi có lý do cụ thể (đo được, không đoán)

---

## 4. Rate Limiting & Throttle

### 4.1 HTTP rate limiting — per-route + per-org

**Có 2 trục phải phân biệt, không phải 1:**

| Trục | Cơ chế | Trạng thái |
|---|---|---|
| **Per-route** — route nhạy cảm (login, tạo org, spend credit) cần limit chặt hơn CRUD thường | `@Throttle({ default: { ttl, limit } })` per-method, override default của `ThrottlerModule.forRoot()` | Đã có sẵn — xem `org.controller.ts`, `knowledge.controller.ts`, `credit.controller.ts`, `engagement.controller.ts`, `platform-admin.controller.ts` |
| **Per-org** — request từ org A không được ăn hết quota của org B | Tracking key (bucket) phải theo `orgId`, không phải IP | ⛔ Thiếu — mặc định `ThrottlerGuard` track theo IP, mọi org đứng sau cùng NAT/proxy công ty dùng chung 1 bucket, và ngược lại không cô lập được org này khỏi traffic của org khác |

**Fix per-org: `OrgAwareThrottlerGuard`** (`infrastructure/http/guards/org-aware-throttler.guard.ts`) — override `getTracker()`:
```typescript
protected async getTracker(req: FastifyRequest): Promise<string> {
  const orgId = req.headers['x-org-id']
  if (typeof orgId === 'string' && orgId.length > 0) return `org:${orgId}:ip:${req.ip}`
  return `ip:${req.ip}`  // route chưa có org (login/register) → rơi về IP như cũ
}
```
Đăng ký thay `ThrottlerGuard` ở `APP_GUARD` trong `app.module.ts`.

**Về mặt cơ chế:** `getTracker()` **không phải** hàm quyết định pass/fail (không phải `canActivate()`, mình không override nó). Nó chỉ là 1 hook mà `canActivate()` gốc (kế thừa nguyên, không đổi) gọi để lấy `tracker: string`, sau đó `generateKey(context, tracker, throttlerName)` tự nối thêm `ClassName-MethodName` vào key rồi hash — nghĩa là **per-route và per-org tự kết hợp**, không cần tự ghép chuỗi route vào tracker. `handleRequest()` mới là nơi thật sự tăng counter trong storage và so với `limit` để quyết định 429. 2 request cho ra cùng 1 chuỗi `getTracker()` → cùng 1 key → dùng chung 1 bucket đếm quota.

**⚠️ Vì sao đọc `X-Org-Id` thô (chưa qua guard xác thực membership) mà vẫn đúng:** `ThrottlerGuard` là `APP_GUARD` — chạy **trước** mọi guard cấp controller (`JwtAuthGuard`, `OrgGuard`), nên `request.user`/`request.org` (được set sau khi xác thực) chưa tồn tại ở thời điểm này. Đây là giới hạn thật của Nest guard ordering (global guard luôn chạy trước route-level guard), không phải sơ suất. Chấp nhận được vì mục đích của rate-limiting là **công bằng/chống lạm dụng**, không phải authorization — request có header `X-Org-Id` giả vẫn bị lớp sau (membership check, hoặc chính domain logic) chặn như cũ; hậu quả tệ nhất của việc track theo header chưa xác thực chỉ là bucket sai (không phải data leak). Các route đọc chính header này thô để lấy `orgId` phục vụ query (search-service/notification-service không có `OrgGuard`, đọc thẳng `@Headers('x-org-id')`) — cùng 1 tin cậy biên đã có sẵn trong codebase, không phải trust boundary mới.

**⚠️ Rủi ro thật đã tìm ra và vá (2026-07-11) — griefing 1 tenant cụ thể bằng header giả:** vì `ThrottlerGuard` chạy trước `JwtAuthGuard`, request **không cần token hợp lệ** vẫn tiêu tốn quota. Kẻ tấn công ẩn danh gửi hàng loạt request với `X-Org-Id: <org-nạn-nhân>` (orgId không bí mật — lộ qua URL/response body) tới 1 route bất kỳ có thể cố ý burn hết quota của org đó dù request sau đó bị 401 — user thật của org bị 429 oan. Đây không phải rủi ro lý thuyết vì trước khi có `OrgAwareThrottlerGuard`, tấn công tương tự khó nhắm đúng 1 org (chỉ nhắm được theo IP). **Vá bằng cách ghép thêm IP vào tracker: `org:{orgId}:ip:{ip}`** thay vì chỉ `org:{orgId}`. Không chặn tuyệt đối (kẻ tấn công vẫn xoay IP được) nhưng nâng chi phí tấn công đáng kể — mỗi IP chỉ burn được bucket riêng của chính nó, không cộng dồn phá 1 bucket chung cho cả org.

**Cố ý CHƯA làm — per-org configurable limit** (số request/phút khác nhau theo org, kiểu tier/pricing): mọi org hiện dùng chung ngưỡng số (per-route) như nhau, chỉ khác nhau ở *bucket* (cô lập lẫn nhau), không khác nhau ở *số*. Thêm cột limit-per-org configurable là một tính năng riêng (đọc từ DB mỗi request hoặc cache) — chưa có nhu cầu thật (chưa có tier/pricing phân biệt), YAGNI cho đến khi có. **Đừng lặp lại bài học `aiRateLimitPerMin`** (xoá 2026-07-12 — field tồn tại nhiều tháng nhưng không nơi nào enforce nó) — nếu làm, field DB và code enforce phải đi cùng nhau trong 1 lần, không thêm field "cho tương lai" trước.

**Đường lùi khi horizontal-scale (nhiều instance 1 service):** `ThrottlerStorageService` mặc định là in-memory — đúng cho 1 process. Khi có >1 replica, bucket không share giữa các instance → limit thực tế bị nhân lên theo số replica. Lúc đó đổi sang `ThrottlerStorageRedisService` (cần Redis, hiện dự án **chưa deploy** — xem `docker-compose.yml`). Tripwire: revisit khi service nào đó chạy >1 instance thật (K8s replica > 1 hoặc PM2 cluster mode).

#### 4.1.1 Audit toàn dự án (2026-07-11) — service nào chuẩn, service nào không áp dụng được

Rate limiting không phải 1 cơ chế dùng chung — mỗi service có transport/trust-model khác nhau, áp máy móc y hệt là sai:

| Service | Cơ chế | Per-route | Per-org | Trạng thái |
|---|---|---|---|---|
| `auth-service` | Fastify thuần + `@fastify/rate-limit` (KHÔNG dùng NestJS) | ✅ có sẵn (`login` 5/5min, `register` 5/5min, `refresh` 10/1min) | N/A — **đúng** là IP-based, vì auth-service xử lý request **trước khi có identity/org** (chính nó là nơi tạo ra identity) | ✅ Chuẩn, không sửa |
| `core-api` | NestJS `@nestjs/throttler` | ✅ có sẵn (5 controller) | ✅ `OrgAwareThrottlerGuard` | ✅ Chuẩn |
| `search-service` | NestJS `@nestjs/throttler` | ✅ thêm `@Throttle` 20/60s cho `POST /search` (chạm Elasticsearch + có thể Claude summarize — đắt hơn CRUD) | ✅ `OrgAwareThrottlerGuard` | ✅ Chuẩn (vá cùng đợt với per-org) |
| `notification-service` | NestJS `@nestjs/throttler` | Không thêm — route chỉ là CRUD nhẹ (list/mark-read), không có chi phí AI/external, giữ mức global 100/60s là đủ | ✅ `OrgAwareThrottlerGuard` | ✅ Chuẩn |
| `worker-service` | `NestFactory.createApplicationContext` — **không có HTTP server**, chỉ consume Kafka | N/A | N/A | ✅ Đúng bản chất, không áp dụng |
| `chat-service` | `src/` chưa tồn tại — chưa build | N/A | N/A | Chưa tới lượt, không áp dụng |

`OrgAwareThrottlerGuard` **không** đưa vào `shared-kernel` dù trùng lặp 3 lần (core-api/search-service/notification-service) — `shared-kernel` framework-agnostic (không phụ thuộc `@nestjs/*`, dùng chung cho cả `auth-service` là Fastify thuần), thêm dependency NestJS vào đó phá vỡ ranh giới đó chỉ để tiết kiệm 10 dòng lặp lại. Mỗi service NestJS giữ bản sao riêng trong `infrastructure/http/guards/`, đúng convention hiện có (`health.controller.ts` + `@SkipThrottle()` cũng lặp lại y hệt ở cả 3 service).

### 4.2 Throttle (AI / Embedding workload)

### Vấn đề
User upload 500 documents cùng lúc → 500 embedding requests → pgvector / Claude API quá tải.

### Giải pháp — xử lý theo batch với delay
```typescript
// infrastructure/ai/throttled-embedder.ts
@Injectable()
export class ThrottledEmbedder {
  private readonly BATCH_SIZE = 10
  private readonly DELAY_MS = 100  // 100ms giữa các batch = 100 embeddings/giây max

  async embedMany(items: { id: string; text: string }[]): Promise<void> {
    const batches = chunk(items, this.BATCH_SIZE)

    for (const batch of batches) {
      await Promise.all(batch.map(item => this.embedOne(item)))
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(r => setTimeout(r, this.DELAY_MS))
      }
    }
  }
}
```

### ⛔ Per-org AI rate limit — ĐÃ XOÁ (2026-07-12), không dựng lại mẫu này nếu chưa có nhu cầu thật

Từng có `Organization.aiRateLimitPerMin` (cột DB + domain field, default 20) với ý định enforce như code mẫu cũ ở đây. Audit toàn dự án phát hiện: field tồn tại nhưng **không có bất kỳ nơi nào đọc/enforce nó** — cấu hình được nhưng đổi giá trị không ảnh hưởng gì thật. Đã xoá field khỏi schema/domain/mapper/repository (migration `prisma db push --accept-data-loss`, 8 org có giá trị cũ, không quan trọng vì chưa từng có hiệu ứng).

**Tripwire — chỉ dựng lại khi có nhu cầu thật** (tier/pricing phân biệt theo org cho AI usage): lúc đó cần cả field DB **và** 1 nơi enforce thật (ví dụ Redis counter như code mẫu cũ, nhưng dự án hiện chưa deploy Redis — xem `§4.1` tripwire tương tự). Đừng thêm field cấu hình trước khi có code dùng nó — bài học từ chính field này.

### Rules
- Throttle áp dụng cho: embedding generation, Claude RAG calls, re-indexing jobs
- KHÔNG throttle CRUD operations — chỉ AI workload
- Dùng cùng với Circuit Breaker (`rag_ai_integration.md`) — Throttle kiểm soát tốc độ, Circuit Breaker kiểm soát health

---

## 5. Graceful Shutdown

### Vấn đề
Process bị dừng đột ngột (deploy mới, container restart, autoscale scale-down, `docker stop`) trong lúc đang xử lý dở:
- Request HTTP đang chạy bị cắt ngang → client nhận connection reset thay vì response.
- Cuộc gọi gRPC đang chạy bị cắt ngang giữa chừng — **nguy hiểm hơn HTTP thường** khi RPC đó là 1 bước trong saga cross-service: ví dụ `ProvisionUser` (xem `microservice_architecture.md`/org-provisioning saga) đã tạo xong user ở `auth_db` nhưng response chưa kịp về tới core-api — core-api coi như fail, chạy compensation, nhưng user vừa tạo có thể đã "kịp" trả lời trước khi process chết → race hiếm nhưng có thật.
- Connection pool Postgres bị ngắt đột ngột thay vì đóng sạch (Prisma không kịp `$disconnect()`).

### Giải pháp
Bắt tín hiệu dừng (`SIGTERM`/`SIGINT`) → **ngừng nhận việc mới** trên mọi transport (HTTP, gRPC...) nhưng **cho việc đang chạy dở hoàn tất** (giới hạn bởi 1 timeout) → sau đó mới đóng kết nối DB → thoát process sạch.

### Implement — ví dụ thật từ `auth-service/src/main.ts`
```typescript
const SHUTDOWN_TIMEOUT_MS = 10_000

async function bootstrap() {
  // ...composition root + app.listen() + startGrpcServer()...
  const grpcServer = startGrpcServer(application.CommandBus, logger)

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`)

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref() // timer này không được giữ process sống nếu shutdown xong sớm

    Promise.all([
      app.close(),                                                       // 1. ngừng nhận HTTP mới, đợi request dở xong
      new Promise<void>((resolve) => grpcServer.tryShutdown(() => resolve())), // 2. tương tự cho gRPC
    ])
      .then(() => prismaService.disconnect())                            // 3. CHỈ đóng DB sau khi cả 2 transport đã đóng sạch
      .then(() => {
        clearTimeout(forceExit)
        logger.info('Shutdown complete')
        process.exit(0)
      })
      .catch((err) => {
        logger.error({ err }, 'Error during shutdown')
        process.exit(1)
      })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
```

### ⚠️ Gotcha Windows (dev machine, không phải bug code)
Windows **không có tín hiệu POSIX thật**. `SIGTERM`/`SIGINT` trên Node-Windows chỉ giả lập qua console-control-handler, **chỉ hoạt động khi tự bấm Ctrl+C trên đúng terminal** đang chạy process đó. Gửi tín hiệu từ ngoài (`taskkill` không `/F`, hoặc `process.kill(otherPid, 'SIGINT')` từ process khác) trên Windows hầu như luôn hành xử như giết cứng (bỏ qua handler đã đăng ký) — đã verify thực tế: cả 2 cách đều KHÔNG kích hoạt được log `"...shutting down gracefully"`. Muốn tự mắt thấy code này chạy trên Windows: mở terminal, `npm run dev`, tự bấm Ctrl+C. Trong Docker/Linux (nơi code này thực sự phục vụ) thì `docker stop`/Kubernetes gửi `SIGTERM` thật theo chuẩn POSIX, handler chạy đúng như thiết kế — đây là target thật của pattern này, không phải dev loop trên Windows.

### Rules
- ⛔ KHÔNG đóng DB trước khi đóng transport — request/RPC đang dở sẽ crash giữa chừng thay vì hoàn tất
- Đăng ký handler **ở đúng 1 nơi** (composition root của `main.ts`, xem `microservice_architecture.md` phần Composition Root) — không rải rác nhiều nơi trong app
- Timeout ép buộc (`forceExit`) là bắt buộc — nếu 1 request/RPC treo vô hạn (deadlock, external call không timeout), graceful shutdown phải có đường thoát cứng sau N giây, không được chờ mãi
- `forceExit.unref()` — nếu shutdown xong sớm hơn timeout, timer đó không được giữ process sống thêm
- Entry point khác (`main.lambda.ts`, cron job, worker consumer...) có process lifecycle khác hẳn (serverless không có "process sống lâu" để graceful shutdown) — pattern này chỉ áp dụng cho service chạy dài hạn (long-running), không áp máy móc cho mọi entrypoint

---

## 6. Background Jobs — index tập trung

**✅ 2026-07-31: tripwire đã chạm (7 job class, 8 lượt `@Cron`/`@Interval`) — đã dựng `infrastructure/scheduled-jobs/`** (`ScheduledJobRegistry`), thay vì tiếp tục dựa vào bảng tay bên dưới. Mỗi job tự `register()` trong constructor của chính nó (`register()` ném khi trùng tên — cùng kiểu guard `EventRouter.register()`).

**Sửa lại 2 lần cùng ngày sau khi bị bắt lỗi thiết kế:**
1. Bản đầu lưu CẢ live-health (lần chạy/lỗi gần nhất, số lỗi liên tiếp) trong RAM của registry, đọc qua 1 REST endpoint `GET /jobs` riêng. Sai 2 điểm — (a) app này đã tự giả định multi-replica chạy song song (xem "HA-safe claim" bên dưới, `FOR UPDATE SKIP LOCKED`), nên state RAM theo từng process cho câu trả lời khác nhau tuỳ replica nào trả lời request, không phải sự thật chung; (b) health chỉ xem được khi CHỦ ĐỘNG gọi API — không có gì tự động scrape/alert, quay lại đúng vấn đề "phải nhớ để kiểm tra" mà cả cụm việc này sinh ra để giải quyết.
2. Sau đó phát hiện thêm: `GET /jobs` (bản đã tách metadata tĩnh ra khỏi live-health ở bước 1) **vẫn là 1 REST endpoint không ai gọi tự động** — Prometheus chỉ scrape `/metrics`, không tự khám phá route JSON tuỳ ý; con người cũng không có lý do gọi tay khi code/bảng doc đã sẵn đó. Bỏ hẳn `ScheduledJobsController` + `GET /jobs`. Thay bằng **info metric** `core_api_scheduled_job_info{job,schedule,file,purpose}` (giá trị luôn = 1, set 1 lần trong `register()`) — cùng pattern `kube_pod_info`/`node_uname_info` của các exporter Prometheus phổ biến. Giờ "job nào tồn tại" nằm chung 1 nguồn với health (`core_api_scheduled_job_last_success_timestamp_seconds`/`..._last_failure_timestamp_seconds`/`..._failures_total`, `scheduled-jobs.metrics.ts` — cùng cơ chế `outbox.metrics.ts`), join được với nhau trong 1 query Grafana, không phải 2 hệ thống tách rời.

Bảng dưới đây (metadata) giữ lại làm tài liệu tường thuật đọc offline; nếu lệch với `core_api_scheduled_job_info` trên `/metrics` thì sửa bảng theo đó, không phải ngược lại.

⚠️ **Gap đã biết, chưa giải quyết:** 1 job KHÔNG BAO GIỜ chạy (misconfig `@Cron`, lỗi wiring lúc boot) sẽ không tăng cả success lẫn failure — im lặng hoàn toàn, không rơi vào alert "failure rate > 0" ở trên. Cần alert kiểu "last-success-timestamp quá cũ" (dead man's switch) mới bắt được ca này, nhưng mỗi job có chu kỳ khác nhau tới 3 bậc độ lớn (2s vs hằng ngày) nên 1 ngưỡng chung không hợp — chưa làm, ghi lại để không quên.

Lý do vẫn KHÔNG dời code từng job vào 1 thư mục `jobs/` vật lý chung (chỉ đăng ký tập trung, không di chuyển code): mỗi job vẫn cần domain knowledge riêng của module nó thuộc về (outbox cần biết `OutboxStatus`, saga cần biết claim/INFLIGHT semantics...) — tách code sang thư mục trung lập chỉ thêm gián tiếp, không giảm coupling thật. Đăng ký tập trung (biết "có gì đang chạy") và code tập trung (chỗ code nằm) là 2 việc khác nhau — việc trước đáng làm, việc sau không.

| Job | Lịch | File |
|---|---|---|
| `PollingPublisherService` | `@Interval(2000)` | `infrastructure/outbox/polling-publisher.service.ts` |
| `OutboxReaperService` | `@Interval(30000)` | `infrastructure/outbox/outbox-reaper.service.ts` |
| `OutboxMetricsReporter` | `@Interval(30000)` | `infrastructure/outbox/outbox-metrics-reporter.service.ts` |
| `OutboxCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/outbox/outbox-cleanup.service.ts` |
| `SagaCompensationReaperService` (2 job: `.poll` + `.reapStaleClaims`) | `@Interval(5000)` + `@Interval(30000)` | `infrastructure/saga-compensation/saga-compensation-reaper.service.ts` |
| `SagaCompensationCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/saga-compensation/saga-compensation-cleanup.service.ts` |
| `IdempotencyCleanupService` | `@Cron('0 3 * * *')` | `infrastructure/http/idempotency/idempotency-cleanup.service.ts` |

**Lỗi âm thầm đã sửa cùng lúc:** trước đây `PollingPublisherService.poll()` và `SagaCompensationReaperService.poll()` chỉ có `try/finally`, KHÔNG có `catch` ở tầng ngoài — nếu `claimPendingBatch` tự nó throw (vd DB blip), lỗi trôi thành unhandled rejection, không log, không ai biết job vừa "chết lặng" 1 tick. Cả 7 job giờ đều có `catch` tầng ngoài: ghi `jobRegistry.recordFailure()` + log lỗi rõ ràng, rồi **swallow** (không rethrow) — 1 job nền lỗi 1 tick không được phép làm crash cả process; tick sau vẫn chạy bình thường.

**2026-07-31 (trước đó cùng ngày):** `modules/outbox/` → `infrastructure/outbox/` — outbox không có domain layer thật (không entity, không business rule), bị đặt nhầm vào `modules/` từ trước khi ranh giới "business module vs infra thuần" rõ ràng như `saga-compensation` (viết sau, đã đúng vị trí từ đầu). Xem `folder_structure_sop.md`: `modules/` = "business logic theo từng domain" — outbox không khớp định nghĩa này. Lúc dời, cấu trúc con `domain/repositories/` + `infrastructure/{cleanup,publishers,reapers,reporters,repositories}/` được giữ nguyên — **sai, sửa tiếp ngay sau đó cùng ngày**: một khi đã xác nhận outbox không phải business module, không còn lý do giữ khuôn `domain/`+`infrastructure/` lồng nhau (khuôn đó chỉ có ý nghĩa cho module có tầng DDD thật) trong khi `saga-compensation` — cùng loại, viết sau — phẳng hoàn toàn. Đã dẹp phẳng `infrastructure/outbox/` xuống 8 file ngang hàng, khớp `saga-compensation` 100%; tên file (`outbox-cleanup.service.ts`, `prisma-outbox.repository.ts`...) đã đủ tự mô tả, không cần subfolder phân loại thêm.

### 6.1 Port hoá driven-side khi nào đáng, khi nào là ceremony

2 job outbox trên (`poll()`, `reapStaleClaims()`) trước đây gọi thẳng `PrismaService.$queryRaw`/`$executeRaw` — vi phạm đúng quy tắc `cqrs_pattern.md` đã có sẵn ("Application layer dùng Domain Repository qua Interface, không biết ORM"). Đã sửa: `IOutboxRepository` (đã có, dùng cho `append()`) mở rộng thêm `claimPendingBatch`/`markProcessed`/`markFailed`/`reapStaleInflight` — thuật toán HA-safe (`FOR UPDATE SKIP LOCKED`) giờ nằm sau 1 interface có tên, đổi ORM bắt buộc phải implement lại đủ (TypeScript ép, không dựa trí nhớ).

**Từng làm sai 1 lần trong lúc sửa cùng đợt này, ghi lại để không lặp lại:** áp y hệt pattern đó cho `IdempotencyCleanupService`/`IdempotencyInterceptor` — dựng `IIdempotencyRepository` port. Sai, vì thiếu điều kiện tiên quyết: `IOutboxRepository` đúng là port vì nằm ở `domain/repositories/` và được **command handler thật ở tầng Application** (`publish-knowledge.handler.ts` và nhiều handler khác) inject — dependency đi từ Application vào Domain, Infrastructure implement. `IIdempotencyRepository` thì interface + implementation + 2 consumer duy nhất **đều nằm trong `infrastructure/`** — không tầng Application nào phụ thuộc vào nó, không có ranh giới kiến trúc nào bị cắt qua. Đó là infra gọi infra qua 1 lớp gián tiếp, không phải Hexagonal port — đã revert.

**Câu hỏi để tự kiểm tra trước khi port hoá 1 thứ:** *"Bên kia interface có phải Application/Domain layer thật không, hay cũng là Infrastructure?"* Nếu cả 2 đầu đều là Infrastructure → không cần interface, gọi thẳng. Câu hỏi phụ: *"Logic phía sau có đủ 'khó, đáng bảo vệ' để mất công port hoá không?"* (`FOR UPDATE SKIP LOCKED` đáng; 1 dòng `deleteMany` thì không).

---

## 7. Correlation-id — W3C Trace Context xuyên HTTP/gRPC/Kafka (2026-07-21)

### Vấn đề
`requestId` trước đây chỉ sống trong 1 service, 1 request HTTP (Fastify `req.id` / nestjs-pino per-request child logger). Request fan-out ra gRPC (core-api → auth-service) hoặc Kafka (outbox → consumer) mất hoàn toàn correlation — không cách nào nối log của 3 service lại thành 1 request logic khi debug.

### Giải pháp — W3C Trace Context (`traceparent`), KHÔNG phải full OpenTelemetry SDK
User chọn chuẩn thật (`00-{traceId}-{spanId}-{flags}`) thay vì tự chế field `requestId` riêng — lý do: nếu sau này cần OTel SDK/APM thật, chỉ cần đổi propagation layer, không phải đổi tên field log ở mọi nơi. **Cố ý KHÔNG** kéo theo `@opentelemetry/api`/SDK/exporter — chỉ lấy đúng format header + 1 ALS mang `{traceId, spanId}`, phục vụ mục đích duy nhất là nối log, chưa cần span timing/exporter thật.

`packages/shared-kernel/src/tracing/trace-context.ts` — public API chỉ 4 hàm + 1 type (đã audit lại ai thực sự import gì trước khi quyết định export gì, 2026-07-21): `runWithTraceContext`/`startTraceContext(inbound?)`/`getCurrentTraceparent()`/`traceLogFields(ctx?)` + type `TraceContext`. Phần còn lại (`generateTraceId`/`generateSpanId`/`formatTraceparent`/`parseInboundTraceparent`/`getTraceContext`) là helper nội bộ, cố ý **không export** — không cho code ngoài gọi thẳng, ví dụ gọi `generateTraceId()` tại 1 SEND boundary sẽ phá vỡ invariant RECEIVE/SEND ở dưới.

### ⚠️ Quy tắc cốt lõi — RECEIVE luôn tự sinh, SEND không bao giờ tự sinh

Mọi boundary chỉ đóng đúng 1 trong 2 vai trò, không lẫn lộn trong cùng 1 lời gọi:

| Vai trò | Hàm dùng | Khi thiếu/hỏng input |
|---|---|---|
| **RECEIVE** (HTTP middleware, gRPC server handler, Kafka consumer) | `startTraceContext(inbound)` | **Luôn tự sinh trace mới** — không bao giờ để downstream chạy mà thiếu `trace_id` |
| **SEND** (gắn vào gRPC outbound, ghi vào outbox để publish Kafka sau) | `getCurrentTraceparent()` | Trả `undefined` — **không bịa ra trace mới**, để phía RECEIVE bên kia tự quyết định |

**Điểm dễ hiểu lầm:** ranh giới KHÔNG phải "HTTP = entry point thật, gRPC/Kafka = giữa nên không cần fallback" — cả 4 điểm RECEIVE (kể cả gRPC server và Kafka consumer, vốn không phải entry point thật của hệ thống) đều dùng `startTraceContext` và **đều tự sinh trace mới nếu thiếu**. Đây là thiết kế phòng thủ có chủ đích: 1 request/event tới bất kỳ RECEIVE boundary nào cũng đảm bảo có `trace_id` dùng được, kể cả khi caller quên gắn (bug) hoặc row Kafka cũ (trước khi có cột `traceparent`) không có giá trị. Ngược lại, SEND-side không tự sinh vì bịa trace ngay lúc gửi không có ý nghĩa — chỉ nơi THẬT SỰ khởi tạo công việc mới có 1 trace đáng để propagate.

4 điểm RECEIVE hiện có: `TraceContextMiddleware` (core-api HTTP), `onRequest` hook (auth-service HTTP), `auth-provisioning.grpc-service.ts` (auth-service gRPC server), `resilient-consumer.ts` (Kafka consumer, shared-kernel). 2 điểm SEND: `auth-provisioning.client.ts.metadata()` (gRPC client), `prisma-outbox.repository.ts.append()` (ghi cột DB).

### ⚠️ `parentSpanId` — vì sao thêm lại sau khi từng cố ý bỏ

Bản đầu `TraceContext` chỉ có `{traceId, spanId}` — field `spanId` parse được từ header inbound (tên gọi đúng chuẩn W3C là "parent-id", xem giải thích dưới) bị vứt bỏ hoàn toàn sau khi dùng xong `traceId`. Lý do lúc đó: hệ thống chỉ cần "các dòng log này có cùng thuộc 1 request không" (trả lời được bằng `trace_id`), chưa cần "span nào gọi span nào".

**Câu hỏi buộc quay lại thêm:** nếu 1 request có core-api gọi CẢ auth-service LẪN search-service, cả 2 đều log cùng `trace_id` — nhưng không có cách nào từ log biết "cả 2 đều do đúng 1 lời gọi từ core-api sinh ra, độc lập với nhau" nếu không giữ lại quan hệ cha-con. Field `serviceContext` (đã có sẵn, `logging_standard.md`) trả lời được "dòng log này của service nào", nhưng KHÔNG trả lời được "theo thứ tự/quan hệ nào" — 2 câu hỏi khác nhau.

**Giải pháp — `TraceContext` có thêm `parentSpanId?: string`:**
```ts
export interface TraceContext {
  traceId: string
  spanId: string          // span CỦA CHÍNH service này
  parentSpanId?: string   // span của caller — cùng bit với "parent-id" trong header, đổi tên
                           // theo góc nhìn nội bộ; undefined nếu là root span (không ai gọi)
}
```
`startTraceContext` parse cả `traceId` lẫn `parentSpanId` từ header inbound (hàm nội bộ `parseInboundTraceparent`), tự sinh `spanId` MỚI cho chính nó như cũ (không đổi), gán `parentSpanId` = giá trị vừa parse được. `traceLogFields` thêm `parent_span_id` vào output khi có (bỏ qua nếu là root span, không log field rỗng).

**Vì sao 1 vị trí bit lại có 2 tên ("parent-id" trong spec, `spanId`/`parentSpanId` trong code):** wire format `traceparent` chỉ có 1 ô 16-hex ở giữa. Lúc 1 service GỬI đi, nó nhét `spanId` CỦA CHÍNH NÓ vào đó — với người gửi, đây là "tôi tự giới thiệu mình". Lúc service kế tiếp NHẬN được đúng chuỗi đó, cùng giá trị ấy giờ có nghĩa "đây là id của thằng đã gọi tôi" — với người nhận, đây là "parent-id". Không phải 2 giá trị khác nhau, chỉ là tên gọi đổi theo góc nhìn gửi/nhận. Code đặt tên `spanId` (của chính mình) và `parentSpanId` (của caller) là 2 field RIÊNG BIỆT trong cùng object, phản ánh đúng 2 vai trò đó tồn tại đồng thời trong 1 `TraceContext`.

**Vẫn KHÔNG phải OTel SDK thật:** không có object "span" với duration/start-end time, không export ra collector nào — chỉ thêm đúng 1 field vào log line để công cụ (Kibana/ES) hoặc script sau này có thể tự dựng lại cây quan hệ từ dữ liệu log thô, nếu cần. Nhược điểm đã chấp nhận: vẫn phải tự viết logic dựng cây đó, không có UI visualize sẵn như Jaeger.

### 3 điểm chạm

| Boundary | Cách propagate |
|---|---|
| **HTTP entry** | `TraceContextMiddleware` (core-api, đăng ký TRƯỚC `TenantContextMiddleware` trong `app.module.ts`) / `onRequest` hook đăng ký đầu tiên trong `auth-service/bootstrap/server.ts` (trước `setupFastify()`) — đọc header `traceparent` inbound (nếu có) hoặc tự sinh trace mới |
| **gRPC** | `shared-kernel/grpc/trace-propagation.ts` (`attachTraceparent`/`readTraceparent`, cùng convention với `internal-grpc-auth.ts`) — client (`AuthProvisioningClient.metadata()`) gắn vào metadata, server (`auth-provisioning.grpc-service.ts`) đọc + `runWithTraceContext` bọc quanh handler |
| **Kafka** | **Không** dùng kafkajs message headers — dùng CloudEvents extension attribute chính thức `traceparent` (CloudEvents Distributed Tracing Extension) ngay trên envelope, vì CloudEvent đã serialize structured-mode vào message value sẵn rồi, không cần đụng `MinimalKafkaMessage`/kafkajs headers. `OutboxEvent.traceparent` (cột nullable) capture từ ALS bên trong `PrismaOutboxRepository.append()` (không cần sửa call site nào gọi `append()`) → `PollingPublisherService` copy sang CloudEvent → `ResilientEventConsumer.eachMessage` đọc lại, `runWithTraceContext` bọc quanh `routeWithRetry()` mỗi message |

### Rules
- ⛔ KHÔNG dùng field tự chế (`requestId` string trần) cho cross-service correlation mới — dùng `traceparent` (format chuẩn W3C) qua các helper trên
- Mỗi hop LUÔN mint `spanId` mới (`startTraceContext`), giữ nguyên `traceId` — không tái dùng `spanId` của caller
- RECEIVE boundary mới (thêm gRPC server / consumer mới) → luôn dùng `startTraceContext(inbound)`, không tự viết logic "nếu thiếu thì bỏ qua trace" — phá vỡ guarantee "downstream luôn có trace_id"
- SEND boundary mới (thêm outbound call mới) → dùng `getCurrentTraceparent()`, không tự sinh trace mới ở đây dù tiện — sinh sai chỗ sẽ làm mất liên kết với trace gốc thật
- Không thêm OTel SDK thật (spans/exporter) trừ khi có nhu cầu APM thật — tripwire khi cần visualize distributed trace, không chỉ nối log

---

## Tóm tắt — Pattern nào dùng khi nào

```
User gửi request có thể retry → Idempotency
Route cần giới hạn theo org, không phải chung 1 bucket IP → Rate Limiting (§4.1)
Sau domain write cần notify service khác → Transactional Outbox
External service fail tạm thời → Retry (+ Circuit Breaker)
Xử lý nhiều item AI cùng lúc → Throttle
External service fail liên tục → Circuit Breaker (xem rag_ai_integration.md)
Service chạy dài hạn cần dừng sạch (deploy/restart/scale-down) → Graceful Shutdown
Cần nối log 1 request xuyên HTTP/gRPC/Kafka → Correlation-id (§7, W3C traceparent)
```
