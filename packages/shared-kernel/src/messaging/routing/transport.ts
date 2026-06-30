/**
 * Message transports that can coexist in the platform. An integration event is
 * routed to ONE OR MORE of these via {@link EVENT_TRANSPORT_MAP}.
 *
 * - KAFKA: durable event backbone — fan-out, multiple consumer groups, ordering
 *   per partition key, event sourcing. The default for domain integration events.
 * - QUEUE: point-to-point background work — delayed jobs, retry-with-backoff,
 *   single-worker tasks (e.g. send email, generate embedding). Backed by BullMQ
 *   once Redis is wired; the adapter slot already exists so the two live together.
 */
export const Transport = {
  KAFKA: 'kafka',
  QUEUE: 'queue',
} as const

export type TransportValue = (typeof Transport)[keyof typeof Transport]
