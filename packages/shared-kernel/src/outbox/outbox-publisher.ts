import type { CloudEvent } from '../messaging/events/cloud-event.js'
import type { IMessagePublisher } from '../messaging/interfaces/message-publisher.interface.js'
import { type ILogger, LogContext } from '../logger/index.js'
import type { ClaimedOutboxEvent, IOutboxStore } from './outbox.ports.js'

export interface OutboxPublisherOptions {
  store: IOutboxStore
  publisher: IMessagePublisher
  logger: ILogger
  /**
   * CloudEvents `source` prefix for this service — the engine appends
   * `/<aggregateType>`. e.g. `/cortex/core-api` → `/cortex/core-api/KnowledgeItem`.
   */
  sourcePrefix: string
  maxAttempts: number
  batchSize: number
  /** Metrics hook, called once per row that has just exhausted its budget. */
  onDeadLetter?: (eventType: string) => void
}

export interface OutboxPollResult {
  claimed: number
  published: number
  failed: number
  deadLettered: number
}

/**
 * Polling Publisher (microservices.io) — the half of the Transactional Outbox that
 * moves rows from PENDING onto the wire. Extracted from core-api 2026-08-24 so the
 * second service to adopt the outbox wires ~20 lines instead of copying this loop:
 * the pattern is identical wherever it is used, only the storage adapter and the
 * scheduler differ.
 *
 * Framework-free on purpose — no scheduler, no DI decorator, no metrics client.
 * The caller owns the tick (`@Interval`, cron, a queue trigger) and calls
 * `pollOnce()`; re-entrancy guarding belongs to the caller too, since only it knows
 * whether its ticks can overlap.
 *
 * Stale-INFLIGHT recovery after a publisher crash is a SEPARATE concern with a
 * different cadence and stays a per-service job talking to the repository directly
 * — `reapStaleInflight` is one line, and wrapping a one-liner in a port is the
 * ceremony `resilience_patterns.md` §6.1 warns about.
 */
export class OutboxPublisher {
  constructor(private readonly opts: OutboxPublisherOptions) {}

  private toCloudEvent(event: ClaimedOutboxEvent): CloudEvent {
    // Internal outbox row → the public CloudEvents 1.0 wire contract. This mapping
    // is the same in every service; only `sourcePrefix` differs.
    return {
      specversion: '1.0',
      id: event.id,
      source: `${this.opts.sourcePrefix}/${event.aggregateType}`,
      type: event.eventType,
      time: event.createdAt.toISOString(),
      subject: event.aggregateId,
      datacontenttype: 'application/json',
      data: event.payload,
      orgid: event.orgId,
      partitionkey: event.aggregateId,
      traceparent: event.traceparent ?? undefined,
    }
  }

  /**
   * One tick: claim a batch, publish each row, mark it. A per-row failure never
   * escapes — it is marked and the loop continues, so one bad event cannot stall
   * the rest of the batch. Only `claimPendingBatch` itself can throw out of here,
   * which the caller must catch (a background job dying quietly for a tick is the
   * exact bug fixed in core-api on 2026-07-31).
   */
  async pollOnce(): Promise<OutboxPollResult> {
    const { store, publisher, logger, maxAttempts, batchSize, onDeadLetter } = this.opts
    const events = await store.claimPendingBatch(batchSize)
    const result: OutboxPollResult = {
      claimed: events.length,
      published: 0,
      failed: 0,
      deadLettered: 0,
    }
    if (events.length === 0) return result

    for (const event of events) {
      try {
        await publisher.publish(this.toCloudEvent(event))
        await store.markProcessed(event.id)
        result.published++
      } catch (err) {
        await store.markFailed(event.id, event.attempts, String(err), maxAttempts)
        result.failed++

        // markFailed applies this same comparison internally to decide
        // PENDING (retry) vs FAILED_DLQ (terminal). Recomputed here rather than
        // returned, so the two stay in sync without widening the port for a
        // caller-only concern.
        const isNowDead = event.attempts + 1 >= maxAttempts
        if (isNowDead) {
          result.deadLettered++
          onDeadLetter?.(event.eventType)
          logger.warn(
            { context: LogContext.OUTBOX, eventId: event.id, attempts: event.attempts + 1, err },
            'Outbox event exhausted retry budget — permanently FAILED_DLQ, needs manual triage',
          )
        } else {
          logger.warn(
            { context: LogContext.OUTBOX, eventId: event.id, attempts: event.attempts + 1, err },
            'Failed to publish outbox event — will retry',
          )
        }
      }
    }
    return result
  }
}
