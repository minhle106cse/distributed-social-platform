export interface ITransactionManager {
  run<R>(callback: () => Promise<R>): Promise<R>;
}

export const TRANSACTION_MANAGER = Symbol('ITransactionManager');
