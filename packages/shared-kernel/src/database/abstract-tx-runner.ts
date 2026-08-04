import { getTx, runInTransaction } from './transaction.context.js'
import { NestedTransactionError } from './tx.error.js'
import type { ITxRunner, IRepoFactory } from './tx-scope.js'
import type { ILogger } from '../logger/index.js'
import { LogContext } from '../logger/index.js'

/**
 * ORM-agnostic half of the Unit-of-Work runner (ADR-0001).
 *
 * One instance per service, built from exactly ONE `IRepoFactory` passed at
 * construction — not a registry keyed by token (that existed when a service
 * could have several DIFFERENT repos shapes; collapsed 2026-07-30 to one
 * repos object per service, see tx-scope.ts's doc for why). The reentrancy
 * guard and transaction-boundary log lines are identical regardless of which
 * ORM a service uses — none of it touches Prisma. Each service supplies only
 * `beginTransaction` — the one line that actually calls `$transaction`.
 */
export abstract class AbstractTxRunner<S, DB = unknown> implements ITxRunner<S> {
  constructor(
    private readonly logger: ILogger,
    private readonly factory: IRepoFactory<S, DB>,
  ) {}

  async run<R>(fn: (repos: S) => Promise<R>): Promise<R> {
    // Nesting would run on a DIFFERENT pooled connection and commit independently,
    // so an outer rollback would not undo it. Fail loudly (ADR-0001 §2.4).
    if (getTx() !== undefined) {
      throw new NestedTransactionError()
    }

    this.logger.debug({ context: LogContext.TRANSACTION }, 'Starting transaction')
    try {
      const result = await this.beginTransaction<R>((db) => this.runInsideTransaction(db, fn))
      this.logger.debug({ context: LogContext.TRANSACTION }, 'Transaction committed')
      return result
    } catch (error) {
      this.logger.debug({ context: LogContext.TRANSACTION, err: error }, 'Transaction rolled back')
      throw error
    }
  }

  /**
   * Everything that must run INSIDE the open transaction's async-local-storage
   * context: mark `db` as the ambient tx (so the nesting guard above can see
   * it from anywhere via `getTx()`), build the repos from it, then run the
   * caller's actual work. Split out purely so `run()` reads top-to-bottom
   * instead of 2 arrow functions nested inline.
   */
  private runInsideTransaction<R>(db: DB, fn: (repos: S) => Promise<R>): Promise<R> {
    return runInTransaction(db, () => fn(this.factory.create(db)))
  }

  /** The one ORM-specific line: open an interactive transaction and hand back its client. */
  protected abstract beginTransaction<R>(fn: (db: DB) => Promise<R>): Promise<R>
}
