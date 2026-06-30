# 💼 BUSINESS REQUIREMENTS — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../01_business_requirements.md) for the complete, up-to-date document.

**Summary:** Cortex is an AI-powered internal Knowledge Hub (B2B SaaS). Five pillars: (1) Knowledge & Collaboration (wiki, OCC, verification), (2) AI Discovery (RAG + Hybrid Search via Elasticsearch + pgvector), (3) Credit Economy (virtual, event-sourced ledger, no payout), (4) Reputation & Gamification, (5) Multi-tenancy & Access (tenant isolation, AI data boundary). Each requirement forces a System Design pattern.

**Credit model (decided):** credit is held **per-member** (each user's own balance within an org), not a shared org pool — this is what makes bounty staking ("stake *my* credit") and per-member quotas coherent. Flow: org **treasury** is topped up → OWNER/ADMIN **allocate** to members → members **spend** (AI calls), **earn** (verified contributions / accepted answers / won bounties), and **stake** (bounties). Every change is an immutable event scoped by `orgId` + `userId`; balance = replay of events.

**Provisioning (current trial phase — NO payment integration yet):** a **system admin** (platform operator) grants credit to an org manually via an Admin Dashboard (`CreditGrantedEvent`). Once the product proves out, payment integration is added and the org buys packs directly (`CreditPurchasedEvent`) — both are immutable events, so swapping the top-up mechanism does not break the ledger. Note: "system admin" is a **platform-wide** role, separate from the in-org RBAC (OWNER/ADMIN/MEMBER/GUEST). See the Vietnamese §3 for full detail.
