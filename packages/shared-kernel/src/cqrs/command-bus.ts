import { ICommand } from './interfaces/command.interface.js';
import { ICommandHandler } from './interfaces/command-handler.interface.js';
import { ICommandMiddleware, NextFn } from './interfaces/command-middleware.interface.js';
import { CommandHandlerNotFoundError } from './errors/cqrs.error.js';

export class CommandBusService {
  private handlers = new Map<string, ICommandHandler>();
  private middlewares: ICommandMiddleware[] = [];

  constructor() {}

  register(commandName: string, handler: ICommandHandler) {
    this.handlers.set(commandName, handler);
  }

  use(...middlewares: ICommandMiddleware[]) {
    this.middlewares.push(...middlewares);
  }

  async execute<T extends ICommand, R = any>(command: T): Promise<R> {
    const handler = this.handlers.get(command.name);
    if (!handler) {
      throw new CommandHandlerNotFoundError(command.name);
    }

    let index = -1;
    const dispatch = async (i: number): Promise<R> => {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;

      if (i < this.middlewares.length) {
        const middleware = this.middlewares[i];
        return middleware.execute(command, () => dispatch(i + 1));
      } else {
        return handler.execute(command);
      }
    };

    return dispatch(0);
  }
}
