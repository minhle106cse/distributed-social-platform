// This module is split along 4 INDEPENDENT axes — each subfolder answers a
// different question, not "the same kind of thing, one level deeper":
//   events/      — WHAT is an integration event? (CloudEvent envelope,
//                  EventType vocabulary, per-event payload definitions —
//                  moved in from a top-level events/ folder 2026-08-01: it had
//                  no consumer anywhere in shared-kernel outside messaging/,
//                  so keeping it as a sibling top-level folder implied a
//                  generality it never had — cqrs/'s own IEvent is a
//                  completely separate, unrelated concept)
//   routing/     — WHICH destination? (transport + Kafka topic decisions —
//                  business/config mappings, no wire-format concern at all)
//   interfaces/  — WHAT contract? (transport-agnostic ports every adapter,
//                  in any service, implements or depends on)
//   kafka-shapes/ — HOW does a real kafkajs object look? (structural typing
//                  mirroring kafkajs's own API surface, so shared-kernel never
//                  needs an actual kafkajs dependency — despite the name, this
//                  has nothing to do with routing/kafka-topic.ts's topic-naming
//                  convention; don't conflate the two just because both say "kafka")
// Root-level files (event-router.ts, resilient-consumer.ts, dlq-replay-consumer.ts)
// are the concrete entry points that consume all 4.

// Events — WHAT is an integration event: CloudEvent envelope, EventType, payloads
export * from './events/index.js'

// Routing — WHERE an event goes: transport, kafka topic, event→destination maps
export * from './routing/index.js'

// Ports/interfaces — transport-agnostic contracts
export * from './interfaces/message-publisher.interface.js'
export * from './interfaces/event-handler.interface.js'
export * from './interfaces/dead-letter.interface.js'

// Kafka-shapes — kafkajs subset shapes, no kafkajs dependency
export * from './kafka-shapes/minimal-consumer.js'
export * from './kafka-shapes/minimal-producer.js'

// Entry points — outbound publish + inbound dispatch
export * from './event-router.js'
export * from './resilient-consumer.js'
export * from './dlq-replay-consumer.js'
