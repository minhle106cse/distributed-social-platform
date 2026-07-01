# PLAN: First Real Consumer — notification-service (own DB, event-driven)

> **Cho session mới.** Đọc trọn file này + `directives/eventing_patterns.md` trước khi code. Làm **Milestone B1 → B2** theo thứ tự. Không nhảy cóc.
> Ngày lập: 2026-06-30. Người duyệt hướng: user (chọn "notification-service full bootstrap" + "fan-out-on-write SoT").

---

## 🚦 TRẠNG THÁI (cập nhật 2026-06-30) — **B1 + B2 ĐÃ HOÀN TẤT**

**✅ MILESTONE B2 HOÀN TẤT.** `turbo typecheck lint` = 5/5 xanh. `prisma db push notification_db` đã thêm bảng `space_followers`. Smoke test B2 chưa chạy — cần boot Docker + thực hiện REST calls follow/unfollow/publish. Đọc B2 Acceptance bên dưới để biết cần verify gì.

### Cấu trúc B1 đã tạo (mirror khi viết B2)
```
apps/notification-service/
├── package.json, tsconfig.json, nest-cli.json, eslint.config.mjs, prisma.config.ts
├── prisma/schema.prisma                    # model Notification (đã db:push vào notification_db)
└── src/
    ├── main.ts, app.ts, bootstrap/{server.ts,fastify.ts}
    ├── config/{env.validation.ts,env.config.ts,config.module.ts}
    ├── app.module.ts
    ├── infrastructure/
    │   ├── database/prisma/{prisma.service.ts,prisma.module.ts}
    │   ├── kafka/{kafka-client.service.ts,kafka.module.ts}
    │   └── http/{guards/jwt-auth.guard.ts, filter/, interceptors/, controllers/health.controller.ts}
    └── modules/notification/
        ├── notification.module.ts
        ├── application/
        │   ├── repositories/notification.repository.interface.ts   # INotificationRepository + NOTIFICATION_REPOSITORY token
        │   └── events/item-published/item-published.handler.ts     # ⚠️ B2.3 sẽ ĐỔI file này (fan-out)
        ├── infrastructure/
        │   ├── repositories/prisma-notification.repository.ts
        │   └── consumers/knowledge-events.consumer.ts              # ⚠️ B2.2 mở rộng (subscribe thêm topic) HOẶC thêm consumer thứ 2
        └── presentation/{notification.controller.ts, schemas/get-notifications.schema.ts}
```

### Sự thật đã verify (dùng cho B2 — KHÔNG đoán lại)
- **Wire format core-api emit** (đã đọc `polling-publisher.service.ts` + `kafka-producer.service.ts`): topic = `topicForEventType(type)`, Kafka key = `event.partitionkey` (= aggregateId), value = `JSON.stringify(cloudEvent)`. CloudEvent 1.0: `{specversion,id,source:'/cortex/core-api/<aggregateType>',type,time,subject:aggregateId,datacontenttype,data:<flat payload>,orgid,partitionkey}`. `data` = payload phẳng.
- **Outbox append idiom** (`publish-knowledge.handler.ts:34`): `await this.outboxRepo.append(XxxEvent.create({ aggregateId, orgId, payload: {...} }))`. Inject `@Inject(OUTBOX_REPOSITORY) IOutboxRepository` từ `@/modules/outbox/domain/repositories/outbox.repository`.
- **FOLLOW infra đã có sẵn trong shared-kernel:** `EventType.FOLLOW_CREATED/FOLLOW_REMOVED` (event-types.ts), `EVENT_TOPIC_MAP` → `engagement-events`, `EVENT_TRANSPORT_MAP` → `[Transport.KAFKA]`. ⇒ B2.1 chỉ cần TẠO 2 file definition + wire vào handler. KHÔNG đụng maps.
- **engagement follow/unfollow handlers** (đường dẫn thật):
  - `apps/core-api/src/modules/engagement/application/commands/follow-target/follow-target.handler.ts` — hiện có `orgId = requireTenantId()`, `Follow.create(...)`, `followRepo.add(follow)`.
  - `.../follow-target/follow-target.command.ts` — **`options = { transactional: false }`** ⚠️ phải đổi `transactional: true` để outbox append atomic (giống publish-knowledge).
  - `.../unfollow-target/unfollow-target.handler.ts` — chỉ có `userId/targetType/targetId`, KHÔNG load entity ⇒ **không có followId sẵn**. Lấy `orgId = requireTenantId()`. ⇒ **FollowRemoved payload BỎ followId** (projection xoá theo PK `[spaceId,userId]`, không cần followId). Đổi command options → `transactional: true`.
- **Smoke-test recipe** (đã verify B1): xem memory `smoke-test-kafka-consumer` — bơm CloudEvent byte-faithful vào topic, boot consumer TRƯỚC khi produce (`fromBeginning:false`), verify own-DB + `kafka-consumer-groups --describe` LAG 0. Scripts mẫu B1 ở scratchpad session trước (produce-event.cjs / make-jwt.cjs) — viết lại tương tự cho FOLLOW events + engagement-events topic.
- **Finding nhỏ (tùy chọn fix):** mọi service đọc `KAFKA_CLIENT_ID` từ `.env` dùng chung (=`core-api`) ⇒ kafka-ui hiển thị clientId sai. Không ảnh hưởng delivery. Quyết định riêng của user, đừng tự sửa.
- **Gotcha:** sửa shared-kernel xong PHẢI rebuild `dist/` (`turbo run build --filter=shared-kernel` hoặc xoá `packages/shared-kernel/dist` + rebuild) nếu không IDE/consumer đỏ. Git Bash Windows: `docker exec ... psql` cần `MSYS_NO_PATHCONV=1`. Tạo DB: `psql -U root -d postgres` (KHÔNG `-d root`).

---

---

## 0. BỐI CẢNH BẮT BUỘC ĐỌC

Dự án **Cortex** (B2B knowledge hub). Backbone event đã LIVE nhưng **chưa ai consume** (cố ý):
`publish-knowledge → outbox → PollingPublisher(@2s) → Kafka topic knowledge-events`. Đây là consumer THẬT đầu tiên.

**Trạng thái nền (đã verify 2026-06-30):**
- Chỉ `KnowledgePublished` được emit (từ `publish-knowledge.handler`). Payload: `{ itemId, orgId, spaceId, type, title, createdByUserId }`.
- Engagement module (vote/follow/bookmark) **KHÔNG emit gì** — `FOLLOW_CREATED` có trong `EVENT_TRANSPORT_MAP` nhưng producer chưa wire.
- `notification-service` = **rỗng hoàn toàn** (0 file src). Phải bootstrap từ đầu.
- `worker-service` = scaffold consumer rỗng (tham chiếu pattern: `KafkaClientService`, `createApplicationContext`, PrismaModule).
- shared-kernel có sẵn: `CloudEvent<T>`, `IIntegrationEventHandler`, `EventRouter`, `KnowledgePublishedEvent`, `EVENT_TOPIC_MAP` (→ `knowledge-events`).

**⛔ LUẬT VÀNG (vẫn áp dụng):** không read model/projection/cache **TRONG cùng service trên cùng DB** như kiểu `feed_timeline` đã rollback. NHƯNG: notification-service own-DB **được phép** giữ state local dựng từ event (đây là data replication chuẩn của microservice, mỗi service own data của mình). Bảng `notifications` = **source of truth** (trạng thái đã-đọc không join ra được từ đâu). `space_follower` projection (B2) = local copy dựng từ FOLLOW events — nêu rõ là quyết định, không trôi ngầm.

**SOP đọc trước khi code:**
- `directives/eventing_patterns.md` — §4 Inbound (consumer, EventRouter 1:1/consumer-group, idempotent receiver, retry→DLQ)
- `directives/microservice_architecture.md` — bootstrap checklist, shared HTTP utilities
- `directives/folder_structure_sop.md` — layering (domain/application/infrastructure/presentation)
- `directives/multi_tenancy.md` — orgId scoping (lưu ý: notification-service KHÔNG có memberships → xem Quyết định #3)
- `directives/database_standard.md` — UUID PK, `@map` snake_case, prisma.config.ts, port 15432
- `directives/zod_validation.md` — validate query/body

---

## QUYẾT ĐỊNH KIẾN TRÚC ĐÃ CHỐT (hệ quả của own-DB)

1. **Snapshot title vào notification row** (KHÔNG join lúc đọc). notification-service own `notification_db`, không truy cập `core_db.knowledge_items` (luật không-join-chéo-DB). Title + actor lấy từ event payload, lưu vào row như ảnh chụp point-in-time. Đây là convention chuẩn của notification (hiển thị "X đã đăng 'Title cũ'" kể cả khi item đổi/xoá sau).
2. **Idempotent receiver KHÔNG cần ProcessedEvent table.** `@@unique([recipientUserId, sourceEventId])` + `createMany skipDuplicates` → at-least-once + event trùng = no-op.
3. **Auth ở GET /notifications = JWT thuần, KHÔNG OrgGuard.** notification-service không có `memberships` (ở core_db) nên không chạy được OrgGuard. Lọc `recipientUserId = jwt.sub` (tự nhiên tenant-safe: user chỉ thấy notification của chính mình) + `orgId` từ header `X-Org-Id`. Membership validation đầy đủ = hardening sau (Phase 8), ghi vào "Known limitations".
4. **DB ownership:** notification-service own `notification_db` (DB MỚI, tách khỏi core_db/auth_db). Prisma schema riêng, `prisma db push` riêng. Port Postgres dùng chung instance `15432`, khác database name.
5. **Consumer = kafkajs raw + EventRouter** (KHÔNG `@nestjs/microservices @EventPattern`) — chủ động offset commit + idempotency, đúng `eventing_patterns.md §4.2`.

---

## MILESTONE B1 — Prove the loop (notify tác giả, ZERO prereq)

### Mục tiêu
Chứng minh trọn vòng `core-api → outbox → Kafka → notification-service → notification_db → GET /notifications` **mà không sửa core-api**. Notification đầu tiên: "Item của bạn đã được publish" → recipient = `createdByUserId` (có sẵn trong payload).

### B1.1 — Bootstrap notification-service (mirror worker-service scaffold)
Mirror cấu trúc `apps/worker-service` (NestJS `createApplicationContext`, KHÔNG HTTP ban đầu? — KHÁC: notification CẦN HTTP cho GET /notifications → dùng `NestFactory.create` với Fastify adapter giống core-api, KHÔNG `createApplicationContext`).

Cần bootstrap:
- `package.json` (mirror worker-service deps + `@nestjs/platform-fastify`, `jsonwebtoken`), `tsconfig.json`, `eslint.config.mjs` (mirror core-api boundary lint), `nest-cli.json`.
- `prisma/schema.prisma` + `prisma.config.ts` (datasource `NOTIFICATION_DATABASE_URL`, generator → `src/generated`).
- `src/config/` (env.validation.ts, env.config.ts, config.module.ts) — cần: `NOTIFICATION_DATABASE_URL`, `JWT_PUBLIC_KEY`, `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_NOTIFICATION_CONSUMER_GROUP`, `NOTIFICATION_SERVICE_PORT`.
- `src/infrastructure/database/prisma/` (prisma.service.ts — soft-delete extension KHÔNG cần ở MVP, prisma.module.ts).
- `src/infrastructure/kafka/kafka-client.service.ts` + `kafka.module.ts` (mirror worker).
- `src/infrastructure/http/` (JwtAuthGuard mirror core-api, global filter/interceptor dùng shared-kernel response utils, health controller).
- `src/bootstrap/server.ts` + `src/main.ts` (Fastify, setGlobalPrefix `api/v1` exclude health, genReqId, pino logger).

### B1.2 — Schema `notification_db`
```prisma
model Notification {
  id              String    @id @default(uuid())
  orgId           String    @map("org_id")
  recipientUserId String    @map("recipient_user_id")
  type            String    // 'ITEM_PUBLISHED' (B1) | 'NEW_IN_SPACE' (B2)
  sourceEventId   String    @map("source_event_id")   // CloudEvent.id — dedup key
  itemId          String    @map("item_id")
  spaceId         String    @map("space_id")
  titleSnapshot   String    @map("title_snapshot")    // snapshot từ payload
  actorUserId     String    @map("actor_user_id")     // createdByUserId
  readAt          DateTime? @map("read_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  @@unique([recipientUserId, sourceEventId])
  @@index([orgId, recipientUserId, readAt])
  @@map("notifications")
}
```
`prisma db push` vào `notification_db` (tạo DB nếu chưa có: `CREATE DATABASE notification_db`).

### B1.3 — Consumer + handler
- `src/modules/notification/infrastructure/consumers/knowledge-events.consumer.ts` — kafkajs consumer, group `KAFKA_NOTIFICATION_CONSUMER_GROUP`, subscribe topic `knowledge-events`. `onModuleInit` connect + run; mỗi message → parse CloudEvent JSON → `router.route(event)`. Lỗi parse (poison) → log + skip (B1 đơn giản; DLQ ở B2/hardening). Lỗi handler → log + KHÔNG commit (để retry) — hoặc bounded retry; ghi rõ TODO DLQ.
- `src/modules/notification/application/events/item-published/item-published.handler.ts` — `implements IIntegrationEventHandler<KnowledgePublishedPayload>`, `readonly eventType = EventType.KNOWLEDGE_PUBLISHED`. `handle()`: build 1 notification cho `payload.createdByUserId` (recipient), `createMany skipDuplicates`. Idempotent qua unique.
- `EventRouter` per-module (Map in-mem), register handler. Đăng ký consumer + router trong `notification.module.ts`.
- Repo: `INotificationRepository` (application) + `PrismaNotificationRepository` (infrastructure) — `insertMany(rows)` dùng `createMany skipDuplicates`; `findByRecipient(orgId, userId, {limit,offset,unreadOnly})`; `markRead(id, userId)`.

### B1.4 — Read API (core-api KHÔNG đụng; ở notification-service)
- `GET /notifications?limit&offset&unreadOnly` — `@UseGuards(JwtAuthGuard)`, lọc `recipientUserId = user.sub` + `orgId` từ `X-Org-Id` header. Trả `NotificationDto[]`.
- `PATCH /notifications/:id/read` — set `readAt = now()` WHERE `id` AND `recipientUserId = user.sub` (chống đọc hộ).
- Zod schema cho query params (mirror feed get-feed.schema.ts).

### B1 — Acceptance
- [ ] `npx turbo run build typecheck lint --filter=...notification-service` xanh.
- [ ] Boot core-api + notification-service + Kafka. Publish 1 knowledge item (core-api `POST /knowledge/:id/publish`) → trong ~2-4s notification-service ghi 1 row cho tác giả.
- [ ] `GET /notifications` (JWT tác giả) thấy notification, `titleSnapshot` đúng.
- [ ] Publish lại / redeliver cùng event → KHÔNG nhân đôi (unique skipDuplicates).
- [ ] `PATCH /notifications/:id/read` → `readAt` set; user khác PATCH → không ăn.
- [ ] Kafka consumer group `KAFKA_NOTIFICATION_CONSUMER_GROUP` thấy trong kafka-ui.

---

## MILESTONE B2 — Real feature (fan-out theo space follower)

### Mục tiêu
Notification "Mới trong space bạn follow" → recipient = followers của space (trừ tác giả). Cần FOLLOW events + local follower projection.

### B2.1 — core-api emit FOLLOW events (prereq)
- **shared-kernel:** tạo `src/events/definitions/follow-created.event.ts` + `follow-removed.event.ts` (mirror `knowledge-published.event.ts`):
  - `FollowCreatedPayload = { orgId, userId, targetType, targetId }` (BỎ followId — không cần cho projection; xem grounding). `defineEvent({ eventType: EventType.FOLLOW_CREATED, aggregateType: 'Follow' })`.
  - `FollowRemovedPayload = { orgId, userId, targetType, targetId }` + `EventType.FOLLOW_REMOVED`.
  - Export cả 2 trong `src/events/index.ts`. Rebuild dist (gotcha ở grounding).
- **engagement follow-target.handler:** sau `followRepo.add(follow)` → `outboxRepo.append(FollowCreatedEvent.create({ aggregateId: follow.id, orgId, payload: { orgId, userId: follow.userId, targetType: follow.targetType, targetId: follow.targetId } }))`. Inject `OUTBOX_REPOSITORY`. Đổi `follow-target.command.ts` options → **`transactional: true`**.
- **engagement unfollow-target.handler:** lấy `orgId = requireTenantId()` (thêm import); sau `followRepo.remove(...)` → `outboxRepo.append(FollowRemovedEvent.create({ aggregateId: command.targetId, orgId, payload: { orgId, userId: command.userId, targetType: command.targetType, targetId: command.targetId } }))`. Đổi `unfollow-target.command.ts` options → **`transactional: true`**. ⚠️ `requireTenantId()` import từ `@/common/tenant/tenant.context`.
- **Verify:** smoke (memory `smoke-test-kafka-consumer` ngược lại — produce qua REST core-api hoặc đọc topic) → `kafka-console-consumer --topic engagement-events` thấy CloudEvent khi follow/unfollow. Hoặc gọn hơn: bơm thẳng test ở B2.2.

### B2.2 — notification-service: local follower projection
```prisma
model SpaceFollower {
  orgId     String @map("org_id")
  spaceId   String @map("space_id")
  userId    String @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  @@id([spaceId, userId])
  @@index([spaceId])
  @@map("space_followers")
}
```
- `prisma db push` lại vào `notification_db` (thêm bảng `space_followers`, KHÔNG drop `notifications`).
- **Consumer cho engagement-events** — quyết định đã chốt: KHÔNG fan-out (cùng concern notification), nên dùng **CÙNG group** `KAFKA_NOTIFICATION_CONSUMER_GROUP`. 2 lựa chọn cấu trúc (chọn cái sạch hơn):
  - (a) **Mở rộng** `knowledge-events.consumer.ts` → subscribe CẢ `knowledge-events` + `engagement-events`, dùng 1 `EventRouter` register 3 handler (KNOWLEDGE_PUBLISHED, FOLLOW_CREATED, FOLLOW_REMOVED). Router 1:1 per-type vẫn đúng (3 type khác nhau, guard chỉ ném khi TRÙNG type). Rename file → `notification-events.consumer.ts` cho đúng nghĩa.
  - (b) Thêm `engagement-events.consumer.ts` riêng cùng group. Nhiều file hơn nhưng tách topic rõ.
  - → Khuyến nghị **(a)** (1 consumer, 1 router, ít bản sao boilerplate). EventRouter scope per-module vẫn 1 (cùng group).
- **Handlers** (mirror `item-published.handler.ts`): `FollowCreatedHandler` (`readonly eventType = EventType.FOLLOW_CREATED`) → chỉ xử lý `targetType === 'SPACE'`, `upsert SpaceFollower` by PK `[spaceId,userId]` (spaceId = payload.targetId). `FollowRemovedHandler` → `delete` by PK. Idempotent tự nhiên (upsert/delete by PK). Đặt ở `application/events/follow-created/` + `follow-removed/`.
- **Repo:** thêm `ISpaceFollowerRepository` (application) + `PrismaSpaceFollowerRepository` (infrastructure): `upsert(row)`, `remove(spaceId,userId)`, `findFollowerIds(orgId, spaceId)` (dùng ở B2.3). Đăng ký token trong `notification.module.ts`.

### B2.3 — Đổi item-published handler → fan-out
- ⚠️ Sửa `application/events/item-published/item-published.handler.ts` (file B1 đã có). Inject thêm `ISpaceFollowerRepository`.
- `handle()`: `const followerIds = await spaceFollowerRepo.findFollowerIds(payload.orgId, payload.spaceId)` → loại `payload.createdByUserId` → map thành N `InsertNotificationRow` (type **`NEW_IN_SPACE`**, recipientUserId = followerId, actorUserId = createdByUserId, titleSnapshot = payload.title) → `notificationRepo.insertMany(rows)` (đã `createMany skipDuplicates`; unique `[recipientUserId, sourceEventId]` chặn trùng khi redeliver). Nếu followerIds rỗng → insertMany([]) → no-op (repo đã guard `length === 0`).
- **QUYẾT ĐỊNH (ghi vào memory + PROJECT_STATUS):** B1 notify tác giả (type ITEM_PUBLISHED); **B2 ĐỔI semantics** → fan-out cho follower của space, tác giả KHÔNG tự notify mình, type `NEW_IN_SPACE`. Type `ITEM_PUBLISHED` ngừng sinh (giữ enum cho lịch sử/rows cũ).

### B2 — Acceptance
- [ ] Follow/unfollow ở core-api → notification-service SpaceFollower cập nhật (qua Kafka).
- [ ] Publish item trong space có follower → mỗi follower (trừ tác giả) nhận 1 notification.
- [ ] Follower projection rỗng → publish → 0 notification.
- [ ] Idempotent: redeliver KnowledgePublished → không nhân đôi.
- [ ] Multi-tenant: follower org khác không nhận.

---

## SAU KHI XONG (After-Task Protocol — tự làm)
- `.ai/PROJECT_STATUS.md`: thêm notification-service (Phase 6 khởi động sớm — first real consumer), Phase 2 backbone "đã có consumer thật".
- `.ai/KNOWLEDGE_INDEX.md` §2: chạy lại `knowledge_builder` (sandbox) → auto-scan thấy module mới.
- `.ai/memory/architecture.jsonl`: log "first real consumer = notification-service own-DB; follower projection từ FOLLOW events; snapshot title (own-DB không join chéo)".
- `directives/eventing_patterns.md` §4.2: cập nhật "TRẠNG THÁI: consumer LIVE ở notification-service" (gỡ nhãn deferred cho phần đã làm).
- Directive mới nếu phát sinh: `microservice_architecture.md` bổ sung mục "service own DB + projection từ event".

## CẠM BẪY ĐÃ BIẾT
- Git Bash Windows: `docker cp`/`docker exec psql -c "/path"` cần `MSYS_NO_PATHCONV=1` (path bị mangle). Xem memory `smoke-test-core-api-harness`.
- Smoke test endpoint cần JWT RS256: craft bằng openssl (xem memory `smoke-test-core-api-harness`), KHÔNG cần boot auth-service.
- shared-kernel `dist/` stale → IDE đỏ dù CLI xanh: xoá `packages/shared-kernel/dist` + rebuild `--force`.
- notification-service own DB → KHÔNG OrgGuard, KHÔNG join core_db. Đừng cố import core-api repo.
- EventRouter 1:1 per type per consumer group — KHÔNG nhồi 2 concern vào 1 group (xem `eventing_patterns.md §4.2`).
- kafkajs consumer giữ event loop sống; `enableShutdownHooks` để disconnect sạch khi SIGTERM.
