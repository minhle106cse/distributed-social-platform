# 🔐 AUTH-SERVICE — REVIEW & VERIFY (Read-only)

> Phạm vi: **chỉ review, KHÔNG sửa code** (theo yêu cầu — auth-service "khá ổn"). Tài liệu này ghi nhận đánh giá + các điểm cần chú ý khi tiến lên **multi-tenancy (Cortex)**.
> Ngày review: 2026-06-19. Files đã đọc: `bootstrap/server.ts`, `bootstrap/fastify.ts`, `config/env.schema.ts`, `modules/auth/application/commands/login/login.handler.ts`, `modules/auth/infrastructure/services/imp-token.service.ts`.

---

## ✅ Verdict tổng quan

**auth-service ở trạng thái tốt, gần production-ready cho phần Identity.** Kiến trúc Hexagonal + DDD sạch, security baseline đầy đủ. Có thể giữ nguyên cho Cortex; chỉ cần **bổ sung tính đa-tổ chức (org scope)** ở vòng code sau.

---

## 💪 Điểm mạnh (giữ nguyên)

| Khía cạnh | Ghi nhận |
|-----------|----------|
| **Security middleware** | `helmet`, `compress`, `rate-limit`, `cors` (credentials), JWT qua cookie — đầy đủ (`bootstrap/fastify.ts`) |
| **CORS** | Lấy từ env (`CORS_ORIGINS`), KHÔNG wildcard — đúng memory gotcha |
| **Env validation** | Zod schema, `JWT_*` secret `min(32)`, DB url validated (`env.schema.ts`) |
| **Refresh token** | Lưu **hash SHA-256**, không lưu raw token (`imp-token.service.ts`) — đúng chuẩn |
| **DDD login flow** | `ensureCanLogin()`, `getAuthIdentity()`, verify qua domain service; soft-delete recovery 30 ngày — tách lớp tốt |
| **Logger** | `loggerInstance` (đúng cho Fastify v5), structured hooks |
| **Error handling** | Global error handler + custom domain errors (đúng memory lessons) |

---

## ⚠️ Phát hiện & Khuyến nghị

| # | Mức | Vấn đề | Khuyến nghị |
|---|-----|--------|-------------|
| 1 | 🟠 Design (multi-tenant) | **Access token thiếu `orgId`.** Payload hiện = `{sub, email, roles, permissions}`. Cortex cần tenant scope. | Thêm `orgId` + org-scoped `role` vào access token; re-issue khi đổi org. (Xem `docs/10` §1.2, §3) |
| 2 | 🟠 Design (distributed) | JWT ký **HS256 (symmetric)**. Nếu `core-api` tự verify token, phải chia sẻ secret. | Cân nhắc **RS256/EdDSA (asymmetric)**: auth-service ký bằng private key, các service verify bằng public key — không chia sẻ secret. |
| 3 | 🟡 Security | **Rate-limit chỉ global 100/min.** Docs yêu cầu login/register chặt hơn (5/5 phút). | Thêm rate-limit riêng cho route `auth/login`, `auth/register` (per-route config). |
| 4 | 🟡 Consistency | **TTL refresh = 30d** (`imp-token.service.ts`) nhưng `docs/10` ghi 7 ngày. | Thống nhất 1 con số; nếu giữ 30d phải đảm bảo rotation + family-revoke chặt. |
| 5 | 🟢 Verify | Cần xác nhận **refresh rotation + family-revoke on reuse** đã implement trong `refresh.handler.ts`. | Đọc/đảm bảo có test cho reuse-detection (token cũ dùng lại → revoke cả family). |
| 6 | 🟢 Verify | Cookie set ở route layer — cần xác nhận `HttpOnly` + `Secure` + `SameSite`. | Kiểm tra nơi set cookie `accessToken`/`refreshToken`. |
| 7 | 🟢 Minor | Access token chứa đầy đủ `roles + permissions` → có thể phình to. | Với org-scope, cân nhắc claim tối thiểu + authz per-request. |

---

## 🧭 Multi-tenancy Readiness (cho Cortex)

Để auth-service phục vụ Cortex (B2B đa tổ chức), vòng code sau cần:

1. **Org membership:** quan hệ User ↔ Organization ↔ Role (xem `docs/04` §2.2, `docs/10` §2).
2. **Token claims:** `orgId` + org role trong access token (Finding #1).
3. **Org switch endpoint:** đổi org đang active → re-issue token (`docs/10` §1.2).
4. **(Khuyến nghị)** chuyển sang asymmetric signing để `core-api`/services khác verify mà không cần secret (Finding #2).

> Không có lỗi chặn (blocker). auth-service có thể giữ nguyên và mở rộng tăng dần ở Phase 1.
