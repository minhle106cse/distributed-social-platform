import { IQuery } from './interfaces/query.interface.js';
import { IQueryHandler } from './interfaces/query-handler.interface.js';
import { QueryHandlerNotFoundError } from './errors/cqrs.error.js';

export class QueryBusService {
  private handlers = new Map<string, IQueryHandler<any, any>>();

  register(queryName: string, handler: IQueryHandler<any, any>) {
    this.handlers.set(queryName, handler);
  }

  async execute<T extends IQuery, R = any>(query: T): Promise<R> {
    const handler = this.handlers.get(query.name);
    if (!handler) {
      throw new QueryHandlerNotFoundError(query.name);
    }

    return handler.execute(query);
  }
}
