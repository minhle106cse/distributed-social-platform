export * from './errors/app-error.js'
export * from './errors/application-error.js'
export * from './errors/infra-error.js'

export * from './http/response.js'
export * from './http/response.utils.js'

export * from './schemas/common.schema.js'

export * from './logger/index.js'
export * from './logger/audit.js'

// Resilience — generic Circuit Breaker for any unreliable external call
export * from './resilience/circuit-breaker.js'
// Resilience — shared Prisma transient-error classification + observability,
// and the generic `transient` marker a domain error can opt into
export * from './resilience/prisma-transient-error.js'

// Auth — system-level permission catalog (JWT claims, cross-service)
export * from './auth/system-permissions.js'
// Auth — org-level permission catalog (RBAC codes, cross-service — core-api
// owns/administers, search-service and notification-service verify remotely)
export * from './auth/org-permissions.js'

// CQRS
export * from './cqrs/index.js'

// Database abstractions — Unit of Work as a value (ADR-0001)
export * from './database/tx-scope.js'
export * from './database/tx.error.js'
export * from './database/abstract-tx-runner.js'
// `transaction.context.ts` (getTx/runInTransaction) is intentionally NOT exported —
// AbstractTxRunner is its only consumer repo-wide. Re-exporting it would put the
// exact ambient-transaction-fallback primitive ADR-0001 exists to stop using back
// on the public surface for any repository to reach for directly.

// Tracing — W3C traceparent propagation across HTTP/gRPC/Kafka boundaries.
// Named (not `export *`) — `traceLogFields` is deliberately excluded: since
// logger/index.ts's traceLogMethodHook applies it to every log call
// automatically, no consumer outside shared-kernel has a real reason to call
// it directly; keeping it off the public surface matches the audit already
// done for the other internal-only helpers in this module.
export {
  type TraceContext,
  runWithTraceContext,
  startTraceContext,
  getCurrentTraceparent,
} from './tracing/trace-context.js'

// Messaging — event vocabulary (WHAT happened) + HOW events travel: transport,
// routing, publish/dispatch (Kafka + queue). events/ moved inside messaging/
// 2026-08-01 (see messaging/index.ts's own comment) — this one export covers both.
export * from './messaging/index.js'

// gRPC — generated (ts-proto) typed contracts for internal service-to-service
// calls (e.g. core-api -> auth-service org provisioning). Regenerate via
// `npm run proto:gen` after editing any proto/*.proto file at repo root.
export * from './grpc/org-provisioning.js'
// gRPC — core-api -> search-service (and any other service without its own
// Membership table) membership verification, protects against a caller
// spoofing X-Org-Id (resilience_patterns.md / IDOR fix 2026-07-19). Named
// (not `export *`) — ts-proto re-emits DeepPartial/Exact/MessageFns/
// protobufPackage per generated file, colliding with org-provisioning.js's
// copies of the same helper names.
export {
  type CheckMembershipRequest,
  type CheckMembershipResponse,
  MembershipVerificationService,
  type MembershipVerificationServer,
  MembershipVerificationClient,
} from './grpc/membership.js'
// gRPC — shared M2M auth convention (shared-secret metadata), reused by every
// internal gRPC server/client so the wire format can't drift between them.
export * from './grpc/internal-grpc-auth.js'
// gRPC — W3C traceparent propagation over metadata (same convention as above)
export * from './grpc/trace-propagation.js'
