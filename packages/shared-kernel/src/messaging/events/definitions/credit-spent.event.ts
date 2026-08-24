import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface CreditSpentPayload {
  userId: string
  amount: number
  reason: string
  /** Wallet balance AFTER the spend — see CreditAwardedPayload.balance. */
  balance: number
  /**
   * Present when the spend closes a two-phase reservation (the AI-Query Saga);
   * absent for a direct POST /credits/spend. Lets a consumer tie the ledger
   * entry back to the saga run that produced it.
   */
  reservationId?: string
  aiQueryId?: string
}

/** Producer: CreditSpentEvent.create({ aggregateId, orgId, payload }). */
export const CreditSpentEvent = defineEvent<CreditSpentPayload>({
  eventType: EventType.CREDIT_SPENT,
  aggregateType: 'CreditAccount',
})
