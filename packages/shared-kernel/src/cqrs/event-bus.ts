import { EventEmitter } from 'events'
import { IEvent } from './interfaces/event.interface.js'
import { IEventHandler } from './interfaces/event-handler.interface.js'
import { ILogger, LogContext } from '../logger/index.js'

export class EventBus {
  private eventEmitter = new EventEmitter()

  constructor(private readonly logger: ILogger) {}

  register<T extends IEvent>(eventName: string, handler: IEventHandler<T>) {
    this.eventEmitter.on(eventName, async (event: T) => {
      try {
        this.logger.debug({ context: LogContext.EVENT_BUS, eventName }, `Handling ${eventName}`)
        await handler.handle(event)
        this.logger.debug({ context: LogContext.EVENT_BUS, eventName }, `Handled ${eventName}`)
      } catch (error) {
        // In-process events are fire-and-forget: a failed handler must not crash
        // the emitter. Log with structured context instead of console.
        this.logger.error(
          { context: LogContext.EVENT_BUS, eventName, err: error },
          'Error handling event',
        )
      }
    })
  }

  publish(event: IEvent) {
    this.eventEmitter.emit(event.name, event)
  }
}
