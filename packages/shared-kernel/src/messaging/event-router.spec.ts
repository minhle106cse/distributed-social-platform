import { EventRouter } from './event-router.js'
import type { IIntegrationEventHandler } from './interfaces/event-handler.interface.js'
import type { CloudEvent } from './events/cloud-event.js'
import type { ILogger } from '../logger/index.js'

function buildEvent(type: string): CloudEvent {
  return {
    specversion: '1.0',
    id: 'event-1',
    source: '/test',
    type,
    time: new Date().toISOString(),
    data: {},
    orgid: 'org-1',
    partitionkey: 'key-1',
  }
}

function buildHandler(eventType: string): jest.Mocked<IIntegrationEventHandler> {
  return { eventType, handle: jest.fn().mockResolvedValue(undefined) }
}

describe('EventRouter', () => {
  let logger: jest.Mocked<ILogger>
  let router: EventRouter

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    router = new EventRouter(logger)
  })

  it('register() nên ném lỗi khi 2 handler cùng đăng ký 1 eventType (chống gộp nhầm concern vào 1 consumer group)', () => {
    router.register(buildHandler('TYPE_A'))

    expect(() => router.register(buildHandler('TYPE_A'))).toThrow(/Duplicate handler/)
  })

  it('register() nên trả về `this` để cho phép chain nhiều register liên tiếp', () => {
    const result = router.register(buildHandler('TYPE_A')).register(buildHandler('TYPE_B'))

    expect(result).toBe(router)
  })

  it('route() nên gọi đúng handler theo event.type', async () => {
    const handlerA = buildHandler('TYPE_A')
    const handlerB = buildHandler('TYPE_B')
    router.register(handlerA).register(handlerB)

    await router.route(buildEvent('TYPE_B'))

    expect(handlerA.handle).not.toHaveBeenCalled()
    expect(handlerB.handle).toHaveBeenCalledTimes(1)
  })

  it('route() nên log warn và bỏ qua (không ném lỗi) khi không có handler nào khớp event.type', async () => {
    await expect(router.route(buildEvent('UNKNOWN_TYPE'))).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('route() nên propagate lỗi từ handler ra ngoài (để adapter tự quyết định retry/DLQ)', async () => {
    const err = new Error('handler failed')
    const handler = buildHandler('TYPE_A')
    handler.handle.mockRejectedValueOnce(err)
    router.register(handler)

    await expect(router.route(buildEvent('TYPE_A'))).rejects.toBe(err)
  })

  it('route() nên tự log dispatch (executing + success/duration) — đồng bộ với CommandBus.LoggingMiddleware, không cần handler tự viết log', async () => {
    const handler = buildHandler('TYPE_A')
    router.register(handler)

    await router.route(buildEvent('TYPE_A'))

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'EventRouter', type: 'TYPE_A' }),
      'Routing TYPE_A...',
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'EventRouter',
        type: 'TYPE_A',
        durationMs: expect.any(Number),
      }),
      'Routed TYPE_A',
    )
  })

  it('route() KHÔNG tự log lỗi (ResilientEventConsumer đã log retry/DLQ ở tầng trên — tránh log trùng 1 lỗi 2 tầng)', async () => {
    const err = new Error('handler failed')
    const handler = buildHandler('TYPE_A')
    handler.handle.mockRejectedValueOnce(err)
    router.register(handler)

    await expect(router.route(buildEvent('TYPE_A'))).rejects.toBe(err)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
