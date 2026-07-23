import { EventBus } from './event-bus.js'
import type { IEvent } from './interfaces/event.interface.js'
import type { IEventHandler } from './interfaces/event-handler.interface.js'
import type { ILogger } from '../logger/index.js'

const makeEvent = (name = 'TestEvent'): IEvent => ({ name }) as unknown as IEvent

// EventBus publish() không await handler (fire-and-forget qua EventEmitter) —
// dùng flushPromises để đợi hết microtask queue trước khi assert.
const flushPromises = () => new Promise((resolve) => setImmediate(resolve))

describe('EventBus', () => {
  let bus: EventBus
  let logger: jest.Mocked<ILogger>

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    bus = new EventBus(logger)
  })

  it('nên gọi mọi handler đã register cho đúng tên event', async () => {
    const handler: jest.Mocked<IEventHandler<IEvent>> = { handle: jest.fn().mockResolvedValue(undefined) }
    bus.register('TestEvent', handler)

    bus.publish(makeEvent('TestEvent'))
    await flushPromises()

    expect(handler.handle).toHaveBeenCalledTimes(1)
  })

  it('publish một event không có handler đăng ký thì không ném lỗi (fire-and-forget), nhưng PHẢI log warn (2026-07-25, trước đó im lặng hoàn toàn)', async () => {
    expect(() => bus.publish(makeEvent('NoHandlerEvent'))).not.toThrow()
    await flushPromises()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'EventBus', eventName: 'NoHandlerEvent' }),
      'No handler registered — event published with zero listeners',
    )
  })

  it('publish một event CÓ handler thì KHÔNG log warn "no handler"', async () => {
    const handler: jest.Mocked<IEventHandler<IEvent>> = { handle: jest.fn().mockResolvedValue(undefined) }
    bus.register('TestEvent', handler)

    bus.publish(makeEvent('TestEvent'))
    await flushPromises()

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('nên hỗ trợ nhiều handler cho cùng 1 event name', async () => {
    const handler1: jest.Mocked<IEventHandler<IEvent>> = { handle: jest.fn().mockResolvedValue(undefined) }
    const handler2: jest.Mocked<IEventHandler<IEvent>> = { handle: jest.fn().mockResolvedValue(undefined) }
    bus.register('TestEvent', handler1)
    bus.register('TestEvent', handler2)

    bus.publish(makeEvent('TestEvent'))
    await flushPromises()

    expect(handler1.handle).toHaveBeenCalledTimes(1)
    expect(handler2.handle).toHaveBeenCalledTimes(1)
  })

  it('handler lỗi phải bị bắt và log, KHÔNG được làm crash emitter hay chặn handler khác', async () => {
    const failing: jest.Mocked<IEventHandler<IEvent>> = {
      handle: jest.fn().mockRejectedValue(new Error('handler boom')),
    }
    const healthy: jest.Mocked<IEventHandler<IEvent>> = { handle: jest.fn().mockResolvedValue(undefined) }
    bus.register('TestEvent', failing)
    bus.register('TestEvent', healthy)

    expect(() => bus.publish(makeEvent('TestEvent'))).not.toThrow()
    await flushPromises()

    expect(healthy.handle).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
