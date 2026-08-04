import type { CompensationAction } from './saga-context.interface.js'

/**
 * Durable record of a compensation that failed on its first (in-process) attempt,
 * so a reaper can retry it later instead of the failure being visible only in a
 * log line — the same "log is for tracing, not for storage" principle that
 * motivated the Transactional Outbox and DLQ already in this codebase, applied to
 * the one at-least-once path that didn't have a durable store yet (review of
 * ADR-0001, 2026-07-30).
 *
 * Optional on `CommandBus` — a service with no saga (most of them) never needs to
 * implement or inject one.
 */
/** DI token for the service-local ISagaCompensationStore implementation (mirrors TX_RUNNER). */
export const SAGA_COMPENSATION_STORE = Symbol('SAGA_COMPENSATION_STORE')

export interface ISagaCompensationStore {
  /**
   * Called once per compensation step that threw, AFTER the bus has already
   * logged it. Must not throw — a store that cannot durably record a failure
   * should swallow its own errors internally (log them) rather than let a
   * secondary failure here mask the original saga error the caller is about to
   * see propagate.
   */
  recordFailed(sagaCommand: string, action: CompensationAction, error: unknown): Promise<void>
}
