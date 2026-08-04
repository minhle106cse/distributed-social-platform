import { Counter } from 'prom-client'

/**
 * Structural (duck-typed) check for Prisma's `PrismaClientKnownRequestError` —
 * deliberately NOT `instanceof Prisma.PrismaClientKnownRequestError`, since that
 * would require importing `@prisma/client`/`@/generated` here, and each service
 * generates its own Prisma client from a different path. `code` + `clientVersion`
 * together are specific enough that nothing else realistically has both.
 */
function isPrismaKnownRequestError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { clientVersion?: unknown }).clientVersion === 'string'
  )
}

/**
 * A domain/application error that is safe to auto-retry even though it isn't a
 * Prisma error itself — e.g. an event-store optimistic-concurrency conflict
 * detected via a `@@unique` violation and re-thrown as a typed domain error
 * before `CommandBus` ever sees the underlying P2002. Mark it so the generic
 * transient predicate recognizes it without every service reinventing the check
 * (review of ADR-0001, 2026-07-30 — `CreditConcurrencyError` is the first user).
 */
export interface MarkedTransientError {
  readonly transient: true
}

export function isMarkedTransient(error: unknown): error is MarkedTransientError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { transient?: unknown }).transient === true
  )
}

/** Prisma error codes worth tracking the frequency of, independent of whether they
 * are currently auto-retried — kept narrow on purpose (see `recordObservation` doc). */
const OBSERVED_CODES = new Set(['P2034', 'P2028'])

export interface PrismaTransientErrorHelpers {
  isTransient: (error: unknown) => boolean
  recordObservation: (error: unknown, retried: boolean) => void
}

/**
 * Builds the transient-error predicate + observability counter every service's
 * `CommandBus` is constructed with. Previously copy-pasted byte-for-byte into
 * core-api/auth-service/notification-service (only the metric name and the
 * `Prisma` import path differed) — the one deliberate, hard-won decision here
 * (retry P2034, deliberately exclude P2028 to avoid a retry-storm against an
 * exhausted pool, resilience_patterns.md §3) now lives in one place instead of
 * three (review of ADR-0001, 2026-07-30).
 */
export function makePrismaTransientErrorHelpers(options: {
  /** Prefixes the Prometheus metric name, e.g. `core_api` → `core_api_db_transient_error_total`.
   * Kept per-service so existing dashboards/alerts built on the current metric
   * names are not silently renamed. */
  metricPrefix: string
}): PrismaTransientErrorHelpers {
  const dbTransientErrorCounter = new Counter({
    name: `${options.metricPrefix}_db_transient_error_total`,
    help: 'Prisma P2034/P2028 errors observed on retryable commands, by code and whether auto-retried',
    labelNames: ['code', 'retried'] as const,
  })

  return {
    isTransient(error: unknown): boolean {
      if (isPrismaKnownRequestError(error) && error.code === 'P2034') {
        return true
      }
      return isMarkedTransient(error)
    },

    /**
     * Only counts P2034/P2028 — NOT every `PrismaClientKnownRequestError`. The
     * original version counted all of them ("observe every P-code, decide later"),
     * which meant an ordinary business error (P2002 duplicate name, P2025 not
     * found, P2003 FK violation) on ANY retryable command incremented a metric
     * named `*_db_transient_error_total`, polluting any alert built on its rate —
     * a burst of duplicate-name requests would page on-call for what is not a
     * database reliability signal at all (review of ADR-0001, 2026-07-30).
     */
    recordObservation(error: unknown, retried: boolean): void {
      if (isPrismaKnownRequestError(error) && OBSERVED_CODES.has(error.code)) {
        dbTransientErrorCounter.inc({ code: error.code, retried: String(retried) })
      }
    },
  }
}
