import * as grpc from '@grpc/grpc-js'
import {
  MembershipVerificationClient as GeneratedMembershipVerificationClient,
  type MembershipVerificationClient as IGeneratedMembershipVerificationClient,
} from './membership.js'
import { attachInternalGrpcSecret } from './internal-grpc-auth.js'
import { attachTraceparent } from './trace-propagation.js'
import { getCurrentTraceparent } from '../tracing/trace-context.js'
import { cachedLookup } from '../cache/cached-lookup.js'
import { CacheKeys } from '../cache/cache-keys.js'
import type { ICacheStore } from '../cache/cache-store.js'

export interface MembershipCheckResult {
  isMember: boolean
  permissions: string[]
}

/**
 * How the caller wraps each call — in practice a service's CircuitBreaker
 * (`<X>GrpcCaller.call`). Passed in rather than constructed here so the breaker
 * INSTANCE and its metric series stay per-service: two services sharing one
 * breaker would trip each other's circuit.
 */
export type BreakerCall = <T>(fn: () => Promise<T>) => Promise<T>

const DEFAULT_DEADLINE_MS = 3000
const DEFAULT_CACHE_TTL_MS = 30_000

/**
 * Short-lived membership cache. Every org-scoped request in search-service /
 * notification-service costs one gRPC round-trip to core-api without it, which
 * makes core-api a hard dependency of every single read — the breaker fails
 * such a request FAST, but it still fails it.
 *
 * Backed by an injected `ICacheStore` (Redis in every real deployment), NOT a
 * per-process Map: with N instances an in-process cache means N cold caches, N
 * times the gRPC load, and N different staleness windows for the same user —
 * and everything is thrown away on every restart/deploy. One shared entry in
 * Redis fixes all three. Omit the store and caching is simply off.
 *
 * The trade-off is explicit: a revoked membership or a removed permission keeps
 * working for up to `ttlMs`. Kept far below the 15-minute access-token TTL that
 * already bounds how stale a caller's identity can be, so this widens no window
 * that was not already open. There is no invalidation channel — TTL expiry is
 * the only eviction path for a still-live entry, so do NOT raise this to
 * minutes without adding one.
 */
export interface MembershipCacheOptions {
  /** 0 disables caching entirely, even when a store is supplied. */
  ttlMs?: number
  /** Where to cache. Omitted → no caching at all (the unit-test default). */
  store?: ICacheStore
}

export interface MembershipVerifierOptions {
  sharedSecret: string
  call: BreakerCall
  deadlineMs?: number
  cache?: MembershipCacheOptions
}

function parseCached(raw: string): MembershipCheckResult | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const candidate = parsed as { isMember?: unknown; permissions?: unknown }
    if (typeof candidate.isMember !== 'boolean' || !Array.isArray(candidate.permissions)) {
      return undefined
    }
    return {
      isMember: candidate.isMember,
      permissions: candidate.permissions.filter((p): p is string => typeof p === 'string'),
    }
  } catch {
    return undefined
  }
}

/**
 * Client half of proto/membership.proto, hand-written and framework-free.
 *
 * WHY THIS IS IN shared-kernel (promoted 2026-08-24): notification-service and
 * search-service each had a `MembershipVerificationClient` that was
 * BYTE-IDENTICAL apart from its doc comment — both exist because neither service
 * has a Membership table, so a caller-supplied `X-Org-Id` must be verified
 * against core-api before it is trusted (IDOR fix, resilience_patterns.md).
 * That is reason B in `folder_structure_sop.md` § Where An Abstraction Lives:
 * two real consumers in independent services, and a core with no framework in
 * it. It passes the kind test too — a runtime `@grpc/grpc-js` import is allowed
 * inside `src/grpc/**`, which already carries the generated stubs.
 *
 * The duplication was not harmless: neither copy attached `traceparent`, so
 * every membership check was a hole in the W3C trace chain that
 * `AuthProvisioningClient`/`RagQueryClient` maintain. Fixed here, once, for both
 * services.
 *
 * ⚠️ TWO WAYS TO BUILD ONE (changed 2026-08-25). `MembershipVerifier.connect(url, …)`
 * opens a real gRPC channel and is what services use; the CONSTRUCTOR takes an
 * already-built transport and is what tests use. Previously the constructor
 * `new`-ed its own channel from a URL, which left tests no seam: the spec built a
 * verifier and then reached in to overwrite the private `client` field
 * (`(verifier as unknown as {client}).client = stub`). A class that can only be
 * tested by monkey-patching its internals is telling you its dependency should be
 * a parameter. The transport stays constructed HERE rather than in each service so
 * that `new GeneratedClient(url, credentials.createInsecure())` is not re-duplicated
 * across the two consumers — which is the duplication promoting this class removed.
 */
export class MembershipVerifier {
  private readonly sharedSecret: string
  private readonly call: BreakerCall
  private readonly deadlineMs: number
  private readonly cacheTtlMs: number
  private readonly store?: ICacheStore

  /** Opens a real gRPC channel to core-api. The production entry point. */
  static connect(coreGrpcUrl: string, options: MembershipVerifierOptions): MembershipVerifier {
    return new MembershipVerifier(
      new GeneratedMembershipVerificationClient(coreGrpcUrl, grpc.credentials.createInsecure()),
      options,
    )
  }

  constructor(
    private readonly client: IGeneratedMembershipVerificationClient,
    options: MembershipVerifierOptions,
  ) {
    this.sharedSecret = options.sharedSecret
    this.call = options.call
    this.deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
    this.cacheTtlMs = options.cache?.ttlMs ?? DEFAULT_CACHE_TTL_MS
    this.store = options.cache?.store
  }

  close(): void {
    this.client.close()
  }

  private metadata(): grpc.Metadata {
    const metadata = attachInternalGrpcSecret(new grpc.Metadata(), this.sharedSecret)
    return attachTraceparent(metadata, getCurrentTraceparent())
  }

  async checkMembership(orgId: string, userId: string): Promise<MembershipCheckResult> {
    return cachedLookup({
      store: this.store,
      key: CacheKeys.membership(orgId, userId),
      ttlMs: this.cacheTtlMs,
      parse: parseCached,
      fetch: () => this.fetchMembership(orgId, userId),
    })
  }

  private async fetchMembership(orgId: string, userId: string): Promise<MembershipCheckResult> {
    return this.call(
      () =>
        new Promise<MembershipCheckResult>((resolve, reject) => {
          this.client.checkMembership(
            { orgId, userId },
            this.metadata(),
            { deadline: Date.now() + this.deadlineMs },
            (err, response) => {
              if (err) {
                reject(err)
                return
              }
              resolve({ isMember: response.isMember, permissions: response.permissions })
            },
          )
        }),
    )
  }
}
