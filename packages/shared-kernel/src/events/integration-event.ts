import { EventTypeValue } from './event-types.js'

/**
 * What a producer hands to the outbox/publisher. The generic payload binds
 * eventType ↔ payload at compile time — unlike a bare `unknown` payload, you
 * cannot pair an eventType with the wrong payload shape or forget a field.
 * Structurally assignable to core-api's OutboxAppendInput.
 */
export interface IntegrationEventInput<TPayload> {
  eventType: EventTypeValue
  aggregateType: string
  aggregateId: string
  orgId: string
  payload: TPayload
}

export interface EventDefinition<TPayload> {
  readonly eventType: EventTypeValue
  create(args: {
    aggregateId: string
    orgId: string
    payload: TPayload
  }): IntegrationEventInput<TPayload>
}

/**
 * Bind an eventType + aggregateType to a payload type once. The returned
 * `create()` produces a fully-typed event input: a missing/mismatched payload
 * field is a compile error, and eventType/aggregateType can't be mistyped at the
 * call site. This is the "construct like a command" safety, kept serializable
 * (create() returns a plain object, not a class instance).
 */
export function defineEvent<TPayload>(meta: {
  eventType: EventTypeValue
  aggregateType: string
}): EventDefinition<TPayload> {
  return {
    eventType: meta.eventType,
    create: ({ aggregateId, orgId, payload }) => ({
      eventType: meta.eventType,
      aggregateType: meta.aggregateType,
      aggregateId,
      orgId,
      payload,
    }),
  }
}
