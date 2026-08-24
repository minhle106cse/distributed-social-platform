/**
 * The Transactional Outbox contract — both halves of it.
 *
 * WHY THIS IS IN shared-kernel (2026-08-24): the outbox is a *capability*
 * shared-kernel provides (`OutboxPublisher` next door), not a core-api feature.
 * Any service that writes state and publishes events needs the identical shape,
 * so it lives here once instead of being copy-pasted the day a second service
 * adopts it — the outcome this repo has already paid for twice (two byte-identical
 * `MembershipVerificationClient`s, and three eslint configs that drifted apart).
 * `IOutboxStore` qualifies on reason A outright: `OutboxPublisher`, shared-kernel's
 * own code, imports it. `IOutboxWriter` rides with it because a capability's public
 * contract is one thing — splitting the write half into the consuming service is
 * the "one transport, two homes" mistake in a different costume.
 *
 * What deliberately does NOT come here: the Prisma SQL (`FOR UPDATE SKIP LOCKED`),
 * the `OutboxEvent` model, the NestJS schedulers, and the prom-client metrics.
 * Those are per-service adapters — see `folder_structure_sop.md` § Where An
 * Abstraction Lives for the kind test that forbids them.
 */

export interface OutboxAppendInput {
  eventType: string
  aggregateType: string
  aggregateId: string
  orgId: string
  payload: unknown
}

/**
 * WRITE side: appending the event MUST commit with the state change that produced
 * it. Belongs in the service's Unit-of-Work (`TxScope`), so it is only reachable
 * from inside a transaction — that is what closes the dual-write hole by
 * construction rather than by remembering a flag.
 *
 * Named for the ROLE, not for its one method (it was `IOutboxAppender` until
 * 2026-08-24). One method is correct — appending is the only thing a command
 * handler legitimately does to the outbox, and `claim`/`mark`/`reap` must stay out
 * of reach here — but the name must not be welded to that verb, or a second write
 * operation turns it into a lie.
 */
export interface IOutboxWriter {
  append(input: OutboxAppendInput): Promise<void>
}

/** One row claimed for publishing. */
export interface ClaimedOutboxEvent {
  id: string
  aggregateType: string
  aggregateId: string
  eventType: string
  orgId: string
  payload: unknown
  attempts: number
  createdAt: Date
  traceparent: string | null
}

/**
 * DISPATCH side, driven by `OutboxPublisher`. Deliberately NOT part of any
 * TxScope: claiming holds row locks and publishing does network I/O, so this must
 * run OUTSIDE an application transaction. Splitting it from `IOutboxWriter` makes
 * that a fact about what a caller can even reach, not a comment (ADR-0001).
 *
 * Exactly the three methods the publisher loop calls, and no more. `reapStaleInflight`,
 * `countByStatus` and `purgeProcessed` stay off this port on purpose: they are
 * one-line delegations driven by per-service scheduled jobs that talk to the
 * concrete repository directly, and port-ifying a one-liner is the ceremony
 * `resilience_patterns.md` §6.1 exists to prevent.
 */
export interface IOutboxStore {
  /**
   * Atomically flip up to `limit` PENDING rows to INFLIGHT (HA-safe under
   * concurrent publisher replicas) and return them. The claim algorithm is the
   * adapter's business — in Postgres, `FOR UPDATE SKIP LOCKED`.
   */
  claimPendingBatch(limit: number): Promise<ClaimedOutboxEvent[]>

  /** A claimed row was published successfully. */
  markProcessed(id: string): Promise<void>

  /** Publishing failed — bump attempts, and DLQ once the budget is exhausted. */
  markFailed(id: string, currentAttempts: number, error: string, maxAttempts: number): Promise<void>
}
