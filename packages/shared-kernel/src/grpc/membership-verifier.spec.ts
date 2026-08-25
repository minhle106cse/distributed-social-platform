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
    del: async (key) => {
      map.delete(key)
    },
  }
}

/** What the RPC hands back — richer than what callers receive. */
interface RpcResponse {
  isMember: boolean
  permissions: string[]
  role: string
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
  respond: () => Promise<RpcResponse>,
  cacheOptions?: { ttlMs?: number; store?: ICacheStore },
): { verifier: MembershipVerifier; calls: () => number } {
  let calls = 0
  const transport = {
    checkMembership: (
      _req: unknown,
      _meta: unknown,
      _opts: unknown,
      cb: (err: Error | null, res?: RpcResponse) => void,
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

// What the RPC returns vs what checkMembership resolves to — the role is a
// caching detail the caller never sees.
const MEMBER_RPC: RpcResponse = { isMember: true, permissions: ['knowledge:read'], role: 'MEMBER' }
const MEMBER: MembershipCheckResult = { isMember: true, permissions: ['knowledge:read'] }

describe('MembershipVerifier caching', () => {
  it('does not cache at all when no store is supplied', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC)

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('serves a repeat lookup from the store instead of a second gRPC call', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    const second = await verifier.checkMembership('org-1', 'user-1')

    expect(second).toEqual(MEMBER)
    expect(calls()).toBe(1)
  })

  it('does not let one org/user pair answer for another', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-2', 'user-1')
    await verifier.checkMembership('org-1', 'user-2')

    expect(calls()).toBe(3)
  })

  // orgId is a client-supplied header, so the two halves of the key must not be
  // ambiguous: 'a' + NUL + 'b' must never collide with a differently-split pair.
  it('keeps keys unambiguous when orgId contains the separator', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store: fakeStore() })

    await verifier.checkMembership('a', 'b')
    await verifier.checkMembership('a\u0000b', '')

    expect(calls()).toBe(2)
  })

  // The store is shared with anything else using the same Redis.
  it('namespaces its keys so another feature cannot collide with them', async () => {
    const store = fakeStore()
    const { verifier } = buildVerifier(async () => MEMBER_RPC, { store })

    await verifier.checkMembership('org-1', 'user-1')

    expect(
      [...store.map.keys()].every(
        (k) => k.startsWith('membership:') || k.startsWith('org-permissions:'),
      ),
    ).toBe(true)
  })

  it('re-queries once the TTL has elapsed', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, {
      ttlMs: 5,
      store: fakeStore(),
    })

    await verifier.checkMembership('org-1', 'user-1')
    await new Promise((resolve) => setTimeout(resolve, 15))
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('bypasses the cache entirely when ttlMs is 0, even with a store', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, {
      ttlMs: 0,
      store: fakeStore(),
    })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
  })

  it('never caches a failed lookup — one blip must not become a TTL of denials', async () => {
    let shouldFail = true
    const { verifier, calls } = buildVerifier(
      async () => {
        if (shouldFail) throw new Error('core-api unreachable')
        return MEMBER_RPC
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
    const notMember: RpcResponse = { isMember: false, permissions: [], role: '' }
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
      del: async () => undefined,
    }
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store: broken })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
    expect(calls()).toBe(1)
  })

  it('still answers when the store throws on write', async () => {
    const broken: ICacheStore = {
      get: async () => null,
      del: async () => {
        throw new Error('redis down')
      },
      set: async () => {
        throw new Error('redis down')
      },
    }
    const { verifier } = buildVerifier(async () => MEMBER_RPC, { store: broken })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
  })

  // The entry is whatever is in Redis, not necessarily what this class wrote.
  it('treats a corrupt cached entry as a miss instead of trusting or crashing on it', async () => {
    const store = fakeStore()
    await store.set('membership:org-1\u0000user-1', '{"isMember":"yes-please"}', 30_000)
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store })

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual(MEMBER)
    expect(calls()).toBe(1)
  })
})

// The whole point of keying the permission set by (orgId, role) instead of by
// (orgId, userId): one edit to a role invalidates with ONE delete, and the
// entry is stored once no matter how many members hold that role.
describe('MembershipVerifier permission cache keyed by role', () => {
  it('shares one permission entry between two members holding the same role', async () => {
    const store = fakeStore()
    const { verifier } = buildVerifier(async () => MEMBER_RPC, { store })

    await verifier.checkMembership('org-1', 'user-1')
    await verifier.checkMembership('org-1', 'user-2')

    const permissionKeys = [...store.map.keys()].filter((k) => k.startsWith('org-permissions:'))
    expect(permissionKeys).toEqual(['org-permissions:org-1\u0000MEMBER'])
  })

  it('serves the NEW permissions after a single delete of the role entry', async () => {
    const store = fakeStore()
    let permissions = ['knowledge:read']
    const { verifier } = buildVerifier(
      async () => ({ isMember: true, permissions, role: 'MEMBER' }),
      { store },
    )

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual({
      isMember: true,
      permissions: ['knowledge:read'],
    })

    // The OWNER edits org_role_permissions; UpdateRolePermissionsHandler issues
    // exactly this one delete in afterCommit.
    permissions = ['knowledge:read', 'credit:spend']
    await store.del('org-permissions:org-1\u0000MEMBER')

    await expect(verifier.checkMembership('org-1', 'user-1')).resolves.toEqual({
      isMember: true,
      permissions: ['knowledge:read', 'credit:spend'],
    })
  })

  it('keeps membership cached when only the permission entry is invalidated', async () => {
    const store = fakeStore()
    const { verifier } = buildVerifier(async () => MEMBER_RPC, { store })

    await verifier.checkMembership('org-1', 'user-1')
    await store.del('org-permissions:org-1\u0000MEMBER')

    expect(store.map.has('membership:org-1\u0000user-1')).toBe(true)
  })

  it('does not cache a permission entry for a non-member (there is no role)', async () => {
    const store = fakeStore()
    const { verifier } = buildVerifier(
      async () => ({ isMember: false, permissions: [], role: '' }),
      { store },
    )

    await verifier.checkMembership('org-1', 'user-1')

    expect([...store.map.keys()].filter((k) => k.startsWith('org-permissions:'))).toEqual([])
  })

  // Splitting one cache entry into two must not turn one round-trip into two.
  it('costs ONE round-trip on a cold cache, not one per cache entry', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store: fakeStore() })

    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(1)
  })

  it('costs ONE round-trip per call when caching is disabled entirely', async () => {
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC)

    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(1)
  })

  // Membership cached, role entry invalidated by an OWNER edit — the one case
  // that legitimately goes back to the wire on an otherwise warm cache.
  it('re-fetches only the permission set when its entry was invalidated', async () => {
    const store = fakeStore()
    const { verifier, calls } = buildVerifier(async () => MEMBER_RPC, { store })

    await verifier.checkMembership('org-1', 'user-1')
    await store.del('org-permissions:org-1\u0000MEMBER')
    await verifier.checkMembership('org-1', 'user-1')

    expect(calls()).toBe(2)
    expect(store.map.has('membership:org-1\u0000user-1')).toBe(true)
  })
})
