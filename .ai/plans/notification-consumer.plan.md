# PLAN: First Real Consumer — notification-service (own DB, event-driven)

> **Cho session mới.** Đọc trọn file này + `directives/eventing_patterns.md` trước khi code. Làm **Milestone B1 → B2** theo thứ tự. Không nhảy cóc.
> Ngày lập: 2026-06-30. Người duyệt hướng: user (chọn "notification-service full bootstrap" + "fan-out-on-write SoT").

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
- Trong engagement module, command tạo/xoá follow → `outboxRepo.append(FollowCreatedEvent.create(...))` / `FollowRemovedEvent.create(...)` trong cùng tx (atomic, mirror publish-knowledge.handler).
- Tạo `shared-kernel/src/events/definitions/follow-created.event.ts` + `follow-removed.event.ts` (payload `{ followId, orgId, userId, targetType, targetId }`). `EventType.FOLLOW_CREATED/REMOVED` + map đã có (topic `engagement-events`).
- Verify outbox → Kafka `engagement-events` có message khi follow/unfollow.

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
- Consumer thứ 2 (group riêng? — KHÔNG: cùng service, nhưng EventRouter 1:1 nên cần consumer cho topic `engagement-events`, group `KAFKA_NOTIFICATION_CONSUMER_GROUP` có thể subscribe nhiều topic; handler FOLLOW_CREATED/REMOVED riêng). Xem `eventing_patterns.md §4.2` về 1 consumer nhiều topic vs nhiều group.
- Handler `FollowCreated` → upsert SpaceFollower (chỉ targetType=SPACE); `FollowRemoved` → delete. Idempotent (upsert/delete by PK).

### B2.3 — Đổi item-published handler → fan-out
- `handle()`: query local `SpaceFollower WHERE spaceId = payload.spaceId AND orgId = payload.orgId`, loại `payload.createdByUserId` → tạo N notification rows (type `NEW_IN_SPACE`), `createMany skipDuplicates` (unique `[recipientUserId, sourceEventId]` chặn trùng).
- B1 notification cho tác giả: giữ hay bỏ? → đổi semantics sang follower fan-out (tác giả không tự notify mình). Ghi quyết định.

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
