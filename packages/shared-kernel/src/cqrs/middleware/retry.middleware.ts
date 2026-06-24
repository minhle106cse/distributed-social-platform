import { ICommandMiddleware, NextFn } from '../interfaces/command-middleware.interface.js';
import { ICommand } from '../interfaces/command.interface.js';
import { ILogger } from '../../logger/index.js';
import { UnreachableError } from '../../errors/infra-error.js';

/**
 * Retries transient command failures with exponential backoff.
 * Uses an injected predicate to classify transient errors, so this class
 * has zero knowledge of any specific database/ORM. Hexagonal Architecture compliant.
 */
export class RetryMiddleware implements ICommandMiddleware {
  constructor(
    private readonly logger: ILogger,
    private readonly isTransientError: (error: unknown) => boolean,
    private readonly maxRetries: number = 3,
    private readonly baseDelayMs: number = 100,
    private readonly maxDelayMs: number = 2_000,
  ) {}

  async execute<T extends ICommand, R = any>(command: T, next: NextFn<R>): Promise<R> {
    if (!command.options?.retryable) {
      return next();
    }

    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        return await next();
      } catch (error) {
        attempt++;

        if (!this.isTransientError(error) || attempt > this.maxRetries) {
          throw error;
        }

        // Full jitter exponential backoff: random delay in [0, min(cap, base * 2^(attempt-1))].
        // Jitter de-synchronizes concurrent deadlock victims (P2034) so they don't re-collide
        // on retry in lockstep. The cap bounds tail latency under connection issues (P2028).
        const backoffCeiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
        const delay = Math.round(Math.random() * backoffCeiling);
        this.logger.warn(
          `[RetryMiddleware] Command ${command.name} failed with transient error. Retrying ${attempt}/${this.maxRetries} after ${delay}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new UnreachableError('Unreachable state in RetryMiddleware');
  }
}
