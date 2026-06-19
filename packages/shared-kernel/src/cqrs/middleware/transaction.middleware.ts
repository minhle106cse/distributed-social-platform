import { ICommandMiddleware, NextFn } from '../interfaces/command-middleware.interface.js';
import { ICommand } from '../interfaces/command.interface.js';
import { type ITransactionManager } from '../../database/transaction-manager.interface.js';
import { ILogger } from '../../logger/index.js';

export class TransactionMiddleware implements ICommandMiddleware {
  constructor(
    private readonly transactionManager: ITransactionManager,
    private readonly logger: ILogger,
  ) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    if (!command.options?.transactional) {
      return next();
    }

    this.logger.debug(`[TransactionMiddleware] Starting transaction for ${command.name}`);

    return this.transactionManager.run(async () => {
      try {
        const result = await next();
        this.logger.debug(`[TransactionMiddleware] Transaction committed for ${command.name}`);
        return result;
      } catch (error) {
        this.logger.debug(`[TransactionMiddleware] Transaction rolled back for ${command.name} due to error`);
        throw error;
      }
    });
  }
}
