// Routing — WHERE an event goes: transport, kafka topic, event→destination maps
export * from './routing/index.js'

// Entry points — outbound publish + inbound dispatch
export * from './message-publisher.port.js'
export * from './event-router.js'
