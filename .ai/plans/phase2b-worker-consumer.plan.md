# PLAN — Phase 2b: worker-service Consumer → FeedTimeline Projection

> **Đối tượng thực thi:** session mới (Sonnet). Plan TỰ ĐỦ.
> **Tiền đề:** Phase 2a smoke test ✅ (2026-06-28): outbox_events PENDING→PROCESSED, topic
> `knowledge-events` có message đúng shape, resilience (Kafka down→up) OK.
> **Scope:** NestJS worker-service subscribe `knowledge-events` → idempotent → upsert
> `feed_timeline`. KHÔNG tách git submodule ở bước này.

---

## 0. ĐỌC TRƯỚC (bắt buộc)

1. `.ai/KNOWLEDGE_INDEX.md` §4 (Critical Rules) + §5 (gotchas).
2. `directives/logging_standard.md` §Logger Hierarchy — ROOT 1 lần / CHILD mọi nơi.
3. `directives/resilience_patterns.md` §1 (Idempotency consumer) + §2 (Outbox consumer contract).
4. `directives/folder_structure_sop.md` §Canonical (áp cho worker-service NestJS).
5. `directives/microservice_architecture.md` §Bootstrap Checklist (NestJS variant).
6. `packages/shared-kernel/src/events/` — DomainEventEnvelope, KnowledgePublishedPayload (KHÔNG định nghĩa lại ở worker).
7. Plan này.

---

## 1. QUYẾT ĐỊNH ĐÃ CHỐT (3 điểm)

### (a) Fan-out Rule — Followers của Space (fan-out-on-write)

`KnowledgePublished { spaceId, orgId }` → query `follows` WHERE `targetType = 'SPACE' AND targetId = spaceId AND orgId = orgId` → ghi `feed_timeline` cho mỗi follower.

**Lý do chọn:**
- Bảng `Follow` đã tồn tại với `targetType = FollowTargetType.SPACE` ✅
- Semantics đúng: chỉ người đang theo dõi space mới thấy content trong feed
- Không gây spam toàn org (fallback "mọi member" quá ồn)
- Fan-out-on-write đủ scale cho Phase 2 (fanout lớn → Phase 6 push notification)

**Edge case:**
- Space có 0 followers → ghi 0 rows (không lỗi)
- createdByUserId có thể là follower của chính space → vẫn ghi (user thấy item mình publish trong feed = UX bình thường)

### (b) DB Ownership — Worker có Prisma schema riêng, trỏ cùng `core_db`

```
apps/worker-service/prisma/schema.prisma  →  datasource trỏ core_db (biến CORE_DATABASE_URL)
```

Worker schema chứa:
| Model | Ownership | Ghi chú |
|---|---|---|
| `ProcessedEvent` | **Worker sở hữu** — worker tạo table qua `db:push` | `eventId String @id` (dedup) |
| `FeedTimeline` | Core-api sở hữu — worker chỉ tham chiếu đủ columns để Prisma gen type | Table đã tồn tại từ core-api push |
| `Follow` | Core-api sở hữu — worker READ-ONLY để resolve fans | Table đã tồn tại từ core-api push |

**Nguyên tắc:**
- Worker KHÔNG đụng `knowledge_items`, `outbox_events`, hay bất kỳ write-model nào của core-api
- `db:push` từ worker chỉ tạo `processed_events` (table mới); `feed_timeline` + `follows` đã có → push idempotent
- Không shared Prisma client package — worker tự gen client từ schema của mình

### (c) Consumer Transport — kafkajs thuần (wrapped NestJS service)

Không dùng `@nestjs/microservices` Kafka transport.

**Lý do:**
- `@nestjs/microservices` Kafka yêu cầu payload theo KafkaMessage pattern riêng → phải adapt `DomainEventEnvelope` → thêm tầng phức tạp không cần thiết
- kafkajs raw khớp với producer side (core-api cũng dùng kafkajs)
- Full control offset management: consumer `eachMessage` → manual commit sau khi xử lý thành công (at-least-once, idempotency guard ở app layer)
- Consumer group `worker-feed` (isolate từ future consumers)
- Graceful shutdown: `consumer.disconnect()` trong `onModuleDestroy`

---

## 2. NGUYÊN LÝ BẮT BUỘC

- **At-least-once + Idempotency:** kafkajs at-least-once → handler PHẢI check `ProcessedEvent` theo `eventId` TRƯỚC khi xử lý. Ghi `ProcessedEvent` TRONG CÙNG transaction với `feed_timeline` upsert. Nếu ack Kafka trước khi commit DB → crash → sẽ bỏ sót (bad). Nếu commit DB trước khi ack Kafka → crash → sẽ xử lý lại (safe vì idempotency guard).
- **Error handling — không crash worker:** parse error / handler error → log + commit offset (poison pill đi vào DLQ topic `knowledge-events.DLQ` — để Phase 5). Không throw unhandled khiến worker die.
- **Logger Hierarchy:** `createLogger('worker-service')` CHỈ 1 lần ở `LoggerModule.forRootAsync` trong `app.module.ts`. Consumer service, handler dùng `@InjectPinoLogger(Xxx.name)`.
- **Event contract:** import từ `@distributed-social-platform/shared-kernel`. KHÔNG định nghĩa lại shape.
- **Tenant isolation:** payload mang `orgId` → filter follow theo `orgId` → feed_timeline ghi đúng `orgId`. Worker không cần OrgGuard (không có HTTP), nhưng PHẢI scope mọi DB query bởi `orgId`.

---

## 3. TASKS (tuần tự — typecheck sau mỗi nhóm)

### T0 — Scaffold worker-service (package thường, KHÔNG submodule)

**(a)** Tạo `apps/worker-service/package.json`:
```json
{
  "name": "@distributed-social-platform/worker-service",
  "version": "0.0.1",
  "scripts": {
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "build": "nest build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\"",
    "lint:fix": "eslint \"src/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "check": "npm run typecheck && npm run lint && npm run format:check",
    "db:generate": "prisma generate",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@distributed-social-platform/shared-kernel": "workspace:*",
    "@nestjs/common": "...",  // kế thừa version từ root
    "@nestjs/core": "...",
    "@nestjs/config": "...",
    "@nestjs/platform-fastify": "...",
    "@nestjs/schedule": "...",
    "kafkajs": "...",
    "nestjs-pino": "...",
    "pino-pretty": "...",
    "pino-elasticsearch": "...",
    "zod": "..."
  },
  "devDependencies": {
    "@nestjs/cli": "...",
    "@nestjs/schematics": "...",
    "typescript": "...",
    "prisma": "..."
  }
}
```
> ⚠️ Copy exact version numbers từ core-api/package.json để tránh mismatch.

**(b)** `apps/worker-service/tsconfig.json` — kế thừa root:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./src",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["src/**/*"]
}
```

**(c)** `apps/worker-service/nest-cli.json`:
```json
{
  "$schema": "...",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "entryFile": "main"
}
```

**(d)** Thêm `worker-service` vào `turbo.json` workspace + root `package.json` workspaces (nếu chưa có).

### T1 — Prisma Schema (worker)

`apps/worker-service/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated"
}

// datasource trỏ cùng core_db
// URL từ env CORE_DATABASE_URL (không có `url` ở đây vì Prisma v7 dùng prisma.config.ts)

model ProcessedEvent {
  eventId     String   @id @map("event_id")
  processedAt DateTime @default(now()) @map("processed_at")

  @@map("processed_events")
}

// Worker references these tables (already exist from core-api schema push)
model FeedTimeline {
  id        String   @id @default(uuid())
  orgId     String   @map("org_id")
  userId    String   @map("user_id")
  itemId    String   @map("item_id")
  reason    String
  createdAt DateTime @default(now()) @map("created_at")

  @@index([orgId, userId, createdAt])
  @@map("feed_timeline")
}

model Follow {
  id         String   @id @default(uuid())
  orgId      String   @map("org_id")
  userId     String   @map("user_id")
  targetType String   @map("target_type")   // "SPACE" for our query
  targetId   String   @map("target_id")
  createdAt  DateTime @default(now()) @map("created_at")

  @@unique([userId, targetType, targetId])
  @@index([orgId, userId])
  @@map("follows")
}
```

`apps/worker-service/prisma.config.ts`:
```ts
import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(process.cwd(), '../../.env') })
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.CORE_DATABASE_URL! },
})
```

→ `cd apps/worker-service && npm run db:generate` (chỉ generate types, db:push khi smoke test)

### T2 — Bootstrap (config + app module + main)

**`src/config/env.validation.ts`:**
```ts
export const envValidationSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORE_DATABASE_URL: z.string().url(),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('worker-service'),
  KAFKA_CONSUMER_GROUP: z.string().default('worker-feed'),
})
```

**`src/config/env.config.ts`:**
```ts
export const envConfig = registerAs('env', () => ({
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'worker-service',
  kafkaConsumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'worker-feed',
}))
```

**`src/app.module.ts`:**
```ts
@Module({
  imports: [
    ConfigModule,      // NestConfigModule.forRoot({ envFilePath: '../../.env', validate, load: [envConfig] })
    PrismaModule,
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: { logger: createLogger('worker-service') },
      }),
    }),
    FeedModule,        // consumer + handler
  ],
})
export class AppModule {}
```

**`src/main.ts`:**
```ts
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,  // nestjs-pino handles logging
  })
  await app.init()
  // Worker là background process, không listen HTTP port
}
bootstrap().catch(err => { console.error(err); process.exit(1) })
```

> ⚠️ `createApplicationContext` (không phải `create`) — worker không expose HTTP, không cần Fastify adapter.

### T3 — Kafka Consumer (infrastructure)

`src/modules/feed/infrastructure/knowledge-events.consumer.ts`:
```ts
@Injectable()
export class KnowledgeEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka
  private readonly consumer: Consumer

  constructor(
    private readonly config: ConfigService,
    private readonly handler: KnowledgePublishedHandler,
    @InjectPinoLogger(KnowledgeEventsConsumer.name) private readonly logger: PinoLogger,
  ) {
    this.kafka = new Kafka({
      clientId: config.get('env.kafkaClientId'),
      brokers: config.get<string[]>('env.kafkaBrokers'),
    })
    this.consumer = this.kafka.consumer({
      groupId: config.get('env.kafkaConsumerGroup'),
    })
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect()
    await this.consumer.subscribe({
      topic: KafkaTopic.KNOWLEDGE_EVENTS,
      fromBeginning: false,
    })
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString()
        if (!raw) return

        let envelope: DomainEventEnvelope
        try {
          envelope = JSON.parse(raw) as DomainEventEnvelope
        } catch {
          this.logger.error({ raw }, 'Failed to parse Kafka message — skipping (poison pill)')
          // ack by returning (offset auto-committed in eachMessage)
          return
        }

        try {
          await this.handler.handle(envelope)
        } catch (err) {
          this.logger.error({ eventId: envelope.eventId, err }, 'Handler error — skipping to DLQ (Phase 5)')
          // Phase 5: produce to knowledge-events.DLQ
        }
      },
    })
    this.logger.info('KnowledgeEventsConsumer connected and listening')
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect()
  }
}
```

### T4 — Handler (application: idempotency + projection)

`src/modules/feed/application/knowledge-published.handler.ts`:
```ts
@Injectable()
export class KnowledgePublishedHandler {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(KnowledgePublishedHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(envelope: DomainEventEnvelope<KnowledgePublishedPayload>): Promise<void> {
    if (envelope.eventType !== EventType.KNOWLEDGE_PUBLISHED) return

    const { eventId, payload } = envelope
    const { itemId, orgId, spaceId } = payload

    // ── Idempotency check ──────────────────────────────────────────
    const already = await this.prisma.client.processedEvent.findUnique({
      where: { eventId },
    })
    if (already) {
      this.logger.debug({ eventId }, 'Event already processed — skipping (idempotent)')
      return
    }

    // ── Resolve space followers ────────────────────────────────────
    const followers = await this.prisma.client.follow.findMany({
      where: { orgId, targetType: 'SPACE', targetId: spaceId },
      select: { userId: true },
    })

    if (followers.length === 0) {
      this.logger.debug({ eventId, spaceId }, 'No followers for space — no feed rows written')
    }

    // ── Atomic: upsert feed_timeline + mark ProcessedEvent ─────────
    await this.prisma.client.$transaction([
      // fan-out: one row per follower
      ...followers.map(({ userId }) =>
        this.prisma.client.feedTimeline.upsert({
          where: { id: `${itemId}:${userId}` },  // NOTE: tidak pakai compound PK — lihat gotcha di bawah
          // Actual upsert key: (itemId, userId) — perlu @@unique. Alternatif: createMany skipDuplicates.
          update: {},  // jika sudah ada, jangan overwrite createdAt
          create: { orgId, userId, itemId, reason: 'new_in_space' },
        }),
      ),
      // mark processed — atomic dengan projection write
      this.prisma.client.processedEvent.create({
        data: { eventId },
      }),
    ])

    this.logger.info({ eventId, itemId, fanOutCount: followers.length }, 'KnowledgePublished projected to feed_timeline')
  }
}
```

> ⚠️ **Gotcha upsert FeedTimeline:** `upsert` cần unique key. FeedTimeline hiện chỉ có `id @id @default(uuid())` — không có unique constraint `(userId, itemId)`. **Cần thêm** `@@unique([userId, itemId])` vào cả core-api schema + worker schema + `db:push`. Thay thế: dùng `createMany({ data: [...], skipDuplicates: true })` (Postgres `ON CONFLICT DO NOTHING`). **Khuyến nghị: createMany + skipDuplicates** (đơn giản hơn, không cần thêm unique constraint).

**Revision sang `createMany` + `skipDuplicates`:**
```ts
await this.prisma.client.$transaction([
  this.prisma.client.feedTimeline.createMany({
    data: followers.map(({ userId }) => ({
      orgId, userId, itemId, reason: 'new_in_space',
    })),
    skipDuplicates: true,   // ON CONFLICT DO NOTHING nếu (userId, itemId) đã có
  }),
  this.prisma.client.processedEvent.create({ data: { eventId } }),
])
```
> Nhưng `createMany` + `$transaction` với `ProcessedEvent.create` = 2 operations. Prisma `$transaction([...])` với interactive mode: OK.

Thực ra `skipDuplicates` chỉ work nếu có unique constraint. Phải thêm `@@unique([userId, itemId])` vào FeedTimeline (cả 2 schema). Đây là **thay đổi schema bắt buộc** — add ở T1 luôn.

### T5 — FeedModule

`src/modules/feed/feed.module.ts`:
```ts
@Module({
  providers: [KnowledgePublishedHandler, KnowledgeEventsConsumer],
})
export class FeedModule {}
```

### T6 — Schema update: FeedTimeline unique constraint

Thêm vào `core-api/prisma/schema.prisma` model `FeedTimeline`:
```prisma
@@unique([userId, itemId])   // cho idempotent createMany skipDuplicates
```

Thêm cả vào `worker-service/prisma/schema.prisma` (mirror).

→ `cd apps/core-api && npm run db:push` (apply unique constraint).

### T7 — Gate

```bash
cd apps/worker-service
npm install
npm run db:generate
npm run db:push       # tạo processed_events
npm run check         # typecheck + lint + format
```

### T8 — Smoke Test 2b

1. Publish 1 knowledge item từ core-api (org có followers).
2. Trong ≤ vài giây: `SELECT * FROM feed_timeline WHERE item_id = '...'` → có rows cho followers.
3. Gửi lại cùng eventId (simulate at-least-once): `processed_events` có 1 row; `feed_timeline` không nhân đôi.
4. Worker không crash khi nhận message parse lỗi (test với invalid JSON).

---

## 4. DEFINITION OF DONE

- [ ] `worker-service` start OK (ApplicationContext), Kafka consumer connected + subscribed `knowledge-events`
- [ ] KnowledgePublished → followers của space có feed_timeline rows (reason='new_in_space')
- [ ] Cùng eventId xử lý 2 lần → chỉ 1 set feed rows (ProcessedEvent guard)
- [ ] `createMany skipDuplicates` → FeedTimeline không duplicate dù at-least-once
- [ ] Worker không crash khi message lỗi (log + skip)
- [ ] `npm run check` (worker-service) xanh
- [ ] Không `console.log`, logger qua Pino nestjs-pino child injection

---

## 5. ⛔ DO NOT

- ❌ Dùng `@nestjs/microservices` Kafka transport — dùng kafkajs raw
- ❌ Ack/commit offset TRƯỚC khi commit DB — crash = lost event
- ❌ Xử lý event không check ProcessedEvent trước (at-least-once → nhân đôi)
- ❌ Import kafkajs ngoài consumer infrastructure file
- ❌ Ghi vào write-model của core-api (knowledge_items, outbox_events, memberships...)
- ❌ `createLogger` ad-hoc trong feature code — chỉ ở composition root
- ❌ console.log bất kỳ đâu

---

## 6. SAU KHI XONG (After-Task Protocol)

- Cập nhật `.ai/PROJECT_STATUS.md`: Phase 2 → ✅; Phase 3 → next
- Log lesson `.ai/memory/architecture.jsonl`: worker-service scaffold, consumer pattern, idempotency via ProcessedEvent
- Surgical edit `.ai/KNOWLEDGE_INDEX.md`: §2 module map worker-service, quyết định kafkajs raw
- Cân nhắc `directives/event_driven_sop.md` nếu pattern consumer mới đủ để document
