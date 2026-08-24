/** Structural subset of a kafkajs Producer — raw send, not the CloudEvent-level
 * publisher port (`IMessagePublisher`, which lives in core-api's common/ since
 * 2026-08-24 — it had no consumer outside that service). The shape itself has nothing DLQ-specific (that's
 * why it's not named MinimalDlqProducer) — today its one caller is
 * `DlqReplayConsumer`, which needs raw byte-for-byte send (it may be
 * republishing the exact poison-pill payload that failed to parse as a
 * CloudEvent in the first place — deserializing it would defeat the point),
 * but nothing about `send`/`connect`/`disconnect` ties this to DLQ replay
 * specifically, same as `MinimalConsumer` is shared by both the normal and
 * DLQ consumer flows. */
export interface MinimalProducer {
  send(record: {
    topic: string
    messages: Array<{
      key?: Buffer | string | null
      value: Buffer | string | null
      headers?: Record<string, string>
    }>
  }): Promise<unknown>
  connect(): Promise<void>
  disconnect(): Promise<void>
}
