import { AsyncLocalStorage } from 'async_hooks'

// Implicitly carries the active transaction client through the call stack so
// repositories never change their signatures. Paired with ITransactionManager:
// the infra TransactionManager calls runInTransaction(tx, ...), repositories
// read it via getTx(). See directives/cqrs_pattern.md.
const transactionContext = new AsyncLocalStorage<unknown>()

export function getTx<T = unknown>(): T | undefined {
  return transactionContext.getStore() as T | undefined
}

export function runInTransaction<R>(tx: unknown, callback: () => Promise<R>): Promise<R> {
  return transactionContext.run(tx, callback)
}
