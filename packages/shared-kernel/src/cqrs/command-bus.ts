import { ICommand } from './interfaces/command.interface.js'
import {
  ICommandHandler,
  ISagaCommandHandler,
  ITransactionalCommandHandler,
} from './interfaces/command-handler.interface.js'
import { SagaContext, CompensationAction } from './interfaces/saga-context.interface.js'
import type { ISagaCompensationStore } from './interfaces/saga-compensation-store.interface.js'
import { ITxRunner } from '../database/tx-scope.js'
import {
  CommandHandlerNotFoundError,
  DuplicateCommandHandlerError,
  NestedSagaDispatchError,
  UnknownHandlerKindError,
} from './errors/cqrs.error.js'
import { ILogger, LogContext } from '../logger/index.js'
import { UnreachableError } from '../errors/infra-error.js'
import type { PrismaTransientErrorHelpers } from '../resilience/prisma-transient-error.js'

export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
}

/**
 * Dispatches a command through a FIXED pipeline: logging → retry → transaction →
 * handler (ADR-0001 §2.3).
 *
 * The order used to come from the order `use()` happened to be called at the
 * composition root, which made "retry must wrap the transaction" a comment rather
 * than a guarantee — swap two lines and every retry re-runs inside an already
 * aborted transaction, silently. MediatR has the same weakness (behaviour order =
 * DI registration order, no validation). It is now written into one function body,
 * the way `dotnet/eShop`'s TransactionBehavior nests `CreateExecutionStrategy`
 * around `BeginTransactionAsync`, so the wrong order is unrepresentable.
 *
 * There is no `use()` and no ICommandMiddleware any more.
 *
 * `S` is the service's ONE repos shape (see tx-scope.ts) — a service has a
 * single `CommandBus<S>` instance, parameterized once at the composition
 * root, not per-handler.
 */
export class CommandBus<S = any> {
  private readonly handlers = new Map<string, ICommandHandler>()

  constructor(
    private readonly logger: ILogger,
    private readonly txRunner: ITxRunner<S>,
    /** ORM-specific transient-error classification, injected at the composition
     * root — always sourced from ONE `makePrismaTransientErrorHelpers()` call per
     * service (never mix-and-matched), so it's a single param, not two loosely
     * paired callbacks. `recordObservation` is purely for metrics: it's called
     * AFTER the retry-or-rethrow decision has already been made (`willRetry`
     * reports it, doesn't influence it) — nothing in it can change what the bus
     * does next. */
    private readonly transientError: PrismaTransientErrorHelpers,
    private readonly retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    /** Durable retry for compensation steps that fail on their first attempt.
     * Optional — a service with no saga handlers never needs one. */
    private readonly compensationStore?: ISagaCompensationStore,
  ) {
    // `withRetry`'s loop condition is `attempt <= maxRetries`; a NaN or negative
    // value (e.g. an unset/mistyped env var coerced with `Number(...)`) makes that
    // condition false on the very first check, so the handler never runs at all
    // and every command fails with a generic UnreachableError instead of running
    // (review of ADR-0001, 2026-07-30).
    if (!Number.isInteger(retryPolicy.maxRetries) || retryPolicy.maxRetries < 0) {
      throw new RangeError(
        `RetryPolicy.maxRetries must be a non-negative integer, got ${retryPolicy.maxRetries}`,
      )
    }
  }

  /**
   * Boot-time validation. A handler with neither `kind` would otherwise skip
   * straight to `runTransactional` and fail with an unrelated `TypeError` on
   * the first request instead of at boot.
   */
  register(commandName: string, handler: ICommandHandler): void {
    if (this.handlers.has(commandName)) {
      throw new DuplicateCommandHandlerError(commandName)
    }
    if (handler.kind !== 'transactional' && handler.kind !== 'saga') {
      throw new UnknownHandlerKindError(commandName, (handler as { kind?: unknown }).kind)
    }
    this.handlers.set(commandName, handler)
    // Rechecked on every registration (not just this one) because registration
    // order is whatever the composition root's DI happens to produce: the saga
    // side of a violation may already be in the map, or may show up next. Either
    // way, the pair is only ever both present after ONE of these two calls, so
    // catching it here — synchronously, during app startup — is as early as a
    // dynamic `kind` map allows. See NestedSagaDispatchError and `dispatches` on
    // ISagaCommandHandler for why this can't just be inferred from `execute`.
    this.validateSagaDispatches()
  }

  private validateSagaDispatches(): void {
    for (const [outerName, outer] of this.handlers) {
      if (outer.kind !== 'saga') continue
      for (const innerName of outer.dispatches) {
        if (this.handlers.get(innerName)?.kind === 'saga') {
          throw new NestedSagaDispatchError(outerName, innerName)
        }
      }
    }
  }

  async execute<C extends ICommand, R = any>(command: C): Promise<R> {
    const handler = this.handlers.get(command.name) as ICommandHandler<C, R> | undefined
    if (!handler) {
      throw new CommandHandlerNotFoundError(command.name)
    }

    return this.withLogging(command, () => {
      // Sagas are never auto-retried: their side effects do not roll back, so a
      // blind retry would double-apply them. They compensate instead.
      if (handler.kind === 'saga') {
        return this.runSaga(command, handler)
      }
      return this.withRetry(command, () => this.runTransactional(command, handler))
    })
  }

  private async runTransactional<C extends ICommand, R>(
    command: C,
    handler: ITransactionalCommandHandler<C, R, S>,
  ): Promise<R> {
    const result = await this.txRunner.run((tx) => handler.execute(command, tx))
    // Only reached once the transaction has actually committed and this attempt
    // will not be retried — see ITransactionalCommandHandler.afterCommit's doc.
    //
    // Wrapped: afterCommit is a SECONDARY effect (audit log today) on top of a
    // command that has ALREADY succeeded. Letting it throw uncaught here would
    // fail a request whose real work already committed — the exact "secondary
    // failure must never mask primary success" rule the saga's own compensation
    // loop already follows. Awaited even though the interface types it `void`,
    // so an `async` implementation's rejection surfaces here instead of becoming
    // an invisible unhandled rejection.
    if (handler.afterCommit) {
      try {
        await handler.afterCommit(command, result)
      } catch (err) {
        this.logger.error(
          { context: LogContext.COMMAND_BUS, command: command.name, err },
          `afterCommit threw for ${command.name} — command already succeeded, not surfaced to caller`,
        )
      }
    }
    return result
  }

  private async runSaga<C extends ICommand, R>(
    command: C,
    handler: ISagaCommandHandler<C, R>,
  ): Promise<R> {
    const compensations: Array<{ action: CompensationAction; undo: () => Promise<void> }> = []
    const ctx: SagaContext = {
      dispatch: <TR>(inner: ICommand) => {
        // One saga owns orchestration for its flow (ADR-0001). Letting a saga
        // dispatch another saga splits compensation ownership between the two —
        // see NestedSagaDispatchError's doc.
        const innerHandler = this.handlers.get(inner.name)
        if (innerHandler?.kind === 'saga') {
          throw new NestedSagaDispatchError(command.name, inner.name)
        }
        return this.execute<ICommand, TR>(inner)
      },
      onCompensate: (action, undo) => {
        compensations.push({ action, undo })
      },
    }

    try {
      return await handler.execute(command, ctx)
    } catch (error) {
      // Reverse order: undo the most recent step first. A compensation failure is
      // logged AND (if a store is wired) durably recorded — swallowed either way,
      // it must never mask the original error the caller needs to see (previously
      // hand-rolled per-saga; now a bus guarantee).
      for (const { action, undo } of [...compensations].reverse()) {
        try {
          await undo()
        } catch (compensationError) {
          this.logger.error(
            { context: LogContext.COMMAND_BUS, command: command.name, err: compensationError },
            `Compensation step failed for ${command.name} — manual cleanup may be needed`,
          )
          await this.compensationStore?.recordFailed(command.name, action, compensationError)
        }
      }
      throw error
    }
  }

  private async withLogging<C extends ICommand, R>(command: C, next: () => Promise<R>): Promise<R> {
    const startTime = Date.now()
    this.logger.info({ context: LogContext.COMMAND_BUS }, `Executing ${command.name}...`)
    // Full input only at DEBUG (silent in prod, avoids body-volume noise). Secrets
    // (password/token/…) are masked by the root logger's `redact` config, so this
    // is safe even though the command shape is unknown here.
    this.logger.debug(
      { context: LogContext.COMMAND_BUS, input: command },
      `Input for ${command.name}`,
    )

    try {
      const result = await next()
      this.logger.info(
        { context: LogContext.COMMAND_BUS, durationMs: Date.now() - startTime },
        `Successfully executed ${command.name}`,
      )
      return result
    } catch (error) {
      this.logger.error(
        { context: LogContext.COMMAND_BUS, durationMs: Date.now() - startTime, err: error },
        `Failed to execute ${command.name}`,
      )
      throw error
    }
  }

  /**
   * Retries transient DB failures (Postgres deadlock / serialization failure).
   * Safe to apply unconditionally here because it only ever wraps the transactional
   * branch, whose every side effect rolls back on the failed attempt — Postgres
   * itself documents that applications must be prepared to retry these.
   */
  private async withRetry<C extends ICommand, R>(command: C, next: () => Promise<R>): Promise<R> {
    const { maxRetries, baseDelayMs, maxDelayMs } = this.retryPolicy
    let attempt = 0

    while (attempt <= maxRetries) {
      try {
        return await next()
      } catch (error) {
        attempt++

        const willRetry = this.transientError.isTransient(error) && attempt <= maxRetries
        this.transientError.recordObservation(error, willRetry)

        if (!willRetry) {
          throw error
        }

        // Full jitter exponential backoff: random delay in [0, min(cap, base * 2^(attempt-1))].
        // Jitter de-synchronizes concurrent transient-error victims so they don't re-collide
        // on retry in lockstep. The cap bounds tail latency of the whole retry window.
        const backoffCeiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
        const delay = Math.round(Math.random() * backoffCeiling)
        this.logger.warn(
          {
            context: LogContext.RETRY,
            command: command.name,
            attempt,
            maxRetries,
            delayMs: delay,
          },
          `Command ${command.name} failed with transient error; retrying ${attempt}/${maxRetries} after ${delay}ms`,
        )

        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new UnreachableError('Unreachable state in CommandBus retry loop')
  }
}
