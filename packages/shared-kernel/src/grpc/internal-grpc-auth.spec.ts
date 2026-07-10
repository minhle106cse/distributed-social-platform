import * as grpc from '@grpc/grpc-js'
import {
  attachInternalGrpcSecret,
  verifyInternalGrpcSecret,
  INTERNAL_GRPC_SECRET_METADATA_KEY,
} from './internal-grpc-auth.js'

describe('internal gRPC auth (M2M shared-secret)', () => {
  describe('attachInternalGrpcSecret', () => {
    it('nên set đúng metadata key và trả về cùng instance metadata (mutate in place)', () => {
      const metadata = new grpc.Metadata()

      const result = attachInternalGrpcSecret(metadata, 'my-secret')

      expect(result).toBe(metadata)
      expect(metadata.get(INTERNAL_GRPC_SECRET_METADATA_KEY)).toEqual(['my-secret'])
    })
  })

  describe('verifyInternalGrpcSecret', () => {
    function buildCall(secretValue?: string) {
      const metadata = new grpc.Metadata()
      if (secretValue !== undefined) metadata.set(INTERNAL_GRPC_SECRET_METADATA_KEY, secretValue)
      return { metadata } as unknown as grpc.ServerUnaryCall<unknown, unknown>
    }

    it('nên trả true khi secret trong metadata khớp đúng secret kỳ vọng', () => {
      const call = buildCall('correct-secret')

      expect(verifyInternalGrpcSecret(call, 'correct-secret')).toBe(true)
    })

    it('nên trả false khi secret không khớp', () => {
      const call = buildCall('wrong-secret')

      expect(verifyInternalGrpcSecret(call, 'correct-secret')).toBe(false)
    })

    it('nên trả false khi metadata không có secret nào (call từ bên ngoài, không phải M2M)', () => {
      const call = buildCall(undefined)

      expect(verifyInternalGrpcSecret(call, 'correct-secret')).toBe(false)
    })
  })
})
