import { CloudEvent } from '../events/cloud-event.js'
import { TransportValue } from '../routing/transport.js'

/**
 * Outbound port. The caller (e.g. the outbox PollingPublisher) depends on THIS,
 * not on Kafka/queue concretely. It hands over a complete envelope and is done —
 * topic/queue selection, key derivation and serialization live in the adapter.
 *
 * Bind this token to a CompositeMessagePublisher that fans an event out to
 * every transport declared for its `type` in EVENT_TRANSPORT_MAP.
 *
 * Deliberately named "Publisher", not "Producer" — this port doesn't know or
 * care which transport ends up handling `publish()` (could be Kafka, could be
 * a queue, could be both via the composite), so it stays above any single
 * transport's own vocabulary. Every CONCRETE adapter behind it uses each
 * transport's real name instead: `KafkaProducerService`, `QueueProducerService`
 * (apps/core-api/src/infrastructure/messaging/adapters/) — if you're looking
 * for "the Kafka producer", that's where it actually is.
 */
export const MESSAGE_PUBLISHER = Symbol('IMessagePublisher')

export interface IMessagePublisher {
  publish<TData>(event: CloudEvent<TData>): Promise<void>
}

/**
 * A single concrete transport (Kafka adapter, queue adapter, …). The composite
 * indexes these by `transport` so it can route per event type. Keeping the tag
 * on the adapter (not in a separate registry) means a new transport is wired by
 * simply implementing this interface and adding it to the providers list.
 */
export interface ITransportPublisher extends IMessagePublisher {
  readonly transport: TransportValue
}
