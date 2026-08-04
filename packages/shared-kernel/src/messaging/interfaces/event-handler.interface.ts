import { CloudEvent } from '../events/cloud-event.js'

/**
 * Inbound handler for one integration event type. A handler is transport-blind:
 * it does not know whether the event arrived from Kafka or a queue worker — it
 * only knows its `eventType` (its subscription, like MediatR's
 * INotificationHandler<TEvent>).
 *
 * The handler MUST be safe under at-least-once delivery (the same event CAN be
 * delivered more than once — outbox republish, reaper, redelivery on commit
 * fail). A typed `idempotency` field used to be required here to force that
 * question at compile time — removed (2026-07-30): the framework has no way to
 * verify the DECLARED strategy matches what `handle()` actually does, so a
 * mislabeled handler passed the check while still double-applying on redelivery.
 * The only real information was ever in the reasoning, not the label — put that
 * reasoning in a comment on `handle()` instead (see directives/eventing_patterns.md §4.2,
 * resilience_patterns.md §1.0 for the underlying techniques — natural-key upsert/delete,
 * dedup-constraint on the event id, etc. — the taxonomy still applies, it's just no longer
 * a field the compiler can check).
 */
export interface IIntegrationEventHandler<TData = unknown> {
  readonly eventType: string
  handle(event: CloudEvent<TData>): Promise<void>
}
