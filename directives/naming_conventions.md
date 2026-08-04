# SOP: Naming Conventions

> Chuẩn đặt tên cho các nhóm class/file lặp lại nhiều lần trong monorepo (Guard, Caller, gRPC Client,
> Repository, Handler, Error, Module, env var). Đọc file này TRƯỚC khi tạo 1 class thuộc 1 trong các
> nhóm dưới đây — mục đích là để tên tự nói lên cơ chế, không cần đọc code/comment mới hiểu.

## 🎯 Vì sao cần file này

Khảo sát 2026-07-19 phát hiện: nhiều nhóm class cùng "họ" kiến trúc (cùng vai trò, lặp lại ở nhiều
service) đã tự hình thành pattern đặt tên khá tốt qua thời gian — nhưng **không có nơi nào viết
thành rule tường minh**, nên mỗi lần code mới có nguy cơ đặt tên khác "cảm tính" theo ngữ cảnh phiên
làm việc đó thay vì theo quy ước đã có. Ví dụ thật đã xảy ra: `OrgGuard` (core-api, check membership
qua DB local) và bản đầu tiên của guard tương đương ở search-service/notification-service được đặt
tên **y hệt** (`OrgMembershipGuard`) dù cơ chế khác hẳn (gọi gRPC ra ngoài, không phải query DB) —
sau đó đổi thành `RemoteOrgMembershipGuard` mới đúng.

Nguyên tắc chung xuyên suốt file này: **tên phải tự trả lời "cơ chế lấy sự thật nằm ở đâu"** — DB
local, gọi ra ngoài (network), hay chỉ đọc claim có sẵn (JWT) — không bắt người đọc phải mở file lên
mới biết.

## 1. NestJS Guard (`implements CanActivate`)

| Cơ chế xác thực/authorization | Suffix | Ví dụ |
|---|---|---|
| Chỉ verify chữ ký JWT, không check gì thêm (không DB, không network) | `JwtAuthGuard` (tên cố định, không đổi theo service) | `JwtAuthGuard` (core-api/search-service/notification-service) |
| Check quyền qua **DB local** (bảng thuộc chính service này) + có thể resolve thêm role/permission | `{Scope}Guard` (không cần tiền tố "Local" — đây là baseline mặc định) | `OrgGuard` (core-api — query `MembershipRepository` local, resolve role+permission) |
| Check quyền bằng cách **gọi ra ngoài qua network** (gRPC/HTTP) vì service này không có bảng đó | `Remote{Scope}Guard` | `RemoteOrgMembershipGuard` (search-service, notification-service — gọi gRPC sang core-api) |
| Chỉ đọc claim có sẵn trong JWT payload, KHÔNG DB, KHÔNG network | `{Scope}PermissionGuard` (không có "DB"/"Remote" vì zero-lookup, tên phải ngụ ý "đọc thẳng token") | `SystemPermissionGuard` (core-api — đọc claim `permissions`, không query gì) |

**Quy tắc quyết định khi tạo guard mới:** tự hỏi *"guard này lấy sự thật từ đâu?"*
1. Không lấy từ đâu cả, chỉ verify chữ ký → `JwtAuthGuard` (dùng lại, không tạo bản mới).
2. Query bảng nằm TRONG chính DB của service này → `{Scope}Guard`, không tiền tố.
3. Phải gọi ra ngoài (network call) vì service này không sở hữu bảng đó → `Remote{Scope}Guard`.
4. Chỉ đọc claim JWT đã có sẵn, không lookup gì → `{Scope}PermissionGuard`.

⚠️ **Nợ kỹ thuật đã biết, CHƯA sửa (không tự ý rename khi thấy):** `OrgGuard` (core-api) đúng ra
theo rule trên có thể đọc nhầm là "không rõ cơ chế" nếu đọc tên đơn độc, không so sánh với
`RemoteOrgMembershipGuard`. Team đã cân nhắc và quyết định **không thêm `Local` vào `OrgGuard`** vì
đây là service sở hữu dữ liệu — baseline mặc định không cần tiền tố, chỉ instance "ngoại lệ" (gọi ra
ngoài) mới cần tiền tố `Remote` để tự đánh dấu mình khác baseline.

## 2. SRP "Caller" class (bọc `CircuitBreaker`)

Pattern: 1 class **chỉ** chứa `CircuitBreaker` + method `call<T>(fn: () => Promise<T>): Promise<T>`,
không chứa business logic (xem `resilience_patterns.md` §3.1.2).

**Rule:** `{TênDependencyĐượcBảoVệ}Caller` — nếu dependency đó tự nó là 1 gRPC/generated client, thêm
`Grpc` vào giữa tên để phân biệt với chính client nó bọc.

| Ví dụ | Bảo vệ cái gì |
|---|---|
| `ClaudeApiCaller`, `GeminiApiCaller` | HTTP call ra Claude/Gemini API |
| `OllamaEmbeddingCaller` | HTTP call ra Ollama embedding service |
| `ElasticsearchSearchCaller` | Call `search()` của ES client |
| `AuthProvisioningGrpcCaller` | Bọc `AuthProvisioningClient` (gRPC) |
| `MembershipVerificationGrpcCaller` | Bọc `MembershipVerificationClient` (gRPC) |

Nhất quán 100% trong toàn repo tính đến 2026-07-19 — không có exception.

## 3. gRPC Client class (bên gọi, KHÔNG phải server)

**Rule:** `{ServiceContract}Client` — luôn có suffix `Client`, **KHÔNG** thêm `Grpc` vào tên (khác với
Caller ở mục 2, nơi `Grpc` CÓ xuất hiện — lý do: Client tên trùng luôn với `service` khai trong
`.proto`, thêm `Grpc` là dư thừa vì bản chất gRPC đã rõ từ cách nó được dùng/generated).

| Ví dụ | proto service |
|---|---|
| `AuthProvisioningClient` | `service AuthProvisioning` |
| `MembershipVerificationClient` | `service MembershipVerification` |

## 4. Repository (Domain interface + Infrastructure impl)

**Rule chuẩn (core-api, search-service, notification-service):**
- Interface: `I{Entity}Repository` (domain layer, đứng cạnh `{ENTITY}_REPOSITORY` DI token dạng `Symbol`)
- Implementation: `Prisma{Entity}Repository implements I{Entity}Repository`
- Query-side riêng (CQRS, trả DTO thay vì Entity): hậu tố `.query-repository.ts` / `I{Entity}QueryRepository`

✅ **Đã sửa (2026-07-31):** `auth-service` từng KHÔNG dùng tiền tố `I` cho interface — ví dụ
`RefreshTokenRepository`, `UserRepository`, `RoleRepository` — trong khi implementation vẫn đúng
pattern `PrismaUserRepository implements UserRepository`. Phát hiện khi quét toàn repo tìm interface
lệch rule (2026-07-31); đã rename toàn bộ sang `IUserRepository`, `IRoleRepository`,
`IRefreshTokenRepository`, `IUserQueryRepository`, `IRoleQueryRepository`, `IGrpcIdempotencyRepository`
(và 2 domain-service port cùng họ: `TokenService`→`ITokenService`, `PasswordService`→`IPasswordService`
— đây KHÔNG phải Repository nhưng cùng chung gốc "auth-service không dùng tiền tố I", nên sửa cùng lúc
cho nhất quán). auth-service giờ khớp `core-api`/`search-service`/`notification-service` 100%. `tsc
--noEmit` sạch + 123/123 test pass sau khi rename.

## 5. Command/Query Handler (CQRS)

**Rule:** `{Verb}{Noun}Command`/`{Verb}{Noun}Query` luôn đi cùng cặp với `{Verb}{Noun}Handler` — tên
Handler phải khớp CHÍNH XÁC tên Command/Query nó xử lý (không viết tắt, không đổi thứ tự từ).

Ví dụ: `GrantCreditsCommand` ↔ `GrantCreditsHandler`, `SpendCreditsCommand` ↔ `SpendCreditsHandler`,
`RefreshCommand` ↔ `RefreshHandler`. Xác nhận nhất quán 100% — không có exception tìm thấy.

## 6. Domain Error class

**Rule:** `{LýDoCụThể}Error extends ApplicationError` (không phải `AppError`/`Exception`).

**Vị trí + tên file:** `common/errors/{module}.error.ts` — **số ít** (`error`, không phải `errors`).

Ví dụ đúng chuẩn: `auth.error.ts`, `rbac.error.ts`, `user.error.ts`, `engagement.error.ts`,
`knowledge.error.ts`, `platform-admin.error.ts`, `tenant.error.ts`, `notification.error.ts`.

⚠️ **Ngoại lệ đã biết, CHƯA sửa:** `apps/core-api/src/modules/credit/domain/credit.errors.ts` — sai
ở **2 điểm** cùng lúc: (a) số nhiều (`credit.errors.ts` thay vì `credit.error.ts`), (b) sai vị trí
(nằm trong `modules/credit/domain/` thay vì `common/errors/` như mọi module khác). Không tự ý di
chuyển/rename khi chỉ đi ngang qua file này — chỉ sửa khi có lý do chính đáng khác đang đụng vào nó,
tránh 1 PR lẫn 2 mục đích không liên quan (rename thuần + logic change).

## 7. NestJS Module (`@Module`)

**Rule:** `{Feature}Module`, tên file `{feature}.module.ts` — tên class PHẢI khớp tên file (không có
tiền tố ẩn không xuất hiện trong tên file).

⚠️ **Ngoại lệ đã biết, CHƯA sửa:** `apps/core-api/src/infrastructure/http/idempotency/idempotency.module.ts`
— file tên `idempotency.module.ts` nhưng class thật là `HttpIdempotencyModule` (không phải
`IdempotencyModule`). Lý do lịch sử: tên `HttpIdempotencyModule` cố ý phân biệt với khái niệm
idempotency ở tầng khác (Kafka consumer, §1.0 kỹ thuật #3/#4 trong `idempotency_strategy.md`) —
nhưng file/class mismatch vẫn nên sửa khi thuận tiện: đổi tên file thành
`http-idempotency.module.ts` để khớp, không đổi class name (class name đang đúng ý nghĩa).

## 8. Config env var

**Rule:**
- `.env`: `SCREAMING_SNAKE_CASE`, tiền tố `{SERVICE}_` khi biến đó specific theo service (ví dụ
  `CORE_KAFKA_CLIENT_ID`, `NOTIFICATION_KAFKA_CLIENT_ID`, `SEARCH_KAFKA_CLIENT_ID`,
  `WORKER_KAFKA_CLIENT_ID`) — KHÔNG dùng tên chung `KAFKA_CLIENT_ID` cho biến khác giá trị mỗi
  service (đã từng là bug thật, xem `.ai/memory/conventions.jsonl`).
- `env.config.ts` (sau khi `registerAs('env', ...)` reshape): `camelCase`, giữ nguyên số ít/nhiều của
  tên gốc (`kafkaBrokers` số nhiều vì `KAFKA_BROKERS` số nhiều).
- Số ít/nhiều phải khớp NGỮ NGHĨA thật: 1 giá trị duy nhất → số ít (`CORE_GRPC_URL`); danh sách/nhiều
  giá trị phân tách dấu phẩy → số nhiều (`KAFKA_BROKERS`, `CORS_ALLOWED_ORIGINS`).

⚠️ **Ngoại lệ đã biết, CHƯA sửa:** `CORS_ORIGINS` (auth-service) vs `CORS_ALLOWED_ORIGINS` (core-api,
search-service, notification-service) — 2 tên khác nhau cho cùng 1 khái niệm. Đã ghi nhận là "known
split" trong `.ai/memory/conventions.jsonl`, chưa hợp nhất vì đụng tới cả 4 `.env.schema`/`.env.validation`
+ risk phá config đang chạy — chỉ sửa khi có lý do khác đang đụng vào cấu hình CORS của cả 4 service
cùng lúc, không tách riêng 1 PR chỉ để đổi tên biến môi trường.

## 9. Domain Port (outbound service interface, gọi ra AI provider/external service)

**Rule:** `I{Capability}Service` cho interface, file `{capability}.service.ts` — kể cả khi tên tự nhiên
hơn là 1 danh từ tác nhân kiểu "-er" (`Summarizer`, `Chunker`). DI token đi kèm: `{CAPABILITY}_SERVICE`
(SCREAMING_SNAKE, bỏ tiền tố `I`, thêm hậu tố `_SERVICE`).

| Ví dụ | File | Token |
|---|---|---|
| `IEmbeddingService` | `embedding.service.ts` | `EMBEDDING_SERVICE` |
| `ISummarizerService` | `summarizer.service.ts` | `SUMMARIZER_SERVICE` |

⚠️ **Không áp dụng cho domain service THUẦN không có interface** (không gọi ra ngoài, không cần swap
adapter) — ví dụ `TextChunker` (`text-chunker.ts`, `domain/services/`) không có `I` prefix và không
suffix `Service`, vì nó không phải port. Câu hỏi quyết định: *"class này có > 1 cách hiện thực hoá có
thể swap được không (adapter khác nhau sau cùng 1 interface)?"* — có → nhóm 9 (port); không → tên tự do
theo ý nghĩa domain, không bắt buộc `.service.ts`.

**Lịch sử:** phát hiện 2026-07-24 khi user (đang học RAG, đọc code lần đầu) hỏi tại sao
`embedding.service.ts` (`IEmbeddingService`) và `summarizer.ts` (`ISummarizer`) đặt tên khác nhau dù
cùng vai trò port — trước đó nhóm 9 này chưa từng được viết thành rule, dù `folder_structure_sop.md` đã
liệt kê cả 2 tên làm ví dụ mà không tự nhận ra bất nhất. Đã thống nhất về `I{X}Service` và rename
`summarizer.ts`→`summarizer.service.ts`, `ISummarizer`→`ISummarizerService`, `SUMMARIZER`→`SUMMARIZER_SERVICE`.

## 10. Messaging Port (transport-agnostic port, `packages/shared-kernel/src/messaging/interfaces/`)

**Rule:** `I{Noun}` cho interface, file `{noun}.interface.ts`. KHÔNG bắt buộc suffix `Service` như nhóm
9 — đây không phải "gọi ra AI provider/external service", mà là contract messaging thuần (publish /
nhận integration event / dead-letter), nên giữ đúng danh từ vai trò (`Publisher`, `Handler`, `Producer`)
thay vì ép về `Service` là tự nhiên hơn.

| Ví dụ | File |
|---|---|
| `IMessagePublisher`, `ITransportPublisher` | `message-publisher.interface.ts` |
| `IIntegrationEventHandler` | `event-handler.interface.ts` |
| `IDeadLetterProducer` | `dead-letter.interface.ts` |

⚠️ **Không áp dụng cho 2 nhóm sau, dễ nhầm vì cũng "trông giống port":**
- **Structural typing mô phỏng shape thư viện ngoài** (`packages/shared-kernel/src/messaging/kafka-shapes/`):
  `MinimalConsumer`, `MinimalKafkaMessage`, `MinimalEachMessagePayload`, `MinimalProducer`,
  `MinimalDlqConsumer` — KHÔNG có tiền tố `I` dù đóng vai trò kỹ thuật giống port, vì đây là bản rút gọn
  (duck-typing subset) của type từ 1 thư viện cụ thể (kafkajs), không phải khái niệm do domain tự định
  nghĩa. Có `I` sẽ ngụ ý sai rằng đây là 1 domain port có thể swap adapter tuỳ ý.
- **DTO/data-shape thuần, không hành vi**: `CloudEvent`, `DeadLetterInput` — mô tả DỮ LIỆU đi kèm lời
  gọi, không phải bản thân cái contract, nên không cần `I`.

Câu hỏi quyết định: *"type này là khái niệm do domain tự định nghĩa (có method, có thể có nhiều adapter
implement), hay chỉ là rút gọn từ API của 1 thư viện ngoài / thuần dữ liệu?"* — domain tự định nghĩa có
hành vi → nhóm 10 (`I` prefix); rút gọn từ lib ngoài hoặc thuần dữ liệu → không `I`.

**Lịch sử:** phát hiện 2026-07-31 khi user đọc lại luồng publisher/consumer/DLQ-replay, thấy
`DeadLetterPort` là tên DUY NHẤT trong `messaging/interfaces/` không theo `I{Noun}` như 3 interface còn
lại (không có tiền tố `I`, dùng suffix `Port` mà không interface nào khác trong cùng thư mục dùng) —
rename thành `IDeadLetterProducer`, đồng thời viết rule này để nhóm 9 (AI-provider port) không bị áp
nhầm lên messaging port và ngược lại.

## ⚠️ Nguyên tắc áp dụng file này

- **Rule ở đây áp dụng cho code MỚI.** Các ngoại lệ liệt kê ở mỗi mục là nợ kỹ thuật đã biết — không
  tự ý rename hàng loạt khi chỉ đang đọc lướt qua; chỉ sửa khi đang có lý do chính đáng khác đụng vào
  đúng file đó (tránh 1 PR lẫn rename-thuần với thay đổi logic, gây khó review/khó revert).
- Khi tạo 1 class thuộc 1 trong 9 nhóm trên mà chưa chắc nên đặt tên gì, tự hỏi đúng câu hỏi quyết
  định của nhóm đó (mục 1 có ví dụ mẫu) — KHÔNG bắt chước tên gần giống nhất tìm được qua Ctrl+F, vì
  tên gần giống đó có thể chính là 1 trong các ngoại lệ liệt kê ở trên.
