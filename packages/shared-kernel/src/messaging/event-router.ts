import { CloudEvent } from './events/cloud-event.js'
import { ILogger, LogContext } from '../logger/index.js'
import { IIntegrationEventHandler } from './interfaces/event-handler.interface.js'

/**
 * Transport-agnostic dispatch (the "Message Dispatcher" EIP / NestJS @EventPattern
 * done by hand for offset+idempotency control). A transport adapter (Kafka consumer,
 * queue worker) deserialises a message into a CloudEvent and calls route(); the
 * router looks up the handler by the event's `type`.
 *
 * Routing is 1:1 — exactly one handler per event type within this router, which
 * represents ONE Kafka consumer group. Fan-out of a single event to many concerns
 * (feed, search, notifications…) is NOT done by registering many handlers here;
 * it is done the Kafka-native way: a separate consumer GROUP per concern, each
 * with its own router. Kafka delivers a copy of the event to every group, so the
 * concerns scale and fail independently. `register()` therefore throws on a
 * duplicate event type — that is a guard against accidentally collapsing two
 * concerns into one consumer group, not a missing feature.
 *
 * Errors propagate to the adapter on purpose: only the adapter knows the delivery
 * semantics (offset commit, ack/nack, DLQ) and must decide retry vs drop.
 */
export class EventRouter {
  private readonly handlers = new Map<string, IIntegrationEventHandler>()

  constructor(private readonly logger: ILogger) {}

  register(handler: IIntegrationEventHandler): this {
    if (this.handlers.has(handler.eventType)) {
      throw new Error(
        `Duplicate handler for event type "${handler.eventType}". One handler per type per ` +
          `consumer group — fan-out to another concern via a separate consumer group.`,
      )
    }
    this.handlers.set(handler.eventType, handler)
    return this
  }

  async route(event: CloudEvent): Promise<void> {
    const handler = this.handlers.get(event.type)
    if (!handler) {
      this.logger.warn(
        { context: LogContext.EVENT_ROUTER, type: event.type },
        'No handler registered — skipping integration event',
      )
      return
    }
    // Business-layer dispatch log — the EventRouter-level equivalent of
    // CommandBus's LoggingMiddleware (same context/shape, same info-on-start +
    // info-on-success semantics: routing is 1:1 per event type, same as a
    // Command, not EventBus's N-handler fan-out where an info-per-handler
    // would be spam). Lives HERE, not per-handler, so every consumer of
    // EventRouter (search-service, notification-service, any future
    // worker-service consumer) gets it automatically — no hand-written
    // logger.info() per handler to forget (2026-07-25: found notification-
    // service's 3 event handlers had ZERO business-layer log at all, and
    // search-service's IndexKnowledgeHandler had one written by hand instead
    // of inherited — this fixes both the same way, at the shared seam).
    const startTime = Date.now()
    this.logger.info(
      { context: LogContext.EVENT_ROUTER, type: event.type },
      `Routing ${event.type}...`,
    )
    // Deliberately NO catch/error-log here, unlike LoggingMiddleware — a
    // thrown error already gets logged by ResilientEventConsumer's own
    // retry-warn/DLQ-error logging one layer up (resilient-consumer.ts). This
    // is the CQRS EventBus asymmetry-with-CommandBus rule applied here too:
    // don't log the same failure twice at two layers with the same meaning.
    await handler.handle(event)
    this.logger.info(
      { context: LogContext.EVENT_ROUTER, type: event.type, durationMs: Date.now() - startTime },
      `Routed ${event.type}`,
    )
  }
}
