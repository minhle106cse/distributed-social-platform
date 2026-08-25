# ADR-0002 — Vị trí của một abstraction được quyết bởi consumer, không bởi thói quen; Outbox thành capability của shared-kernel

- **Status:** Accepted — 2026-08-24. **IMPLEMENTED cùng ngày**, 25 commit, `turbo typecheck lint
  format:check test` 33/33 xanh + `npm run check:arch` A–I sạch.
- **Supersedes:** ADR-0001 §5 (`TxScopeToken` + registry) và ADR-0001 §9 điểm 2
  (`IOutboxAppender`/`IOutboxDispatchRepository`). Phần còn lại của ADR-0001 — Unit of Work, suy
  transaction từ **kiểu** của handler, fail-fast lúc boot — **vẫn còn hiệu lực**.
- **Amended 2026-08-25 (cơ chế, không đổi quyết định):** §3 bác phương án *"promote nguyên khối"* và
  chốt *"mỗi service giữ vỏ `@Injectable()` và breaker riêng"*. Quyết định đó **vẫn đúng** — lõi lên
  shared-kernel, breaker vẫn per-service. Chỉ **cái vỏ** đổi: từ một class `@Injectable()` sang một
  `useFactory` provider trong `GrpcModule` của từng service. Lý do: cái vỏ hoá ra chỉ `new` verifier
  rồi forward đúng một method, và bản thân nó lại bị nhân đôi byte-for-byte giữa hai service — đúng
  loại trùng lặp mà chính ADR này tồn tại để loại. shared-kernel không mang được `@Injectable()`
  (check H cấm `@nestjs/*`), nhưng đó là lý do để dùng factory, không phải lý do đẻ ra một class mỗi
  service chỉ để chứa một decorator. Nội dung gốc bên dưới **giữ nguyên văn** theo quy ước `README.md`.
- **Người quyết:** owner dự án. **Người soạn:** AI agent.
- **Phạm vi:** mọi abstraction (port, interface, error class, adapter, transport endpoint) trong
  `apps/*` và `packages/shared-kernel`.

---

## 1. Bối cảnh — vì sao cần một ADR nữa

ADR-0001 trả lời *"transaction chạy ở đâu"*. Nó **không** trả lời *"cái interface này nên nằm ở
file nào"*. Câu hỏi thứ hai bị bỏ ngỏ, và trong ~2 tháng sau đó nó được trả lời bằng thói quen —
mỗi lần một kiểu. Đợt audit 2026-08-24 (owner khởi xướng bằng một câu hỏi: *"sao trong `infra` lại
có interface, port đâu ra mà port?"*) đo lại toàn repo và tìm thấy **cùng một loại artefact nằm ở
những chỗ khác nhau, theo cả hai chiều ngược nhau**:

| # | Triệu chứng | Bằng chứng đo được |
|---|---|---|
| 1 | **Thừa** interface: port khai trong `infrastructure/` mà cả hai đầu đều là infra | `IOutboxDispatchRepository` (4 consumer) + `ISagaCompensationDispatchRepository` (2 consumer) — **không consumer nào** nằm ngoài `infrastructure/` |
| 2 | **Thiếu** port: application inject thẳng class hạ tầng | `AskAiHandler` → `RagQueryClient`, `ProvisionOrgHandler` → `AuthProvisioningClient`. eslint không bắt vì group của application chỉ liệt kê `@/infrastructure/database/**` + `http/**` |
| 3 | Port thật nhưng **đặt sai tầng** | `IOutboxAppender` ở `infrastructure/` dù 6 command handler dùng — khiến `common/database/core-api-repos.ts` phải xin **ngoại lệ eslint** để import `@/infrastructure/**` |
| 4 | shared-kernel chứa thứ **không có lý do** ở đó | `IMessagePublisher`: không file shared-kernel nào import, core-api là consumer **và** implementer duy nhất |
| 5 | Transport endpoint nằm trong module | gRPC **server** của search-service ở `modules/search/infrastructure/grpc/` trong khi gRPC **client** của chính nó ở `src/infrastructure/grpc/` |
| 6 | Cùng một artefact, hai vị trí tuỳ service | error class: core-api cấm `domain → common/` nên credit để trong `domain/`; auth-service cho phép nên để ở `common/errors/` |

Điểm chung của cả 6: **không có tiêu chí nào phát biểu được, nên không có gì kiểm được.** Đây đúng
là loại drift mà repo đã trả giá một lần — `folder_structure_sop.md` và `cqrs_pattern.md` mâu thuẫn
nhau ~6 tuần hồi 2026-07 mà không ai phát hiện, và câu trả lời khi đó cũng là một control
(`check:arch`), không phải thêm prose.

## 2. Quyết định

### 2.1 — Vị trí quyết bởi **consumer nằm ở đâu**, và đó là một **ảnh chụp**

Bốn nhà, mỗi nhà một lý do phải **nói ra được**:

| Nhà | Điều kiện |
|---|---|
| `packages/shared-kernel` | đúng một trong A/B/C ở §2.2 |
| service `common/` | ≥2 module của **một** service dùng, và không dính framework |
| module `domain/` | một module dùng |
| `infrastructure/` | **không bao giờ** là port — chỉ implementation |

Trường hợp mọi consumer đều nằm trong `infrastructure/`: **không interface, không DI token**, inject
class cụ thể. Độ khó của thuật toán **không** phải lý do — muốn thuật toán nằm một chỗ thì đó là lý
do để có **một class**, không phải để có một interface.

⚠️ **Đây là ảnh chụp, không phải phán quyết vĩnh viễn.** Cùng một ngày, `IMessagePublisher` đi từ
shared-kernel xuống core-api rồi **quay lại**, và `IOutboxDispatchRepository` bị xoá buổi sáng rồi
**sống lại** buổi chiều dưới tên `IOutboxStore`. Không lần nào là đảo luật — **consumer dịch
chuyển**, nên câu trả lời dịch chuyển theo. Suy lại từ import graph, đừng tin quyết định lần trước.

### 2.2 — Ba lý do để vào shared-kernel, cộng một kind test

- **A** — chính code shared-kernel import nó (không có thì không compile).
- **B** — đã có ≥2 service độc lập tiêu thụ **và** độc lập framework (tiền lệ `CircuitBreaker`).
- **C** — là **wire contract được publish** (proto type, event payload definition, routing map);
  **số consumer không liên quan**, vì mục đích là consumer không bao giờ phải import từ service của
  producer.

**Kind test (chặn tuyệt đối, bất kể A/B/C):** shared-kernel không được runtime-import `kafkajs`,
`@nestjs/*`, `fastify`, `@prisma/*`, `ioredis`. Nên một framework binding dù bị trùng lặp giữa các
service **cũng không** được promote.

### 2.3 — Outbox là **capability của shared-kernel**, không phải feature của core-api

Contract (`IOutboxWriter` + `IOutboxStore` + row shapes) và **engine** (`OutboxPublisher`: claim →
map CloudEvent → publish → mark → quyết định DLQ) ở `shared-kernel/src/outbox/`. Service cung cấp:
adapter Prisma (`FOR UPDATE SKIP LOCKED`), model, scheduler, metrics, `sourcePrefix`.

Điều này khiến `IOutboxStore` trở thành **reason A** — `OutboxPublisher` import nó — nên nó là port
hợp lệ, khác hẳn `IOutboxDispatchRepository` mà nó thay thế.

### 2.4 — Mỗi module đúng **một** file lỗi, trong `domain/` của chính nó

`modules/<module>/domain/<module>.error.ts`. `common/errors/` bị xoá ở cả 3 service. Cả 4 service
cấm `modules/*/domain/**` import `@/common/**` như nhau.

### 2.5 — Transport thuộc về service, không thuộc module

Cả hai chiều của một transport ở `src/infrastructure/<transport>/`. Module infra chỉ có 4 thư mục
con: `mappers`, `consumers`, `services`, `repositories`. Module infra cấp service là `@Global` +
import **một lần** ở `AppModule`.

## 3. Alternatives considered — và vì sao bị bác

| Phương án | Vì sao bác |
|---|---|
| **Giữ nguyên, chỉ viết rõ luật vào directive** | Luật `resilience_patterns.md` §6.1 **đã tồn tại** từ 2026-07-31 và vẫn bị vi phạm ~1 tháng. Prose không phải control. Đây là lần thứ hai repo học lại bài này. |
| **Giữ vế "logic đủ khó thì đáng port-ify"** (`FOR UPDATE SKIP LOCKED` thì có) | Vế phụ này **lặng lẽ vô hiệu hoá vế chính**: `FOR UPDATE SKIP LOCKED` là thứ **duy nhất** nó từng áp dụng vào, và hai interface nó bảo kê chính là hai interface vi phạm vế chính. Thuật toán vẫn nằm trong class dù có interface hay không, và **không test nào từng mock hai interface đó**. |
| **Đẩy outbox lên shared-kernel ngay từ lúc chỉ core-api dùng** (đề xuất đầu của owner) | Bị bác ở vòng đầu vì tiền đề *"service nào cũng dùng"* sai — chỉ core-api có bảng `OutboxEvent`. **Nhưng owner diễn đạt lại**: *"service nào **có** dùng thì cũng dùng y hệt một kiểu"* — lập luận này đúng, và cách làm nó hết speculative là đưa **engine** lên, khiến port trở thành reason A thay vì "biết đâu sau này cần". |
| **Promote `MembershipVerificationClient` nguyên khối lên shared-kernel** | Chỉ tách **lõi** (`MembershipVerifier`); mỗi service giữ vỏ `@Injectable()` và **breaker riêng** — hai service dùng chung một breaker instance thì service này làm service kia mở circuit. |
| **Ép cả 4 service dùng chung một ranh giới domain bằng cách sửa script** | Ban đầu định hardcode "domain không được import common/" vào `check:arch`. Bác: auth-service cho phép **có chủ đích** ở thời điểm đó. Script giờ **đọc `eslint.config.mjs` của từng service** và enforce theo khai báo của chính nó — thống nhất là quyết định riêng của owner, đến sau. |
| **Sửa `credit.errors.ts` cho khớp directive** (directive nói mọi error phải ở `common/errors/`) | Bác sau khi kiểm: `credit-account.aggregate.ts` — một domain aggregate — throw các error đó, mà `@/common/**` nằm trong ban-list của tầng domain. Làm theo directive thì aggregate **không import nổi error của chính nó**. **Rule sai, không phải code sai.** |
| **Bỏ `common/errors/` nhưng giữ nhiều file lỗi mỗi module** | Owner chốt "quy về 1 mối, mỗi module 1 file" — một vị trí hợp lệ thay vì hai làm chính cái check đơn giản đi (không còn nhánh if/else). |

## 4. Hệ quả

**Được:**
- `check:arch` từ 5 check lên **9 (A–I)**; mỗi check mới đều được verify bằng cách **bơm vi phạm rồi
  revert**, không phải chỉ pass trên cây sạch.
- eslint application-boundary đảo từ blocklist sang allowlist ở cả 3 service NestJS → thư mục
  `infrastructure/` **mới** mặc định là đóng.
- Adopt outbox ở service mới = model + adapter + scheduler gọi `pollOnce()`, không copy vòng lặp.
- Một lỗ hổng thật được vá kèm: trong 3 chặng gRPC chỉ **1** chặng propagate `traceparent` đủ hai
  đầu. Trùng lặp code là thứ giấu nó — hai bản `MembershipVerificationClient` giống nhau từng byte
  nên **cùng thiếu** cùng một dòng.

**Mất / phải chấp nhận:**
- 25 commit, ~90 file sửa import, trong đó vài commit trung gian không build độc lập vì Phase 5b và
  đợt refactor đan vào nhau ở ~5 file.
- shared-kernel to thêm (outbox + MembershipVerifier). Kind test §2.2 là thứ giữ nó không phình vô
  tội vạ.
- `check:arch` giờ đọc `eslint.config.mjs` của từng service → thêm một ràng buộc ngầm giữa hai file.
  Đổi tên block `files: ['src/modules/*/domain/**/*.ts']` sẽ làm check D im lặng.

**Nợ còn để ngỏ:** `check:arch` không phát hiện được lỗi **DI wiring** — chỉ `app-module-graph.spec.ts`
(NestFactory preview mode) làm được, và nó là spec nên chỉ chạy khi ai đó chạy test.

## 5. Tham chiếu

- Luật đầy đủ: `directives/folder_structure_sop.md` § *Where An Abstraction Lives* ·
  `directives/resilience_patterns.md` §6.1 · `directives/naming_conventions.md` §6 ·
  `directives/eventing_patterns.md` §4.1
- Control: `scripts/check-repo-placement.cjs` (A–I) · `apps/*/eslint.config.mjs` ·
  `apps/*/src/app-module-graph.spec.ts`
- Bài học rút ra: `.ai/memory/architecture.jsonl` #104–112
- Tường thuật theo ngày: `.ai/CHANGELOG.md` § *Moved out of PROJECT_STATUS.md on 2026-08-25*
- Tiền lệ ngành cho "port chỉ có khi băng qua biên": Cockburn, *Hexagonal Architecture*
  (alistair.cockburn.us/hexagonal-architecture) — port là chỗ **actor bên ngoài** nói chuyện với
  ứng dụng; hai lớp hạ tầng gọi nhau không tạo ra actor nào.
- Tiền lệ cho "shared kernel phải nhỏ và có chủ đích": Evans, *Domain-Driven Design*, Shared Kernel
  pattern — chia sẻ càng nhiều thì chi phí đồng bộ giữa các team càng cao, nên chỉ chia sẻ cái
  **buộc phải** chung.
