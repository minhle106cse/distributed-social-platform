/**
 * SINGLE SOURCE OF TRUTH for every log `context` field value in the system —
 * shared AND app-local. (Rule tightened 2026-07-25 — read this before adding
 * any new logging call site.)
 *
 * ⛔ FORBIDDEN: relying on `@InjectPinoLogger(ClassName.name)`'s auto-injected
 * class name, or Fastify's `logger.child({ context: ClassName.name })`, as
 * the ACTUAL `context` value that ends up in a log line. Both were found in
 * this codebase — reason it's banned, not just "not preferred":
 *   1. NestJS/`nestjs-pino`: `PinoLogger.call()` does
 *      `Object.assign({context: this.context}, firstArg)` — if a log call
 *      ALSO passes an explicit `context` in its payload (the normal case for
 *      any cross-service boundary), the explicit one silently wins and the
 *      class-name binding becomes 100% dead code that still LOOKS load-bearing.
 *   2. auth-service (plain Fastify + real `pino`): `logger.child({context: X})`
 *      followed by a call that ALSO passes `{context: Y}` produces a JSON
 *      log line with the KEY `context` written TWICE
 *      (`"context":"X","context":"Y"`) — technically malformed JSON, correct
 *      only by accident because most parsers take the last occurrence.
 *      Verified both failure modes with real pino/nestjs-pino instances,
 *      2026-07-25 — not hypothetical.
 * The fix in both cases is the same: every log call site passes `context`
 * EXPLICITLY from this file, full stop. `@InjectPinoLogger(SomeToken)` is
 * still required as a DI-token argument (NestJS plumbing, unrelated to what
 * ends up in the log) — just never treat that argument as documentation of
 * the actual context; the explicit field below is the only truth.
 *
 * ✅ REQUIRED: if a class needs a context value that doesn't exist yet, ADD IT
 * HERE (even if only one service uses it today) — never invent an implicit
 * one. This registry is the one place a human or AI reads to know every
 * context string that can appear in a log line, service-specific or shared.
 */
export const LogContext = {
  // CQRS pipeline — shared-kernel middlewares, identical in every service
  COMMAND_BUS: 'CommandBus',
  QUERY_BUS: 'QueryBus',
  RETRY: 'RetryMiddleware',
  TRANSACTION: 'TransactionMiddleware',
  // In-process domain event dispatcher (shared-kernel EventBus)
  EVENT_BUS: 'EventBus',
  // Cross-service integration-event dispatch (shared-kernel EventRouter) —
  // also used by handler-specific detail logs layered on top of it (e.g.
  // search-service's IndexKnowledgeHandler) and by DeadLetterProducer.
  EVENT_ROUTER: 'EventRouter',
  // HTTP transport layer (NestJS interceptor / Fastify hook)
  HTTP: 'HttpLayer',
  // gRPC transport layer — per-RPC handler logs (success+failure) AND the
  // server bootstrap listen/fail log (GrpcServerBootstrap / startGrpcServer).
  GRPC: 'GrpcLayer',
  // Unhandled exception filter / global error handler
  EXCEPTION: 'ExceptionFilter',
  // Security-relevant events (login, refresh-token reuse, role changes...) —
  // same operational logger as everything else, tagged for filterability.
  // See audit.ts (logAudit/AuditEvent).
  AUDIT: 'AuditLog',
  // shared-kernel CircuitBreaker (packages/shared-kernel/src/resilience) —
  // every `*Caller` wrapper (Claude/Gemini/Ollama/Elasticsearch/gRPC callers)
  // logs through this ONE class, so this ONE context covers all of them.
  CIRCUIT_BREAKER: 'CircuitBreaker',
  // Transactional Outbox pipeline (core-api) — PollingPublisherService
  // (claim+publish), OutboxReaperService (stale-claim recovery),
  // KafkaProducerService (the producer PollingPublisherService publishes
  // through). One context for the whole "DB row → Kafka topic" pipeline —
  // querying "outbox" should show every phase together, not 3 fragments.
  OUTBOX: 'Outbox',
  // HTTP idempotency-key enforcement (core-api) — IdempotencyInterceptor
  // (claim/replay/conflict) + IdempotencyCleanupService (nightly TTL purge).
  IDEMPOTENCY: 'Idempotency',
  // Process-level start/shutdown (main.ts in every service) — not a request/
  // dispatch boundary, but still a real log source, so it gets a real context
  // like everything else (2026-07-25 audit — was previously untagged).
  LIFECYCLE: 'Lifecycle',
} as const

export type LogContextValue = (typeof LogContext)[keyof typeof LogContext]
