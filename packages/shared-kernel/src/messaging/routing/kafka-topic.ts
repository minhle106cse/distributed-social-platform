/**
 * Kafka topics — a transport-level destination, NOT part of the event vocabulary.
 * Lives in messaging/ (HOW an event travels), while EventType lives in events/
 * (WHAT happened). The event→topic lookup is in routing.ts.
 */
export const KafkaTopic = {
  KNOWLEDGE_EVENTS: 'knowledge-events',
  ENGAGEMENT_EVENTS: 'engagement-events',
  CREDIT_EVENTS: 'credit-events',
} as const

export type KafkaTopicValue = (typeof KafkaTopic)[keyof typeof KafkaTopic]

/**
 * Dead-letter topic for a source topic — convention: `<topic>.DLQ`. A consumer
 * routes a message here after it fails terminally (poison pill or handler error
 * past max retries) so the bad message is isolated for triage instead of being
 * dropped or blocking the partition.
 */
export function deadLetterTopic(topic: string): string {
  return `${topic}.DLQ`
}
