# SOP: RAG & AI Integration Standard

> [!NOTE]
> Directive này quy định cách tích hợp AI (RAG, Hybrid Search, Embeddings) vào Cortex.
> Áp dụng cho **core-api** — service chứa KnowledgeItem, Search, và AI Query endpoints.

---

## 🎯 Architecture Overview

```
User Query
    ↓
[core-api: SearchKnowledgeQuery]
    ↓
Hybrid Retrieval (RRF)
    ├── pgvector (Semantic) ──────── Embedding(query) → cosine similarity
    └── Elasticsearch (Full-text) ── BM25 keyword search
    ↓
RRF Merge & Re-rank
    ↓
[Claude API: RAG Summarization] ← Circuit Breaker
    ↓
SearchResult { chunks, summary, sources }
```

---

## 📜 Kiến Trúc Bắt Buộc

### 1. Embedding Generation — Claude API

```typescript
// modules/knowledge/infrastructure/services/embedding.service.ts
export class EmbeddingService implements IEmbeddingService {
  constructor(
    private readonly anthropic: Anthropic,
    private readonly circuitBreaker: CircuitBreaker,
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.circuitBreaker.execute(async () => {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: text }],
        // NOTE: Claude hiện dùng text generation để derive embedding proxy.
        // Khi claude-embed-* available, chuyển sang đó.
      })
      // Tạm thời: dùng hash-based embedding cho dev, real API cho prod
      return this.deriveEmbedding(text)
    })
  }
}
```

> **Model cho embedding**: `claude-haiku-4-5-20251001` (fastest + cheapest).
> **Model cho RAG summarization**: `claude-sonnet-4-6` (quality).

---

### 2. Database Schema — pgvector

```prisma
// Cần enable pgvector extension trong prisma/migrations/
// CREATE EXTENSION IF NOT EXISTS vector;

model KnowledgeChunk {
  id              String                  @id @default(uuid())
  knowledgeItemId String                  @map("knowledge_item_id")
  orgId           String                  @map("org_id")
  content         String                  // raw text chunk
  embedding       Unsupported("vector(1536)")? // pgvector column
  chunkIndex      Int                     @map("chunk_index")
  tokenCount      Int                     @map("token_count")
  createdAt       DateTime                @default(now()) @map("created_at")

  knowledgeItem KnowledgeItem @relation(fields: [knowledgeItemId], references: [id])

  @@index([orgId])
  @@map("knowledge_chunks")
}
```

**Migration để tạo HNSW index** (phải chạy thủ công sau generate):
```sql
CREATE INDEX knowledge_chunks_embedding_idx
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

### 3. Circuit Breaker — Bắt Buộc cho mọi AI call

Mọi call đến Claude API phải đi qua Circuit Breaker để tránh cascade failure khi AI service down.

```typescript
// infrastructure/ai/circuit-breaker.ts
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  private failureCount = 0
  private lastFailureTime?: Date

  constructor(
    private readonly threshold = 5,           // failures before open
    private readonly timeoutMs = 60_000,      // 60s before half-open
    private readonly logger: ILogger,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime!.getTime() > this.timeoutMs) {
        this.state = 'half-open'
      } else {
        throw new ServiceUnavailableError('AI service circuit open')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure(err)
      throw err
    }
  }

  private onSuccess() {
    this.failureCount = 0
    this.state = 'closed'
  }

  private onFailure(err: unknown) {
    this.failureCount++
    this.lastFailureTime = new Date()
    this.logger.warn({ err, failureCount: this.failureCount }, 'AI call failed')
    if (this.failureCount >= this.threshold) {
      this.state = 'open'
      this.logger.error('Circuit breaker OPEN — AI service unavailable')
    }
  }
}
```

---

### 4. Hybrid Search — RRF Merge

```typescript
// modules/search/application/queries/search-knowledge.handler.ts
export class SearchKnowledgeHandler implements IQueryHandler<SearchKnowledgeQuery> {
  async execute(query: SearchKnowledgeQuery): Promise<SearchResult> {
    const orgId = getTenantId()

    // Run both searches in parallel
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query.text, orgId),       // pgvector cosine
      this.keywordSearch(query.text, orgId),         // Elasticsearch BM25
    ])

    // RRF merge: score = Σ 1/(k + rank_i), k=60 is standard
    const merged = this.rrfMerge(semanticResults, keywordResults, 60)
    const topChunks = merged.slice(0, query.topK ?? 10)

    // RAG summarization — optional, skip if circuit open
    const summary = await this.summarize(query.text, topChunks).catch(() => null)

    return { chunks: topChunks, summary, sources: this.extractSources(topChunks) }
  }

  private rrfMerge(semantic: RankedResult[], keyword: RankedResult[], k: number) {
    const scoreMap = new Map<string, number>()

    for (const [rank, result] of semantic.entries()) {
      scoreMap.set(result.id, (scoreMap.get(result.id) ?? 0) + 1 / (k + rank + 1))
    }
    for (const [rank, result] of keyword.entries()) {
      scoreMap.set(result.id, (scoreMap.get(result.id) ?? 0) + 1 / (k + rank + 1))
    }

    return [...scoreMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([id]) => [...semantic, ...keyword].find(r => r.id === id)!)
  }
}
```

---

### 5. Chunking Strategy

Khi index một KnowledgeItem:

```typescript
// infrastructure/ai/text-chunker.ts
export class TextChunker {
  // Fixed-size với overlap để giữ context liên tục
  chunk(text: string, chunkSize = 512, overlap = 64): string[] {
    const words = text.split(/\s+/)
    const chunks: string[] = []
    let start = 0

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length)
      chunks.push(words.slice(start, end).join(' '))
      start += chunkSize - overlap  // slide window với overlap
    }
    return chunks
  }
}
```

> Chunk size 512 tokens (≈ 400 words) với 64 token overlap. Điều chỉnh nếu content domain là code (nên chunk theo function boundary thay vì word count).

---

### 6. Elasticsearch Integration

```typescript
// infrastructure/search/elasticsearch.repository.ts
export class ElasticsearchKnowledgeRepository implements IKeywordSearchRepository {
  constructor(private readonly client: Client) {}

  async search(text: string, orgId: string, limit = 20): Promise<RankedResult[]> {
    const response = await this.client.search({
      index: `knowledge-${orgId}`,         // per-tenant index
      body: {
        query: {
          multi_match: {
            query: text,
            fields: ['title^3', 'content'],  // boost title
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        },
        size: limit,
      },
    })

    return response.hits.hits.map((hit, rank) => ({
      id: hit._id!,
      content: hit._source?.content ?? '',
      score: hit._score ?? 0,
      rank,
    }))
  }

  async index(chunk: KnowledgeChunk): Promise<void> {
    await this.client.index({
      index: `knowledge-${chunk.orgId}`,
      id: chunk.id,
      document: { title: chunk.title, content: chunk.content, itemId: chunk.knowledgeItemId },
    })
  }
}
```

> **Per-tenant index** (`knowledge-{orgId}`) — isolation tự nhiên, không cần filter trong query.

---

## ⚠️ Gotchas

- **Circuit Breaker là bắt buộc** — không call Claude API trực tiếp. Search vẫn trả về kết quả khi AI down, chỉ không có summary.
- **pgvector HNSW index** phải được tạo qua raw SQL migration, không thể qua Prisma schema attributes.
- **Embedding dimensions**: Claude embedding proxy → 1536 dims. Nếu đổi model, phải migrate toàn bộ `embedding` column.
- **Elasticsearch index per tenant**: Xóa index khi org bị deleted. Đừng dùng shared index với filter — cross-tenant data risk.
- **Chunking trước embedding**: Không embed toàn bộ document — chunk trước, embed từng chunk.

---

## 🔗 Liên quan

- `directives/cqrs_pattern.md` — SearchKnowledgeQuery là Query handler
- `directives/multi_tenancy.md` — orgId isolation trong Elasticsearch + pgvector
- `directives/event_sourcing.md` — Knowledge indexing trigger có thể là Domain Event
- `docs/03_system_architecture_diagrams.md` — system data flow diagrams
