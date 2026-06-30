export * from './errors/app-error.js'
export * from './errors/domain-error.js'
export * from './errors/application-error.js'
export * from './errors/infra-error.js'

export * from './http/response.js'
export * from './http/response.utils.js'

export * from './schemas/common.schema.js'

export * from './logger/index.js'

// CQRS
export * from './cqrs/index.js'

// Database abstractions
export * from './database/transaction-manager.interface.js'
export * from './database/transaction.context.js'

// Event vocabulary — WHAT happened (transport-agnostic contracts)
export * from './events/index.js'

// Messaging — HOW events travel: transport, routing, publish/dispatch (Kafka + queue)
export * from './messaging/index.js'
