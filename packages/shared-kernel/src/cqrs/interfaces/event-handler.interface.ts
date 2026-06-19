import { IEvent } from './event.interface.js';

export interface IEventHandler<T extends IEvent = any> {
  handle(event: T): Promise<void> | void;
}
