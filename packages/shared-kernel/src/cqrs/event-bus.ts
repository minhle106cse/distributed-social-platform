import { EventEmitter } from 'events';
import { IEvent } from './interfaces/event.interface.js';
import { IEventHandler } from './interfaces/event-handler.interface.js';


export class EventBus {
  private eventEmitter = new EventEmitter();

  register<T extends IEvent>(eventName: string, handler: IEventHandler<T>) {
    this.eventEmitter.on(eventName, async (event: T) => {
      try {
        await handler.handle(event);
      } catch (error) {
        console.error(`Error handling event ${eventName}:`, error);
      }
    });
  }

  publish(event: IEvent) {
    this.eventEmitter.emit(event.name, event);
  }
}
