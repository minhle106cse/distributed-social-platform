# SOP: Resilience Patterns

> Hướng dẫn implement 4 pattern bảo vệ hệ thống: Idempotency, Transactional Outbox, Retry, Throttle.
> Đọc file này trước khi viết bất kỳ endpoint nào xử lý mutation quan trọng hoặc gọi external service.

---

## 📌 Khi nào đọc directive này

| Task | Pattern cần dùng |
|---|---|
| Endpoint POST/PATCH có thể bị client retry | Idempotency |
| Sau khi save DB cần publish event ra Kafka | Transactional Outbox |
| Gọi external service có thể fail tạm thời | Retry |
| Gọi Claude API / embedding cho nhiều item | Throttle |
| Viết `main.ts`/entrypoint mới cho 1 service | Graceful Shutdown |

---

## 1. Idempotency

### Vấn đề
Client gửi `POST /ai/ask` → timeout → retry → server xử lý 2 lần, tốn credit 2 lần.

### Giải pháp
Client gửi header `X-Idempotency-Key: <uuid>`. Server check key đã tồn tại chưa — nếu rồi trả lại response cũ, không xử lý lại.

### Schema (đã có)
```prisma
model IdempotencyRecord {
  key       String   @id               // X-Idempotency-Key
  response  Json                        // response đã trả lần đầu
  createdAt DateTime @default(now())
  expiresAt DateTime                    // TTL 24h, cron xóa expired rows
  @@index([expiresAt])
}
```

### Implement — NestJS Interceptor
```typescript
// infrastructure/http/interceptors/idempotency.interceptor.ts
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const key = req.headers['x-idempotency-key'] as string | undefined

    // Chỉ áp dụng cho mutation methods
    if (!key || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next.handle()
    }

    // Check key đã tồn tại chưa
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key } })
    if (existing) {
      return of(existing.response) // trả lại response cũ ngay
    }

    // Chưa có → xử lý bình thường, lưu response
    return next.handle().pipe(
      tap(async (response) => {
        await this.prisma.idempotencyRecord.create({
          data: {
            key,
            response: response as object,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
          },
        })
      }),
    )
  }
}
```

### Đăng ký — chỉ cho routes cần thiết (không global)
```typescript
// Áp lên controller cụ thể
@UseInterceptors(IdempotencyInterceptor)
@Post('ai/ask')
async ask() { ... }
```

### Rules
- ⛔ KHÔNG đăng ký global — chỉ áp cho endpoint có side effect tốn kém (AI call, credit spend)
- ⛔ KHÔNG áp cho GET
- TTL 24h là chuẩn, có thể giảm xuống 1h cho endpoints không quan trọng
- Cron cleanup: `DELETE FROM idempotency_records WHERE expires_at < NOW()` chạy mỗi đêm

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

### Đã có sẵn — RetryMiddleware trong CQRS pipeline
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

### Rules
- Retry chỉ cho **transient errors** (timeout, 503, connection reset)
- KHÔNG retry **4xx errors** (validation, auth, not found) — những lỗi này retry vô nghĩa
- Max 3 attempts, exponential backoff
- Luôn dùng Circuit Breaker bên ngoài Retry (xem `rag_ai_integration.md`)

### Cập nhật (2026-06-22) + Readiness cho Phase 5 (OCC)
- **Jitter**: `RetryMiddleware` giờ dùng *full jitter* — `delay = random(0, min(maxDelayMs, base·2^(n-1)))` thay backoff cố định, để các victim deadlock (P2034) không retry đồng pha rồi đâm lại nhau. Helper `withRetry` thủ công ở trên nên áp dụng jitter tương tự.
- **Seam mở rộng**: middleware KHÔNG biết "lỗi nào là transient" — nó nhận predicate `isPrismaTransientError` inject ở composition root (`cqrs.module.ts`). Thêm loại lỗi retry-able → compose predicate ở đó, KHÔNG sửa middleware (giữ ORM-agnostic).
- **⚠️ GAP phải đóng khi làm `knowledge-module` (OCC)**: OCC version-conflict trong Prisma nổi lên dưới dạng **P2025** (`update where version=X` khớp 0 row) hoặc `updateMany` trả `count: 0` — **KHÔNG phải P2034**. Predicate hiện chỉ bắt P2034/P2028 → sẽ KHÔNG retry OCC conflict. Khi code OCC: ném `OptimisticLockConflictError` riêng rồi compose vào predicate (hoặc nhận diện P2025-trong-ngữ-cảnh-versioned). Thứ tự **Retry-wraps-Transaction đã đúng sẵn** cho OCC: retry → tx mới → đọc lại version mới → re-apply.
- **Điều kiện an toàn của retry**: chỉ an toàn khi mọi side-effect nằm TRONG transaction bị rollback. Không retry command có publish Kafka / gọi external trực tiếp giữa handler — đó là lý do Outbox (mục 2) là tiền đề để retry-safe khi có event.

---

## 4. Throttle (AI / Embedding workload)

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

### Per-org rate limit (từ schema)
```typescript
// Mỗi org có aiRateLimitPerMin riêng trong Organization.aiRateLimitPerMin
// Enforce trước khi gọi Claude API
async enforceOrgAiRateLimit(orgId: string): Promise<void> {
  const org = await this.orgRepo.findById(orgId)
  const currentUsage = await this.redis.incr(`ai_rate:${orgId}:${minuteKey()}`)
  if (currentUsage === 1) await this.redis.expire(`ai_rate:${orgId}:${minuteKey()}`, 60)
  if (currentUsage > org.aiRateLimitPerMin) {
    throw new TooManyRequestsError('AI rate limit exceeded for this organization')
  }
}
```

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

## Tóm tắt — Pattern nào dùng khi nào

```
User gửi request có thể retry → Idempotency
Sau domain write cần notify service khác → Transactional Outbox
External service fail tạm thời → Retry (+ Circuit Breaker)
Xử lý nhiều item AI cùng lúc → Throttle
External service fail liên tục → Circuit Breaker (xem rag_ai_integration.md)
Service chạy dài hạn cần dừng sạch (deploy/restart/scale-down) → Graceful Shutdown
```
