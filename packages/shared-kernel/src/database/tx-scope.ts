/**
 * Unit of Work as a VALUE (ADR-0001, docs/adr/0001-transaction-retry-boundary.md).
 *
 * A service has exactly ONE repos shape: every write repository in that
 * service's database, already bound to one open transaction. Handlers receive
 * it as a parameter — they never reach for a client themselves, so there is
 * no "ambient or fallback" branch left to forget.
 *
 * Earlier version of this file had a per-module `TxScopeToken` + a registry
 * (`registerScope`/`canResolve`) so several DIFFERENT scope shapes could
 * coexist per service (KnowledgeTxScope, EngagementTxScope, ...). Collapsed
 * (2026-07-30) to one repos object per service: splitting by module bought a
 * SOFT protection (a handler in module A doesn't see module B's repos on
 * autocomplete) at the cost of a real one — every module needing its own
 * `TxScope` interface + factory + registration, and every new cross-need
 * between 2 existing scopes meaning "which scope does this handler even
 * belong to now?" The hard guarantee (every write in a handler shares the
 * SAME transaction) does not need per-module splitting — it only needs ONE
 * object built from ONE `tx` client, which a single repos-wide factory gives
 * just as well. Write repos still are not, and were never, NestJS DI
 * providers — that (not the module split) is what already prevents "handler
 * silently gets a repo via ordinary DI injection with no transaction
 * attached", the actual bug class ADR-0001 was written to kill.
 *
 * Precedent: `Architecture Patterns with Python` (O'Reilly) ch.6 —
 * `class AbstractUnitOfWork: batches: AbstractRepository`, i.e. the UoW
 * exposes the repositories directly.
 *
 * Pure TypeScript: shared-kernel stays ORM-agnostic. The concrete runner lives
 * in each service's infrastructure and is the only thing that knows about
 * Prisma.
 */
export interface IRepoFactory<S, DB = unknown> {
  create(db: DB): S
}

/** DI token for the service-local ITxRunner implementation. */
export const TX_RUNNER = Symbol('TX_RUNNER')

export interface ITxRunner<S = unknown> {
  /**
   * Opens a transaction, builds the service's repos from it, runs `fn`. Rolls
   * back if `fn` throws. MUST throw if a transaction is already active on
   * this async context (nested command dispatch) instead of quietly opening
   * a second, independent one.
   */
  run<R>(fn: (repos: S) => Promise<R>): Promise<R>
}
