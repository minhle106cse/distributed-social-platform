export * from './errors/app-error.js'
export * from './errors/domain-error.js'
export * from './errors/application-error.js'
export * from './errors/infra-error.js'

export * from './http/response.js'
export * from './http/response.utils.js'

export * from './schemas/common.schema.js'

export * from './logger/index.js'

// Resilience — generic Circuit Breaker for any unreliable external call
export * from './resilience/circuit-breaker.js'

// Auth — system-level permission catalog (JWT claims, cross-service)
export * from './auth/system-permissions.js'
// Auth — org-level permission catalog (RBAC codes, cross-service — core-api
// owns/administers, search-service and notification-service verify remotely)
export * from './auth/org-permissions.js'

// CQRS
export * from './cqrs/index.js'

// Database abstractions
export * from './database/transaction-manager.interface.js'
export * from './database/transaction.context.js'

// Event vocabulary — WHAT happened (transport-agnostic contracts)
export * from './events/index.js'

// Messaging — HOW events travel: transport, routing, publish/dispatch (Kafka + queue)
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
