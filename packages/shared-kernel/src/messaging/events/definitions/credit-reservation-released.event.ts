import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface CreditReservationReleasedPayload {
  userId: string
  /** Amount that was held and is now free again — the user was never charged it. */
  amount: number
  reservationId: string
  aiQueryId: string
  /** Why the hold was released, e.g. 'AI_UNAVAILABLE' | 'EXPIRED'. */
  reason: string
  /**
   * First line of the question, for rendering a human-readable notification
   * without a cross-service call back to core-api. Snapshot, deliberately not a
   * pointer — same fat-event tradeoff as KnowledgePublishedPayload.body.
   */
  questionSnippet: string
}

/** Producer: CreditReservationReleasedEvent.create({ aggregateId, orgId, payload }). */
export const CreditReservationReleasedEvent = defineEvent<CreditReservationReleasedPayload>({
  eventType: EventType.CREDIT_RESERVATION_RELEASED,
  aggregateType: 'CreditAccount',
})
