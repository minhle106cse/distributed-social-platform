/**
 * Every Redis key the platform writes, allocated in ONE place.
 *
 * WHY A REGISTRY AND NOT A `cacheKey()` PER CONSUMER (2026-08-25): Redis is a
 * SINGLE keyspace shared by every service. A prefix chosen locally inside
 * whichever class happens to need a cache is a namespace allocated with no view
 * of what else is already there — two features can pick the same one and the
 * only symptom is one silently reading the other's value. Scattered helpers also
 * make "what does this deployment actually store, and under what TTL" an
 * archaeology exercise across N files. Allocating here makes the collision
 * checkable, and `cache-keys.spec.ts` checks it.
 *
 * This lives in shared-kernel even though `systemPermissions` has exactly one
 * consumer (core-api): the thing being centralised is not any one feature's key,
 * it is the ALLOCATION OF A SHARED NAMESPACE. A registry listing only some of
 * the keys would not prevent the collisions it exists to prevent.
 *
 * ⚠️ NOT every cache in the system is here, deliberately:
 *   - `OrgAwareThrottlerGuard` — `ThrottlerModule.forRoot` with no storage, so
 *     rate-limit counters are per-process memory, NOT Redis.
 *   - HTTP idempotency — Postgres (`idempotency_records`), because it must
 *     survive a restart and be transactional with the work it guards.
 * Adding either to Redis later means adding it here FIRST.
 */

/**
 * Separator inside a composite key. NUL because a key part can be
 * attacker-controlled — `orgId` arrives from the client's `X-Org-Id` header —
 * and a printable separator like ':' would let a crafted id shift the boundary
 * so two different (orgId, userId) pairs produce one key. NUL cannot appear in
 * an HTTP header value, so no input can forge it.
 */
const SEPARATOR = '\u0000'

/**
 * The namespace of every key family. Kept separate from the builders below so a
 * test can assert they cannot collide — see `cache-keys.spec.ts`.
 */
export const CACHE_NAMESPACES = {
  membership: 'membership',
  systemPermissions: 'system-permissions',
} as const

export type CacheNamespace = (typeof CACHE_NAMESPACES)[keyof typeof CACHE_NAMESPACES]

export const CacheKeys = {
  /** Org membership + resolved org permissions. Written by `MembershipVerifier`. */
  membership: (orgId: string, userId: string): string =>
    `${CACHE_NAMESPACES.membership}:${orgId}${SEPARATOR}${userId}`,

  /** Resolved SYSTEM permissions. Written by core-api's `SystemPermissionsClient`. */
  systemPermissions: (userId: string): string => `${CACHE_NAMESPACES.systemPermissions}:${userId}`,
} as const
