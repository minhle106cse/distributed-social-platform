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
 * suffix, matching the sibling ports in this same folder (`IMessagePublisher`,
 * `ITransportPublisher`, `IIntegrationEventHandler`).
 */
export interface IDeadLetterProducer {
  send(input: DeadLetterInput): Promise<void>
}
