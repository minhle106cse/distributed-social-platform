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
}
