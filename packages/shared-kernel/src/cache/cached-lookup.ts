import type { ICacheStore } from './cache-store.js'

export interface CachedLookupOptions<T> {
  /** Omitted/undefined → caching is off; `fetch` runs every time. */
  store: ICacheStore | undefined
  /** Namespace it (`membership:`, `system-permissions:`) — the store is shared. */
  key: string
  /** 0 or less disables caching, even when a store is supplied. */
  ttlMs: number
  /**
   * Validates a raw entry and narrows it to `T`. MUST return `undefined` for
   * anything it does not recognise: the value is whatever is in the store, not
   * necessarily what this caller wrote, so shape validation is mandatory rather
   * than a courtesy. Entries are written with `JSON.stringify`.
   */
  parse: (raw: string) => T | undefined
  /** The authoritative lookup. Only its SUCCESSFUL result is ever cached. */
  fetch: () => Promise<T>
}

/**
 * Read-through cache around an authoritative lookup (cache-aside).
 *
 * Extracted 2026-08-25: `MembershipVerifier` and core-api's
 * `SystemPermissionsClient` had each hand-rolled this same skeleton —
 * try/catch around the read, shape-validate, fall through to the source,
 * best-effort write, never cache a failure — differing only in which shape they
 * validated. Two copies of a policy this subtle is how one of them silently
 * drifts into caching an error or trusting a malformed entry.
 *
 * The three rules it enforces, none of them optional on an authz path:
 *
 * 1. **A cache failure is a MISS, never an error.** The store is in FRONT of an
 *    authoritative source, so an unreachable Redis must cost a round-trip, not
 *    a 500. `ICacheStore` already promises not to throw; this re-guards anyway,
 *    because a misbehaving adapter must not be able to fail a permission check.
 * 2. **Only a completed lookup is cached — never a rejection.** Absorbing a
 *    failing dependency is the circuit breaker's job. Caching the failure would
 *    turn one blip into a full TTL of denials. (A negative *answer*, e.g.
 *    `isMember: false`, IS cacheable: that is a completed lookup.)
 * 3. **A cached entry is untrusted input.** `parse` rejecting it reads as a
 *    miss, so a foreign or corrupt value degrades to a slower correct answer
 *    rather than a wrong one.
 */
export async function cachedLookup<T>({
  store,
  key,
  ttlMs,
  parse,
  fetch,
}: CachedLookupOptions<T>): Promise<T> {
  const enabled = store !== undefined && ttlMs > 0

  if (enabled) {
    try {
      const raw = await store.get(key)
      if (raw !== null) {
        const cached = parse(raw)
        if (cached !== undefined) return cached
      }
    } catch {
      // Fall through to the source — see rule 1.
    }
  }

  const result = await fetch()

  if (enabled) {
    try {
      await store.set(key, JSON.stringify(result), ttlMs)
    } catch {
      // A cache that cannot be written is still a working system.
    }
  }

  return result
}
