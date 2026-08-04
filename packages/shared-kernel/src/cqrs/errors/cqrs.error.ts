import { InfrastructureError } from '../../errors/infra-error.js'

export abstract class CqrsError extends InfrastructureError {
  abstract readonly code: string

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details)
    this.name = this.constructor.name
  }
}

export class CommandHandlerNotFoundError extends CqrsError {
  readonly code = 'COMMAND_HANDLER_NOT_FOUND'
  constructor(commandName: string) {
    super(`Command handler not found for command: ${commandName}`, { commandName })
  }
}

export class DuplicateCommandHandlerError extends CqrsError {
  readonly code = 'DUPLICATE_COMMAND_HANDLER'
  constructor(commandName: string) {
    super(
      `Two handlers registered for command: ${commandName}. A command is 1:1 with its handler.`,
      {
        commandName,
      },
    )
  }
}

/**
 * Boot-time failure: a registered handler's `kind` is neither `'transactional'`
 * nor `'saga'` — e.g. a handler class that never declared `readonly kind` at all.
 * Without this check the handler silently skips `register()`'s TxScope validation
 * and falls into `runTransactional` with `txScope: undefined`, surfacing at the
 * first request as an unrelated `TypeError` instead of at boot (review of
 * ADR-0001, 2026-07-30 — the same silent-to-loud gap the ADR closed for missing
 * TxScope factories, left open for a missing `kind`).
 */
export class UnknownHandlerKindError extends CqrsError {
  readonly code = 'UNKNOWN_HANDLER_KIND'
  constructor(commandName: string, kind: unknown) {
    super(
      `Handler for "${commandName}" has kind "${String(kind)}" — must be 'transactional' or 'saga'. ` +
        `Did the handler class forget "readonly kind = 'transactional' as const" (or 'saga')?`,
      { commandName, kind },
    )
  }
}

/**
 * A saga dispatched another saga via `ctx.dispatch`. Orchestration is meant to
 * have exactly one saga per flow deciding the order of steps and owning
 * compensation for that flow (ADR-0001) — a saga calling another saga splits
 * that ownership two ways: the inner saga self-compensates and rethrows, and if
 * the outer handler also registers `onCompensate` for that same dispatch (easy
 * to do out of habit, since every other step needs one), the bus undoes it a
 * second time on top of what the inner saga already undid. Caught at dispatch
 * time instead of left to be found via a double-compensation bug in prod.
 */
export class NestedSagaDispatchError extends CqrsError {
  readonly code = 'NESTED_SAGA_DISPATCH'
  constructor(outerCommand: string, innerCommand: string) {
    super(
      `Saga "${outerCommand}" dispatched "${innerCommand}", which is itself a saga handler. ` +
        `A saga may only dispatch 'transactional' commands via ctx.dispatch — nest orchestration ` +
        `by having one saga own the whole flow, not by calling another saga.`,
      { outerCommand, innerCommand },
    )
  }
}

export class QueryHandlerNotFoundError extends CqrsError {
  readonly code = 'QUERY_HANDLER_NOT_FOUND'
  constructor(queryName: string) {
    super(`Query handler not found for query: ${queryName}`, { queryName })
  }
}

export class EventHandlerNotFoundError extends CqrsError {
  readonly code = 'EVENT_HANDLER_NOT_FOUND'
  constructor(eventName: string) {
    super(`Event handler not found for event: ${eventName}`, { eventName })
  }
}
