import { ResilientEventConsumer } from './resilient-consumer.js'
import { EventRouter } from './event-router.js'
import type { IDeadLetterProducer } from './interfaces/dead-letter.interface.js'
import type { MinimalConsumer, MinimalEachMessagePayload } from './kafka-shapes/minimal-consumer.js'
import type { ILogger } from '../logger/index.js'

function buildConsumer(): jest.Mocked<MinimalConsumer> & {
  eachMessage?: (payload: MinimalEachMessagePayload) => Promise<void>
} {
  const consumer = {
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest
      .fn()
      .mockImplementation(async (config: { eachMessage: typeof consumer.eachMessage }) => {
        consumer.eachMessage = config.eachMessage
      }),
    commitOffsets: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MinimalConsumer> & {
    eachMessage?: (payload: MinimalEachMessagePayload) => Promise<void>
  }
  return consumer
}

function buildPayload(value: string | null, overrides: Partial<MinimalEachMessagePayload> = {}) {
  return {
    topic: 'knowledge-events',
    partition: 0,
    message: { key: null, value: value === null ? null : Buffer.from(value), offset: '10' },
    ...overrides,
  } as MinimalEachMessagePayload
}

function validEventJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    specversion: '1.0',
    id: 'event-1',
    source: '/test',
    type: 'KNOWLEDGE_PUBLISHED',
    time: new Date().toISOString(),
    data: {},
    orgid: 'org-1',
    partitionkey: 'key-1',
    ...overrides,
  })
}

describe('ResilientEventConsumer', () => {
  let logger: jest.Mocked<ILogger>
  let deadLetter: jest.Mocked<IDeadLetterProducer>
  let router: EventRouter
  let consumer: jest.Mocked<MinimalConsumer> & {
    eachMessage?: (payload: MinimalEachMessagePayload) => Promise<void>
  }
  let sleep: jest.Mock

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    deadLetter = { send: jest.fn().mockResolvedValue(undefined) }
    router = new EventRouter(logger)
    consumer = buildConsumer()
    sleep = jest.fn().mockResolvedValue(undefined) // test seam — no real delay
  })

  describe('start()', () => {
    it('nên connect, subscribe từng topic với fromBeginning:false, và run với autoCommit:false', async () => {
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['topic-a', 'topic-b'],
        router,
        deadLetter,
        logger,
        sleep,
      })

      await runner.start()

      expect(consumer.connect).toHaveBeenCalledTimes(1)
      expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'topic-a', fromBeginning: false })
      expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'topic-b', fromBeginning: false })
      expect(consumer.run).toHaveBeenCalledWith(expect.objectContaining({ autoCommit: false }))
    })
  })

  describe('stop()', () => {
    it('nên disconnect consumer', async () => {
      const runner = new ResilientEventConsumer({
        consumer,
        topics: [],
        router,
        deadLetter,
        logger,
        sleep,
      })
      await runner.stop()
      expect(consumer.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('eachMessage — tombstone (value rỗng)', () => {
    it('nên commit ngay và bỏ qua, không gọi router/deadLetter', async () => {
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload(null))

      expect(consumer.commitOffsets).toHaveBeenCalledWith([
        { topic: 'knowledge-events', partition: 0, offset: '11' },
      ])
      expect(deadLetter.send).not.toHaveBeenCalled()
    })
  })

  describe('eachMessage — poison pill', () => {
    it('JSON không parse được → dead-letter reason poison-pill, rồi vẫn commit', async () => {
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload('{not-json'))

      expect(deadLetter.send).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'poison-pill' }),
      )
      expect(consumer.commitOffsets).toHaveBeenCalledTimes(1)
    })

    it('JSON hợp lệ nhưng thiếu id/type → dead-letter reason poison-pill (envelope invalid, retry vô ích)', async () => {
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload(JSON.stringify({ specversion: '1.0' })))

      expect(deadLetter.send).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'poison-pill' }),
      )
    })
  })

  describe('eachMessage — handler thành công', () => {
    it('nên route đúng 1 lần, commit, không dead-letter, không sleep', async () => {
      const handler = {
        eventType: 'KNOWLEDGE_PUBLISHED',
        idempotency: 'natural-key' as const,
        handle: jest.fn().mockResolvedValue(undefined),
      }
      router.register(handler)
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload(validEventJson()))

      expect(handler.handle).toHaveBeenCalledTimes(1)
      expect(deadLetter.send).not.toHaveBeenCalled()
      expect(sleep).not.toHaveBeenCalled()
      expect(consumer.commitOffsets).toHaveBeenCalledTimes(1)
    })
  })

  describe('eachMessage — handler lỗi rồi hồi phục trong budget retry', () => {
    it('nên retry với linear backoff (retryBackoffMs × lần thử) và gọi onRetry mỗi lần', async () => {
      const handler = {
        eventType: 'KNOWLEDGE_PUBLISHED',
        idempotency: 'natural-key' as const,
        handle: jest
          .fn()
          .mockRejectedValueOnce(new Error('transient 1'))
          .mockRejectedValueOnce(new Error('transient 2'))
          .mockResolvedValueOnce(undefined),
      }
      router.register(handler)
      const onRetry = jest.fn()
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
        maxRetries: 3,
        retryBackoffMs: 500,
        onRetry,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload(validEventJson()))

      expect(handler.handle).toHaveBeenCalledTimes(3)
      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(sleep).toHaveBeenNthCalledWith(1, 500) // backoff * (attempt+1), attempt=0
      expect(sleep).toHaveBeenNthCalledWith(2, 1000) // attempt=1
      expect(deadLetter.send).not.toHaveBeenCalled()
      expect(consumer.commitOffsets).toHaveBeenCalledTimes(1)
    })
  })

  describe('eachMessage — hết budget retry', () => {
    it('nên dead-letter reason handler-error sau maxRetries lần thử, rồi vẫn commit (không kẹt partition)', async () => {
      const err = new Error('always fails')
      const handler = {
        eventType: 'KNOWLEDGE_PUBLISHED',
        idempotency: 'natural-key' as const,
        handle: jest.fn().mockRejectedValue(err),
      }
      router.register(handler)
      const runner = new ResilientEventConsumer({
        consumer,
        topics: ['t'],
        router,
        deadLetter,
        logger,
        sleep,
        maxRetries: 2,
      })
      await runner.start()

      await consumer.eachMessage!(buildPayload(validEventJson()))

      expect(handler.handle).toHaveBeenCalledTimes(3) // 1 lần đầu + 2 retry
      expect(deadLetter.send).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'handler-error', error: String(err) }),
      )
      expect(consumer.commitOffsets).toHaveBeenCalledTimes(1)
    })
  })
})
