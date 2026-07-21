import { Counter, Gauge } from 'prom-client'
import type { ILogger } from '../logger/index.js'

type State = 'closed' | 'open' | 'half-open'

const STATE_VALUE: Record<State, number> = { closed: 0, 'half-open': 1, open: 2 }

// Module-level singletons (Node caches the module) — every CircuitBreaker
// instance across every service shares these, distinguished by the `name`
// label. Surfaces automatically on GET /metrics (same convention as
// notification.metrics.ts / search.metrics.ts).
const stateGauge = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Current circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['name'] as const,
})
const transitionsCounter = new Counter({
  name: 'circuit_breaker_transitions_total',
  help: 'Circuit breaker state transitions',
  labelNames: ['name', 'state'] as const,
})

/**
 * Generic Circuit Breaker for any unreliable external call (AI provider,
 * Elasticsearch, gRPC...) — see resilience_patterns.md §3.1 (Circuit Breaker).
 * After `threshold` consecutive failures it trips OPEN and fails fast
 * for `timeoutMs` (no calls hit the failing dependency), then HALF-OPENs to
 * probe recovery. One success closes it. Keeps a flaky/slow dependency from
 * becoming the caller's own latency.
 */
export class CircuitBreaker {
  private state: State = 'closed'
  private failureCount = 0
  private lastFailureTime = 0

  constructor(
    private readonly name: string,
    private readonly logger: ILogger,
    private readonly threshold = 5,
    private readonly timeoutMs = 60_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // `half-open` itself IS the mutex — it only exists between the moment ONE
    // caller claims the probe (below) and that probe resolving (onSuccess/
    // onFailure always move state away from half-open). Any other call that
    // lands here while state is still half-open is a concurrent caller arriving
    // at (or after) the same instant the timeout elapsed — it must NOT also
    // probe. Without this check, a thundering herd all treats itself as THE
    // probe and hits the still-recovering dependency at once, defeating the
    // point of probing gently. (No separate boolean flag needed — the state
    // transition into/out of half-open only ever happens on the synchronous
    // portion of execute()/onSuccess()/onFailure(), before any `await` yields
    // control back to the event loop, so it can't race with itself.)
    if (this.state === 'half-open') {
      throw new Error('Circuit open')
    }
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime <= this.timeoutMs) {
        throw new Error('Circuit open')
      }
      this.setState('half-open') // claim the probe slot
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure(err)
      throw err
    }
  }

  get currentState(): State {
    return this.state
  }

  private setState(next: State): void {
    this.state = next
    stateGauge.labels(this.name).set(STATE_VALUE[next])
    transitionsCounter.labels(this.name, next).inc()
  }

  private onSuccess(): void {
    if (this.state !== 'closed') {
      this.logger.info({ state: 'closed' }, 'Circuit recovered — closing')
    }
    this.failureCount = 0
    this.setState('closed')
  }

  private onFailure(err: unknown): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    this.logger.warn({ err, failureCount: this.failureCount }, 'Call failed')
    if (this.failureCount >= this.threshold && this.state !== 'open') {
      this.setState('open')
      this.logger.error({ state: 'open' }, 'Circuit breaker OPEN')
    }
  }
}
