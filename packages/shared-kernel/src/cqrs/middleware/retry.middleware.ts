import { ICommandMiddleware, NextFn } from '../interfaces/command-middleware.interface.js'
import { ICommand } from '../interfaces/command.interface.js'
import { ILogger, LogContext } from '../../logger/index.js'
import { UnreachableError } from '../../errors/infra-error.js'

/**
 * Retries transient command failures with exponential backoff.
 * Uses an injected predicate to classify transient errors, so this class
 * has zero knowledge of any specific database/ORM. Hexagonal Architecture compliant.
 *
 * Fires for any `transactional:true` command — there is no separate opt-in flag
 * (removed 2026-07-14, resilience_patterns.md §3). `transactional:true` already IS
 * the precondition for safe blind retry (every side effect rolls back on the
 * failed attempt), so gating on it directly means every transactional command
 * gets deadlock protection automatically instead of needing someone to remember
 * to flip a second flag. A command whose handler does something retry-unsafe
 * (an external call mid-handler) must be `transactional:false` and use an
 * app-level saga with compensation instead — see `ProvisionOrgCommand`.
 */
export class RetryMiddleware implements ICommandMiddleware {
  constructor(
    private readonly logger: ILogger,
    private readonly isTransientError: (error: unknown) => boolean,
    private readonly maxRetries: number = 3,
    private readonly baseDelayMs: number = 100,
    private readonly maxDelayMs: number = 2_000,
    /**
     * Observability seam, called once per caught error on a transactional command —
     * BEFORE the retry/rethrow decision, and regardless of which way it goes.
     * Stays ORM-agnostic on purpose (raw `error` + the boolean this middleware
     * already computed): the ORM-specific classification (e.g. mapping a Prisma
     * error to a P-code label) belongs at the composition root, the one place
     * that already knows about Prisma (see isPrismaTransientError's own comment).
     * Exists so a decision like "stop auto-retrying P2028" can be revisited with
     * real observed frequency instead of a guess (resilience_patterns.md §3).
     */
    private readonly onError?: (error: unknown, willRetry: boolean) => void,
  ) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    if (!command.options?.transactional) {
      return next()
    }

    let attempt = 0

    while (attempt <= this.maxRetries) {
      try {
        return await next()
      } catch (error) {
        attempt++

        const willRetry = this.isTransientError(error) && attempt <= this.maxRetries
        this.onError?.(error, willRetry)

        if (!willRetry) {
          throw error
        }

        // Full jitter exponential backoff: random delay in [0, min(cap, base * 2^(attempt-1))].
        // Jitter de-synchronizes concurrent transient-error victims so they don't re-collide
        // on retry in lockstep. The cap bounds tail latency of the whole retry window.
        const backoffCeiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1))
        const delay = Math.round(Math.random() * backoffCeiling)
        this.logger.warn(
          {
            context: LogContext.RETRY,
            command: command.name,
            attempt,
            maxRetries: this.maxRetries,
            delayMs: delay,
          },
          `Command ${command.name} failed with transient error; retrying ${attempt}/${this.maxRetries} after ${delay}ms`,
        )

        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new UnreachableError('Unreachable state in RetryMiddleware')
  }
}
