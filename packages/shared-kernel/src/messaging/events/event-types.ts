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
} as const

export type EventTypeValue = (typeof EventType)[keyof typeof EventType]
