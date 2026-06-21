### 📊 Curated Status — _cập nhật thủ công sau mỗi task (After-Task Protocol)_

> Last curated: **2026-06-21**
> Đây là nguồn chủ quan (phase %, focus). Phần auto-detect bên dưới mới là ground truth — nếu lệch nhau thì file này stale.

**Overall:** ~22% · **Phase đang làm:** Phase 1 (Multi-tenant Knowledge Monolith) · **Next:** `knowledge-module` (core-api)

| Phase | Mục tiêu | Trạng thái |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | 🟡 ~55% — đang làm |
| 2 | Event Backbone (Kafka + Outbox) | ⬜ Schema split sẵn, chưa code |
| 3 | CQRS & Read Model | ⬜ Chưa bắt đầu |
| 4 | AI Search & Discovery (RAG) | ⬜ Chưa bắt đầu |
| 5 | Credit Economy & Saga | ⬜ Chưa bắt đầu |
| 6 | Realtime & Workers | ⬜ Chưa bắt đầu |
| 7 | The Great Migration | ⬜ Chưa bắt đầu |
| 8 | Production Hardening | ⬜ Chưa bắt đầu |

#### Phase 1 — chi tiết

| Hạng mục | Service | Trạng thái |
|---|---|---|
| auth (JWT RS256, refresh rotation) | auth-service | ✅ Done |
| system RBAC (role/permission, wildcard catalog) | auth-service | ✅ Done |
| user | auth-service | ✅ Done |
| tenant (Org, Space, Membership, Invite, OrgGuard) | core-api | ✅ Done |
| **knowledge** (KnowledgeItem CRUD + OCC versioning + Revision) | core-api | ⬜ **Schema có, chưa code — NEXT** |
| taxonomy (Tag/Topic, Space subscribe) | core-api | ⬜ Schema partial (Tag), chưa code |
| engagement (Vote, Accept Answer, Bookmark) | core-api | ⬜ Vote trong schema, chưa code |

**Quyết định kiến trúc đã chốt liên quan:**
- Org context truyền qua `x-org-id` header + `OrgGuard` (KHÔNG nhúng `orgId` vào JWT). System RBAC (auth) và Org RBAC (core) tách biệt hoàn toàn. Xem `.ai/memory/architecture.jsonl#41`, `docs/11`.
