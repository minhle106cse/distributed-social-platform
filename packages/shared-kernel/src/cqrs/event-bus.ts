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
    // emit() returns false when zero listeners were registered for this name —
    // the EventEmitter equivalent of EventRouter's "no handler registered" case
    // (route.ts, 2026-07-25). Without this check, a typo'd event name or a
    // handler removed without updating the publish call site fails completely
    // silently — found as a real gap during the 2026-07-25 gateway audit.
    const hadListeners = this.eventEmitter.emit(event.name, event)
    if (!hadListeners) {
      this.logger.warn(
        { context: LogContext.EVENT_BUS, eventName: event.name },
        'No handler registered — event published with zero listeners',
      )
    }
  }
}
