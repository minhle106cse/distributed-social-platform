import { CloudEvent } from '../events/cloud-event.js'
import { ILogger, LogContext } from '../logger/index.js'

/**
 * Inbound handler for one integration event type. A handler is transport-blind:
 * it does not know whether the event arrived from Kafka or a queue worker — it
 * only knows its `eventType` (its subscription, like MediatR's
 * INotificationHandler<TEvent>).
 */
export interface IIntegrationEventHandler<TData = unknown> {
  readonly eventType: string
  handle(event: CloudEvent<TData>): Promise<void>
}

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
    await handler.handle(event)
  }
}
