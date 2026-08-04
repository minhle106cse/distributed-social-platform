import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface FollowCreatedPayload {
  userId: string
  targetType: string
  targetId: string
}

/** Producer: FollowCreatedEvent.create({ aggregateId, orgId, payload }). */
export const FollowCreatedEvent = defineEvent<FollowCreatedPayload>({
  eventType: EventType.FOLLOW_CREATED,
  aggregateType: 'Follow',
})
