import { ILogger, LogContext } from '../logger/index.js'
import type { MinimalDlqConsumer } from './kafka-shapes/minimal-consumer.js'
import type { MinimalProducer } from './kafka-shapes/minimal-producer.js'

/** Header value as kafkajs hands it back — normalize to a plain string. */
function headerToString(
  value: Buffer | string | (Buffer | string)[] | undefined,
): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  if (v === undefined) return undefined
  return Buffer.isBuffer(v) ? v.toString() : v
}

export interface DlqReplayOptions {
  consumer: MinimalDlqConsumer
  /** `<topic>.DLQ` names — NOT the original topics (see `deadLetterTopic()`). */
  dlqTopics: string[]
  producer: MinimalProducer
  logger: ILogger
  /** Replays exhausted → give up (message stays in the DLQ topic for manual
   * triage via Kafka retention; this consumer stops touching it). Default 3. */
  maxReplays?: number
  /** Pacing delay before each replay — DLQ messages already exhausted in-process
   * retry moments ago; replaying instantly just reproduces the same failure
   * immediately. Default 60s gives a transient downstream outage room to clear. */
  replayDelayMs?: number
  /** Metrics hook — called once per message given up on permanently. */
  onGiveUp?: (originalTopic: string) => void
  /** Metrics hook — called once per message successfully replayed. */
  onReplay?: (originalTopic: string, replayCount: number) => void
  /** Test seam; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Closes the gap DeadLetterProducer's own doc names: DLQ topics are
 * "isolated for triage instead of dropped" — but nothing consumed them, so
 * "triage" meant a human reading Kafka UI by hand indefinitely (review of
 * ADR-0001, 2026-07-30 — the same "durable store with no reprocessor" gap
 * found for saga compensation, confirmed to also apply here).
 *
 * Tracks replay attempts in a header (`x-dlq-replay-count`) carried on the
 * republished message, so this consumer is stateless across restarts — the
 * count lives on the message, not in a side table. Republishes the ORIGINAL
 * bytes to `x-original-topic` (a header DeadLetterProducer already writes),
 * letting the normal consumer group reprocess it exactly like any other
 * (redelivered) message — idempotency is still the handler's job, unchanged.
 */
export class DlqReplayConsumer {
  private readonly maxReplays: number
  private readonly replayDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: DlqReplayOptions) {
    this.maxReplays = opts.maxReplays ?? 3
    this.replayDelayMs = opts.replayDelayMs ?? 60_000
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async start(): Promise<void> {
    const { consumer, dlqTopics, logger } = this.opts

    await consumer.connect()
    for (const topic of dlqTopics) {
      await consumer.subscribe({ topic, fromBeginning: false })
    }

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const commit = () =>
          consumer.commitOffsets([{ topic, partition, offset: String(Number(message.offset) + 1) }])

        const headers = message.headers ?? {}
        const originalTopic = headerToString(headers['x-original-topic'])
        const replayCount = Number(headerToString(headers['x-dlq-replay-count']) ?? '0')

        if (!originalTopic) {
          // DeadLetterProducer always sets this — defensive only, should be unreachable.
          logger.error(
            { context: LogContext.EVENT_ROUTER, dlqTopic: topic },
            'DLQ message missing x-original-topic header — cannot replay, skipping',
          )
          await commit()
          return
        }

        if (replayCount >= this.maxReplays) {
          logger.warn(
            { context: LogContext.EVENT_ROUTER, originalTopic, replayCount },
            'Giving up on DLQ message after exhausting replay budget — needs manual triage',
          )
          this.opts.onGiveUp?.(originalTopic)
          await commit()
          return
        }

        await this.sleep(this.replayDelayMs)

        const stringHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(headers)) {
          const v = headerToString(value)
          if (v !== undefined) stringHeaders[key] = v
        }
        stringHeaders['x-dlq-replay-count'] = String(replayCount + 1)

        await this.opts.producer.send({
          topic: originalTopic,
          messages: [{ key: message.key, value: message.value, headers: stringHeaders }],
        })

        logger.info(
          { context: LogContext.EVENT_ROUTER, originalTopic, replayCount: replayCount + 1 },
          'Replayed DLQ message back to its original topic',
        )
        this.opts.onReplay?.(originalTopic, replayCount + 1)
        await commit()
      },
    })

    this.opts.logger.info(
      { context: LogContext.EVENT_ROUTER, dlqTopics },
      'DlqReplayConsumer started',
    )
  }

  async stop(): Promise<void> {
    await this.opts.consumer.disconnect()
  }
}
