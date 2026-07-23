import { CloudEvent } from '../events/cloud-event.js'
import { ILogger, LogContext } from '../logger/index.js'
import { runWithTraceContext, startTraceContext } from '../tracing/trace-context.js'
import { EventRouter } from './event-router.js'

/**
 * Structural subset of a kafkajs Consumer — just what the runner calls. Typing
 * it structurally keeps shared-kernel free of a kafkajs dependency (each service
 * owns its Kafka client); any kafkajs Consumer is assignable as-is.
 */
export interface MinimalKafkaMessage {
  key: Buffer | null
  value: Buffer | null
  offset: string
}

export interface MinimalEachMessagePayload {
  topic: string
  partition: number
  message: MinimalKafkaMessage
}

export interface MinimalConsumer {
  connect(): Promise<void>
  subscribe(subscription: { topic: string; fromBeginning: boolean }): Promise<void>
  run(config: {
    autoCommit: boolean
    eachMessage: (payload: MinimalEachMessagePayload) => Promise<void>
  }): Promise<void>
  commitOffsets(offsets: { topic: string; partition: number; offset: string }[]): Promise<void>
  disconnect(): Promise<void>
}

/**
 * Everything a dead-letter producer needs to reconstruct the original message
 * and record why it died. Shared by the port below and every per-service
 * DeadLetterProducer implementation — declare it once here instead of each
 * service re-typing the same shape.
 */
export interface DeadLetterInput {
  topic: string
  key: Buffer | string | null
  value: Buffer | string | null
  reason: 'poison-pill' | 'handler-error'
  error: string
  partition: number
  offset: string
}

/** Outbound port to a per-service dead-letter producer (`<topic>.DLQ`). */
export interface DeadLetterPort {
  send(input: DeadLetterInput): Promise<void>
}

export interface ResilientConsumerOptions {
  consumer: MinimalConsumer
  topics: string[]
  router: EventRouter
  deadLetter: DeadLetterPort
  logger: ILogger
  /** Bounded in-process retry before dead-lettering (linear backoff). */
  maxRetries?: number
  retryBackoffMs?: number
  /** Metrics hook — called once per retry attempt (e.g. prom counter.inc). */
  onRetry?: (eventType: string) => void
  /** Test seam; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * The one at-least-once consumption loop every consumer service runs
 * (eventing_patterns.md §4.2), extracted so a new consumer is ~30 lines of
 * wiring instead of a ~150-line copy of this logic. Semantics:
 *
 * - autoCommit OFF; the offset is committed after success OR after the message
 *   is dead-lettered — the partition never stalls behind one bad message.
 * - Poison pill (unparseable/invalid envelope) → DLQ immediately (retry is
 *   pointless) + commit.
 * - Handler error → bounded linear-backoff retry; budget exhausted → DLQ +
 *   commit. Transient failures recover, permanent ones are isolated for triage.
 * - Empty value (tombstone) → commit and move on.
 *
 * Handlers stay idempotent (enforced via IIntegrationEventHandler.idempotency),
 * so the redeliveries this policy allows are always safe to re-apply.
 */
export class ResilientEventConsumer {
  private readonly maxRetries: number
  private readonly retryBackoffMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: ResilientConsumerOptions) {
    this.maxRetries = opts.maxRetries ?? 3
    this.retryBackoffMs = opts.retryBackoffMs ?? 500
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async start(): Promise<void> {
    const { consumer, topics, logger } = this.opts

    await consumer.connect()
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false })
    }

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const commit = () =>
          consumer.commitOffsets([{ topic, partition, offset: String(Number(message.offset) + 1) }])

        const raw = message.value?.toString()
        if (!raw) {
          await commit()
          return
        }

        let event: CloudEvent
        try {
          event = JSON.parse(raw) as CloudEvent
          if (!event.id || !event.type) throw new Error('missing id or type')
        } catch (err) {
          logger.error(
            { context: LogContext.EVENT_ROUTER, err, raw },
            'Poison pill — dead-lettering message',
          )
          await this.opts.deadLetter.send({
            topic,
            key: message.key,
            value: message.value,
            reason: 'poison-pill',
            error: String(err),
            partition,
            offset: message.offset,
          })
          await commit()
          return
        }

        // Resumes the traceId of the request that produced this event (via the
        // CloudEvent's `traceparent` extension), minting a new spanId for this
        // consumer's own processing — every log call inside this scope (here
        // and anywhere routeWithRetry/router.route logs) automatically picks
        // up trace_id/span_id/parent_span_id via the logger's pino hook, no
        // per-call-site wiring needed (logger/index.ts traceLogMethodHook).
        const traceCtx = startTraceContext(event.traceparent)
        await runWithTraceContext(traceCtx, async () => {
          try {
            await this.routeWithRetry(event)
          } catch (err) {
            logger.error(
              { context: LogContext.EVENT_ROUTER, err, eventId: event.id, eventType: event.type },
              'Handler failed after retries — dead-lettering message',
            )
            await this.opts.deadLetter.send({
              topic,
              key: message.key,
              value: message.value,
              reason: 'handler-error',
              error: String(err),
              partition,
              offset: message.offset,
            })
          }
        })

        await commit()
      },
    })

    this.opts.logger.info(
      { context: LogContext.EVENT_ROUTER, topics },
      'ResilientEventConsumer started',
    )
  }

  async stop(): Promise<void> {
    await this.opts.consumer.disconnect()
  }

  private async routeWithRetry(event: CloudEvent): Promise<void> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.opts.router.route(event)
        return
      } catch (err) {
        lastErr = err
        if (attempt < this.maxRetries) {
          this.opts.onRetry?.(event.type)
          this.opts.logger.warn(
            {
              context: LogContext.EVENT_ROUTER,
              err,
              eventId: event.id,
              eventType: event.type,
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
            },
            'Handler error — retrying',
          )
          await this.sleep(this.retryBackoffMs * (attempt + 1))
        }
      }
    }
    throw lastErr
  }
}
