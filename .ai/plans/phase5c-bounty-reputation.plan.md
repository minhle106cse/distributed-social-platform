# Plan — Phase 5c: Bounty + Reputation + Badge

- **Ngày:** 2026-08-24 · **Trạng thái:** PLAN ONLY, **thiết kế ĐÃ CHỐT** (v3). Chưa viết một dòng
  code nào.
  - *v2:* một vòng tự phản biện — 3 quyết định của v1 bị đảo (§4.4, §4.6, §4.7), 2 gap mới.
  - *v3:* vòng soát cuối, đối chiếu thiết kế với **code thật + `eslint.config.mjs` +
    `scripts/check-repo-placement.cjs`** — vá 9 lỗ hổng, trong đó **3 cái là lỗi runtime**
    (§3.5, §7 `orgId`, §3.3 verify): typecheck sạch, unit test mock sạch, chỉ vỡ khi chạy thật.
    Bốn thứ được soát và **xác nhận đúng, không phải sửa**: eslint không cấm import chéo module
    (§4.8 hợp lệ); ngoại lệ eslint của `core-api-repos.ts` chỉ phủ `@/modules/*/domain/repositories/**`
    (2 port mới đặt đúng chỗ); cả 5 check A–F của `check-repo-placement.cjs` đều qua; tên
    `BountySettlementPolicy`/`bounty-settlement.policy.ts` hợp lệ theo ngoại lệ **pure domain
    service** của `naming_conventions.md` §9 (không `I`, không `Service`, filename khớp class —
    tiền lệ `TextChunker`, `RagPromptBuilder`).
- **Tiền đề (kiểm bằng `git status`, không suy đoán):**
  - **Phase 5b vẫn CHƯA COMMIT** — 3 submodule `m` + 4 file untracked ở shared-kernel. 5c xây thẳng
    lên trên đó ⇒ **commit 5b trước**, đừng để bug 5b và bug 5c nằm chung một diff không tách được.
  - `.ai/plans/phase5b-ai-query-saga.plan.md` đã **khôi phục** (367 dòng, lấy nguyên văn từ
    transcript session 2026-08-22). Lưu ý: file đó **không có** section `§Amendments` mà
    `KNOWLEDGE_INDEX.md` đang trích dẫn — 4 lỗi chặn + 8 gap của review 5b nằm ở
    `.ai/memory/gotchas.jsonl`. Sửa câu trích trong index khi chạy After-Task.
  - `apps/core-api` đang có refactor cấu trúc folder của owner: `IOutboxAppender` →
    `common/outbox/outbox-appender.ts`, `RagQueryClient` sau port
    `credit/domain/services/rag-query.service.ts`, eslint application-boundary siết thành
    `@/infrastructure/**`. Plan này bám trạng thái đó; **handler mới TUYỆT ĐỐI không import
    `@/infrastructure/**`**.

---

## 1. Phạm vi

| # | Hạng mục | 5c? | Ghi chú |
|---|---|---|---|
| 1 | Stake credit lên `QUESTION` | ✅ A | UC-D2 |
| 2 | Huỷ bounty (asker) | ✅ A | |
| 3 | Award khi accept answer | ✅ B | UC-B3 + UC-D2 |
| 4 | Bounty hết hạn → tự release | ✅ C | mirror `ExpiredReservationSweeperService` |
| 5 | **Release khi question bị xoá** | ✅ A | **gap mới, §3.5** |
| 6 | Reputation ledger + aggregate | ✅ B | bảng `reputation_events` có sẵn, chưa ai chạm |
| 7 | Điểm: accept / revoke-accept / verify | ✅ B | |
| 8 | Badge suy được từ chính reputation stream | ✅ B | PATHFINDER, TRUSTED_EXPERT |
| 9 | `GET /reputation/me` + `/leaderboard` | ✅ C | §4.7 |
| 10 | Notification: bounty won / badge / answer accepted / bounty released | ✅ C | |
| 11 | Reputation từ **vote** | ❌ | cần emit `VoteCast` (event type chết) — Wave D tuỳ chọn |
| 12 | Badge cần dữ liệu ngoài reputation stream | ❌ | `readme.phases` Phase 6 đã giao cho worker-service Badge Cron |
| 13 | Reputation gating theo ngưỡng (`docs/10` §2.5) | ❌ | Wave D |
| 14 | Bảng `reputation_summary` | ❌ | §4.7 |

---

## 2. Đối chiếu tài liệu ↔ code thật

| Tài liệu hứa | Code thật | Kết luận |
|---|---|---|
| `docs/01` §3.3 `CreditStakedEvent` | không tồn tại | thêm (§4.2) |
| `docs/01` §3.4 cron "Sum(events)==Balance" | **KHÔNG CÓ JOB NÀO** (đã grep) | không viện dẫn được — §4.3 tự lo |
| `docs/01` §3.5 "Bounty Saga … compensate" | — | **không cần saga** (§4.1) |
| `docs/04` §2.6 `ReputationEvent` | bảng có ở `schema.prisma:262`, **0 dòng code** | dùng lại, sửa `aggregateId` (§3.2) |
| `docs/06` §6 `POST /questions/{id}/bounty` "chưa triển khai" | — | đổi path → `/knowledge/:id/bounty` |
| `docs/06` §7 `/reputation/*` | không route nào | Wave C |
| `EventType.ANSWER_ACCEPTED` (đã khai báo + đã map cả 2 routing table) | **chưa ai emit, chưa có definition** | 5c là lần đầu nó sống |
| `VOTE_CAST`/`BOOKMARK_*`/`KNOWLEDGE_ARCHIVED`/`KNOWLEDGE_MARKED_STALE` | cũng khai báo mà chưa emit | không thuộc 5c — ghi để khỏi tưởng gap mới |

---

## 3. Va chạm với code đang chạy (phần quan trọng nhất)

### 3.1 🔴 `ExpiredReservationSweeperService` sẽ ăn mất mọi bounty sau 5 phút

`findStaleReservations()` quét `event_type = 'CreditReserved'` cũ hơn `AI_RESERVATION_TTL_MS`
(**default 300_000 = 5 phút**, `env.validation.ts:56`). Nếu stake tái dùng `CreditReserved` thì mọi
bounty treo quá 5 phút bị tự release, kèm một row `AiQuery` FAILED vô nghĩa và một notification
"AI tạm thời không khả dụng" gửi cho asker. Sai từ tiền đến chữ.

→ §4.2: stake dùng event type riêng. Sweeper **không sửa một dòng**. Test hồi quy bắt buộc.

### 3.2 🔴 `ReputationEvent.aggregateId = userId` phá multi-tenancy

Comment schema tự mâu thuẫn: `aggregateId String // userId` + `orgId String // per org`, và
`@@unique([aggregateId, version])`. Hệ quả:
- load có filter `orgId` → version sinh theo từng org → user thuộc 2 org đụng **P2002 vĩnh viễn**;
- load không filter → điểm org A cộng sang org B → vi phạm `multi_tenancy.md` §3.

→ `aggregateId = "${orgId}:${userId}"`, y hệt `CreditAccount.walletId()`. Bảng chưa có dòng nào ⇒
**không phải viết migration**, chỉ sửa comment + đặt đúng `ReputationAccount.accountId()` từ đầu.

### 3.3 🔴 Set-semantics an toàn tới đúng lúc nó bắt đầu sinh side effect — **HAI handler**, không phải một

Cả hai handler dưới đây hôm nay idempotent một cách tình cờ: chúng ghi đè state, và **không sinh ra
gì cả**. Từ 5c chúng sinh ledger event ⇒ gọi lại lần thứ hai là nhân bản điểm.

| Handler | Hôm nay | Từ 5c nếu không guard |
|---|---|---|
| `AcceptAnswerHandler` | `question.acceptAnswer(id)` ghi đè | accept 2 lần cùng `answerId` → **+15 điểm lần nữa** |
| `VerifyKnowledgeHandler` | `item.verify(...)` set `isVerified=true` **vô điều kiện** | verify 2 lần → **+10 điểm lần nữa** |

Bounty được `Bounty.status` cứu; **reputation không có gì cứu**.

→ Guard no-op ở đầu **cả hai**:
- `if (question.acceptedAnswerId === cmd.answerId) return { changed: false }`
- `if (item.isVerified) return`

`IdempotencyInterceptor` là lớp thứ hai, **không thay thế được** guard này (§8 — nó bỏ qua khi client
không gửi header).

### 3.4 🔴 GAP MỚI — xoá question đang treo bounty ⇒ credit khoá vĩnh viễn

`DeleteKnowledgeHandler` chỉ `item.softDelete(); tx.items.update(item)` — không biết gì về bounty.
Xoá một question đang OPEN bounty ⇒ hold còn nguyên, `available` mất vĩnh viễn, và **không còn UI
nào chạm tới bounty đó** (route bounty đi qua `:id` của một item đã soft-delete →
`KnowledgeItemNotFoundError`). Đúng cái `event_sourcing.md` gọi là *"worse than a visible error"*.

→ `DeleteKnowledgeHandler` phải release stake (`QUESTION_DELETED`) trong cùng transaction.
**ARCHIVE thì không** — item vẫn tồn tại và truy cập được, bounty vẫn hợp lệ.

### 3.5 🔴 Repo bị **job nền** gọi thì KHÔNG được đọc tenant context

`requireTenantId()` đọc từ `AsyncLocalStorage` do `TenantContextMiddleware` set — **chỉ có trên
đường HTTP**. Đã grep toàn `apps/core-api/src`: chỉ repo của knowledge / engagement / tenant gọi nó;
repo credit, aiQuery, outbox thì **không**.

Đó chính xác là lý do `ExpiredReservationSweeperService` (chạy từ `setInterval`) sống được:
`ReleaseCreditReservationHandler` chỉ chạm `creditEvents` / `aiQueries` / `outbox`.

`BountyExpirySweeperService` chạy cùng kiểu. Nếu `PrismaBountyRepository` bắt chước
`PrismaKnowledgeItemRepository` (`where: { id, orgId: requireTenantId() }`) thì **sweeper throw ngay
vòng quét đầu tiên** — và unit test với mock repo sẽ không thấy gì.

→ **Mọi method của `IBountyRepository` nhận `orgId` tường minh.** Ghi lý do vào docstring của
`PrismaBountyRepository`, nếu không người sau sẽ "sửa cho nhất quán với repo knowledge" và làm hỏng
sweeper. Cùng ràng buộc áp cho `IReputationEventRepository`.

### 3.6 🟢 Đã kiểm và KHÔNG phải vấn đề (ghi để khỏi ai kiểm lại)

- `tx.items.findById()` **có** filter tenant: `where: { id, orgId: requireTenantId() }` + extension
  soft-delete. Không IDOR.
- `POST /credits/spend` so với `available` ⇒ stake tự động không tiêu được. Không phải sửa gì.
- Thêm `EventType` mà quên routing ⇒ **compile error** (`Record<EventTypeValue,…>` exhaustive).
- notification-service gặp event lạ ⇒ `EventRouter` warn + skip, **không DLQ**.

---

## 4. Tám quyết định — ĐÃ CHỐT

> v1 của plan này để ngỏ 7 câu cho owner. Vòng tự phản biện đã **đảo 3 câu** (§4.4, §4.6, §4.7).
> Dưới đây là quyết định cuối, kèm phương án bị loại và lý do loại.

### 4.1 ✅ CHỐT: **một `ITransactionalCommandHandler`, KHÔNG phải saga**

Ba lý do, xếp theo sức nặng:

1. **Không bước nào ra khỏi transaction.** Accept + 2 ví + reputation + bounty row + outbox đều
   trong `core_db`. Saga tồn tại để bù cho bước không rollback được — ở đây không có bước đó.
2. **`cqrs_pattern.md` §4a viết đúng ca này**: *"Keep multi-write steps as ONE transactional command
   … Split into two dispatches, the second one failing leaves a charged wallet with no record of
   what it bought."* Bounty award là ca đó nhân đôi (2 ví + 1 ledger reputation).
3. **Saga bị loại khỏi retry.** `CommandBus` chỉ `withRetry` nhánh `transactional`. Command này chạm
   **3 aggregate có OCC** ⇒ `CreditConcurrencyError`/`ReputationConcurrencyError` (`transient=true`)
   là chuyện thường ngày và đang được bus tự retry. Làm saga = tự vứt cơ chế đó, trả 409 cho asker
   chỉ vì answerer vừa hỏi AI cùng lúc.

**Phản biện mạnh nhất (và câu trả lời):** `readme.phases.md` Phase 7 định **tách
`credit-ledger-service` own-DB**. Lúc đó award *sẽ* thành liên-service, tức là *sẽ* cần saga — vậy
sao không viết saga sẵn?

Vì **two-phase hold đã lát sẵn đường đó rồi**. Sau khi tách, bước remote là "commit hold + cộng ví
winner". Nếu nó fail, transaction local rollback và **hold vẫn OPEN** → `BountyExpirySweeperService`
release, hoặc asker accept lại. **Compensation của saga tương lai chính là hold + sweeper đang xây
hôm nay** — không phải thứ phải viết thêm. Viết saga bây giờ chỉ tạo 3 transaction rời trên **cùng
một DB**: mất nguyên tử, mất retry, đổi lại số 0.

**Hai thứ làm hôm nay để Phase 7 rẻ (miễn phí, không phải "thiết kế cho tương lai"):**
- **Thứ tự trong handler: credit settlement là bước CUỐI trước outbox** (§7). Khi nó thành remote
  call, mọi thứ trước nó vẫn là một transaction local, remote call nằm đúng biên.
- **Tách logic quyết định thành pure domain service** (§4.8) — đó là đường cắt module, và cũng là
  thứ giữ handler khỏi phình.

*Loại:* saga 3-dispatch. *Hệ quả:* `docs/01` §3.5 + `readme.phases.md` Phase 5 deliverable 2 phải
sửa lại mô tả trong cùng task. Câu chuyện portfolio thay thế còn mạnh hơn: *"dừng lại và chứng minh
chỗ này không cần saga"* — hệ thống vẫn còn 2 saga thật để phô diễn.

### 4.2 ✅ CHỐT: 4 ledger event type mới; **không** tái dùng `CreditReserved`

| Event | `balance` | `available` | Ví | Vào total nào |
|---|---|---|---|---|
| `CreditStaked` | — | −amount | asker | — |
| `CreditStakeCommitted` | **−amount** | hold đóng | asker | `totalSpent` |
| `CreditStakeReleased` | — | +amount (hold đóng) | asker | — |
| `CreditBountyAwarded` | **+amount** | +amount | winner | **`totalEarned` (field MỚI)** |

- Tên đối xứng có chủ ý với `Reserved/ReservationCommitted/ReservationReleased`: **cùng một hình
  dạng fold**, người đọc `apply()` không phải học khái niệm mới. Nội bộ aggregate dùng chung map
  `_reservations` (khái niệm = *hold*); `available = balance − Σ(OPEN holds)` bất kể loại hold.
- **`CreditBountyAwarded` tách khỏi `CreditGranted`** vì `docs/01` §3.3 phân biệt "+ Cấp" (org phát)
  với "+ Thưởng" (kiếm được). Gộp lại thì `totalGranted` nói dối.
- ⚠️ **Phát hiện khi tự phản biện — `WalletDto` phải thêm `totalEarned`.** Hôm nay
  `balance = totalGranted + totalRefunded − totalSpent`. Thêm một nguồn (+) mà không thêm total thì
  đẳng thức đó vỡ, và **không có test nào bắt** vì hiện chưa ai assert nó. → thêm `totalEarned` vào
  `WalletDto` (thay đổi additive, an toàn) **và** thêm assert đẳng thức vào parity test.

*Loại:* `CreditReserved` + `payload.purpose='BOUNTY'` + sửa filter sweeper thành
`AND payload->>'purpose' IS DISTINCT FROM 'BOUNTY'`. Đó là **fail-open**: một `purpose` mới quên sửa
filter ⇒ tiền bị trả nhầm người trong im lặng. Cách đã chọn là **fail-closed**: sweeper chỉ biết
`CreditReserved`, hold loại lạ mặc định *không* bị đụng. Kẹt hold (hiện ra ở đối soát, không mất
tiền) luôn tốt hơn release nhầm (ledger kể chuyện sai). **Trên tiền, fail-closed thắng.**

### 4.3 ✅ CHỐT: có bảng `bounties`; ranh giới với ledger viết thành docstring

- **Ledger sở hữu TIỀN** — `balance`/`available` chỉ fold từ `credit_events`.
- **`bounties` sở hữu QUAN HỆ + vòng đời** (question ↔ asker ↔ amount ↔ deadline ↔ status).
- **Bất biến:** mọi chuyển trạng thái của `Bounty` ghi trong **cùng transaction** với ledger event
  tương ứng. Khuôn giống `AiQuery` (row phẳng cạnh event stream, không ai recompute state từ nó).
- **Khi lệch thì LEDGER thắng** — `Bounty.status` là chỉ mục vật chất hoá trên ledger, không phải
  nguồn sự thật về tiền.

**Tự phản biện:** `status` đúng là state suy được từ ledger ⇒ denormalize. Phương án "không lưu
status, fold ledger của asker theo `stakeId`" bị loại vì (a) phải load cả stream ví chỉ để hỏi "bounty
còn mở không?", (b) sweeper hết hạn sẽ lại phải quét JSON — đúng thứ §4.2 vừa tránh.

**Vì `docs/01` §3.4 hứa cron đối soát nhưng job đó KHÔNG TỒN TẠI (đã grep)**, không viện dẫn nó
được. Thay vào đó: `BountyExpirySweeperService` mỗi vòng quét **cũng** đếm số bounty `OPEN` mà hold
tương ứng không còn OPEN trong ledger (và ngược lại) → `Gauge` + `logger.error`. Rẻ, chạy sẵn, và là
mầm của cron đối soát thật sau này. **Không tự động sửa dữ liệu** — cùng lý do
`OrphanedProvisionedUserWatcher` chỉ cảnh báo chứ không tự xoá.

### 4.4 🔄 **ĐẢO so với v1** — cho phép treo lại; ràng buộc bằng cột nullable-unique

v1 chọn `questionId @unique` (một question chỉ treo bounty một lần **vĩnh viễn**) vì sợ partial
unique index bị `prisma db push` drop. **Sai ở chỗ tự giới hạn nghiệp vụ để né một hạn chế công cụ,
trong khi Prisma diễn đạt được ràng buộc đúng bằng schema thuần:**

```prisma
/// = questionId khi status=OPEN, NULL khi đã đóng. Postgres coi mọi NULL là KHÁC nhau
/// trong unique index → nhiều bounty đã đóng cho cùng một question, nhưng TỐI ĐA MỘT
/// cái đang mở. Ràng buộc ở DB, không phải ở handler → không có race window nào.
/// ⚠️ Đừng "dọn" cột này vì thấy trùng questionId: bỏ nó đi là mất luôn ràng buộc.
activeQuestionId String? @unique @map("active_question_id")
questionId       String  @map("question_id")
@@index([questionId])
```

Được cả hai: **treo lại sau khi huỷ/hết hạn** (nghiệp vụ đúng, giống SO) **và** đúng-do-cấu-trúc
(không cần `SELECT … FOR UPDATE`, không cần raw SQL, `db push` quản lý được).

*Loại:* (a) `questionId @unique` — chặn re-stake, giới hạn vô cớ; (b) check trong handler +
READ COMMITTED — 2 request khác key đồng thời vẫn lọt; (c) partial unique index raw SQL — `db push`
có thể drop trong im lặng (rủi ro có thật, đã thấy ở HNSW index pgvector); (d) `FOR UPDATE` trên
question — thêm pessimistic locking vào một codebase đang thuần OCC/idempotency, mechanism mới cho
một bài toán schema giải được.

### 4.5 ✅ CHỐT: ba nhánh "không trao được" là release, không phải lỗi

| Tình huống | Xử lý | `releaseReason` | Reputation |
|---|---|---|---|
| Asker accept chính answer của mình | release stake về asker | `SELF_ACCEPTED` | **0 điểm** |
| Answerer không còn là member | release stake | `WINNER_NOT_MEMBER` | 0 điểm |
| Question bị xoá (§3.4) | release stake | `QUESTION_DELETED` | — |
| Không có bounty | không đụng credit | — | vẫn cộng điểm |
| **Tự verify bài của chính mình** | — (không liên quan bounty) | — | **0 điểm** |

Dòng cuối là quy tắc song song, không phải ngoại lệ: `knowledge:verify` là quyền của ADMIN (và về sau
là reputation-gated), nên **tác giả hoàn toàn có thể tự verify bài mình**. Điểm `ITEM_VERIFIED` trao
cho `item.createdByUserId` ⇒ không guard thì đó là đường tự thưởng điểm. Guard:
`item.createdByUserId !== command.verifierUserId`, cùng khuôn self-accept ở dòng đầu bảng.

Check membership của winner là **bắt buộc** và có tiền lệ nguyên văn ở `GrantCreditsHandler`:
*"an OWNER could grant real credit to ANY uuid … a 'ghost wallet'"*. Người nhận không phải người gọi
API ⇒ phải verify riêng.

Đây là `cqrs_pattern.md` §4a **"Not every unwind is a compensation"**: có lý do riêng, trả 200,
không ném lỗi hạ tầng.

### 4.6 🔄 **ĐẢO so với v1** — CHO phép unaccept sau khi đã trao bounty

v1 chọn chặn (409). **Sai**: nó khoá vĩnh viễn trạng thái item — accept nhầm + đã trả bounty ⇒ câu
hỏi mang accepted-answer sai mãi mãi, không đường sửa. Đó là product wart do lo ngại kỹ thuật đẻ ra.

**Chốt:**
- Unaccept **luôn được phép**. Bounty đã `AWARDED` thì **giữ nguyên** — tiền không đòi lại.
- Reputation xử lý bằng **event bù**, không phải xoá event (`event_sourcing.md` §Gotchas: *"append a
  correction event"*): `PointsDeducted(reason='ACCEPT_REVOKED')` cho tác giả answer cũ.
- Accept một answer khác sau đó: **có điểm, không có credit** (bounty đã settle một lần duy nhất —
  `activeQuestionId` đã NULL nên không có bounty OPEN nào để trao).
- `Bounty` giữ `awardedAnswerId`/`awardedUserId` ⇒ UI nói được *"bounty đã trao cho câu trả lời X"*
  ngay cả khi accepted answer hiện tại là câu khác. **Cái v1 sợ (hiển thị mâu thuẫn) là chuyện của
  UI, và dữ liệu đã đủ để UI kể đúng.**

Không đòi credit lại là quyết định có lý do, không phải lười: winner có thể đã tiêu hết ⇒ đòi lại
đẩy ví về âm; và đảo một ledger đã settle là *append event bù*, không phải rollback.

### 4.7 ✅ CHỐT: ship leaderboard bằng SQL fold, **không** bảng summary — và ghi nó là trigger Phase 3

- `GET /reputation/me` fold bằng chính `ReputationAccount.rehydrate()` ⇒ **không sinh nợ fold thứ
  hai** (khác hẳn ví, nơi `PrismaWalletQueryRepository` đang phải chép lại `apply()` bằng tay).
- `GET /reputation/leaderboard`: `SELECT user_id, SUM(CASE eventType …) … WHERE org_id = $1 GROUP BY
  user_id` trên `reputation_events`. Đây **là** fold thứ hai, viết bằng SQL ⇒ **bắt buộc có test đối
  chiếu** với `ReputationAccount` từng user trên cùng bộ seed (đúng thủ thuật parity test của credit).
- ⚠️ **GROUP BY `user_id`, KHÔNG phải `split_part(aggregate_id, ':', 2)`** — xem cột `userId` mới ở
  §6. Sau §3.2 thì `aggregateId = "${orgId}:${userId}"`; bóc chuỗi trong SQL vừa không index được,
  vừa vỡ im lặng nếu format aggregateId đổi.

Theo memory *flag-optimizations-for-approval*: **không** tự thêm bảng summary. Nhưng cũng không hoãn
leaderboard — badge + bảng xếp hạng chính là phần nhìn thấy được của cả Trụ cột 4; hoãn thì 5c
không có gì để demo. **Ghi vào `docs/04` §2.7: đây là read path cụ thể đầu tiên justify Phase 3** —
khi nó chậm, `reputation_summary` là câu trả lời, và lúc đó mới có số đo để quyết.

### 4.8 ✅ CHỐT (mới ở v2): logic quyết định nằm ở **pure domain service**, không nhồi vào handler

Phản biện chính đáng với §4.1: một transactional command làm hết ⇒ handler engagement biết cả nội
tình credit lẫn reputation. Trả lời: handler **giữ transaction + gọi repo**, còn **quyết định** thì
đẩy sang 2 pure domain service, mỗi cái ở module chủ của nó:

- `credit/domain/services/bounty-settlement.policy.ts` →
  `decide({ bounty, askerUserId, answerAuthorId, isMember }) : { kind:'AWARD' } | { kind:'RELEASE', reason }`
- `reputation/domain/services/reputation-scoring.policy.ts` → điểm theo `sourceType` + badge đạt ngưỡng

Thuần TS, **không `@Injectable`** — đúng ngoại lệ owner đã duyệt trong `folder_structure_sop.md`
(`domain/services/` cho pure domain service, tiền lệ `TextChunker` ở search-service). Toàn bộ nhánh
của §4.5 trở thành một hàm thuần test được kiệt kê, và đây cũng chính là **đường cắt cho Phase 7**.

---

## 5. Mô hình domain

### 5.1 `CreditAccount` — mở rộng, không viết lại

```
+ stake(stakeId, amount, reason)            → CreditStaked          (check available, như reserve)
+ commitStake(stakeId, reason)              → CreditStakeCommitted  (throw nếu không OPEN)
+ releaseStake(stakeId, reason): boolean    → CreditStakeReleased   (không OPEN → false, không raise)
+ receiveBounty(amount, reason, bountyId)   → CreditBountyAwarded   (ví winner)
```

⚠️ **Ba chỗ ngoài class dễ quên nhất:**
1. `walletDelta()` (hàm module-level cuối `prisma-wallet.query-repository.ts`) — thiếu
   `CreditStakeCommitted` (−) / `CreditBountyAwarded` (+) thì các dòng ledger hiện `delta: 0` và
   không còn cộng ra balance.
2. Fold trong `getWallet()` — 4 `case` mới.
3. `WalletDto.totalEarned` (§4.2).

### 5.2 `ReputationAccount` — aggregate mới

```
accountId = `${orgId}:${userId}`             ← §3.2, KHÔNG phải userId trần
state: _points, _badges:Set<string>, _acceptedAnswerCount, _verifiedItemCount, _version

earn(points, reason, source:{type,id})       → PointsEarned
deduct(points, reason, source)               → PointsDeducted    (kẹp ở 0, không âm)
awardBadge(code): boolean                    → BadgeAwarded      (đã có → false: idempotent)
evaluateBadges(): string[]                   → thuần, dựa trên counter fold từ chính stream
```

`_acceptedAnswerCount`/`_verifiedItemCount` fold từ `payload.source.type` ⇒ **badge tính được mà
không đọc bảng nào khác** — đúng ranh giới §1 #12.

Bảng quy tắc — hằng số trong `domain/reputation-rules.ts`, **không phải env** (đổi điểm là đổi
nghiệp vụ, phải qua code review):

| Nguồn | Điểm | Badge |
|---|---|---|
| `ANSWER_ACCEPTED` | +15 | PATHFINDER ở ≥ 5 |
| `ACCEPT_REVOKED` | −15 | — |
| `ITEM_VERIFIED` | +10 | TRUSTED_EXPERT ở ≥ 3 |

> **Badge không tự thu hồi khi điểm tụt.** `BadgeRevoked` có trong vocabulary nhưng 5c không dùng —
> badge là "đã từng đạt"; thu hồi tự động sẽ nhấp nháy mỗi lần asker đổi ý.

### 5.3 Error mới

| Error | HTTP | code |
|---|---|---|
| `BountyAlreadyOpenError` | 409 | `BOUNTY_ALREADY_OPEN` |
| `BountyNotFoundError` | 404 | `BOUNTY_NOT_FOUND` |
| `BountyNotOpenError` | 409 | `BOUNTY_NOT_OPEN` |
| `BountyForbiddenError` | 403 | `BOUNTY_FORBIDDEN` |
| `BountyOnAnsweredQuestionError` | 409 | `BOUNTY_QUESTION_ALREADY_ANSWERED` |
| `InvalidBountyAmountError` | 400 | `INVALID_BOUNTY_AMOUNT` |
| `StakeNotOpenError` | 409 | `STAKE_NOT_OPEN` |
| `ReputationConcurrencyError` **implements `MarkedTransientError`** | 409 | `REPUTATION_CONCURRENCY_CONFLICT` |

`transient = true` là bắt buộc — sao chép nguyên lý `CreditConcurrencyError`: P2002 trên
`@@unique([aggregateId, version])` nghĩa là write đã rollback sạch, chạy lại an toàn. Quên cờ này ⇒
mọi accept đồng thời trả 409 cho người dùng.

---

## 6. Schema

```prisma
model Bounty {
  id               String    @id @default(uuid(7))
  orgId            String    @map("org_id")
  questionId       String    @map("question_id")
  /// §4.4 — nullable-unique: = questionId khi OPEN, NULL khi đóng.
  activeQuestionId String?   @unique @map("active_question_id")
  askerUserId      String    @map("asker_user_id")
  amount           Int
  /// OPEN | AWARDED | RELEASED
  status           String
  /// hold id trong credit_events (payload.reservationId của CreditStaked)
  stakeId          String    @unique @map("stake_id")
  /// chỉ khi RELEASED: CANCELLED | EXPIRED | SELF_ACCEPTED | WINNER_NOT_MEMBER | QUESTION_DELETED
  releaseReason    String?   @map("release_reason")
  awardedAnswerId  String?   @map("awarded_answer_id")
  awardedUserId    String?   @map("awarded_user_id")
  expiresAt        DateTime? @map("expires_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  settledAt        DateTime? @map("settled_at")

  /// Backs BountyExpirySweeperService — quét BẢNG NÀY theo expiresAt, không quét
  /// ledger (khác ExpiredReservationSweeperService phải dò JSON vì AI hold không có row).
  @@index([orgId, status, expiresAt])
  @@index([questionId])
  @@map("bounties")
}
```

**Không có `deletedAt`** — bounty không bị xoá, nó chuyển trạng thái. Ghi ngoại lệ này vào docstring
vì `database_standard.md` §3 mặc định mọi entity có soft delete.

**`reputation_events` — sửa comment `aggregateId` (§3.2) VÀ thêm một cột:**

```prisma
/// Denormalized từ aggregateId (giống hệt CreditEvent.userId, cùng lý do): read-side
/// leaderboard GROUP BY cột này thay vì split_part(aggregate_id, ':', 2) — bóc chuỗi
/// thì không index được và vỡ im lặng nếu format aggregateId đổi. save() luôn set nó,
/// NOT NULL để read-side tin được, không cần fallback.
userId String @map("user_id")
@@index([orgId, userId])
```

Bảng **chưa có dòng nào** (chưa ai code) ⇒ thêm cột là miễn phí, không migration.

**Port của 2 module mới — ràng buộc bắt buộc (§3.5):** mọi method của `IBountyRepository` và
`IReputationEventRepository` **nhận `orgId` tường minh**, tuyệt đối không `requireTenantId()`. Cả hai
bị gọi từ job nền (`BountyExpirySweeperService`) nơi không có tenant context.

---

## 7. `AcceptAnswerHandler` sau khi mở rộng

Một `ITransactionalCommandHandler` duy nhất. **Không `commandBus.execute` từ trong handler** —
re-entrancy guard của `PrismaTxRunner` sẽ ném `NestedTransactionError`.

⚠️ **Đổi signature command trước đã.** `AcceptAnswerCommand` hiện là
`(questionId, answerId, actorUserId)` — **không có `orgId`**. Handler cũ không cần vì
`tx.items.findById()` lấy org từ tenant context; nhưng bước ⑦ dưới đây gọi
`creditEvents.loadOrOpen(orgId, …)` và `reputationEvents.loadOrOpen(orgId, …)` ⇒ **không có biến nào
để truyền**. Thêm `orgId` vào `AcceptAnswerCommand` **và** `UnacceptAnswerCommand`, controller lấy từ
`@CurrentOrg()` (decorator đã có sẵn, `EngagementController` đang dùng cho route khác).

*Không* dùng `requireTenantId()` trong handler dù có tiền lệ (`follow-target.handler.ts`): command
mang đủ dữ liệu thì còn dispatch được từ ngoài HTTP; đọc ALS thì không (§3.5).

```
① guard: question tồn tại / type=QUESTION / createdByUserId === actor
② NO-OP GUARD (§3.3): acceptedAnswerId === cmd.answerId → return {changed:false}
③ guard: answer tồn tại / type=ANSWER / parentId === question.id
④ QUYẾT ĐỊNH (thuần, §4.8): BountySettlementPolicy.decide(...) + điểm/badge dự kiến
⑤ accept: question.acceptAnswer(answer.id); tx.items.update(question)
⑥ reputation:
     - nếu đang accept answer khác → PointsDeducted(ACCEPT_REVOKED) cho tác giả cũ
     - nếu không phải self-accept → PointsEarned(ANSWER_ACCEPTED) + evaluateBadges()
⑦ credit (BƯỚC CUỐI — §4.1, để Phase 7 tách ledger là cắt đúng chỗ này):
     AWARD   → asker.commitStake(...) + winner.receiveBounty(...) + bounty→AWARDED, activeQuestionId=NULL
     RELEASE → asker.releaseStake(...) + bounty→RELEASED + releaseReason, activeQuestionId=NULL
⑧ outbox: AnswerAccepted, (BountyAwarded | BountyReleased), BadgeAwarded × n
⑨ return { changed, bountyAwarded?, reputationDelta, newBadges }
```

**Vì sao ⑥ trước ⑦ (v1 làm ngược):** quyết định "self-accept ⇒ 0 điểm" chỉ cần so
`answer.createdByUserId` với `question.createdByUserId`, **không cần đụng bounty**. Tính quyết định ở
④ rồi để credit xuống cuối vừa đúng hôm nay, vừa đặt remote call của Phase 7 vào đúng biên.

**Tối đa 3 aggregate có OCC trong một transaction** (2 ví + 1 reputation) — chính là lập luận #3 của
§4.1: nhánh `transactional` được `withRetry` bọc sẵn.

---

## 8. HTTP contract

| Method | Path | Permission | Idem-Key | Throttle | Ghi chú |
|---|---|---|---|---|---|
| POST | `/api/v1/knowledge/:id/bounty` | `KNOWLEDGE_READ` + `CREDIT_SPEND` | tôn trọng nếu gửi | 30/phút | `{ amount, expiresInDays? }` → 201 `{ bountyId, amount, available, expiresAt }` |
| DELETE | `/api/v1/knowledge/:id/bounty` | `KNOWLEDGE_READ` + `CREDIT_SPEND` | — | 30/phút | 204; chỉ asker, chỉ OPEN, chỉ khi chưa có accepted answer |
| GET | `/api/v1/knowledge/:id/bounty` | `KNOWLEDGE_READ` | — | — | 200 / 404 |
| POST | `/api/v1/knowledge/:id/accept-answer` | `ENGAGEMENT_ACCEPT_ANSWER` | tôn trọng nếu gửi **(mới)** | giữ nguyên | ⚠️ response đổi `void` → `{ changed, bountyAwarded?, reputationDelta, newBadges }`; command nhận thêm `orgId` (§7) |
| DELETE | `/api/v1/knowledge/:id/accept-answer` | như trên | — | giữ nguyên | §4.6 — **không** thêm nhánh lỗi nào |
| GET | `/api/v1/reputation/me` | `KNOWLEDGE_READ` | — | — | `{ points, badges[], acceptedAnswerCount, verifiedItemCount }` |
| GET | `/api/v1/reputation/leaderboard?limit=` | `KNOWLEDGE_READ` | — | — | §4.7 |

**"Tôn trọng nếu gửi", KHÔNG phải "bắt buộc" — đây là sự thật về code, không phải nới lỏng.**
`IdempotencyInterceptor.intercept()` mở đầu bằng `if (!key || !MUTATION_METHODS.includes(req.method))
return next.handle()` ⇒ thiếu header thì **bỏ qua im lặng**; không có guard nào ép client gửi.
`/credits/grant`, `/credits/spend`, `/ai/ask` hôm nay đều đúng như vậy. **Không** thêm guard ép header
riêng cho bounty — làm thế là tạo bất nhất giữa 4 endpoint tiêu tiền; muốn ép thì ép cả 4, và đó là
task riêng. **Hệ quả trực tiếp:** interceptor không thay được no-op guard ở §3.3.

`@Throttle` 30/phút cho route bounty = cùng mức `/credits/grant` (đều là thao tác tiền); mọi route
mutation hiện có đều đã có Throttle nên bỏ trống sẽ là ngoại lệ duy nhất.

**KHÔNG thêm `OrgPermission` mới — lý do hạ tầng, không phải lười.** `DEFAULT_ROLE_PERMISSIONS` chỉ
là **seed lúc tạo org**; runtime đọc bảng `org_role_permissions`. Thêm permission vào catalog ⇒ **mọi
org đã tồn tại đều thiếu nó** cho tới khi có script backfill. `CREDIT_SPEND` đúng nghĩa "khoá credit
của chính tôi", và `POST /ai/ask` đã có tiền lệ ghép 2 permission.

`KNOWLEDGE_READ` đang bị dùng như "permission mức member" (`/feed`, `/bookmarks`, `/follows`). Không
phát minh `org:read` trong 5c, nhưng **ghi cái mùi này vào `docs/10`**.

**Đổi response accept-answer là breaking** → grep `apps/web` trước khi làm.

---

## 9. Event + routing + notification

| EventType mới | Topic | `aggregateType` / `aggregateId` | Vì sao topic đó |
|---|---|---|---|
| `BOUNTY_STAKED` | `credit-events` | `Bounty` / `bounty.id` | credit bị khoá — đúng lý lẽ đã ghi cho `CREDIT_RESERVATION_RELEASED`: consumer hành động theo **kết cục credit** |
| `BOUNTY_AWARDED` | `credit-events` | `Bounty` / `bounty.id` | tiền đổi chủ |
| `BOUNTY_RELEASED` | `credit-events` | `Bounty` / `bounty.id` | payload mang `reason`; **producer emit mọi lý do**, consumer lọc (`eventing_patterns.md` §4.4) |
| `BADGE_AWARDED` | `engagement-events` | `ReputationAccount` / `accountId` | consumer duy nhất đã subscribe topic này |
| `ANSWER_ACCEPTED` *(đã khai báo sẵn)* | `engagement-events` *(đã map)* | `KnowledgeItem` / `question.id` | chỉ cần viết definition + emit |

⚠️ **`aggregateId` KHÔNG phải cột trang trí — nó là partition key.**
`polling-publisher.service.ts:74` đặt `partitionkey: event.aggregateId`. Ba event của một bounty
(`Staked → Awarded|Released`) là một chuỗi có thứ tự ⇒ phải chung `bounty.id`. Dùng wallet id sẽ đẩy
`Staked` (ví asker) và `Awarded` (ví winner) sang **2 partition khác nhau**, mất thứ tự giữa chúng.

**Payload — phải chở đủ snapshot, notification-service KHÔNG join được `core_db`:**

| Event | Payload |
|---|---|
| `BountyStaked` | `{ bountyId, questionId, questionTitle, askerUserId, amount, expiresAt }` |
| `BountyAwarded` | `{ bountyId, questionId, questionTitle, answerId, askerUserId, winnerUserId, amount }` |
| `BountyReleased` | `{ bountyId, questionId, questionTitle, askerUserId, amount, reason }` |
| `AnswerAccepted` | `{ questionId, questionTitle, answerId, answerAuthorUserId, acceptedByUserId }` |
| `BadgeAwarded` | `{ userId, badgeCode, points }` |

`questionTitle` là **bắt buộc**, không phải tiện tay: notification-service lưu `titleSnapshot` lúc
ghi và không có đường nào đọc lại `knowledge_items`. Cùng nguyên tắc `questionSnippet` mà
`CreditReservationReleasedEvent` đã dùng ở 5b.

**Không tạo topic `reputation-events`.** Thêm topic ⇒ dính gotcha 2026-08-24 (Kafka không auto-create
kịp, cả 2 consumer service crash lúc boot). Chỉ tách khi có consumer thứ hai — cùng lý lẽ YAGNI đã
dùng cho read model.

**Không emit `PointsEarned/PointsDeducted`** ra Kafka: không consumer, chỉ đẻ warn mỗi lần accept.

### notification-service

| Handler | Nguồn | Recipient | `type` |
|---|---|---|---|
| `BountyAwardedHandler` | `BountyAwarded` | winner | `BOUNTY_WON` |
| `AnswerAcceptedHandler` | `AnswerAccepted` | tác giả answer | `ANSWER_ACCEPTED` |
| `BadgeAwardedHandler` | `BadgeAwarded` | chủ badge | `BADGE_AWARDED` |
| `BountyReleasedHandler` | `BountyReleased` | asker | `BOUNTY_RELEASED`, chỉ `NOTIFIABLE_REASONS={EXPIRED, QUESTION_DELETED}` |

- **Không sửa schema notification-service** — 4 cột đã nullable từ 5b, `metadata Json?` đã có.
- Dedup vẫn `@@unique([recipientUserId, sourceEventId])` — không cơ chế mới.
- ⚠️ Winner nhận **2 notification** khi accept có bounty (`ANSWER_ACCEPTED` + `BOUNTY_WON`). Chấp
  nhận có chủ ý: hai tin khác nhau. Gộp lại đòi consumer phải biết về event kia — đúng thứ §4.4 cấm.
- `BountyStaked` **không** có handler → warn + skip. **Không** viết no-op handler để bịt (§4.4).

---

## 10. Config / job / metrics

| Env (core-api) | Default |
|---|---|
| `BOUNTY_MIN_AMOUNT` | 5 |
| `BOUNTY_MAX_AMOUNT` | 500 |
| `BOUNTY_DEFAULT_TTL_DAYS` | 14 |
| `BOUNTY_MAX_TTL_DAYS` | 30 |
| `BOUNTY_EXPIRY_SWEEP_INTERVAL_MS` | 300_000 |

**Điểm reputation KHÔNG vào env** (§5.2).

**`BountyExpirySweeperService`** — khuôn `ExpiredReservationSweeperService`
(`OnApplicationBootstrap` + `setInterval().unref()` + `ScheduledJobRegistry` + guard `running`), khác
2 điểm: (1) quét **bảng `bounties`** `WHERE status='OPEN' AND expiresAt < now()` ăn index, **không
`$queryRaw`, không dò JSON**; (2) dispatch `ReleaseBountyCommand(reason='EXPIRED')` **qua
`commandBus`** để hưởng retry + log + transaction. Idempotent 2 lớp: `status !== OPEN` bỏ qua;
`releaseStake()` trả `false` ⇒ không raise event.

🔴 **Ràng buộc sống-chết của sweeper (§3.5):** nó chạy ngoài HTTP ⇒ **không có tenant context**. Mọi
repo mà `ReleaseBountyCommand` chạm tới (`bounties`, `creditEvents`, `outbox`) phải nhận `orgId`
tường minh. Một dòng `requireTenantId()` lọt vào `PrismaBountyRepository` là sweeper chết ở vòng quét
đầu tiên — và **unit test với mock repo sẽ báo xanh**.

**Metrics** (`observability_monitoring.md` §2 — Counter cho sự kiện): `bounty_settlement_total{outcome}`
(`awarded|self_accepted|winner_not_member|expired|cancelled|question_deleted`) +
`bounty_ledger_mismatch` Gauge của §4.3.

---

## 11. Wave

### Wave 0 — dọn đường
1. **Commit Phase 5b.** 2. Sửa câu trích `§Amendments` trong `KNOWLEDGE_INDEX.md`.
3. Đồng bộ với refactor folder đang chạy — `git status` lại.

### Wave A — stake / cancel / xoá-question (chưa đụng reputation)
Schema `Bounty` + 4 `CreditEventType` + `WalletDto.totalEarned` · aggregate + spec · fold read-side +
`walletDelta()` + parity test mở rộng · `StakeBountyHandler` / `ReleaseBountyHandler` ·
`DeleteKnowledgeHandler` release stake (§3.4) · `BountyController` · event `BountyStaked`/`BountyReleased`.

- [ ] Stake 20 → `balance` không đổi, `available` −20, `/credits/wallet` khớp aggregate
- [ ] `balance == totalGranted + totalRefunded + totalEarned − totalSpent` (đẳng thức mới)
- [ ] Stake vượt `available` → **402**; stake lần 2 khi đang OPEN → **409**
- [ ] Cancel → `available` phục hồi; cancel lần 2 → no-op, không event thứ hai
- [ ] **Treo lại sau khi huỷ → OK** (§4.4)
- [ ] **Xoá question đang OPEN → stake tự release** (§3.4)
- [ ] **`findStaleReservations()` KHÔNG trả row `CreditStaked` quá TTL** ← test hồi quy §3.1
- [ ] **`ReleaseBountyCommand` chạy được KHI KHÔNG có tenant context** (§3.5) — test gọi thẳng
      handler ngoài ALS, hoặc smoke test để sweeper tự chạy; mock repo **không** chứng minh được điều này

### Wave B — reputation + award
Sửa comment schema (§3.2) · `ReputationAccount` + spec · module `reputation` · 2 pure policy (§4.8) ·
mở rộng `AcceptAnswerHandler` (§7) + `UnacceptAnswerHandler` + `VerifyKnowledgeHandler` ·
event `AnswerAccepted`/`BountyAwarded`/`BadgeAwarded`.

- [ ] Accept có bounty 20 → asker −20, winner +20, **tổng org không đổi**
- [ ] Accept 2 lần cùng answerId → lần 2 no-op, **không event reputation thứ hai** (§3.3)
- [ ] **Verify 2 lần cùng item → lần 2 no-op, không +10 lần nữa** (§3.3)
- [ ] **Tự verify bài của mình → 0 điểm** (§4.5)
- [ ] Đổi accept A→B → A −15, B +15; bounty đã trao cho A **không** trao lại
- [ ] **Unaccept sau khi đã trao → 204, bounty vẫn AWARDED** (§4.6)
- [ ] Self-accept → release `SELF_ACCEPTED`, 0 điểm
- [ ] Winner đã rời org → release `WINNER_NOT_MEMBER`, không tạo ví ma
- [ ] Đủ 5 accepted answer → `BadgeAwarded(PATHFINDER)` đúng **một** lần
- [ ] `Sum(credit events) == balance` cho cả 2 ví sau toàn bộ kịch bản

### Wave C — đọc + thông báo + hết hạn
`GET /reputation/me` + `/leaderboard` + `GET /knowledge/:id/bounty` ·
`BountyExpirySweeperService` + metrics · 4 handler notification-service.

- [ ] Bounty quá hạn → release ≤ 1 chu kỳ sweep, asker nhận `BOUNTY_RELEASED`
- [ ] Winner nhận `BOUNTY_WON` + `ANSWER_ACCEPTED`; gửi lại cùng CloudEvent id → không nhân đôi row
- [ ] Leaderboard SQL khớp từng `ReputationAccount` fold trên cùng seed
- [ ] `bounty_ledger_mismatch` = 0 sau toàn bộ smoke test

### Wave D — tuỳ chọn
Emit `VoteCast`/`VoteRetracted` → reputation từ vote · gating ngưỡng `docs/10` §2.5.

---

## 12. Test plan

| Loại | Nội dung |
|---|---|
| Aggregate | `CreditAccount`: stake/commit/release/receiveBounty; stake so `available`; release idempotent trên hold đã COMMITTED; stream trộn đủ 10 event type |
| **Parity (bắt buộc)** | mở rộng `credit-account.aggregate.spec.ts` §"fold parity" + **assert đẳng thức balance/totals** — `event_sourcing.md` §6: *"Fold rules must live in exactly as many places as you have folds"* |
| Aggregate | `ReputationAccount`: earn/deduct/kẹp 0/badge idempotent/`evaluateBadges` đúng ngưỡng/rehydrate |
| **Pure policy** | `BountySettlementPolicy.decide` — liệt kê đủ 4 nhánh §4.5 (rẻ nhất, giá trị cao nhất) |
| Handler | `StakeBountyHandler`, `ReleaseBountyHandler` (no-op path), `AcceptAnswerHandler` 6 nhánh §7, `UnacceptAnswerHandler` (§4.6), `DeleteKnowledgeHandler` (§3.4) |
| **Hồi quy** | `findStaleReservations()` bỏ qua `CreditStaked` (§3.1) |
| **Hồi quy** | `spend()` không tiêu được phần đang stake |
| Parity | leaderboard SQL ↔ per-user fold (§4.7) |
| Consumer | 4 handler notification-service, gồm ca `BountyReleased(reason=CANCELLED)` → **không** notify |
| Smoke (hạ tầng thật) | theo `smoke-test-core-api-harness` + `smoke-test-kafka-consumer`: stake → accept → 2 ví + reputation + 3 notification; hết hạn (chèn `expiresAt` quá khứ bằng SQL, giống thủ thuật sweeper 5b); xoá question đang treo; **dọn seed sau khi xong** |

---

## 13. Checklist "không impact"

- [ ] `ExpiredReservationSweeperService` **không sửa một dòng** và mù với stake (test §3.1)
- [ ] `walletDelta()` + fold read-side + `totalEarned` — cả 3 chỗ ngoài class (§5.1)
- [ ] Parity test xanh với đủ 10 event type **và** đẳng thức totals
- [ ] `POST /ai/ask` vẫn chạy: reserve nay cạnh tranh `available` với stake ⇒ user stake hết credit
      sẽ 402 khi hỏi AI. **Đúng thiết kế** — nêu trong `docs/06`
- [ ] `POST /credits/spend` không tiêu được phần đang stake
- [ ] **Không** thêm `OrgPermission` (nếu buộc phải → viết script backfill org cũ)
- [ ] **Không** thêm `KafkaTopic` (nếu buộc phải → tạo topic thủ công trước khi boot)
- [ ] shared-kernel sửa xong → `turbo build --filter=shared-kernel` + restart TS server
- [ ] `npm run check:arch` xanh — port mới theo đúng quy tắc 2 bước
- [ ] `turbo run typecheck lint format:check test` — **33/33** như baseline, không ít hơn
- [ ] `npm run db:push` ở `apps/core-api` — bảng `bounties` **và cột `reputation_events.userId`** (§6)
- [ ] `apps/web` có gọi `accept-answer` không? (§8 breaking)
- [ ] Handler/policy mới **không import `@/infrastructure/**`** (boundary vừa siết)
- [ ] `grep -n "requireTenantId" ` trong `modules/credit` + `modules/reputation` → **0 kết quả** (§3.5)
- [ ] Mọi event mới chở `questionTitle`/snapshot đủ để notification render mà không join `core_db` (§9)
- [ ] `aggregateId` của 3 event bounty đều là `bounty.id` — kiểm bằng cách đọc lại §9, sai chỗ này
      không có test nào bắt (nó chỉ làm lệch thứ tự partition)

---

## 14. Rủi ro còn mở

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Cột `activeQuestionId` bị người sau "dọn" vì thấy trùng `questionId` | Trung bình | docstring cảnh báo + test "2 bounty OPEN cùng question → P2002" |
| Handler accept 9 bước, 3 aggregate | Trung bình | §4.8 đẩy quyết định sang pure policy; test 6 nhánh |
| Chưa có cron đối soát ledger thật (`docs/01` §3.4 vẫn nợ) | Trung bình | §4.3 gắn check + Gauge vào sweeper; **không** tự sửa dữ liệu |
| Điểm 15/10 và ngưỡng badge 5/3 là số khởi điểm | Thấp | hằng số một chỗ, đổi rẻ; ghi rõ là giá trị khởi điểm |
| Phase 7 tách ledger sẽ phải viết saga | Thấp | §4.1 — hold + sweeper đã là compensation sẵn; thứ tự bước ⑦ cuối đã đặt đúng biên |

---

## 15. After-Task Protocol (cùng task, không xin phép)

- `.ai/memory/architecture.jsonl` — "bounty không cần saga: mọi bước trong 1 DB; hold+sweeper của
  two-phase reserve chính là compensation dựng sẵn cho lúc tách `credit-ledger-service` (Phase 7)".
- `.ai/memory/gotchas.jsonl` — (1) sweeper 5b ăn stake nếu tái dùng `CreditReserved`;
  (2) `ReputationEvent.aggregateId=userId` phá multi-tenancy khi user thuộc 2 org;
  (3) set-semantics an toàn tới đúng lúc sinh side effect — **đã tái diễn ở `verify`**, không chỉ
  `accept`, nên đây là lớp lỗi chứ không phải ca lẻ;
  (4) xoá question đang treo bounty ⇒ credit khoá vĩnh viễn;
  (5) thêm nguồn (+) vào ví mà quên `totalEarned` ⇒ đẳng thức totals vỡ không ai bắt;
  (6) **repo bị job nền gọi mà đọc `requireTenantId()` ⇒ chết ở runtime, unit test mock báo xanh** —
  đây là ràng buộc ngầm đang giữ `ExpiredReservationSweeperService` sống, chưa từng được viết ra;
  (7) `aggregateId` của outbox event **là Kafka partition key** (`polling-publisher.ts:74`) — chọn
  sai không có test nào bắt, chỉ làm lệch thứ tự giữa các event cùng một quy trình nghiệp vụ.
- `.ai/memory/conventions.jsonl` — nullable-unique (`activeQuestionId`) là cách diễn đạt "tối đa một
  row active" bằng schema thuần, thay cho partial index raw SQL mà `db push` có thể drop.
- `directives/event_sourcing.md` §6 — "hold thứ hai": vì sao stake phải là event type riêng
  (fail-closed) chứ không phải cờ trong payload.
- `directives/cqrs_pattern.md` §4a — mặt kia của bài học: **khi nào KHÔNG cần saga**, và dấu hiệu
  nhận biết (không có bước nào ra khỏi transaction).
- `directives/eventing_patterns.md` §4.4 — ca "2 notification cho cùng một hành động, cố ý".
- `docs/01` §3.5 + `readme.phases.md` Phase 5 — sửa mô tả "Bounty Saga" (§4.1).
- `docs/02` UC-B3 / UC-D2 — luồng thật + 4 nhánh release.
- `docs/04` — model `Bounty`, sửa comment `ReputationEvent`, §2.7 ghi leaderboard là trigger Phase 3.
- `docs/06` — §6/§7 endpoint mới, response accept-answer đổi, mã lỗi mới, `totalEarned`.
- `docs/10` §2.5 — nói rõ gating **vẫn hoãn** dù 5c xong; ghi mùi `KNOWLEDGE_READ`-làm-member-check.
- `.ai/PROJECT_STATUS.md` — Phase 5 → 5c, module map thêm `reputation`.
- `docs/linkedin_posts_plan.md` — chất liệu thật: *"dừng lại và chứng minh chỗ này không cần saga"*
  + *"two-phase hold hoá ra là compensation dựng sẵn cho lần tách service sau"*.

---

## 16. References & Compliance

| Directive | Quyết định điều gì |
|---|---|
| `cqrs_pattern.md` §4, §4a, §5, §6 | §4.1 (không saga), §7 (1 transaction, không nested dispatch), chỗ đặt repo port |
| `event_sourcing.md` §3, §6, §Gotchas | §4.2 (hold là event), §4.6 (append event bù), §12 (parity test) |
| `eventing_patterns.md` §3.2, §4.3, §4.4 | §9 (topic, producer emit facts, cấm no-op handler) |
| `idempotency_strategy.md` | §9 (dedup `(recipientUserId, sourceEventId)`) |
| `resilience_patterns.md` §1.1 | §8 (`IdempotencyInterceptor` claim-before-execute) |
| `multi_tenancy.md` §3, §4 | §3.2 (aggregateId composite), §8 (không thêm permission) |
| `folder_structure_sop.md` | §4.8 (`domain/services/` pure, tiền lệ `TextChunker`), cây `modules/reputation/` |
| `naming_conventions.md` §4, §5, §6, §11 | tên repository/handler/error/policy |
| `domain_modeling.md` §0, §1 | `ReputationAccount` mutable + `_fields`, factory `create<Variant>` |
| `database_standard.md` §1, §2, §3 | model `Bounty` (uuid PK, `@map` snake_case, ngoại lệ soft-delete có lý do) |
| `testing_standard.md` §1, §2 | §12 |
| `observability_monitoring.md` §2, §5 | §10 (Counter/Gauge, `ScheduledJobRegistry`) |
| `logging_standard.md` | `@InjectPinoLogger` + `LogContext` tường minh |

**Docs:** `01` §3.1–3.5, §4.1–4.3 · `02` UC-B3, UC-C1/C2, UC-D1–D3 · `04` §2.6, §2.7, §551 ·
`06` §5, §6, §6b, §7 · `10` §2.5, §3 · `readme.phases.md` Phase 5, **Phase 7** (tách
`credit-ledger-service` — đầu vào của §4.1).

**Code đã đọc:** `credit-account.aggregate.ts` · `ask-ai.handler.ts` · `commit-ai-query.handler.ts` ·
`release-credit-reservation.handler.ts` · `reserve-credits.handler.ts` · `grant-credits.handler.ts` ·
`expired-reservation-sweeper.service.ts` · `prisma-wallet.query-repository.ts` · `credit.errors.ts` ·
`credit.module.ts` · `accept-answer.handler.ts` · `unaccept-answer.handler.ts` ·
`delete-knowledge.handler.ts` · `engagement.controller.ts` · `knowledge-item.entity.ts` ·
`prisma-knowledge-item.repository.ts` · `core-api-repos.ts` + factory · `outbox-appender.ts` ·
`rag-query.service.ts` · `idempotency.interceptor.ts` · `ai-query.controller.ts` ·
`credit.controller.ts` · `org-permissions.ts` · `org-rbac.ts` · `scheduled-job-registry.service.ts` ·
`core-api/prisma/schema.prisma` · `notification-service/prisma/schema.prisma` ·
`credit-reservation-released.handler.ts` · `notification-events.consumer.ts` ·
`notification.repository.ts` · shared-kernel `event-types.ts` / `maps.ts` / `credit-awarded.event.ts`.

**`.ai/GOTCHAS.md`:** các entry 5b (two-phase reserve, release idempotent ở mức handler,
degrade-vs-throw, bảng notifications hình dạng knowledge-item, Kafka không auto-create topic) +
idempotency / outbox `orgId` / DLQ replay.
