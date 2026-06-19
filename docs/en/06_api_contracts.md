# 📡 API CONTRACTS — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../06_api_contracts.md) for the complete endpoint list.

**Summary:** REST + JSON. Auth via HTTP-only cookie (JWT carries `sub`, `orgId`, `role`). All core-api requests are tenant-scoped. `X-Idempotency-Key` required on credit-spending POSTs; `version` required on knowledge PUTs (OCC). Cursor pagination. Endpoint groups: auth, tenant (orgs/spaces/members), knowledge (+revisions/verify/answers/votes), discovery (`GET /search` hybrid, `POST /ai/ask` RAG), credit & bounty, reputation & feed, realtime WS channels. Standard error codes incl. `OCC_CONFLICT` (409), `FORBIDDEN_TENANT` (403), `INSUFFICIENT_CREDIT` (402), `AI_UNAVAILABLE` (503), `RATE_LIMITED` (429).
