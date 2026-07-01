import { EventType } from '../event-types.js'
import { defineEvent } from '../integration-event.js'

export interface FollowRemovedPayload {
  orgId: string
  userId: string
  targetType: string
  targetId: string
}

/** Producer: FollowRemovedEvent.create({ aggregateId, orgId, payload }). */
export const FollowRemovedEvent = defineEvent<FollowRemovedPayload>({
  eventType: EventType.FOLLOW_REMOVED,
  aggregateType: 'Follow',
})
