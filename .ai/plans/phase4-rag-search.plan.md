# PLAN: Phase 4 — AI Search & Discovery (RAG + Hybrid)

> **Cho session mới.** Đọc trọn file + `directives/rag_ai_integration.md` (⚠️ có lỗi factual, xem §0) + `directives/eventing_patterns.md` + `directives/idempotency_strategy.md` trước khi code. Làm **C1 → C2 → C3** theo thứ tự. Không nhảy cóc.
> Ngày lập: 2026-07-02. Duyệt hướng (user): embeddings = **self-hosted local**; search = **service riêng (consumer #2)**.

## 🚦 TRẠNG THÁI (2026-07-02)
- **C1.0 ✅ DONE + committed** (root `e71be9b`): directive §1 fixed, `body` vào KnowledgePublished payload (shared-kernel + core-api `6742b35`), docker-compose embedding (Ollama nomic-embed-text dim 768), init-dbs `search_db`, `.env`.
- **C1.1–C1.5 ✅ CODE DONE + SMOKE-TESTED END-TO-END** (chưa commit — chờ tạo GitHub repo cho submodule). search-service bootstrap (mirror notification), `KnowledgeChunk` schema (`vector(768)`) + `prisma db push search_db` ✅ + **HNSW index** raw SQL ✅. `IEmbeddingService`/`HttpEmbeddingService` (Ollama `/api/embed`), `TextChunker`, `IndexKnowledgeHandler` (`idempotency='natural-key'`), `KnowledgeIndexerConsumer` (group riêng + DLQ + retry), `PrismaSearchChunkRepository` (raw pgvector insert + `<=>` cosine), `POST /api/v1/search` (JWT + X-Org-Id). **`turbo typecheck lint` = 3/3 xanh.**
- **✅ SMOKE TEST (2026-07-02):** boot search-service (health ok, consumer group `search-service-indexer-group` LAG 0) → bơm 3 KnowledgePublished (Kafka/Postgres/React) → 3 chunks ghi với `vector_dims=768` → `POST /search "scale event streaming consumers"` xếp **Kafka item top (score 0.625)**, Postgres kế (semantic đúng, không cần trùng keyword). Phủ định: no-JWT=401, org khác=0 (tenant isolation), thiếu X-Org-Id=400. **Bug tìm thấy khi smoke:** `prisma.service.ts` copy sót `NOTIFICATION_DATABASE_URL` → sửa `SEARCH_DATABASE_URL` (đã fix). Gotcha: boot service nhiều lần → consumer group churn "coordinator not aware" → phải `kafka-consumer-groups --delete` + boot 1 bản + chờ stable rồi mới produce.
- **C2 ✅ CODE DONE + SMOKE-TESTED** (working tree, chưa commit): `@elastic/elasticsearch` dep + `ElasticsearchClientService` (singleton, http+basic auth), `IKeywordSearchRepository`/`ElasticsearchKeywordRepository` (per-tenant index `knowledge-{orgId}`, BM25 `multi_match` title^3+content, fuzziness AUTO, index-not-found→[]). `IndexKnowledgeHandler` ghi CẢ pgvector + ES (ES fail→retry→DLQ, cả 2 idempotent). `SearchKnowledgeService` = **RRF fusion** (k=60): semantic (pgvector, dedup chunk→item) ‖ keyword (ES) chạy `Promise.all`, ES down→`.catch`→degrade semantic-only. `.env` + config: ELASTICSEARCH_URL/ELASTIC_USERNAME/ELASTIC_PASSWORD. **`turbo typecheck lint` = 3/3 xanh.**
- **✅ SMOKE TEST C2 (2026-07-02):** 3 item index vào cả pgvector (3 chunks) + ES (3 docs). (1) keyword-exact `autovacuum_vacuum_scale_factor` → **Postgres top** (BM25 bắt token hiếm); (2) semantic `making many workers share a workload` (không trùng keyword) → **Kafka top** (pgvector); (3) hybrid `react component state` → **React top**. RRF score top=0.0333=1/60+1/60 (item xếp #0 ở CẢ hai list). **Degrade:** `docker stop dsp-elasticsearch` → search vẫn 201 + 3 kết quả semantic-only, KHÔNG 500.
- **C3 ✅ CODE DONE + SMOKE-TESTED** (working tree, CHƯA commit theo yêu cầu): `@anthropic-ai/sdk@0.109.1`, `CircuitBreaker` (infra/ai — threshold 5, timeout 60s, closed/open/half-open), `ISummarizer`/`ClaudeSummarizer` (Claude `RAG_MODEL=claude-opus-4-8`, system prompt cite [n], breaker bọc mọi call). `SearchKnowledgeService`: sau RRF → `summarizer.summarize(...).catch(()=>null)` → `{ chunks, summary, sources }`. Schema thêm `summarize` flag (default true). env: `ANTHROPIC_API_KEY` (optional, rỗng OK), `RAG_MODEL`. **`turbo typecheck lint` = 3/3 xanh.**
- **✅ SMOKE TEST C3 (2026-07-02):** key rỗng → degrade path: `summarize:true` → search **201 + chunks, summary:null** (KHÔNG 500); `summarize:false` → skip. Fire 6 request → log `AI call failed`×5 → **`Circuit breaker OPEN`** → fail-fast.
- **✅ HAPPY-PATH SUMMARY THẬT (2026-07-02, qua Gemini):** thêm `GeminiSummarizer` (raw fetch Gemini REST, cùng `ISummarizer` port + cùng CircuitBreaker) + công tắc `SUMMARIZER_PROVIDER=claude|gemini` (module `useFactory`). Đây là minh chứng port: đổi LLM = 1 adapter + 1 factory line, service/handler/RRF KHÔNG đổi. Test thật: query "how do kafka consumer groups scale" → summary grounded cite `[1]` đúng nguồn Kafka + sources. ⚠️ `gemini-2.0-flash` đã EOL → dùng `gemini-2.5-flash`. Key trong `.env` (local, gitignored). (Claude adapter vẫn là default trong CODE; Claude happy-path chưa test vì không có Anthropic key.)
- **CÒN LẠI:** (a) tạo GitHub repo `distributed-social-platform_search-service` → init/push/`git submodule add` → commit toàn bộ C1+C2+C3 (code + `prisma.service` fix đang ở working tree, chưa versioned); (b) test summary thật khi có `ANTHROPIC_API_KEY`. **→ Phase 4 (C1+C2+C3) CODE-COMPLETE, smoke-tested (trừ happy-path summary cần key).**

---

## 0. ⚠️ SỬA LỖI DIRECTIVE TRƯỚC KHI CODE (bắt buộc)

`directives/rag_ai_integration.md §1 "Embedding Generation — Claude API"` **SAI SỰ THẬT**:
- **Claude/Anthropic KHÔNG có embeddings API.** Không có model `claude-embed-*`. Gọi `messages.create({max_tokens:1})` trả **text sinh ra**, KHÔNG phải vector — đoạn code đó vô nghĩa.
- Model ID `claude-haiku-4-5-20251001` sai kiểu (date-suffix) — alias đúng là `claude-haiku-4-5`.

**Việc phải làm ở C1.0:** viết lại §1 directive → embeddings qua `IEmbeddingService` (provider **ngoài** Claude). Model Claude chỉ dùng cho **summarization** (§C3), ID đúng: `claude-opus-4-8` (default, mạnh nhất) hoặc `claude-sonnet-4-6` (rẻ hơn, hợp volume cao). **KHÔNG** date-suffix.

---

## 1. QUYẾT ĐỊNH KIẾN TRÚC ĐÃ CHỐT

1. **Embeddings = self-hosted local**, đứng sau `IEmbeddingService` (port). Provider cụ thể: một service nhỏ trong Docker (khuyến nghị `sentence-transformers BAAI/bge-base-en-v1.5` **dim 768**, hoặc Ollama `nomic-embed-text` dim 768). **`EMBEDDING_DIM=768`** → cột `vector(768)`. Miễn phí, không key ngoài, launchable. Swap sang Voyage/OpenAI sau = đổi 1 adapter + re-embed (đổi dim = migrate cột).
2. **search-service MỚI** own `search_db` (pgvector), là **consumer THẬT #2**: subscribe `knowledge-events` → **embed-on-publish** → lưu chunks+vector. Mirror `notification-service`, tái dùng backbone đã hardened, giữ core-api gọn. → directive `rag_ai_integration.md` viết "áp dụng core-api" đã **lỗi thời** (viết trước quyết định microservice trajectory) — cập nhật ở After-Task.
3. **Nội dung để index đến từ đâu:** search-service own-DB, KHÔNG join `core_db` (luật). Payload `KnowledgePublished` hiện tại **THIẾU body** (`{itemId,orgId,spaceId,type,title,createdByUserId}`). → **C1.0 prereq:** thêm `body` vào payload (snapshot point-in-time lúc publish, đúng triết lý snapshot). ⚠️ Event to ra (body lớn). **Scale path (ghi, chưa làm):** Claim-Check EIP — body vào object store, event mang pointer. MVP: nhét body vào event.
4. **Auth `POST /search` = JWT + X-Org-Id, KHÔNG OrgGuard** (search-service không có memberships — giống notification-service). Lọc `orgId` mọi query (tenant-safe).
5. **Consumer idempotency:** re-publish cùng item → re-index. `@@unique([itemId, chunkIndex])` + upsert HOẶC delete-by-itemId-rồi-createMany trong 1 tx. Handler khai `readonly idempotency = 'natural-key'` (bắt buộc, xem `idempotency_strategy.md`).
6. **RAG summarization degrade mềm:** Circuit Breaker quanh Claude; circuit open → search vẫn trả chunks, chỉ thiếu `summary` (search KHÔNG chết theo AI).

---

## 2. BỐI CẢNH

Cortex = B2B knowledge hub; **RAG/Hybrid Search là differentiator** (§ product hiện 0%). Backbone event đã LIVE + hardened (outbox HA, DLQ, idempotency enforce). notification-service = consumer #1 (own-DB, projection từ event). Phase 4 = consumer #2 + đường đọc AI.

**SOP đọc trước khi code:** `rag_ai_integration.md` (§2 pgvector schema, §3 circuit breaker, §4 RRF, §5 chunking, §6 ES — nhưng §1 SAI, xem §0), `eventing_patterns.md` (§4 consumer/DLQ/idempotency), `idempotency_strategy.md`, `microservice_architecture.md` (bootstrap), `database_standard.md` (pgvector + prisma.config), `multi_tenancy.md`.

---

## MILESTONE C1 — Semantic search end-to-end (prove RAG loop)

Mục tiêu: `publish knowledge → knowledge-events → search-service embed+index → POST /search (semantic) trả kết quả liên quan`. Chưa cần ES, chưa cần Claude.

### C1.0 — Prereq (shared-kernel + core-api + docker + directive)
- **Sửa `rag_ai_integration.md §1`** (xem §0): bỏ Claude-embedding, dùng `IEmbeddingService` + provider local + model ID đúng.
- **shared-kernel:** thêm `body: string` vào `KnowledgePublishedPayload` (`definitions/knowledge-published.event.ts`). Rebuild dist.
- **core-api `publish-knowledge.handler`:** truyền `body: item.body` (hoặc field content thật của KnowledgeItem) vào `payload`. Kiểm tra entity KnowledgeItem có field body/content — dùng đúng tên.
- **docker-compose:** thêm embedding service (bge/ollama) + `search_db` (dùng chung Postgres instance 15432, DB mới; cần pgvector — image `pgvector/pgvector` hoặc CREATE EXTENSION). `.env`: `EMBEDDING_SERVICE_URL`, `EMBEDDING_DIM=768`, `SEARCH_DATABASE_URL`, `KAFKA_SEARCH_INDEXER_GROUP=search-service-indexer-group`.

### C1.1 — Bootstrap search-service (mirror notification-service)
- Copy scaffold notification-service (đã chuẩn hoá core-api): package.json/tsconfig/tsconfig.build/eslint (boundary rules)/nest-cli/prisma.config/.prettierrc/.gitignore. Đổi tên, port `4004`.
- `config/` (env.validation + env.config): `SEARCH_DATABASE_URL`, `JWT_PUBLIC_KEY`, `KAFKA_BROKERS/CLIENT_ID`, `KAFKA_SEARCH_INDEXER_GROUP`, `EMBEDDING_SERVICE_URL`, `EMBEDDING_DIM`, `KAFKA_CONSUMER_MAX_RETRIES/RETRY_BACKOFF_MS`.
- Bootstrap Fastify (server.ts genReqId + enableShutdownHooks), PrismaService (pgvector), KafkaModule, health/metrics controller. **Logger = `@InjectPinoLogger` (child), KHÔNG `createLogger` trong feature code** (xem `logging_standard.md` — bài học notification-service).
- **Tạo repo GitHub + submodule** (như notification-service): git init → push → `git submodule add` vào root.

### C1.2 — Schema `search_db` (pgvector)
```prisma
model KnowledgeChunk {
  id              String @id @default(uuid())
  knowledgeItemId String @map("knowledge_item_id")
  orgId           String @map("org_id")
  spaceId         String @map("space_id")
  chunkIndex      Int    @map("chunk_index")
  content         String
  titleSnapshot   String @map("title_snapshot")
  embedding       Unsupported("vector(768)")?
  createdAt       DateTime @default(now()) @map("created_at")
  @@unique([knowledgeItemId, chunkIndex])
  @@index([orgId])
  @@map("knowledge_chunks")
}
```
- `CREATE EXTENSION IF NOT EXISTS vector;` + `prisma db push search_db`.
- HNSW index qua **raw SQL migration** (Prisma không làm được qua schema): `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);`. Chạy thủ công + verify trên DB thật (như outbox SQL).

### C1.3 — Embedding adapter + chunker
- `IEmbeddingService` (application port): `embed(text): Promise<number[]>`, `embedBatch(texts): Promise<number[][]>`.
- `HttpEmbeddingService` (infra): POST tới `EMBEDDING_SERVICE_URL`, trả vector 768. Wrap Circuit Breaker (tái dùng ở C3) — nhưng indexing fail thì để consumer retry/DLQ, KHÔNG nuốt.
- `TextChunker` (infra): fixed-size + overlap (512 tokens ≈ 400 words, overlap 64) — theo `rag_ai_integration.md §5`. Chunk `title + "\n" + body`.

### C1.4 — Consumer + indexer handler (consumer #2)
- `KnowledgeIndexerConsumer` (kafkajs raw, group `KAFKA_SEARCH_INDEXER_GROUP` — **group RIÊNG**, khác notification, để 2 concern fan-out độc lập): subscribe `knowledge-events`. Dùng pattern notification-service: bounded retry → DLQ, LUÔN commit. `@InjectPinoLogger`.
- `IndexKnowledgeHandler implements IIntegrationEventHandler<KnowledgePublishedPayload>`, `readonly eventType = KNOWLEDGE_PUBLISHED`, `readonly idempotency = 'natural-key'`. `handle()`: chunk(title+body) → `embedBatch(chunks)` → **delete chunks WHERE itemId (trong tx) + createMany** (re-index sạch khi re-publish) → tenant-safe (orgId từ payload). Prisma raw cho ghi vector (`INSERT ... $1::vector`).
- `ISearchChunkRepository` + `PrismaSearchChunkRepository`: `replaceForItem(itemId, rows)` (delete+insert tx), `semanticSearch(orgId, queryVec, topK)` (dùng C1.5).

### C1.5 — Read API `POST /search` (semantic-only)
- `@UseGuards(JwtAuthGuard)`, body `{ query: string, topK?: number }` (Zod). `orgId` từ `X-Org-Id`.
- `SearchKnowledgeHandler`: `embed(query)` → `semanticSearch(orgId, vec, topK)` = raw SQL `ORDER BY embedding <=> $1::vector LIMIT k` (cosine distance) `WHERE org_id = $2`. Trả `{ chunks: [{itemId, content, titleSnapshot, score}] }`.

### C1 — Acceptance
- [ ] `turbo build typecheck lint` search-service + shared-kernel + core-api xanh.
- [ ] Boot: publish 2-3 knowledge items khác nội dung → search-service ghi chunks (embedding NOT NULL).
- [ ] `POST /search {query}` (JWT) trả item liên quan **nhất** đứng đầu (semantic, không cần trùng keyword).
- [ ] Re-publish 1 item (đổi body) → chunks thay mới, không nhân đôi (`@@unique[itemId,chunkIndex]`).
- [ ] Multi-tenant: item org khác không lọt kết quả.
- [ ] Consumer group `search-service-indexer-group` LAG 0; DLQ hoạt động (bơm poison → `<topic>.DLQ`).

---

## MILESTONE C2 — Hybrid (pgvector + Elasticsearch + RRF)

- **docker-compose:** thêm Elasticsearch (đã có trong infra plan?). `.env`: `ELASTICSEARCH_URL`.
- **Index song song:** `IndexKnowledgeHandler` ghi CẢ pgvector CHUNK + ES doc (per-tenant index `knowledge-{orgId}` theo `rag_ai_integration.md §6`, hoặc shared index + filter orgId — chốt: per-tenant index, isolation tự nhiên). Ghi 2 store trong handler; ES fail → retry/DLQ (KHÔNG để pgvector ghi mà ES rớt âm thầm — hoặc tách concern nếu cần).
- **`IKeywordSearchRepository` + `ElasticsearchRepository`:** BM25 `multi_match` (title^3, content), fuzziness AUTO.
- **RRF merge** (`rag_ai_integration.md §4`): `score = Σ 1/(k + rank_i)`, k=60. `SearchKnowledgeHandler` chạy song song semantic + keyword (`Promise.all`) → `rrfMerge` → top-K.

### C2 — Acceptance
- [ ] Query trùng keyword chính xác → ES kéo lên; query diễn giải khác từ → pgvector kéo lên; RRF trộn hợp lý.
- [ ] ES down → search vẫn trả (degrade về semantic-only) HOẶC ngược lại — nêu rõ hành vi degrade.
- [ ] Per-tenant ES index; xoá index khi org xoá (ghi TODO nếu chưa có luồng xoá org).

---

## MILESTONE C3 — RAG summarization (Claude + Circuit Breaker)

- **Anthropic SDK** (`@anthropic-ai/sdk`) trong search-service infra. `.env`: `ANTHROPIC_API_KEY`, `RAG_MODEL=claude-opus-4-8` (default; user có thể đổi `claude-sonnet-4-6` cho rẻ). ⚠️ model 4.6+: `thinking:{type:'adaptive'}`, KHÔNG `budget_tokens`; stream nếu `max_tokens` lớn.
- **`ISummarizer` + `ClaudeSummarizer`** (infra): dựng prompt từ query + top-K chunks → `messages.create({ model: RAG_MODEL, ... })` → trả summary + cite sources (itemId).
- **Circuit Breaker BẮT BUỘC** (`rag_ai_integration.md §3`): quanh MỌI call Claude. Open → `summarize` throw ServiceUnavailable → `SearchKnowledgeHandler` `.catch(() => null)` → trả `{ chunks, summary: null, sources }`. **Search KHÔNG chết theo AI.**
- Response cuối: `{ chunks, summary, sources }`.

### C3 — Acceptance
- [ ] `POST /search` trả summary tổng hợp từ top-K, có sources (itemId).
- [ ] Ngắt Claude (sai key/timeout) → circuit mở sau N fail → search vẫn trả chunks, `summary=null`, KHÔNG 500.
- [ ] Circuit half-open phục hồi khi Claude trở lại.

---

## SAU KHI XONG (After-Task Protocol — tự làm)
- `directives/rag_ai_integration.md`: sửa §1 (embeddings), cập nhật "áp dụng core-api" → "search-service (consumer #2, own search_db)"; model ID đúng; RRF/CB/chunking giữ.
- `.ai/PROJECT_STATUS.md` + `KNOWLEDGE_INDEX.md`: Phase 4 trạng thái, thêm search-service vào §Services + auto-detect module map; overall %.
- `.ai/memory/architecture.jsonl`: "consumer #2 = search-service own-DB; embed-on-publish; Claude KHÔNG có embeddings API (dùng local provider sau IEmbeddingService); hybrid RRF; CB degrade mềm".
- `.ai/memory/gotchas.jsonl`: "Claude không có embeddings endpoint — directive cũ sai".
- `eventing_patterns.md §4.2`: thêm search-service vào danh sách consumer LIVE (group riêng, fan-out độc lập với notification).

## CẠM BẪY ĐÃ BIẾT (từ các phase trước)
- shared-kernel sửa xong PHẢI rebuild dist (`turbo build --filter=shared-kernel`) + restart TS server, nếu không IDE đỏ dù CLI xanh.
- Git Bash Windows: `docker exec psql` cần `MSYS_NO_PATHCONV=1`. Tạo DB: `psql -U root -d postgres`.
- pgvector: HNSW index KHÔNG tạo qua Prisma schema → raw SQL, verify trên DB thật.
- Logger: `@InjectPinoLogger(Class.name)` (child), CẤM `createLogger` trong feature code (bài học notification-service).
- Handler idempotency: field `readonly idempotency` BẮT BUỘC (compile-time), `EventRouter.register` chặn `'none'`.
- Consumer group RIÊNG per concern (search ≠ notification) → fan-out độc lập; 2 consumer chung group = chia partition (sai).
- Model Claude: dùng alias KHÔNG date-suffix; embeddings KHÔNG phải Claude.
