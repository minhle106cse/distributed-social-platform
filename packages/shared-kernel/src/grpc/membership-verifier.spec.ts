import { MembershipVerifier } from './membership-verifier'
import type { MembershipCheckResult } from './membership-verifier'
import type { ICacheStore } from '../cache/cache-store'

/** In-memory stand-in for the Redis adapter — same contract, no network. */
function fakeStore(): ICacheStore & { map: Map<string, { v: string; exp: number }> } {
  const map = new Map<string, { v: string; exp: number }>()
  return {
    map,
    get: async (key) => {
      const e = map.get(key)
      if (!e) return null
      if (e.exp <= Date.now()) {
        map.delete(key)
        return null
      }
      return e.v
    },
    set: async (key, value, ttlMs) => {
      map.set(key, { v: value, exp: Date.now() + ttlMs })
    },
  }
}

/**
 * The transport is a CONSTRUCTOR PARAMETER, so a stub goes straight in — no
 * network and no reaching into private fields. (Until 2026-08-25 the constructor
 * built its own channel from a URL and these tests had to overwrite the private
 * `client` afterwards; `MembershipVerifier.connect()` is now the only thing that
 * opens a real channel.) The caching logic under test sits above the wire, in
 * `checkMembership` itself.
 */
function buildVerifier(
  respond: () => Promise<MembershipCheckResult>,
  cacheOptions?: { ttlMs?: number; store?: ICacheStore },
): { verifier: MembershipVerifier; calls: () => number } {
  let calls = 0
  const transport = {
    checkMembership: (
      _req: unknown,
      _meta: unknown,
      _opts: unknown,
      cb: (err: Error | null, res?: { isMember: boolean; permissions: string[] }) => void,
    ) => {
      calls++
      respond().then(
        (res) => cb(null, res),
        (err: Error) => cb(err),
      )
    },
    close: () => undefined,
  }
  const verifier = new MembershipVerifier(
    transport as unknown as ConstructorParameters<typeof MembershipVerifier>[0],
    { sharedSecret: 'secret', call: (fn) => fn(), deadlineMs: 3000, cache: cacheOptions },
  )
  return { verifier, calls: () => calls }
}

const MEMBER: MembershipCheckResult = { isMember: true, permissions: ['knowledge:read'] }

describe('MembershipVerifier caching', () => {
  it('does not cache at all when no store is supplied', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER)

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('serves a repeat lookup from the store instead of a second gRPC call', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    const second = await verifier.checkMembership('org-1', 'user-1')

    expect(second).toEqual(MEMBER)
    expect(calls()).toBe(1)
  })

  it('does not let one org/user pair answer for another', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-2', 'user-1')
    await verifier.checkMembership('org-1', 'user-2')

    expect(calls()).toBe(3)
  })

  // orgId is a client-supplied header, so the two halves of the key must not be
  // ambiguous: 'a' + NUL + 'b' must never collide with a differently-split pair.
  it('keeps keys unambiguous when orgId contains the separator', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER, { store: fakeStore() })

    await verifier.checkMembership('a', 'b')
    await verifier.checkMembership('a\u0000b', '')

    expect(calls()).toBe(2)
  })

  // The store is shared with anything else using the same Redis.
  it('namespaces its keys so another feature cannot collide with them', async () => {
    const store = fakeStore()
    const { verifier } = buildVerifier(async () => MEMBER, { store })

    await verifier.checkMembership('org-1', 'user-1')

    expect([...store.map.keys()].every((k) => k.startsWith('membership:'))).toBe(true)
  })

  it('re-queries once the TTL has elapsed', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER, { ttlMs: 5, store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    await new Promise((resolve) => setTimeout(resolve, 15))
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('bypasses the cache entirely when ttlMs is 0, even with a store', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER, { ttlMs: 0, store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('never caches a failed lookup — one blip must not become a TTL of denials', async () => {
    let shouldFail = true
    const { verifier, calls } = buildVerifier(
      async () => {
        if (shouldFail) throw new Error('core-api unreachable')
        return MEMBER
      },
      { store: fakeStore() },
    )

    await expect(verifier.checkMembership('org-1', 'user-1')).rejects.toThrow(
      'core-api unreachable',
    )
    shouldFail = false
    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
    expect(calls()).toBe(2)
  })

  it('caches a negative membership result, which is a completed lookup, not a failure', async () => {
    const notMember: MembershipCheckResult = { isMember: false, permissions: [] }
    const { verifier, calls } = buildVerifier(async () => notMember, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(1)
  })

  // A cache is an optimisation in FRONT of an authoritative source; on an authz
  // path a broken one must degrade to a miss, never to an error.
  it('falls back to the source when the store throws on read', async () => {
    const broken: ICacheStore = {
      get: async () => {
        throw new Error('redis down')
      },
      set: async () => undefined,
    }
    const { verifier, calls } = buildVerifier(async () => MEMBER, { store: broken })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
    expect(calls()).toBe(1)
  })

  it('still answers when the store throws on write', async () => {
    const broken: ICacheStore = {
      get: async () => null,
      set: async () => {
        throw new Error('redis down')
      },
    }
    const { verifier } = buildVerifier(async () => MEMBER, { store: broken })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
  })

  // The entry is whatever is in Redis, not necessarily what this class wrote.
  it('treats a corrupt cached entry as a miss instead of trusting or crashing on it', async () => {
    const store = fakeStore()
    await store.set('membership:org-1\u0000user-1', '{"isMember":"yes-please"}', 30_000)
    const { verifier, calls } = buildVerifier(async () => MEMBER, { store })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
    expect(calls()).toBe(1)
  })
})
