# SOP: RAG & AI Integration Standard

> ✅ **STATUS: LIVE in search-service (Phase 4, 2026-07-02, smoke-tested).** C1 semantic (pgvector embed-on-publish) + C2 hybrid (ES BM25 + RRF) + C3 RAG summary (Claude + circuit breaker). Consumer #2 (`KnowledgeIndexerConsumer`, group `search-service-indexer-group`). Outstanding: the happy-path summary needs a valid `ANTHROPIC_API_KEY`; search-service isn't versioned yet (waiting on the GitHub repo).

> [!NOTE]
> This directive defines how AI (RAG, Hybrid Search, Embeddings) is integrated into Cortex.
> It applies to **search-service** — the microservice owning `search_db` (pgvector), consuming `knowledge-events` (embed-on-publish), and exposing Search + AI Query. (It previously said "core-api"; split out along the microservice trajectory — Phase 4, see `.ai/plans/phase4-rag-search.plan.md`.)
>
> ⚠️ **Claude has NO embeddings API.** There is no `claude-embed-*` model; `messages.create` returns TEXT, not a vector. Embeddings MUST come from an external provider (self-hosted local / Voyage / OpenAI) behind `IEmbeddingService`. Claude is used only for **summarization** (§3 + RAG).

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

## 📜 The Mandatory Architecture

### 1. Embedding generation — a provider OTHER than Claude, behind `IEmbeddingService`

Claude does not generate embeddings. Use the `IEmbeddingService` port + an adapter to a real embedding provider. **The Cortex decision (Phase 4): self-hosted local** (free, no external key, launchable) — a small service in Docker (recommended: Text-Embeddings-Inference with `BAAI/bge-base-en-v1.5`, **dim 768**, or Ollama's `nomic-embed-text`). Swapping to Voyage/OpenAI = changing one adapter (a change of dimension ⇒ migrating the `vector` column).

```typescript
// search-service: application/ports/embedding.service.ts
export interface IEmbeddingService {
  embed(text: string): Promise<number[]>          // dim = EMBEDDING_DIM (768)
  embedBatch(texts: string[]): Promise<number[][]>
}

// search-service: infrastructure/embedding/http-embedding.service.ts
export class HttpEmbeddingService implements IEmbeddingService {
  // POST EMBEDDING_SERVICE_URL/embed { inputs } → number[][]. Does NOT call Anthropic.
  async embedBatch(texts: string[]): Promise<number[][]> { /* fetch → vectors */ }
}
```

> **The embedding model**: an external provider (local `bge-base-en-v1.5`, dim 768). **NOT Claude.**
> **The RAG summarization model (§3)**: `claude-opus-4-8` (the default, most capable) or `claude-sonnet-4-6` (cheap, high volume). Use the alias — **NOT a date suffix**. Models 4.6+: `thinking:{type:'adaptive'}`, NOT `budget_tokens`.

---

### 2. Database schema — pgvector

```prisma
// The pgvector extension must be enabled in prisma/migrations/
// CREATE EXTENSION IF NOT EXISTS vector;

// ⬇️ Actual (search-service owns search_db). NO relation to KnowledgeItem — that
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

**The migration creating the HNSW index** (must be run manually after generate):
```sql
CREATE INDEX knowledge_chunks_embedding_idx
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

### 3. Circuit Breaker — mandatory for every AI call

Every call to the Claude/Gemini API must go through a Circuit Breaker to avoid cascading failure when the AI service is down.

> **Update (2026-07-12):** `CircuitBreaker` is no longer a search-service-private class — it moved into `@distributed-social-platform/shared-kernel` (`src/resilience/circuit-breaker.ts`) because it is now shared between AI calls (search-service) and Elasticsearch/Ollama/gRPC (core-api). Import it from shared-kernel; don't rewrite it locally. Full detail + audit + rules: `resilience_patterns.md §3.1`.

```typescript
import { CircuitBreaker } from '@distributed-social-platform/shared-kernel'

// ClaudeSummarizer/GeminiSummarizer — each adapter holds its own instance
this.breaker = new CircuitBreaker(logger) // threshold=5, timeoutMs=60_000 (defaults)

async summarize(query: string, context: SummaryContext[]): Promise<RagSummary> {
  return this.breaker.execute(async () => {
    // the real Claude/Gemini call goes here
  })
}
```

---

### 4. Hybrid Search — RRF Merge

**Why search-service has no CommandBus/QueryBus — CORRECTED 2026-07-25; the previous version reasoned wrongly:** the first version here argued "there's only 1 query and 1 write, so a bus isn't worth building" — **wrong, it was pointed out and fixed.** CommandBus/QueryBus is tied to HTTP dispatch (a command from a specific HTTP route), and is NOT a precondition for consistency. The real reason: search-service **has no write that is an HTTP Command** — its only write is a Kafka event (`IndexKnowledgeHandler implements IIntegrationEventHandler`), and event dispatch does NOT go through the CommandBus but through `EventRouter` (shared-kernel) — a `event.type`-based routing mechanism, transport-agnostic, SHARED with core-api/notification-service, not something specific to search-service.

**So is the setup consistent? YES — meeting the requirement that "the setup must be the same regardless of what's used":** `EventRouter.route()` (2026-07-25) now logs dispatch itself (`info` when routing starts + `info`+`durationMs` when it finishes) — **right at this shared point**, rather than hand-written separately in `IndexKnowledgeHandler`. That means search-service, notification-service, and any future consumer using `EventRouter` (including worker-service once it gains its first consumer) all get identical dispatch logging automatically — the same spirit as the CommandBus's `LoggingMiddleware`, differing only in placement (at `EventRouter`, not at a separate bus for search-service). A real bug found while fixing this: `notification-service`'s 3 event handlers (`item-published`, `follow-removed`, `follow-created`) had **no business-layer logging at all** — not because "there's no bus" but because logging had previously been hand-written per handler (search-service) or forgotten entirely (notification-service), never existing at the shared layer. It does now.

**What search-service GENUINELY doesn't have, and correctly doesn't need:** CommandBus/QueryBus — because no HTTP route dispatches through them (`search()` is called directly via NestJS DI; that is an HTTP-layer decision, not a logging-layer one). This is NOT a reason for the logging/dispatch setup to differ — two separate concerns, which the previous version wrongly conflated.

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
> **Already LIVE (Phase 4, 2026-07-02):** RRF fusion in `SearchKnowledgeService`. `rank` starts at 0 (`1/(60+rank)`). Smoke test: keyword-exact → ES on top, semantic → pgvector on top, an item in BOTH lists → the highest score (2×1/60).

---

### 5. Chunking strategy

When indexing a KnowledgeItem:

```typescript
// infrastructure/ai/text-chunker.ts
export class TextChunker {
  // Fixed-size with overlap, to preserve continuous context
  chunk(text: string, chunkSize = 512, overlap = 64): string[] {
    const words = text.split(/\s+/)
    const chunks: string[] = []
    let start = 0

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length)
      chunks.push(words.slice(start, end).join(' '))
      start += chunkSize - overlap  // slide the window with overlap
    }
    return chunks
  }
}
```

> Chunk size 512 tokens (≈ 400 words) with a 64-token overlap. Adjust if the content domain is code (chunk on function boundaries rather than word count).

---

### 6. Elasticsearch integration

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
            fields: ['title^3', 'content'],  // boost the title
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
// search(): index-not-found (the org hasn't been indexed) → catch statusCode 404 → return []
```

> **A per-tenant index** (`knowledge-{orgId}`) — natural isolation, with no need for a filter in the query.
> **Already LIVE (Phase 4):** `ElasticsearchKeywordRepository` + `ElasticsearchClientService` (a singleton, http+basic auth, security-on/TLS-off locally). Per-item indexing in `IndexKnowledgeHandler` (in parallel with pgvector). ES down during indexing → the handler throws → retry → DLQ (both stores are idempotent). ES down during search → degrade to semantic-only.

---

## ⚠️ Gotchas

- **The Circuit Breaker is mandatory** — never call the Claude API directly. Search still returns results when the AI is down, only without a summary.
- **The pgvector HNSW index** must be created through a raw SQL migration; it cannot be expressed as Prisma schema attributes.
- **Embedding dimensions**: determined by the provider (Cortex local `bge-base` → **768**). The `vector(N)` column must match; changing provider/dimension ⇒ migrate the `embedding` column + re-embed everything.
- **A per-tenant Elasticsearch index**: delete the index when an org is deleted. Don't use a shared index with a filter — a cross-tenant data risk.
- **Chunk before embedding**: never embed a whole document — chunk first, embed each chunk.

---

## 🔗 Related

- `directives/cqrs_pattern.md` — SearchKnowledgeQuery is a Query handler
- `directives/multi_tenancy.md` — orgId isolation in Elasticsearch + pgvector
- `directives/event_sourcing.md` — the knowledge indexing trigger may be a Domain Event
- `docs/03_system_architecture_diagrams.md` — system data-flow diagrams
