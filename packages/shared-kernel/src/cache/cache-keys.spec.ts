import { CACHE_NAMESPACES, CacheKeys } from './cache-keys'

const namespaces = Object.values(CACHE_NAMESPACES)

// The registry only prevents collisions if something CHECKS that it does.
// Without these, "allocate your namespace here" is a convention, and a
// convention is exactly what let the two cacheKey() helpers drift apart in the
// first place.
describe('cache namespace allocation', () => {
  it('allocates a distinct namespace to every key family', () => {
    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  // `a` and `a-b` are distinct strings but `a` still prefixes `a-b`, so a
  // SCAN/KEYS sweep for one namespace would sweep the other's entries too.
  it('has no namespace that is a prefix of another', () => {
    for (const a of namespaces) {
      for (const b of namespaces) {
        if (a !== b) expect(b.startsWith(a)).toBe(false)
      }
    }
  })

  // A ':' inside a namespace would move the delimiter and make "which family
  // does this key belong to" ambiguous to read and to grep.
  it('keeps the delimiter out of the namespace itself', () => {
    for (const ns of namespaces) {
      expect(ns).not.toContain(':')
      expect(ns).not.toContain(' ')
      expect(ns.length).toBeGreaterThan(0)
    }
  })
})

describe('CacheKeys', () => {
  it('prefixes every key with its declared namespace', () => {
    expect(
      CacheKeys.membership('org-1', 'user-1').startsWith(`${CACHE_NAMESPACES.membership}:`),
    ).toBe(true)
    expect(
      CacheKeys.systemPermissions('user-1').startsWith(`${CACHE_NAMESPACES.systemPermissions}:`),
    ).toBe(true)
  })

  // The reason the separator is NUL and not ':' — orgId comes straight from a
  // client header, so a printable separator lets a crafted id shift the
  // boundary and make two different (orgId, userId) pairs collide onto one key,
  // i.e. one org reading another's cached membership.
  it('cannot be made to collide by a crafted orgId', () => {
    const crafted = CacheKeys.membership('org-1:user-2', 'x')
    const honest = CacheKeys.membership('org-1', 'user-2:x')
    expect(crafted).not.toBe(honest)
  })

  it('separates composite parts with NUL, which no header value can contain', () => {
    expect(CacheKeys.membership('org-1', 'user-1')).toBe('membership:org-1\u0000user-1')
  })

  it('distinguishes different users within the same org', () => {
    expect(CacheKeys.membership('org-1', 'user-1')).not.toBe(
      CacheKeys.membership('org-1', 'user-2'),
    )
  })
})
