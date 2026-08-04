import { InfrastructureError } from '../errors/infra-error.js'

/**
 * A transaction was requested while one is already open on this async context —
 * i.e. a command was dispatched from inside a transactional handler.
 *
 * Opening a second transaction here would run it on a DIFFERENT pooled connection:
 * it commits independently, so the outer rollback would not undo it. Prisma 7.5+
 * *can* nest via SAVEPOINT, but only when nesting through the transaction client;
 * going through the base client silently does not join. Rather than quietly pick
 * savepoint semantics, we fail loudly — nesting a command inside a transaction is
 * almost always a design smell, and a transactional handler is not given a bus
 * precisely so this cannot happen by accident (ADR-0001 §2.4).
 */
export class NestedTransactionError extends InfrastructureError {
  readonly code = 'NESTED_TRANSACTION'
  constructor() {
    super(
      `Cannot open a new transaction: one is already active on this async context. ` +
        `Compose inside a transaction with plain functions taking the repos, or move the ` +
        `orchestration to a saga handler (which dispatches without holding a transaction).`,
    )
  }
}
