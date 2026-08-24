import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface CreditAwardedPayload {
  userId: string
  amount: number
  reason: string
  /** Wallet balance AFTER this grant — saves every consumer a fold of the stream. */
  balance: number
}

/**
 * Producer: CreditAwardedEvent.create({ aggregateId, orgId, payload }).
 * `aggregateId` is the wallet id (`${orgId}:${userId}`, CreditAccount.walletId).
 */
export const CreditAwardedEvent = defineEvent<CreditAwardedPayload>({
  eventType: EventType.CREDIT_AWARDED,
  aggregateType: 'CreditAccount',
})
