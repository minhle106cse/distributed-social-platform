// ── Org Permission Catalog (closed set — see apps/core-api/src/modules/tenant/domain/org-rbac.ts) ──
// Unlike SystemPermission (auth-service, dynamic — created via POST /permissions),
// Org permissions are a FIXED enum: you can only assign/revoke them, never
// create a new one at runtime. `OrgRole`/`DEFAULT_ROLE_PERMISSIONS` (the ROLE
// side of RBAC) stay in core-api — only the permission CODES cross the
// service boundary, same precedent as SystemPermission staying split from
// SystemRole (auth-service keeps the role names, other services only ever
// see permission strings).
//
// Moved here (was core-api-local) once a second consumer needed it:
// search-service/notification-service verify org membership over gRPC
// (MembershipVerification service) and now also need to check the SAME
// permission codes core-api's OrgGuard checks locally — see
// resilience_patterns.md IDOR fix follow-up. Any service's guard can now
// reference ONE canonical constant per permission instead of retyping the
// string literal.
export const OrgPermission = {
  // Knowledge
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_WRITE: 'knowledge:write',
  KNOWLEDGE_VERIFY: 'knowledge:verify',

  // Engagement
  ENGAGEMENT_VOTE: 'engagement:vote',
  ENGAGEMENT_BOOKMARK: 'engagement:bookmark',
  ENGAGEMENT_FOLLOW: 'engagement:follow',
  ENGAGEMENT_ACCEPT_ANSWER: 'engagement:accept_answer',

  // AI
  AI_QUERY: 'ai:query',

  // Credit economy
  CREDIT_READ: 'credit:read',
  CREDIT_SPEND: 'credit:spend',
  CREDIT_GRANT: 'credit:grant', // distribute org credit to members (admin/owner)

  // Org management
  ORG_MANAGE_MEMBERS: 'org:manage_members',
  ORG_MANAGE_SPACES: 'org:manage_spaces',
  ORG_MANAGE_BILLING: 'org:manage_billing',
  ORG_MANAGE_ROLES: 'org:manage_roles', // meta: chỉnh mapping role→permission của org
} as const

export type OrgPermissionValue = (typeof OrgPermission)[keyof typeof OrgPermission]

// Toàn bộ permission tồn tại — dùng cho OWNER (implicit-all) và validate input.
export const ALL_ORG_PERMISSIONS: OrgPermissionValue[] = Object.values(OrgPermission)

export function isValidOrgPermission(value: string): value is OrgPermissionValue {
  return (ALL_ORG_PERMISSIONS as string[]).includes(value)
}
