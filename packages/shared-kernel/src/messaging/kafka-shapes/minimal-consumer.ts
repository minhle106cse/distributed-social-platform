/**
 * Structural subset of a kafkajs Consumer — just what the runner calls. Typing
 * it structurally keeps shared-kernel free of a kafkajs dependency (each service
 * owns its Kafka client); any kafkajs Consumer is assignable as-is.
 */
export interface MinimalKafkaMessage {
  key: Buffer | null
  value: Buffer | null
  offset: string
}

export interface MinimalEachMessagePayload {
  topic: string
  partition: number
  message: MinimalKafkaMessage
}

export interface MinimalConsumer<TPayload = MinimalEachMessagePayload> {
  connect(): Promise<void>
  subscribe(subscription: { topic: string; fromBeginning: boolean }): Promise<void>
  run(config: {
    autoCommit: boolean
    eachMessage: (payload: TPayload) => Promise<void>
  }): Promise<void>
  commitOffsets(offsets: { topic: string; partition: number; offset: string }[]): Promise<void>
  disconnect(): Promise<void>
}

/** Message shape a DLQ replay consumer needs — same idea as `MinimalEachMessagePayload`
 * above, plus `headers` (which that one never needed). */
export interface DlqEachMessagePayload {
  topic: string
  partition: number
  message: MinimalKafkaMessage & {
    headers?: Record<string, Buffer | string | (Buffer | string)[] | undefined>
  }
}

export type MinimalDlqConsumer = MinimalConsumer<DlqEachMessagePayload>
