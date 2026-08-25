import jwt from 'jsonwebtoken'

/**
 * Claims carried by an auth-service access token — system-level identity ONLY.
 * `orgId`/`orgRole` are deliberately absent: org context travels in the
 * `X-Org-Id` header and is resolved per-request against core-api (OrgGuard /
 * RemoteOrgMembershipGuard), so changing org never requires re-issuing a token.
 */
export interface AccessTokenClaims {
  sub: string
  email: string
  /** System-level roles (e.g. 'SUPER_ADMIN'). NOT org roles. */
  roles: string[]
  /** System-level permissions (e.g. 'org:create'). NOT org permissions. */
  permissions: string[]
}

/** Thrown for any token that fails signature, algorithm, expiry, or shape checks. */
export class InvalidAccessTokenError extends Error {
  constructor(message = 'Invalid token') {
    super(message)
    this.name = 'InvalidAccessTokenError'
  }
}

/**
 * Verifies an auth-service RS256 access token and normalises its claims.
 *
 * WHY THIS IS IN shared-kernel (promoted 2026-08-25): core-api, search-service
 * and notification-service each had a `JwtAuthGuard` whose verify body was
 * BYTE-IDENTICAL — the same duplication class already fixed for
 * `MembershipVerifier`, and with the same demonstrated failure mode: those two
 * gRPC client copies silently diverged (neither attached `traceparent`) until
 * someone noticed. Drift in an AUTHENTICATION path is worse than drift in
 * tracing — adding issuer/audience checks, clock tolerance, or revocation to
 * one copy leaves the other two silently unprotected, with nothing to catch it.
 * That is reason B in `folder_structure_sop.md` § Where An Abstraction Lives:
 * 3 real consumers in independent services, and a core with no framework in it
 * (`@nestjs/*` never appears here — the `CanActivate` shell stays per-service,
 * exactly like `MembershipVerificationClient` wraps `MembershipVerifier`).
 *
 * `algorithms: ['RS256']` is pinned deliberately and must stay pinned: without
 * it, `jsonwebtoken` would accept any algorithm the TOKEN names, letting an
 * attacker sign with HS256 using the (public!) verification key as the HMAC
 * secret — the classic algorithm-confusion attack. Refresh tokens cannot be
 * replayed here either: they are HS256 signed with a separate secret that
 * never leaves auth-service, so they fail this check on both counts.
 */
export function verifyAccessToken(token: string, publicKey: string): AccessTokenClaims {
  let payload: unknown
  try {
    payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] })
  } catch (err) {
    throw new InvalidAccessTokenError(err instanceof Error ? err.message : 'Invalid token')
  }

  // A validly-SIGNED token can still be the wrong shape (an older token issued
  // before a claim existed, or a token minted by a different flow). The three
  // guards used to blind-cast the payload, so a missing `permissions` claim
  // surfaced as `undefined` deep inside a permission check rather than as a
  // rejected token. Normalising once, here, is the point of sharing this.
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidAccessTokenError('Token payload is not an object')
  }

  const claims = payload as Record<string, unknown>
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new InvalidAccessTokenError('Token is missing a subject')
  }

  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    roles: toStringArray(claims.roles),
    permissions: toStringArray(claims.permissions),
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}
