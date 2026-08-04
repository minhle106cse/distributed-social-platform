import { AsyncLocalStorage } from 'async_hooks'

// Since ADR-0001 this is NO LONGER how repositories find their client — they are
// handed one when their TxScope is built, so there is no `getTx() ?? client`
// fallback left to forget. What survives is the narrower job it is actually good
// at: telling a TxRunner whether a transaction is already open on this async
// context, so nesting can fail loudly instead of silently opening a second one on
// another pooled connection. Assertion mechanism, not wiring mechanism.
const transactionContext = new AsyncLocalStorage<unknown>()

export function getTx<T = unknown>(): T | undefined {
  return transactionContext.getStore() as T | undefined
}

export function runInTransaction<R>(tx: unknown, callback: () => Promise<R>): Promise<R> {
  return transactionContext.run(tx, callback)
}
