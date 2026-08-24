/**
 * Everything a dead-letter producer needs to reconstruct the original message
 * and record why it died. Shared by `IDeadLetterProducer` below and every
 * per-service `DeadLetterProducer` implementation — declare it once here
 * instead of each service re-typing the same shape.
 */
export interface DeadLetterInput {
  topic: string
  key: Buffer | string | null
  value: Buffer | string | null
  reason: 'poison-pill' | 'handler-error'
  error: string
  partition: number
  offset: string
}

/**
 * Outbound port to a per-service dead-letter producer (`<topic>.DLQ`). Named
 * after its one real shape — a "producer" — rather than a generic "Port"
 * suffix, matching `IIntegrationEventHandler` next to it.
 *
 * This one earns its place in shared-kernel the hard way: `ResilientConsumer`
 * (shared-kernel) injects it, so shared-kernel would not compile without it.
 * Contrast `IMessagePublisher`, which used to sit in this folder and moved to
 * core-api on 2026-08-24 — nothing here imported it and core-api was its only
 * consumer.
 */
export interface IDeadLetterProducer {
  send(input: DeadLetterInput): Promise<void>
}
