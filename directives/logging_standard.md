# Observability & Logging Standard

**Date**: May 2026  
**Target**: All microservices  
**Status**: ✅ IMPLEMENTED (Standardized across services)

## The Dual-Logging Philosophy

In a strict Hexagonal / CQRS Architecture, logging is split into two distinct layers. This separation of concerns ensures that observability is precise, transport-agnostic, and easy to profile.

We mandate the use of **two independent logs** for every user action:

### 1. HTTP Layer Log (Fastify Request Logger)
**Location**: `src/infrastructure/http/hooks/http-logging.hook.ts`

- **Purpose**: To observe the network/transport layer.
- **What it logs**: HTTP Protocol metrics (Method, Route, URL, Status Code, IP Address, User-Agent, and the total duration of the HTTP Request).
- **Why it is needed**:
  - Acts as the "gatekeeper" log.
  - Monitors API endpoint health and HTTP routing.
  - Helps the Load Balancer / API Gateway track 400s (Client Errors) and 500s (Server Errors).
  - Determines the overall latency experienced by the client (Network + Framework overhead + Business Logic).

### 2. Business Layer Log (CQRS Middleware Logger)
**Location**: `src/common/cqrs/middlewares/logging.middleware.ts`

- **Purpose**: To observe the core business logic (Application Layer).
- **What it logs**: Command/Query name, execution payload, and the execution time of the specific Handler logic.
- **Why it is needed**:
  - **Transport Agnostic**: If a Command is triggered by a Message Queue (Kafka/RabbitMQ), a cron job, or gRPC rather than HTTP, this log still perfectly captures the business action.
  - **Deep Profiling**: By comparing this log's duration with the HTTP log's duration, developers can pinpoint bottlenecks. (e.g., If HTTP took 100ms but Command took 20ms, the system is losing 80ms to network latency, middleware, serialization, or auth guards, not the database).

## Standard Output Format

Always use structured JSON logging in production. 
Do not pollute the console with unstructured strings. 

- Use the shared `createLogger(serviceName)` utility from `@distributed-social-platform/shared-kernel`.
  - *Note for dev mode:* `createLogger` uses `pino-pretty` for console output and directly pushes to Elasticsearch via `pino-elasticsearch`.
- Never `console.log`.

## Enforcement for AI Workflows

When an AI Agent is tasked with creating a new microservice or adding a new module:
1. Ensure `httpLoggingHook` is attached in the `fastify.ts` setup.
2. Ensure `LoggingMiddleware` is correctly applied to the `CommandBus` in the `container` initialization.
3. **DO NOT** inject `ILogger` into Domain Entities or core Domain logic unless absolutely necessary. Rely on the CQRS pipeline for observability.
