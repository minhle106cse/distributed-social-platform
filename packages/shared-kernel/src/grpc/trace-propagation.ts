import type * as grpc from '@grpc/grpc-js'

// W3C Trace Context over gRPC metadata — same convention as
// internal-grpc-auth.ts (centralized key name so client/server can't drift).
// See tracing/trace-context.ts for the header format itself.
export const TRACEPARENT_METADATA_KEY = 'traceparent'

export function attachTraceparent(
  metadata: grpc.Metadata,
  traceparent: string | undefined,
): grpc.Metadata {
  if (traceparent) metadata.set(TRACEPARENT_METADATA_KEY, traceparent)
  return metadata
}

export function readTraceparent(call: grpc.ServerUnaryCall<unknown, unknown>): string | undefined {
  const value = call.metadata.get(TRACEPARENT_METADATA_KEY)[0]
  return typeof value === 'string' ? value : undefined
}
