# SOP: RAG & AI Integration Standard

> ✅ **TRẠNG THÁI: LIVE ở search-service (Phase 4, 2026-07-02, smoke-tested).** C1 semantic (pgvector embed-on-publish) + C2 hybrid (ES BM25 + RRF) + C3 RAG summary (Claude + circuit breaker). Consumer #2 (`KnowledgeIndexerConsumer`, group `search-service-indexer-group`). Còn: happy-path summary cần `ANTHROPIC_API_KEY` hợp lệ; search-service chưa versioned (chờ GitHub repo).

> [!NOTE]
> Directive này quy định cách tích hợp AI (RAG, Hybrid Search, Embeddings) vào Cortex.
> Áp dụng cho **search-service** — microservice own `search_db` (pgvector), consume `knowledge-events` (embed-on-publish), expose Search + AI Query. (Trước đây ghi "core-api"; đã tách theo microservice trajectory — Phase 4, xem `.ai/plans/phase4-rag-search.plan.md`.)
>
> ⚠️ **Claude KHÔNG có embeddings API.** Không có model `claude-embed-*`; `messages.create` trả TEXT, không phải vector. Embeddings PHẢI qua provider ngoài (self-hosted local / Voyage / OpenAI) sau `IEmbeddingService`. Claude chỉ dùng cho **summarization** (§3+RAG).

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

### 1. Embedding Generation — provider NGOÀI Claude, sau `IEmbeddingService`

Claude không sinh embedding. Dùng port `IEmbeddingService` + adapter tới provider embedding thật. **Chốt Cortex (Phase 4): self-hosted local** (miễn phí, không key ngoài, launchable) — một service nhỏ trong Docker (khuyến nghị Text-Embeddings-Inference `BAAI/bge-base-en-v1.5`, **dim 768**, hoặc Ollama `nomic-embed-text`). Swap Voyage/OpenAI = đổi 1 adapter (đổi dim ⇒ migrate cột `vector`).

```typescript
// search-service: application/ports/embedding.service.ts
export interface IEmbeddingService {
  embed(text: string): Promise<number[]>          // dim = EMBEDDING_DIM (768)
  embedBatch(texts: string[]): Promise<number[][]>
}

// search-service: infrastructure/embedding/http-embedding.service.ts
export class HttpEmbeddingService implements IEmbeddingService {
  // POST EMBEDDING_SERVICE_URL/embed { inputs } → number[][]. KHÔNG gọi Anthropic.
  async embedBatch(texts: string[]): Promise<number[][]> { /* fetch → vectors */ }
}
```

> **Model embedding**: provider ngoài (local `bge-base-en-v1.5` dim 768). **KHÔNG phải Claude.**
> **Model RAG summarization (§3)**: `claude-opus-4-8` (default, mạnh nhất) hoặc `claude-sonnet-4-6` (rẻ, volume cao). Dùng alias — **KHÔNG date-suffix**. Model 4.6+: `thinking:{type:'adaptive'}`, KHÔNG `budget_tokens`.

---

### 2. Database Schema — pgvector

```prisma
// Cần enable pgvector extension trong prisma/migrations/
// CREATE EXTENSION IF NOT EXISTS vector;

// ⬇️ Actual (search-service own search_db). NO relation to KnowledgeItem — that
// lives in core_db; search-service snapshots title+content from the event (no
// cross-DB join). dim = 768 (nomic-embed-text), not 1536.
model KnowledgeChunk {
  id              String   @id @default(uuid())
  knowledgeItemId String   @map("knowledge_item_id")
  orgId           String   @map("org_id")
  spaceId         String   @map("space_id")
  chunkIndex      Int      @map("chunk_index")
  content         String
  titleSnapshot   String   @map("title_snapshot")
  embedding       Unsupported("vector(768)")?
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([knowledgeItemId, chunkIndex]) // idempotent re-index (delete+insert by itemId)
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

Mọi call đến Claude/Gemini API phải đi qua Circuit Breaker để tránh cascade failure khi AI service down.

> **Cập nhật (2026-07-12):** `CircuitBreaker` không còn là class riêng của search-service — đã chuyển vào `@distributed-social-platform/shared-kernel` (`src/resilience/circuit-breaker.ts`) vì giờ được dùng chung bởi cả AI call (search-service) lẫn Elasticsearch/Ollama/gRPC (core-api). Import từ shared-kernel, không viết lại cục bộ. Chi tiết đầy đủ + audit + rules: `resilience_patterns.md §3.1`.

```typescript
import { CircuitBreaker } from '@distributed-social-platform/shared-kernel'

// ClaudeSummarizer/GeminiSummarizer — mỗi adapter giữ 1 instance riêng
this.breaker = new CircuitBreaker(logger) // threshold=5, timeoutMs=60_000 (default)

async summarize(query: string, context: SummaryContext[]): Promise<RagSummary> {
  return this.breaker.execute(async () => {
    // gọi Claude/Gemini thật ở đây
  })
}
```

---

### 4. Hybrid Search — RRF Merge

**Vì sao search-service không có CommandBus/QueryBus — SỬA LẠI 2026-07-25, bản trước lý luận sai:** bản đầu viết ở đây lý luận "chỉ 1 query/1 write nên không đáng dựng bus" — **sai, đã bị chỉ ra và sửa.** CommandBus/QueryBus gắn với HTTP dispatch (command từ 1 route HTTP cụ thể), KHÔNG phải điều kiện để có consistency. Đúng bản chất: search-service **không có write nào là HTTP Command** — write duy nhất là 1 Kafka event (`IndexKnowledgeHandler implements IIntegrationEventHandler`), và dispatch cho event KHÔNG đi qua CommandBus mà qua `EventRouter` (shared-kernel) — cơ chế route theo `event.type`, transport-agnostic, dùng CHUNG với core-api/notification-service, không phải thứ riêng của search-service.

**Vậy setup có đồng bộ không? CÓ — đúng yêu cầu "setup phải giống nhau bất kể dùng gì":** `EventRouter.route()` (2026-07-25) giờ tự log dispatch (`info` lúc bắt đầu route + `info`+`durationMs` lúc xong) — **đúng ngay tại điểm dùng chung này**, không phải viết tay riêng ở `IndexKnowledgeHandler`. Nghĩa là search-service, notification-service, và bất kỳ consumer nào dùng `EventRouter` sau này (kể cả worker-service khi có consumer đầu tiên) đều nhận log dispatch giống hệt nhau tự động — đúng tinh thần `LoggingMiddleware` của CommandBus, chỉ khác chỗ đặt (tại `EventRouter`, không phải tại 1 bus tách riêng cho search-service). Bug thật tìm ra khi sửa: `notification-service` có 3 event handler (`item-published`, `follow-removed`, `follow-created`) **hoàn toàn không có business-layer log** — không phải vì "không có bus" mà vì log trước đó bị viết tay per-handler (search-service) hoặc quên hẳn (notification-service), chưa từng có ở tầng dùng chung. Giờ đã có.

**Cái search-service THẬT SỰ không có, và đúng là không cần:** CommandBus/QueryBus — vì không có route HTTP nào dispatch qua đó (search() gọi trực tiếp qua NestJS DI, đây là quyết định HTTP-layer, không phải logging-layer). Đây KHÔNG phải lý do để logging/dispatch setup khác đi — 2 việc tách biệt, bản trước gộp nhầm.

```typescript
// search-service: modules/search/application/queries/search-knowledge.service.ts
// (plain application service, not the CQRS QueryBus — search-service has no bus)
async search(orgId, query, topK, summarize): Promise<SearchResult> {
  const [queryVec] = await this.embedding.embedBatch([query])

  const [semanticChunks, keywordHits] = await Promise.all([
    this.chunkRepo.semanticSearch(orgId, queryVec, fetch),        // pgvector <=> cosine
    this.keywordRepo.search(orgId, query, fetch).catch(() => []), // ES BM25; ES down → degrade
  ])

  // ⚠️ FUSE AT ITEM LEVEL. Semantic is chunk-level → dedupe to best chunk per item
  // first, so both lists rank the SAME identity (knowledgeItemId).
  const semanticItems = this.dedupeToItems(semanticChunks)
  const chunks = this.rrfMerge(semanticItems, keywordHits).slice(0, topK)

  // Best-effort RAG summary (circuit breaker inside): failure/open → null.
  const summary = summarize && chunks.length
    ? await this.summarizer.summarize(query, chunks).catch(() => null)
    : null
  return { chunks, summary: summary?.text ?? null, sources: summary?.sources ?? [] }
}

// RRF by knowledgeItemId: score = Σ 1/(k + rank), k=60. Keep a representative
// snippet per item (prefer the semantic chunk). Avoids the concat-then-find bug.
private rrfMerge(semantic: RankedItem[], keyword: KeywordHit[]): RankedItem[] {
  const scores = new Map<string, number>()
  const repr = new Map<string, { content: string; titleSnapshot: string }>()
  semantic.forEach((it, rank) => { addRrf(scores, it.knowledgeItemId, rank); repr.set(it.knowledgeItemId, it) })
  keyword.forEach((h, rank) => { addRrf(scores, h.knowledgeItemId, rank); if (!repr.has(h.knowledgeItemId)) repr.set(h.knowledgeItemId, h) })
  return [...scores.entries()].sort(([, a], [, b]) => b - a).map(([id, score]) => ({ knowledgeItemId: id, score, ...repr.get(id)! }))
}
```
> **Đã LIVE (Phase 4, 2026-07-02):** RRF fusion ở `SearchKnowledgeService`. `rank` bắt đầu từ 0 (`1/(60+rank)`). Smoke: keyword-exact → ES top, semantic → pgvector top, item ở CẢ hai list → điểm cao nhất (2×1/60).

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

  // Index ONE doc per ITEM (id = itemId), not per chunk — keyword hits are
  // item-level, matching the RRF fusion granularity. Upsert by id = idempotent.
  async indexItem(doc: IndexItemDoc): Promise<void> {
    await this.client.index({
      index: `knowledge-${doc.orgId}`,
      id: doc.knowledgeItemId,
      document: { orgId: doc.orgId, spaceId: doc.spaceId, title: doc.title, content: doc.content },
      refresh: 'wait_for', // searchable ≤1s, no forced global refresh
    })
  }
}
// search(): index-not-found (org chưa index) → catch statusCode 404 → return []
```

> **Per-tenant index** (`knowledge-{orgId}`) — isolation tự nhiên, không cần filter trong query.
> **Đã LIVE (Phase 4):** `ElasticsearchKeywordRepository` + `ElasticsearchClientService` (singleton, http+basic auth, security-on/TLS-off local). Indexing per-item trong `IndexKnowledgeHandler` (song song pgvector). ES down lúc index → handler throw → retry → DLQ (cả 2 store idempotent). ES down lúc search → degrade semantic-only.

---

## ⚠️ Gotchas

- **Circuit Breaker là bắt buộc** — không call Claude API trực tiếp. Search vẫn trả về kết quả khi AI down, chỉ không có summary.
- **pgvector HNSW index** phải được tạo qua raw SQL migration, không thể qua Prisma schema attributes.
- **Embedding dimensions**: theo provider (Cortex local `bge-base` → **768**). Cột `vector(N)` phải khớp; đổi provider/dim ⇒ migrate cột `embedding` + re-embed toàn bộ.
- **Elasticsearch index per tenant**: Xóa index khi org bị deleted. Đừng dùng shared index với filter — cross-tenant data risk.
- **Chunking trước embedding**: Không embed toàn bộ document — chunk trước, embed từng chunk.

---

## 🔗 Liên quan

- `directives/cqrs_pattern.md` — SearchKnowledgeQuery là Query handler
- `directives/multi_tenancy.md` — orgId isolation trong Elasticsearch + pgvector
- `directives/event_sourcing.md` — Knowledge indexing trigger có thể là Domain Event
- `docs/03_system_architecture_diagrams.md` — system data flow diagrams
