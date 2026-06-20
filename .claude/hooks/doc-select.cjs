'use strict'

const msg = `
╔══════════════════════════════════════════════════════════════╗
║         ⚡ DOC-READING PROTOCOL — BẮT BUỘC TRƯỚC MỌI TASK  ║
╚══════════════════════════════════════════════════════════════╝

BƯỚC 1 — Luôn đọc trước (nếu chưa có trong context):
  → .ai/KNOWLEDGE_INDEX.md  ← toàn bộ project context, gotchas, rules

BƯỚC 2 — Chọn ĐÚNG theo loại task (không đọc thừa, không bỏ sót):

  🏗️  MODULE MỚI / FEATURE MỚI
      directives/cqrs_pattern.md           ← pipeline, middleware, POJO rules
      directives/folder_structure_sop.md   ← nơi đặt file, import rules
      directives/database_standard.md      ← naming, PK, soft delete, Prisma v7
      directives/zod_validation.md         ← schema location, NestJS vs Fastify
      directives/multi_tenancy.md          ← orgId isolation, tenant context (BẮT BUỘC nếu module có data per-org)
      docs/04_database_schema.md           ← nếu cần thiết kế schema mới

  🐛  BUG / DEBUG / LỖI BUILD
      .ai/memory/errors.jsonl              ← lỗi đã gặp + solution
      .ai/memory/gotchas.jsonl             ← framework/lib traps
      (grep keyword trước, đọc toàn file sau nếu cần)

  🔧  BOOTSTRAP / CONFIG / INIT SERVICE
      directives/microservice_architecture.md  ← checklist + gotchas
      directives/logging_standard.md           ← dual-log, shared-kernel utils

  🗄️  DATABASE / SCHEMA / MIGRATION
      directives/database_standard.md      ← Prisma v7 config, naming
      docs/04_database_schema.md           ← existing schema reference

  🧪  TESTING / QA
      directives/testing_standard.md
      directives/qa_standard.md

  🌐  API / HTTP LAYER / RESPONSE FORMAT
      directives/microservice_architecture.md
      directives/logging_standard.md       ← shared-kernel utilities bắt buộc
      directives/zod_validation.md

  🔄  REFACTOR / KIẾN TRÚC / DI
      directives/cqrs_pattern.md
      directives/folder_structure_sop.md
      .ai/memory/architecture.jsonl
      .ai/memory/conventions.jsonl

  💳  CREDIT / REPUTATION MODULE
      directives/event_sourcing.md         ← EventStore, OCC, projection, snapshot
      directives/cqrs_pattern.md

  🔍  AI / SEARCH / RAG
      directives/rag_ai_integration.md     ← Hybrid search, Circuit Breaker, pgvector
      directives/multi_tenancy.md          ← per-tenant Elasticsearch index

  📖  BUSINESS LOGIC / DOMAIN RULES
      docs/01_business_requirements.md
      docs/02_use_cases.md
      docs/10_security_rbac.md             ← nếu liên quan RBAC/multi-tenancy

BƯỚC 3 — Luôn search memory cho issues tương tự TRƯỚC khi debug:
  .ai/memory/errors.jsonl       → lỗi build/runtime
  .ai/memory/gotchas.jsonl      → framework traps
  .ai/memory/architecture.jsonl → quyết định kiến trúc trước đó

⛔ KHÔNG bắt đầu viết code khi chưa hoàn thành 3 bước trên.
`.trim()

process.stdout.write(JSON.stringify({ systemMessage: msg }))
