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

## Tóm tắt — Pattern nào dùng khi nào

```
User gửi request có thể retry → Idempotency
Sau domain write cần notify service khác → Transactional Outbox
External service fail tạm thời → Retry (+ Circuit Breaker)
Xử lý nhiều item AI cùng lúc → Throttle
External service fail liên tục → Circuit Breaker (xem rag_ai_integration.md)
```
