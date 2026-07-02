import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface KnowledgePublishedPayload {
  itemId: string
  orgId: string
  spaceId: string
  type: string
  title: string
  // Full content snapshot at publish time — consumers (search-service) index this
  // without joining core_db. Fat-event tradeoff accepted for MVP; scale path is the
  // Claim-Check pattern (store body in object storage, event carries a pointer).
  body: string
  createdByUserId: string
}

/** Producer: KnowledgePublishedEvent.create({ aggregateId, orgId, payload }). */
export const KnowledgePublishedEvent = defineEvent<KnowledgePublishedPayload>({
  eventType: EventType.KNOWLEDGE_PUBLISHED,
  aggregateType: 'KnowledgeItem',
})
