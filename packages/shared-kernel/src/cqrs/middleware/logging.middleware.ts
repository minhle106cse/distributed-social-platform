import { ICommandMiddleware, NextFn } from '../interfaces/command-middleware.interface.js';
import { ICommand } from '../interfaces/command.interface.js';
import { ILogger } from '../../logger/index.js';

export class LoggingMiddleware implements ICommandMiddleware {
  constructor(private readonly logger: ILogger) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    const startTime = Date.now();
    this.logger.info(`[CommandBus] Executing ${command.name}...`, { payload: command });

    try {
      const result = await next();
      const executionTime = Date.now() - startTime;
      this.logger.info(`[CommandBus] Successfully executed ${command.name} in ${executionTime}ms`);
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`[CommandBus] Failed to execute ${command.name} after ${executionTime}ms`, { error });
      throw error;
    }
  }
}
