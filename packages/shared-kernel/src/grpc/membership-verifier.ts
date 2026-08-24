import * as grpc from '@grpc/grpc-js'
import {
  MembershipVerificationClient as GeneratedMembershipVerificationClient,
  type MembershipVerificationClient as IGeneratedMembershipVerificationClient,
} from './membership.js'
import { attachInternalGrpcSecret } from './internal-grpc-auth.js'
import { attachTraceparent } from './trace-propagation.js'
import { getCurrentTraceparent } from '../tracing/trace-context.js'

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
 * Each service keeps a thin `@Injectable()` shell that supplies config and its
 * own breaker. What was duplicated — metadata assembly, deadline, the callback
 * bridge — now exists once.
 *
 * The duplication was not harmless: neither copy attached `traceparent`, so
 * every membership check was a hole in the W3C trace chain that
 * `AuthProvisioningClient`/`RagQueryClient` maintain. Fixed here, once, for both
 * services.
 */
export class MembershipVerifier {
  private readonly client: IGeneratedMembershipVerificationClient

  constructor(
    coreGrpcUrl: string,
    private readonly sharedSecret: string,
    private readonly call: BreakerCall,
    private readonly deadlineMs: number = DEFAULT_DEADLINE_MS,
  ) {
    this.client = new GeneratedMembershipVerificationClient(
      coreGrpcUrl,
      grpc.credentials.createInsecure(),
    )
  }

  close(): void {
    this.client.close()
  }

  private metadata(): grpc.Metadata {
    const metadata = attachInternalGrpcSecret(new grpc.Metadata(), this.sharedSecret)
    return attachTraceparent(metadata, getCurrentTraceparent())
  }

  async checkMembership(orgId: string, userId: string): Promise<MembershipCheckResult> {
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
