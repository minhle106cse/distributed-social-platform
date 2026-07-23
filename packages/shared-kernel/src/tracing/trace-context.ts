import { AsyncLocalStorage } from 'async_hooks'
import { randomBytes } from 'crypto'

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) propagated across
 * every service boundary (HTTP, gRPC metadata, CloudEvents `traceparent`
 * extension) purely to correlate log lines for one logical request end-to-end
 * — this is NOT a full OpenTelemetry SDK (no spans/timing/exporters). Using
 * the real W3C header name/format means adopting OTel later is a drop-in
 * swap of the propagation layer, not a rename of every log field.
 *
 * Every boundary plays exactly one of two roles, never both in the same call:
 *
 *  - RECEIVE side (HTTP middleware, gRPC server handler, Kafka consumer) —
 *    always calls `startTraceContext(inbound)`. This NEVER leaves you without
 *    a usable context: if `inbound` is missing/malformed (caller forgot to
 *    attach it, or a pre-existing Kafka row predates this column), it just
 *    mints a brand new trace instead of propagating "nothing" downstream.
 *    This is deliberate — a receive boundary's job is to guarantee every log
 *    line from here on has a `trace_id`, even in the degraded case.
 *
 *  - SEND side (attaching to an outgoing gRPC call, writing to the outbox
 *    for a later Kafka publish) — always calls `getCurrentTraceparent()`.
 *    This NEVER synthesizes a trace: if there's no active context (e.g. a
 *    background job with no inbound request), it returns `undefined` and the
 *    receiver on the other end is the one that decides what to do (mint its
 *    own via `startTraceContext`, per the rule above). Inventing a trace at
 *    send-time would be pointless — only the caller who *originated* the
 *    work has a trace worth propagating.
 *
 * `parentSpanId` (below) is the ONE piece of real causality this module keeps
 * — the id of whichever span sent us the request we're now processing. It's
 * carried purely so log tooling can reconstruct "which span called which"
 * across services; there is still no span TREE object, no duration/timing, no
 * exporter — that remains a real OTel SDK's job if this project ever needs it.
 */
export interface TraceContext {
  traceId: string // 32 lowercase hex chars — stable for the whole request across all hops
  spanId: string // 16 lowercase hex chars — THIS service's own span, regenerated at every hop
  parentSpanId?: string // the caller's spanId (their "spanId" IS our "parent-id", same bits, our name). Absent for a root span (nothing called us).
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

const traceContextStorage = new AsyncLocalStorage<TraceContext>()

// Internal helpers below — deliberately NOT exported. Only 4 functions +
// TraceContext form the public API (see barrel export list at bottom of this
// file's usage in index.ts); everything here is an implementation detail of
// startTraceContext/getCurrentTraceparent. Keeping these module-private means
// nobody outside can call e.g. generateTraceId() directly at a SEND boundary
// and accidentally break the RECEIVE-always-synthesizes/SEND-never-synthesizes
// invariant described above.

function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

function generateSpanId(): string {
  return randomBytes(8).toString('hex')
}

function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-01`
}

/**
 * Parses an inbound header into (traceId, parentSpanId) — the header's own
 * span-id segment (spec name: "parent-id") identifies the CALLER's span, kept
 * here as `parentSpanId` purely for log causality (see module doc comment).
 * `startTraceContext` always mints its OWN fresh spanId regardless; this
 * parsed value never becomes "our" spanId. Returns null on malformed/absent
 * input — caller decides fallback (usually: start a new trace, no parent).
 */
function parseInboundTraceparent(
  header: string | undefined | null,
): { traceId: string; parentSpanId: string } | null {
  if (!header) return null
  const match = TRACEPARENT_RE.exec(header)
  return match ? { traceId: match[1], parentSpanId: match[2] } : null
}

function getTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore()
}

export function runWithTraceContext<R>(ctx: TraceContext, callback: () => R): R {
  return traceContextStorage.run(ctx, callback)
}

/**
 * SEND side — formats the traceparent header to send to the NEXT hop (gRPC
 * metadata, Kafka message/outbox row). Per W3C spec, the callee treats our
 * current spanId as its parent — the callee then mints its own new spanId
 * for its own work, same traceId. Returns undefined if no trace context is
 * active (e.g. background job with no inbound request) — never synthesizes
 * one; see the module doc comment and `startTraceContext` (the RECEIVE-side
 * counterpart, which does synthesize).
 */
export function getCurrentTraceparent(): string | undefined {
  const ctx = getTraceContext()
  return ctx ? formatTraceparent(ctx) : undefined
}

/**
 * RECEIVE side — establishes the trace context at a hop boundary (HTTP
 * request, gRPC server handler, Kafka consumer). Reuses the traceId from an
 * inbound traceparent (if valid) but always mints a fresh spanId — this
 * service's own span, distinct from the caller's. Always returns a usable
 * context, synthesizing a new trace if `inboundTraceparent` is missing or
 * malformed; see the module doc comment and `getCurrentTraceparent` (the
 * SEND-side counterpart, which does NOT synthesize).
 */
export function startTraceContext(inboundTraceparent?: string | null): TraceContext {
  const inbound = parseInboundTraceparent(inboundTraceparent)
  return {
    traceId: inbound?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: inbound?.parentSpanId,
  }
}

/**
 * Log-correlation fields (OTel semantic-convention names) for a log call made
 * outside the ALS scope (e.g. ILogger has no `.child()`, so call sites splat
 * this into each structured log call instead). Defaults to the active
 * context if none is passed. `parent_span_id` is only present when this span
 * was actually caused by another (absent for a root span) — lets log tooling
 * reconstruct "which span called which" across services, not just "which
 * spans belong to the same request" (that's `trace_id` alone).
 */
export function traceLogFields(ctx: TraceContext | undefined = getTraceContext()): {
  trace_id?: string
  span_id?: string
  parent_span_id?: string
} {
  if (!ctx) return {}
  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    ...(ctx.parentSpanId ? { parent_span_id: ctx.parentSpanId } : {}),
  }
}
