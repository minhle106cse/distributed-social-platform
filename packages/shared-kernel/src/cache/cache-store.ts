/**
 * A string key/value store with per-entry expiry — the seam that lets
 * shared-kernel code cache without owning a live infrastructure connection.
 *
 * WHY A PORT AND NOT AN ioredis CLIENT HERE: `check:arch` check H bans
 * `ioredis` (alongside kafkajs / @nestjs / fastify / @prisma) from
 * shared-kernel — the same rule that makes `MinimalConsumer` mirror kafkajs's
 * API instead of importing it. shared-kernel owns ALGORITHMS, never live
 * connections. So the Redis client lives in each service's
 * `infrastructure/cache/`, and only this interface crosses the boundary.
 *
 * ⚠️ CONTRACT: an implementation MUST NOT throw. A cache is an optimisation
 * sitting in front of an authoritative source, so an unreachable Redis must
 * degrade to a MISS (re-query the source), never to an error and never to a
 * stale "allow". Callers still defend themselves — `MembershipVerifier`
 * wraps both calls — but the adapter is where the swallowing belongs, because
 * only it can log the real cause.
 */
export interface ICacheStore {
  /** Returns null on miss, on expiry, or on any backend failure. */
  get(key: string): Promise<string | null>
  /** Best-effort write; a failure must be swallowed, not propagated. */
  set(key: string, value: string, ttlMs: number): Promise<void>
  /**
   * Best-effort invalidation; deleting an absent key is a no-op, not an error.
   *
   * Swallowing a failure here is a REAL trade-off, unlike get/set: a dropped
   * delete leaves a stale entry until its TTL expires. That is the price of
   * never failing a write whose database work already committed, and it is why
   * the TTL stays short enough to be an acceptable worst case on its own —
   * invalidation shortens the stale window, it is not the only thing closing it.
   */
  del(key: string): Promise<void>
}

/**
 * DI token for the port above. A plain `Symbol`, so it carries no framework
 * dependency and can live beside the interface it names — the same convention
 * the per-module repository ports follow (`MEMBERSHIP_QUERY_REPOSITORY` sits in
 * the file declaring `IMembershipQueryRepository`).
 *
 * Declared here rather than per-service (changed 2026-08-25) because three
 * services each defined their OWN `Symbol('CACHE_STORE')` for the same port.
 * Distinct symbols are distinct tokens, so nothing shared could ever ask for
 * "the cache" — every consumer had to import its own service's copy, which is
 * exactly what stops an application-layer handler from depending on the port
 * without reaching into `infrastructure/`.
 */
export const CACHE_STORE = Symbol('CACHE_STORE')
