# 🛡️ SECURITY & ACCESS CONTROL — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../10_security_rbac.md) for the complete document.

**Summary:** B2B multi-tenant security. JWT (access + rotating refresh, HTTP-only cookies; token carries `orgId`/`role`). Two-tier RBAC: System (auth-service) + Org (OWNER/ADMIN/MEMBER/GUEST), with reputation-gated privileges. **Tenant Isolation is the top invariant:** every core-api query scoped by `orgId` (guard + optional Postgres RLS), cross-org → 403. **AI Data Boundary:** retrieval filters embeddings by org so org A data never enters org B's RAG context. Rate limiting / per-tenant quota (token bucket, Redis). Hardening: TLS, secret rotation, no CORS wildcard, Helmet, Zod validation, audit via event store + revisions. Threat model covers cross-tenant leak, prompt injection, credit fraud, token theft, AI cost abuse, XSS.
