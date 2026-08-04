import { DlqReplayConsumer, type DlqReplayOptions } from './dlq-replay-consumer.js'
import type { MinimalDlqConsumer, DlqEachMessagePayload } from './kafka-shapes/minimal-consumer.js'
import type { MinimalProducer } from './kafka-shapes/minimal-producer.js'
import type { ILogger } from '../logger/index.js'

function buildConsumer(): jest.Mocked<MinimalDlqConsumer> & {
  eachMessage?: (payload: DlqEachMessagePayload) => Promise<void>
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
  } as unknown as jest.Mocked<MinimalDlqConsumer> & {
    eachMessage?: (payload: DlqEachMessagePayload) => Promise<void>
  }
  return consumer
}

function buildPayload(
  overrides: {
    headers?: Record<string, string>
    value?: string | null
  } = {},
): DlqEachMessagePayload {
  return {
    topic: 'knowledge-events.DLQ',
    partition: 0,
    message: {
      key: null,
      value:
        overrides.value === undefined
          ? Buffer.from('payload-bytes')
          : overrides.value === null
            ? null
            : Buffer.from(overrides.value),
      offset: '10',
      headers: overrides.headers ?? { 'x-original-topic': 'knowledge-events' },
    },
  }
}

describe('DlqReplayConsumer', () => {
  let logger: jest.Mocked<ILogger>
  let producer: jest.Mocked<MinimalProducer>
  let consumer: ReturnType<typeof buildConsumer>
  let sleep: jest.Mock
  let random: jest.Mock

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    producer = {
      send: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    }
    consumer = buildConsumer()
    sleep = jest.fn().mockResolvedValue(undefined)
    // Deterministic: full-jitter picks the top of the range, i.e. no jitter.
    random = jest.fn().mockReturnValue(0.999999)
  })

  const buildRunner = (opts: Partial<DlqReplayOptions> = {}) =>
    new DlqReplayConsumer({
      consumer,
      dlqTopics: ['knowledge-events.DLQ'],
      producer,
      logger,
      sleep,
      random,
      ...opts,
    })

  it('nên republish message tới x-original-topic, tăng x-dlq-replay-count', async () => {
    const runner = buildRunner()
    await runner.start()

    await consumer.eachMessage!(
      buildPayload({
        headers: { 'x-original-topic': 'knowledge-events', 'x-dlq-reason': 'handler-error' },
      }),
    )

    expect(producer.send).toHaveBeenCalledWith({
      topic: 'knowledge-events',
      messages: [
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-original-topic': 'knowledge-events',
            'x-dlq-replay-count': '1',
          }),
        }),
      ],
    })
    expect(consumer.commitOffsets).toHaveBeenCalled()
  })

  it('nên đợi trước khi republish (không replay ngay lập tức) — full jitter trên base delay', async () => {
    const runner = buildRunner({ baseReplayDelayMs: 5000, maxReplayDelayMs: 100_000 })
    await runner.start()

    await consumer.eachMessage!(buildPayload())

    // random() ~ 0.999999, replayCount 0 → delay ≈ random * min(cap, 5000 * 2^0) ≈ 5000
    expect(sleep).toHaveBeenCalledWith(4999)
  })

  it('delay tăng theo cấp số nhân với x-dlq-replay-count', async () => {
    const runner = buildRunner({ baseReplayDelayMs: 5000, maxReplayDelayMs: 100_000 })
    await runner.start()

    await consumer.eachMessage!(
      buildPayload({
        headers: { 'x-original-topic': 'knowledge-events', 'x-dlq-replay-count': '2' },
      }),
    )

    // replayCount 2 → base * 2^2 = 20000
    expect(sleep).toHaveBeenCalledWith(19999)
  })

  it('delay bị chặn trên bởi maxReplayDelayMs dù exponential đã vượt', async () => {
    const runner = buildRunner({ baseReplayDelayMs: 60_000, maxReplayDelayMs: 90_000 })
    await runner.start()

    await consumer.eachMessage!(
      buildPayload({
        headers: { 'x-original-topic': 'knowledge-events', 'x-dlq-replay-count': '2' },
      }),
    )

    // exponential = 60000 * 2^2 = 240000, nhưng cap ở 90000
    expect(sleep).toHaveBeenCalledWith(89999)
  })

  it('random() = 0 → delay 0 (full jitter cho phép replay gần như ngay nếu may mắn)', async () => {
    random.mockReturnValue(0)
    const runner = buildRunner({ baseReplayDelayMs: 5000 })
    await runner.start()

    await consumer.eachMessage!(buildPayload())

    expect(sleep).toHaveBeenCalledWith(0)
  })

  it('bỏ cuộc (KHÔNG replay nữa) khi x-dlq-replay-count đã đạt maxReplays', async () => {
    const onGiveUp = jest.fn()
    const runner = buildRunner({ maxReplays: 2, onGiveUp })
    await runner.start()

    await consumer.eachMessage!(
      buildPayload({
        headers: { 'x-original-topic': 'knowledge-events', 'x-dlq-replay-count': '2' },
      }),
    )

    expect(producer.send).not.toHaveBeenCalled()
    expect(onGiveUp).toHaveBeenCalledWith('knowledge-events')
    expect(consumer.commitOffsets).toHaveBeenCalled()
  })

  it('bỏ qua an toàn khi thiếu x-original-topic (không throw, không kẹt partition)', async () => {
    const runner = buildRunner()
    await runner.start()

    await consumer.eachMessage!(buildPayload({ headers: {} }))

    expect(producer.send).not.toHaveBeenCalled()
    expect(consumer.commitOffsets).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it('gọi onReplay với replayCount mới sau khi republish thành công', async () => {
    const onReplay = jest.fn()
    const runner = buildRunner({ onReplay })
    await runner.start()

    await consumer.eachMessage!(
      buildPayload({
        headers: { 'x-original-topic': 'knowledge-events', 'x-dlq-replay-count': '1' },
      }),
    )

    expect(onReplay).toHaveBeenCalledWith('knowledge-events', 2)
  })
})
