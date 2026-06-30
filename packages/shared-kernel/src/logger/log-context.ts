/**
 * Centralized log `context` field values shared ACROSS services.
 *
 * Patterns that exist in BOTH auth-service and core-api (CQRS pipeline, HTTP
 * layer, exception handling) must use the SAME context string so a single
 * Kibana query (`context: "CommandBus"`) spans every service. Each is emitted
 * as a child of that service's root logger (`serviceContext: auth-service` /
 * `core-api`), so you filter by `serviceContext` + `context` together.
 *
 * App-LOCAL contexts that live in only one service (e.g. KafkaProducer,
 * PollingPublisher) are NOT listed here — they use `@InjectPinoLogger(Xxx.name)`
 * with the class name, which is self-maintaining. Only cross-service shared
 * contexts belong in this registry.
 */
export const LogContext = {
  // CQRS pipeline — shared-kernel middlewares, identical in every service
  COMMAND_BUS: 'CommandBus',
  QUERY_BUS: 'QueryBus',
  RETRY: 'RetryMiddleware',
  TRANSACTION: 'TransactionMiddleware',
  // In-process domain event dispatcher (shared-kernel EventBus)
  EVENT_BUS: 'EventBus',
  // Cross-service integration-event dispatch (shared-kernel EventRouter)
  EVENT_ROUTER: 'EventRouter',
  // HTTP transport layer (NestJS interceptor / Fastify hook)
  HTTP: 'HttpLayer',
  // Unhandled exception filter / global error handler
  EXCEPTION: 'ExceptionFilter',
} as const

export type LogContextValue = (typeof LogContext)[keyof typeof LogContext]
