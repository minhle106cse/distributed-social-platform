export * from './errors/app-error.js'
export * from './errors/domain-error.js'
export * from './errors/application-error.js'
export * from './errors/infra-error.js'

export * from './http/response.js'
export * from './http/response.utils.js'

export * from './schemas/common.schema.js'

export * from './logger/index.js'

// Auth — system-level permission catalog (JWT claims, cross-service)
export * from './auth/system-permissions.js'

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
// `npm run proto:gen` after editing proto/org-provisioning.proto at repo root.
export * from './grpc/org-provisioning.js'
// gRPC — shared M2M auth convention (shared-secret metadata), reused by every
// internal gRPC server/client so the wire format can't drift between them.
export * from './grpc/internal-grpc-auth.js'
