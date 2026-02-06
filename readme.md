# 🚀 DISTRIBUTED SOCIAL PLATFORM — PRODUCTION-GRADE SENIOR BLUEPRINT (RELEASE-READY)

---

# 🧠 TẦM NHÌN DỰ ÁN (NORTH STAR)

## Mục tiêu:
Đây **không phải** portfolio CRUD nhiều feature.  
Đây là một **production-style distributed system** có thể:
- Deploy thực tế
- Scale theo domain pressure
- Có reliability/failure strategy
- Có observability
- Có security boundary
- Có cost-awareness
- Có thể release và tiếp tục evolve

---

# 🎯 MỤC TIÊU CỐT LÕI

## Xây dựng hệ thống để demonstrate:

### System Design
- Domain-driven boundary
- Distributed mindset
- Hybrid architecture
- Scalability economics

### Engineering
- Event-driven architecture
- Realtime architecture
- Async consistency
- Failure handling

### Operations
- Monitoring
- Logging
- Deployment
- Incident response

---

# 🏗️ TRIẾT LÝ KIẾN TRÚC

# Core Strategy:
## Modular Monolith First → Extract by Scaling Pressure

---

## Lý do:
### Tránh:
- Premature microservices
- Over-distributed complexity
- Contract chaos
- Infra overhead
- Debugging hell

---

## Senior Principle:
### “Chỉ phân tách khi domain hoặc scaling characteristic buộc phải tách”

---

# 🧭 HIGH-LEVEL SYSTEM ARCHITECTURE

```txt
Client (Web / Mobile)
       |
       v
AWS API Gateway (HTTP + WebSocket)
       |
       v
Lambda Authorizer / Auth Validation
       |
       v
---------------------------------------------------
| core-api (ECS/Fargate)                          |
| auth-service (Lambda/ECS Hybrid)                |
| chat-service (WebSocket + Redis)                |
| notification-service                            |
---------------------------------------------------
       |
       v
Event Backbone (SQS + SNS/EventBridge)
       |
       v
worker-service
       |
       v
---------------------------------------------------
| PostgreSQL | Redis | S3 | CloudWatch | Terraform|
---------------------------------------------------
```

---

# 🧱 DOMAIN BOUNDARY (CỰC KỲ QUAN TRỌNG)

# auth-service
## Chỉ chịu trách nhiệm:
- Register
- Login
- Access Token
- Refresh Token
- Session lifecycle
- Credential security

---

## Không chịu trách nhiệm:
- User profile
- Social graph
- Feed

---

# core-api
## Source of Truth:
- User profile
- Settings
- Social graph
- Productivity
- Interaction
- Feed metadata

---

# chat-service
## Source of Truth:
- Conversations
- Messages
- Delivery state
- Presence

---

# notification-service
## Source of Truth:
- Notification history
- Delivery attempts
- Channel dispatch

---

# RULE:
## Tuyệt đối không shared database giữa service.

### Giao tiếp:
- Sync → API
- Async → Event

---

# 📦 REPOSITORY STRATEGY

# Recommended:
## Monorepo (Nx / Turborepo)

---

## apps/
- api-gateway
- auth-service
- core-api
- chat-service
- worker-service
- notification-service

---

## packages/
- event-contracts
- shared-kernel
- logger
- auth-sdk
- config
- observability

---

## infra/
- terraform
- docker
- monitoring
- ci-cd

---

# 🔐 API GATEWAY STRATEGY (AWS)

# API Gateway Responsibilities:
- Routing
- JWT verification
- WAF
- Rate limiting
- Request throttling
- Request tracing
- Request normalization

---

# HTTP Gateway:
## Dùng cho:
- Auth
- Core API
- Feed
- Productivity

---

# WebSocket Gateway:
## Dùng cho:
- Chat
- Live notifications
- Presence

---

# Best Practice:
## Không để frontend direct-call nhiều service nếu không cần.

---

# 🔑 AUTHENTICATION BEST PRACTICE

# Token Strategy:
## Access Token:
- TTL ngắn (10–15 phút)

## Refresh Token:
- Rotation
- Reuse detection
- Token family tracking
- Hash storage

---

# Security:
## MUST:
- Device/session tracking
- IP anomaly detection
- Secret Manager
- Token revocation
- Least privilege IAM

---

# Optional Advanced:
- OAuth2
- MFA
- Suspicious login challenge

---

# 📡 EVENT-DRIVEN ARCHITECTURE (BACKBONE)

# Event Flow:
1. User action xảy ra
2. Domain write thành công
3. Outbox record tạo
4. Publisher đẩy event → SQS/SNS
5. Worker consume
6. Retry nếu fail
7. DLQ nếu poison
8. Replay nếu cần

---

# Event Contract Standard:

```ts
type DomainEvent<T> = {
  eventId: string
  eventType: string
  eventVersion: number
  occurredAt: string
  producer: string
  actorId: string
  entityId: string
  correlationId: string
  causationId?: string
  idempotencyKey: string
  payload: T
  metadata?: Record<string, unknown>
}
```

---

# MUST HAVE:
## Versioning:
- USER_FOLLOWED_V1
- USER_FOLLOWED_V2

---

# NEVER:
## Breaking consumer directly.

---

# 🛡️ RELIABILITY PATTERNS (NON-NEGOTIABLE)

# 1. Outbox Pattern
## Giải quyết:
DB commit success nhưng publish fail

---

# 2. Inbox / Idempotency
## Giải quyết:
Duplicate event

---

# 3. Retry Strategy
## Bao gồm:
- Immediate retry
- Exponential backoff
- Delayed retry
- DLQ

---

# 4. Replay Tool
## Admin capability:
- Replay by eventId
- Replay by date
- Replay by event type

---

# 5. Correlation ID
## Mục tiêu:
Distributed tracing xuyên service

---

# 🧠 FEED SYSTEM (HARDEST DOMAIN)

# Core Problem:
Read-heavy + ranking + scale

---

# Phase 1 Strategy:
## Hybrid Fanout

### Fanout on Write:
- Normal user

### Fanout on Read:
- Celebrity / high follower

---

# Storage:
## Hot:
- Redis Sorted Set

## Canonical:
- PostgreSQL

---

# Ranking Inputs:
- Recency
- Follow strength
- Engagement score
- Block/mute
- Productivity relevance (optional)

---

# Advanced Future:
- ML ranking
- Edge ranking
- Cached personalized timeline

---

# ⚡ REALTIME LAYER

# chat-service MUST support:
- WebSocket
- Presence
- Redis pub/sub
- Multi-instance scaling
- Reconnect
- Ack
- Ordering
- Delivery state

---

# Delivery States:
- SENT
- DELIVERED
- SEEN

---

# Ordering:
## Recommended:
- ULID / Snowflake
OR
- Conversation sequence number

---

# notification-service:
## Channels:
- WebSocket
- Push
- Email

---

# Pattern:
worker → notification → fanout

---

# 📊 OBSERVABILITY (BẮT BUỘC)

# Structured Logging:
```json
{
  "requestId": "",
  "correlationId": "",
  "service": "",
  "userId": "",
  "eventId": "",
  "timestamp": ""
}
```

---

# Metrics:
## MUST TRACK:
- P50 / P95 / P99 latency
- Queue lag
- DLQ size
- Retry count
- Socket connections
- Cache hit ratio
- Auth failure
- DB latency

---

# Stack:
- CloudWatch
- OpenTelemetry
- X-Ray
- Grafana
- Prometheus

---

# Alerts:
## Ví dụ:
- Queue backlog spike
- Redis unavailable
- Auth anomaly
- WebSocket disconnect storm

---

# 🚨 FAILURE PLAYBOOKS

# Required:
## What if:
- Redis down?
- Queue delayed?
- Worker crash?
- Duplicate event?
- Poison message?
- Token stolen?
- Notification flood?

---

# MUST:
## Mỗi case cần:
- Detection
- Containment
- Recovery
- Replay
- Postmortem

---

# 🔒 SECURITY LAYER

# MUST:
- WAF
- Rate limiting
- DTO validation
- Secret rotation
- IAM least privilege
- Encryption at rest
- PII protection
- Audit log

---

# Sensitive Data:
## Encrypt:
- Email
- Phone
- Session data
- Device fingerprint

---

# Optional:
- Regional compliance
- GDPR-style deletion

---

# 💸 COST ENGINEERING (SENIOR SIGNAL)

# Lambda phù hợp:
- Auth
- Lightweight triggers
- Notification dispatch

---

# ECS/Fargate phù hợp:
- Core API
- WebSocket
- Heavy worker

---

# Rule:
## Không “Lambda everything”.

### Vì:
- Cold start
- Connection issue
- Cost unpredictability

---

# 🧪 TESTING STRATEGY

# Layer:
## Unit:
- Domain

## Integration:
- DB
- Redis
- Queue

## Contract:
- Event schema

## Load:
- k6
- Artillery

## Chaos:
- Queue duplicate
- Redis outage
- Worker death

---

# 🚀 RELEASE ROADMAP

# Phase 0 — Foundation
- Monorepo
- Shared package
- CI/CD
- Terraform baseline
- Logging standard

---

# Phase 1 — Identity + Core
- Auth
- User
- Social graph
- Interaction

---

# Phase 2 — Async Backbone
- Outbox
- SQS
- Worker
- Retry
- DLQ

---

# Phase 3 — Feed
- Fanout hybrid
- Ranking
- Cache

---

# Phase 4 — Realtime
- Chat
- Notification

---

# Phase 5 — Hardening
- Monitoring
- Security
- Cost optimization
- Replay tooling

---

# 📚 REQUIRED DOCUMENTATION (SENIOR DIFFERENTIATOR)

# MUST WRITE:

## 1. ADR (Architecture Decision Record)
### Ví dụ:
- Why SQS over Kafka
- Why modular monolith first
- Why Redis for feed hot path

---

## 2. Sequence Diagram
### Flows:
- Register
- Follow
- Message
- Feed generation
- Notification

---

## 3. Failure Runbook
### Cases:
- DLQ
- Replay
- Redis outage

---

## 4. Cost Model
### Include:
- Monthly estimate
- Scaling threshold
- Break-even points

---

# 🏁 SUCCESS BENCHMARK

## Sau project bạn phải giải thích được:

### Technical:
- Outbox
- Inbox
- Idempotency
- Fanout
- WebSocket scale
- Auth lifecycle

---

### Operational:
- Incident response
- Rollback
- Monitoring
- Autoscaling
- Failure economics

---

# ❌ COMMON FAILURE TRAPS

## Tránh:
- Over-microservice
- Shared DB
- Kafka chỉ để ngầu
- Kubernetes quá sớm
- No observability
- No contract versioning

---

# 🎯 FINAL SENIOR TRUTH

## Senior không phải:
“nhiều service”

---

## Senior là:
### “System survives scale, failure, and complexity with maintainable economics.”

---

# 📈 FINAL SCORECARD

## Architecture Depth: 9.5/10  
## Production Readiness: 9/10  
## Resume Signal: 10/10  
## Operational Credibility: 9.5/10  

---

# 🚀 NEXT IMMEDIATE ACTIONS

## Làm NGAY:
### 1. Domain Boundary Doc
### 2. Event Contract Package
### 3. ADR
### 4. Infra Topology
### 5. Sequence Diagram
### 6. Failure Playbook
### 7. Cost Model

---

# 💥 KẾT LUẬN

### Đây đã vượt xa mức “project học backend”.

## Nếu triển khai đúng:
### Đây là production-style distributed platform

## Nếu triển khai sai:
### Chỉ là nhiều NestJS service gọi nhau

---

# 🔥 BOTTOM LINE:
## Build less vanity.  
## Build more survivability.