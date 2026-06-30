import { IQuery } from './interfaces/query.interface.js'
import { IQueryHandler } from './interfaces/query-handler.interface.js'
import { QueryHandlerNotFoundError } from './errors/cqrs.error.js'
import { ILogger, LogContext } from '../logger/index.js'

export class QueryBus {
  private handlers = new Map<string, IQueryHandler<any, any>>()

  constructor(private readonly logger: ILogger) {}

  register(queryName: string, handler: IQueryHandler<any, any>) {
    this.handlers.set(queryName, handler)
  }

  async execute<T extends IQuery, R = any>(query: T): Promise<R> {
    const handler = this.handlers.get(query.name)
    if (!handler) {
      throw new QueryHandlerNotFoundError(query.name)
    }

    // Reads are high-frequency and already captured by the HTTP-layer log; keep
    // the business-layer trace at DEBUG (silent in prod, available for profiling
    // handler-time vs transport-time). No info/error here: expected domain errors
    // surface as 4xx, unexpected ones are logged by the exception filter.
    const startTime = Date.now()
    this.logger.debug({ context: LogContext.QUERY_BUS }, `Executing ${query.name}`)
    const result = await handler.execute(query)
    this.logger.debug(
      { context: LogContext.QUERY_BUS, durationMs: Date.now() - startTime },
      `Executed ${query.name}`,
    )
    return result
  }
}
