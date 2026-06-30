import { EventType, EventTypeValue } from '../../events/event-types.js'
import { Transport, TransportValue } from './transport.js'
import { KafkaTopic, KafkaTopicValue } from './kafka-topic.js'

/**
 * Routing tables — the single place that answers "given an event, where does it go?"
 * in two layers:
 *   1. Transport selection  (which broker: kafka, queue, or both)
 *   2. Kafka topic           (within Kafka, which topic)
 *
 * Both maps are `Record<EventTypeValue, …>` so they are exhaustive: adding an
 * EventType without a routing entry is a compile error — no event can silently
 * go nowhere. The functions take `string` because event types arrive at runtime
 * from outbox rows / wire messages with no compile-time guarantee.
 */

// ── Layer 1: event → transport(s) ───────────────────────────────────────────
// Today everything rides Kafka. Flipping an event onto the queue is a one-line
// change here once the queue adapter is registered — no producer code changes.
export const EVENT_TRANSPORT_MAP: Record<EventTypeValue, TransportValue[]> = {
  [EventType.KNOWLEDGE_PUBLISHED]: [Transport.KAFKA],
  [EventType.KNOWLEDGE_ARCHIVED]: [Transport.KAFKA],
  [EventType.KNOWLEDGE_MARKED_STALE]: [Transport.KAFKA],

  [EventType.VOTE_CAST]: [Transport.KAFKA],
  [EventType.VOTE_RETRACTED]: [Transport.KAFKA],
  [EventType.FOLLOW_CREATED]: [Transport.KAFKA],
  [EventType.FOLLOW_REMOVED]: [Transport.KAFKA],
  [EventType.BOOKMARK_ADDED]: [Transport.KAFKA],
  [EventType.BOOKMARK_REMOVED]: [Transport.KAFKA],
  [EventType.ANSWER_ACCEPTED]: [Transport.KAFKA],

  [EventType.CREDIT_AWARDED]: [Transport.KAFKA],
  [EventType.CREDIT_SPENT]: [Transport.KAFKA],
}

export function transportsForEventType(eventType: string): TransportValue[] {
  const transports = EVENT_TRANSPORT_MAP[eventType as EventTypeValue]
  if (!transports || transports.length === 0) {
    throw new Error(`No transport mapped for event type: ${eventType}`)
  }
  return transports
}

// ── Layer 2: event → Kafka topic ────────────────────────────────────────────
export const EVENT_TOPIC_MAP: Record<EventTypeValue, KafkaTopicValue> = {
  [EventType.KNOWLEDGE_PUBLISHED]: KafkaTopic.KNOWLEDGE_EVENTS,
  [EventType.KNOWLEDGE_ARCHIVED]: KafkaTopic.KNOWLEDGE_EVENTS,
  [EventType.KNOWLEDGE_MARKED_STALE]: KafkaTopic.KNOWLEDGE_EVENTS,

  [EventType.VOTE_CAST]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.VOTE_RETRACTED]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.FOLLOW_CREATED]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.FOLLOW_REMOVED]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.BOOKMARK_ADDED]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.BOOKMARK_REMOVED]: KafkaTopic.ENGAGEMENT_EVENTS,
  [EventType.ANSWER_ACCEPTED]: KafkaTopic.ENGAGEMENT_EVENTS,

  [EventType.CREDIT_AWARDED]: KafkaTopic.CREDIT_EVENTS,
  [EventType.CREDIT_SPENT]: KafkaTopic.CREDIT_EVENTS,
}

export function topicForEventType(eventType: string): KafkaTopicValue {
  const topic = EVENT_TOPIC_MAP[eventType as EventTypeValue]
  if (!topic) {
    throw new Error(`No Kafka topic mapped for event type: ${eventType}`)
  }
  return topic
}
