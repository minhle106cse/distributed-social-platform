import { ICommand } from './command.interface.js'

/**
 * Data description of a compensation step — NOT the closure itself. A closure
 * only lives in the memory of the request that created it; if the bus needs to
 * durably record "this compensation failed, retry it later" (see
 * `ISagaCompensationStore`), it needs something it can serialize to a store and
 * hand to a registry later, not a function reference (review of ADR-0001,
 * 2026-07-30 — a compensation that fails today is logged and never touched
 * again).
 */
export interface CompensationAction {
  /** Looked up in the service's compensation registry to re-run this action later.
   * A constant, not freely chosen per call site — see the registry's own doc. */
  readonly type: string
  /** Everything the registry needs to reconstruct the call — e.g. `{ userId }`. */
  readonly payload: Record<string, unknown>
}

/**
 * What a saga handler is handed instead of a transaction (ADR-0001).
 *
 * A saga spans resources no single DB transaction can cover (another service over
 * gRPC, a second store), so atomicity is replaced by explicit compensation.
 *
 * `onCompensate` is a STACK, registered as the saga progresses: each step records
 * how to undo itself while the values needed to undo it are still in scope. That
 * is why compensation is a closure and not a `compensate(command)` method — the
 * real saga here (`ProvisionOrgHandler`) must undo a user created mid-flight using
 * the `userId` the gRPC call returned, which a command-only signature cannot see.
 *
 * On failure the bus runs the stack in REVERSE. The closure is tried first (fast
 * path); if it throws, the bus swallows the error (never masks the original one
 * the caller needs to see) AND durably records `action` via
 * `ISagaCompensationStore` so a reaper can retry it later instead of the failure
 * being visible only in a log line.
 *
 * `dispatch` is the ONLY way to send another command from inside a handler. It
 * exists on the saga context and nowhere else: a transactional handler is not
 * given a bus, so it structurally cannot nest a second transaction.
 */
export interface SagaContext {
  dispatch<R = void>(command: ICommand): Promise<R>
  onCompensate(action: CompensationAction, undo: () => Promise<void>): void
}
