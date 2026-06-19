import { ICommand } from './command.interface.js';

export type NextFn<R = any> = () => Promise<R>;

export interface ICommandMiddleware {
  execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R>;
}
