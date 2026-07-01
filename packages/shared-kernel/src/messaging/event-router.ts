import { CloudEvent } from '../events/cloud-event.js'
import { ILogger, LogContext } from '../logger/index.js'

/**
 * How a handler stays safe under at-least-once delivery (the same event CAN be
 * delivered more than once — outbox republish, reaper, redelivery on commit fail).
 * Declaring this is MANDATORY: it forces every handler author to have answered
 * "what happens if this runs twice?" at compile time, instead of leaving it to
 * reviewer vigilance. See directives/eventing_patterns.md §4.3.
 *
 * - `natural-key`      — effect idempotent by construction (upsert / delete by PK).
 * - `dedup-constraint` — a unique key on the event id (e.g. INSERT … ON CONFLICT
 *                        DO NOTHING) makes a re-apply a no-op.
 * - `none`             — NOT safe to re-apply. Forbidden for handlers with a
 *                        persistent side effect; `EventRouter.register` rejects it.
 *                        Only legitimate for a genuinely read-only/no-op handler.
 */
export type IdempotencyStrategy = 'natural-key' | 'dedup-constraint' | 'none'

/**
 * Inbound handler for one integration event type. A handler is transport-blind:
 * it does not know whether the event arrived from Kafka or a queue worker — it
 * only knows its `eventType` (its subscription, like MediatR's
 * INotificationHandler<TEvent>).
 */
export interface IIntegrationEventHandler<TData = unknown> {
  readonly eventType: string
  /** How this handler survives a redelivered event. See IdempotencyStrategy. */
  readonly idempotency: IdempotencyStrategy
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
    // At-least-once guard: a handler with a persistent side effect MUST declare a
    // real idempotency strategy. Registering an 'none' handler is a boot-time
    // failure — fail loud at startup, not silently on the first redelivery.
    if (handler.idempotency === 'none') {
      throw new Error(
        `Handler for "${handler.eventType}" declares idempotency 'none'. Under at-least-once ` +
          `delivery a redelivered event would double-apply. Make the write idempotent ` +
          `(natural-key upsert/delete, or a dedup-constraint on the event id) before registering.`,
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
