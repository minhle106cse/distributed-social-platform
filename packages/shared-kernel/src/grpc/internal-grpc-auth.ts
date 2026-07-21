import { createHash, timingSafeEqual } from 'crypto'
import type * as grpc from '@grpc/grpc-js'

// M2M auth for internal-only gRPC contracts (service-to-service traffic, not
// an end-user JWT — e.g. core-api calling auth-service's AuthProvisioning
// service). Every internal gRPC server should guard incoming calls with
// verifyInternalGrpcSecret(); every client should attach the same secret via
// attachInternalGrpcSecret(). Centralized here (not per-service) so the
// metadata key and comparison can't drift between callers as more internal
// gRPC services appear — each caller still supplies its OWN secret value
// (read from its own env/config), this only shares the wire convention.
export const INTERNAL_GRPC_SECRET_METADATA_KEY = 'x-internal-secret'

export function attachInternalGrpcSecret(metadata: grpc.Metadata, secret: string): grpc.Metadata {
  metadata.set(INTERNAL_GRPC_SECRET_METADATA_KEY, secret)
  return metadata
}

export function verifyInternalGrpcSecret(
  call: grpc.ServerUnaryCall<unknown, unknown>,
  expectedSecret: string,
): boolean {
  const provided = call.metadata.get(INTERNAL_GRPC_SECRET_METADATA_KEY)[0]
  if (typeof provided !== 'string') return false

  // timingSafeEqual throws on length mismatch instead of returning false, and
  // requires equal-length buffers — hash both sides first so length itself
  // (and therefore the comparison outcome) never leaks via response timing.
  const providedHash = createHash('sha256').update(provided).digest()
  const expectedHash = createHash('sha256').update(expectedSecret).digest()
  return timingSafeEqual(providedHash, expectedHash)
}
