// ── System Permission Catalog (well-known, code-referenced permissions) ──────
// Unlike OrgPermission (a closed, fixed enum — see
// apps/core-api/src/modules/tenant/domain/org-permissions.ts), System RBAC
// (auth-service) technically allows ANY permission code to be created
// dynamically via POST /permissions. This catalog exists anyway so every
// service's guard code references ONE canonical constant per permission
// instead of retyping the same string literal at each call site — same
// convention as OrgPermission: SCREAMING_SNAKE_CASE key -> 'resource:action'
// string value.
//
// Lives in shared-kernel (not auth-service) because this permission set is
// checked across services, not just where it's administered: auth-service
// owns/creates/assigns these via its RBAC module, but any service's guard
// (e.g. core-api's SystemPermissionGuard) verifies them straight from the
// JWT's `permissions` claim — no cross-service call needed, the token IS the
// source of truth once issued.
export const SystemPermission = {
  // Report management
  REPORT_READ: 'report:read', // xem danh sách / chi tiết abuse report
  REPORT_RESOLVE: 'report:resolve', // xử lý report (ban user, gỡ content, v.v.)
  REPORT_DISMISS: 'report:dismiss', // từ chối report (không vi phạm)

  // System monitoring — read-only, không thay đổi state
  SYSTEM_MONITOR: 'system:monitor', // xem health, metrics, resource usage

  // System resource management
  SYSTEM_RESOURCE_MANAGE: 'system:resource_manage', // điều chỉnh tài nguyên khi có yêu cầu

  // User management (cross-org)
  USER_READ: 'user:read', // xem profile bất kỳ user
  USER_BAN: 'user:ban', // ban / deactivate user
  USER_UNBAN: 'user:unban', // restore user bị ban

  // Org management (cross-org, platform-wide — e.g. core-api's "list all orgs")
  ORG_READ: 'org:read', // xem thông tin bất kỳ org
  ORG_CREATE: 'org:create', // provision org mới + tài khoản owner (onboarding sau khi ký hợp đồng)
  ORG_SUSPEND: 'org:suspend', // tạm ngưng hoạt động org
  ORG_RESTORE: 'org:restore', // khôi phục org bị suspend

  // Billing (platform-wide)
  BILLING_READ: 'billing:read', // xem subscription, invoice
  BILLING_MANAGE: 'billing:manage', // đổi plan, áp credit, hoàn tiền

  // RBAC management (quản lý roles/permissions của hệ thống)
  RBAC_ALL: 'rbac:*', // wildcard — toàn quyền quản lý RBAC
} as const

export type SystemPermissionValue = (typeof SystemPermission)[keyof typeof SystemPermission]

export const ALL_SYSTEM_PERMISSIONS: SystemPermissionValue[] = Object.values(SystemPermission)

export function isValidSystemPermission(value: string): value is SystemPermissionValue {
  return (ALL_SYSTEM_PERMISSIONS as string[]).includes(value)
}
