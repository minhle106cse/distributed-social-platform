export const EventType = {
  // Knowledge lifecycle
  KNOWLEDGE_PUBLISHED: 'KnowledgePublished',
  KNOWLEDGE_ARCHIVED: 'KnowledgeArchived',
  KNOWLEDGE_MARKED_STALE: 'KnowledgeMarkedStale',

  // Engagement
  VOTE_CAST: 'VoteCast',
  VOTE_RETRACTED: 'VoteRetracted',
  FOLLOW_CREATED: 'FollowCreated',
  FOLLOW_REMOVED: 'FollowRemoved',
  BOOKMARK_ADDED: 'BookmarkAdded',
  BOOKMARK_REMOVED: 'BookmarkRemoved',
  ANSWER_ACCEPTED: 'AnswerAccepted',

  // Credit economy (Phase 5)
  CREDIT_AWARDED: 'CreditAwarded',
  CREDIT_SPENT: 'CreditSpent',
  // Phase 5b — the AI-Query Saga's compensation made visible to other services.
  // NOT named 'AiQueryFailed': what a consumer actually acts on is the CREDIT
  // outcome ("AI unavailable, you were not charged"), and keeping the vocabulary
  // credit-centric keeps it on the existing `credit-events` topic instead of
  // minting a topic for a single event. The AI detail travels in the payload
  // (`reason`, `aiQueryId`) for whoever needs to render it.
  CREDIT_RESERVATION_RELEASED: 'CreditReservationReleased',
} as const

export type EventTypeValue = (typeof EventType)[keyof typeof EventType]
