import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface KnowledgePublishedPayload {
  itemId: string
  orgId: string
  spaceId: string
  type: string
  title: string
  createdByUserId: string
}

/** Producer: KnowledgePublishedEvent.create({ aggregateId, orgId, payload }). */
export const KnowledgePublishedEvent = defineEvent<KnowledgePublishedPayload>({
  eventType: EventType.KNOWLEDGE_PUBLISHED,
  aggregateType: 'KnowledgeItem',
})
