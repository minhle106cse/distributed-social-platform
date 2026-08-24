import { CloudEvent } from '../events/cloud-event.js'
import { TransportValue } from '../routing/transport.js'

/**
 * ⚠️ THIS FILE MOVED TWICE ON 2026-08-24, and the round trip is the point, not an
 * accident — recorded so nobody "tidies" it back:
 *   1. shared-kernel → core-api/common. At that moment it satisfied none of the
 *      three reasons for being here: no shared-kernel file imported it, core-api
 *      was its only consumer and only implementer, and it is not a wire contract
 *      (the thing that crosses the network is `CloudEvent`). It was shared-looking
 *      by location and shared by nothing.
 *   2. core-api/common → back here, once `OutboxPublisher` (shared-kernel's own
 *      outbox engine, extracted the same day) began injecting it. That is **reason
 *      A**: remove this file and shared-kernel stops compiling.
 * The rule never changed — "where are the consumers" — the consumers did. Which is
 * exactly why placement is re-derived from the import graph rather than remembered.
 *
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
