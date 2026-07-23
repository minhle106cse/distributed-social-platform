import { createHash } from 'crypto'
import type { ILogger } from './index.js'
import { LogContext } from './log-context.js'

/**
 * A security-relevant event — login, refresh-token reuse, role/permission
 * change. NOT a separate logging subsystem from the app's point of view:
 * goes through the SAME pino instance/redaction/hooks as everything else,
 * tagged `context: LogContext.AUDIT`. A dedicated PINO INSTANCE (separate
 * transport, own redaction exemption to keep raw PII) was built and reverted
 * same day (2026-07-22) — that version had zero real access-control benefit
 * (same ES read permissions as operational logs) for double the log
 * infrastructure surface.
 *
 * The physical separation DOES now exist again, but at the ES layer, not
 * here (2026-07-25) — an ingest-pipeline `reroute` processor
 * (docker-init/elasticsearch/ingest-pipeline-log-router.json) moves any doc
 * with `context: "AuditLog"` from the `dsp-logs` data stream into
 * `dsp-audit-logs`, and 2 ES roles (dsp_ops_reader / dsp_audit_reader,
 * verified 403/200 against real containers) gate read access per stream.
 * This is NOT a repeat of the reverted design: this file, `logAudit()`, and
 * every call site are byte-for-byte unchanged — the split is invisible to
 * the app and costs zero extra code here. It only makes sense because the
 * missing piece from before (a real access boundary) now exists. See
 * logging_standard.md "Audit Log" section for the full rationale.
 */
export interface AuditEvent {
  /** Dot-namespaced, e.g. 'auth.login', 'auth.register', 'auth.refresh_reuse_detected'. */
  action: string
  outcome: 'success' | 'failure'
  /** null when identity isn't resolved yet (e.g. a failed login before the user is found). */
  actorUserId: string | null
  /** sha256(email), NEVER raw email — same redaction policy as every other log
   * (logger/index.ts SENSITIVE_LOG_KEYS). Still lets an investigator correlate
   * repeated failures against the SAME account without ever printing PII —
   * pass the same email through two calls and the hash matches. */
  actorEmailHash?: string
  /** Set when the action targets a DIFFERENT user than the actor (role grant, credit grant...). */
  targetUserId?: string
  ip?: string
  metadata?: Record<string, unknown>
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex')
}

export function logAudit(logger: ILogger, event: AuditEvent): void {
  const payload = { context: LogContext.AUDIT, ...event }
  const msg = `audit: ${event.action}`
  // failure = warn (unusual, not a system error — same level discipline as
  // everywhere else: ApplicationError/4xx isn't `error`, that's reserved for
  // things needing operator attention).
  if (event.outcome === 'failure') {
    logger.warn(payload, msg)
  } else {
    logger.info(payload, msg)
  }
}
