import { ICommand } from './command.interface.js'
import { SagaContext } from './saga-context.interface.js'

/**
 * Writes inside ONE database, atomically (ADR-0001).
 *
 * Declaring `kind: 'transactional'` (i.e. taking an `S` parameter at all) IS the
 * opt-in — there is no `transactional` flag on the command any more. The old flag
 * lived on the command DTO while the writes lived in the handler, so adding a
 * second repository write here silently lost atomicity unless someone remembered
 * to open another file. Now the only way to write is through the `tx` parameter,
 * and taking that parameter is what makes the bus open a transaction. The two
 * cannot drift apart. `S` is the service's ONE repos shape (see tx-scope.ts) —
 * there is no per-handler scope to declare separately any more.
 *
 * Because its only I/O surface is `tx`, the bus retries it on transient DB errors
 * automatically — no second flag. A handler that must call out to another service
 * is a saga instead (see ISagaCommandHandler); do NOT inject gRPC/HTTP clients here.
 */
export interface ITransactionalCommandHandler<C extends ICommand = any, R = any, S = any> {
  readonly kind: 'transactional'
  execute(command: C, tx: S): Promise<R>
  /**
   * Optional: runs once, AFTER `txRunner.run()` has resolved — i.e. the
   * transaction has actually committed and this attempt will NOT be retried.
   *
   * Exists for side effects inside `execute` that write to something outside the
   * transaction (an audit log shipped to Elasticsearch, a metric) and therefore
   * do NOT roll back with it. Calling such a side effect directly inside `execute`
   * is unsafe: Prisma commits *after* the callback resolves, so a commit-time
   * failure (e.g. a P2034 serialization error detected only at COMMIT) makes
   * `CommandBus.withRetry` re-run the whole handler even though the side effect
   * already fired — duplicating it. `afterCommit` only runs once the commit is
   * known to have actually succeeded (review of ADR-0001, 2026-07-30).
   *
   * `CommandBus` awaits this and swallows anything it throws (logged, not
   * rethrown) — a failure here must never fail a command whose real work
   * already committed. May be async.
   */
  afterCommit?(command: C, result: R): void | Promise<void>
}

/**
 * Work that crosses a boundary no transaction can span (another service, a second
 * store). Atomicity is replaced by compensation registered via `ctx.onCompensate`.
 * Never auto-retried — a saga's side effects do not roll back, so a blind retry
 * would double-apply them.
 */
export interface ISagaCommandHandler<C extends ICommand = any, R = any> {
  readonly kind: 'saga'
  /**
   * Every command name this handler may pass to `ctx.dispatch`, e.g.
   * `[CreateOrgCommand.name]`. `CommandBus.register` cross-checks this against
   * every other registered handler's `kind` the moment both are registered, so a
   * saga that dispatches another saga fails at composition-root startup — before
   * any traffic, and before the buggy saga's branch has to actually run in
   * production to be noticed. `execute`'s body is ordinary imperative code the
   * bus cannot see into, so this list is the only thing that makes dispatch
   * targets checkable ahead of time, the same reason `compensation` above is a
   * required declaration rather than something inferred from `execute`.
   */
  readonly dispatches: readonly string[]
  execute(command: C, ctx: SagaContext): Promise<R>
}

export type ICommandHandler<C extends ICommand = any, R = any> =
  | ITransactionalCommandHandler<C, R, any>
  | ISagaCommandHandler<C, R>
