/**
 * CloudEvents 1.0 envelope (CNCF spec) — the wire contract for every integration
 * event. https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
 *
 * Why a standard envelope: without one, every team invents its own field names
 * (eventId vs id, occurredAt vs time…) and needs a translator to talk to anything
 * external. CloudEvents is protocol-agnostic and has a first-class Kafka binding,
 * so this serialises cleanly and interops with Knative / Argo / Azure Event Grid.
 *
 *  - Required: specversion, id, source, type
 *  - Optional: time, subject, datacontenttype
 *  - Extensions (names MUST be lowercase a–z0–9):
 *      orgid        — multi-tenant owner
 *      partitionkey — CloudEvents Partitioning extension; used as the Kafka message
 *                     key so all events of one aggregate keep partition ordering
 *
 * The producer's outbox table keeps its own column names; this envelope is built
 * from an outbox row at publish time — internal storage schema ≠ public contract.
 */
export interface CloudEvent<TData = unknown> {
  specversion: '1.0'
  id: string // unique within source — outbox row id (UUID v4); consumer dedup key
  source: string // producing context (URI-ref), e.g. '/cortex/core-api/KnowledgeItem'
  type: string // EventType.* — routing key for topic, transport, and handler
  time: string // RFC3339 / ISO 8601
  subject?: string // the resource within source — aggregate id
  datacontenttype?: string // 'application/json'
  data: TData

  // ── extension attributes (lowercase per spec) ──
  orgid: string
  partitionkey: string
}
