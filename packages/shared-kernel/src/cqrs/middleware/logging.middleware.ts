import { ICommandMiddleware, NextFn } from '../interfaces/command-middleware.interface.js'
import { ICommand } from '../interfaces/command.interface.js'
import { ILogger, LogContext } from '../../logger/index.js'

export class LoggingMiddleware implements ICommandMiddleware {
  constructor(private readonly logger: ILogger) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    const startTime = Date.now()
    this.logger.info({ context: LogContext.COMMAND_BUS }, `Executing ${command.name}...`)
    // Full input only at DEBUG (silent in prod, avoids body-volume noise). Secrets
    // (password/token/…) are masked by the root logger's `redact` config, so this
    // is safe even though the command shape is unknown here.
    this.logger.debug(
      { context: LogContext.COMMAND_BUS, input: command },
      `Input for ${command.name}`,
    )

    try {
      const result = await next()
      const durationMs = Date.now() - startTime
      this.logger.info(
        { context: LogContext.COMMAND_BUS, durationMs },
        `Successfully executed ${command.name}`,
      )
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      this.logger.error(
        { context: LogContext.COMMAND_BUS, durationMs, err: error },
        `Failed to execute ${command.name}`,
      )
      throw error
    }
  }
}
