import { makePrismaTransientErrorHelpers, isMarkedTransient } from './prisma-transient-error.js'

const knownRequestError = (code: string) =>
  Object.assign(new Error('mock'), { code, clientVersion: 'test' })

describe('makePrismaTransientErrorHelpers', () => {
  const { isTransient, recordObservation } = makePrismaTransientErrorHelpers({
    metricPrefix: `test_${Math.random().toString(36).slice(2)}`,
  })

  describe('isTransient', () => {
    it('trả về true cho P2034 (deadlock/write-conflict) — an toàn để retry', () => {
      expect(isTransient(knownRequestError('P2034'))).toBe(true)
    })

    it('trả về false cho P2028 (connection/pool issue) — KHÔNG retry, xem resilience_patterns.md §3', () => {
      expect(isTransient(knownRequestError('P2028'))).toBe(false)
    })

    it('trả về false cho lỗi Prisma known khác (vd P2002 unique constraint)', () => {
      expect(isTransient(knownRequestError('P2002'))).toBe(false)
    })

    it('trả về false cho lỗi không phải PrismaClientKnownRequestError', () => {
      expect(isTransient(new Error('boom'))).toBe(false)
    })

    it('trả về true cho lỗi domain khai transient:true (vd CreditConcurrencyError)', () => {
      expect(isTransient({ transient: true })).toBe(true)
    })
  })

  describe('recordObservation', () => {
    it('KHÔNG throw khi ghi nhận P2034/P2028/lỗi thường/lỗi khác Prisma', () => {
      expect(() => recordObservation(knownRequestError('P2034'), true)).not.toThrow()
      expect(() => recordObservation(knownRequestError('P2028'), false)).not.toThrow()
      expect(() => recordObservation(knownRequestError('P2002'), false)).not.toThrow()
      expect(() => recordObservation(new Error('boom'), false)).not.toThrow()
    })

    it('đếm lỗi domain khai transient:true (vd CreditConcurrencyError) dưới label A2001 — bug tìm thấy 2026-08-11: retry path và observation path từng lệch scope nhau', async () => {
      const { register } = await import('prom-client')
      const metricPrefix = `test_marked_${Math.random().toString(36).slice(2)}`
      const { isTransient, recordObservation: record } = makePrismaTransientErrorHelpers({
        metricPrefix,
      })
      const occConflict = { transient: true as const }

      // isTransient đã retry error này từ trước — assert lại để khoá bất biến
      // "retry" và "observe" phải cùng nhận diện nó, không phải 2 predicate lệch nhau.
      expect(isTransient(occConflict)).toBe(true)
      expect(() => record(occConflict, true)).not.toThrow()

      const metric = await register.getSingleMetricAsString(
        `${metricPrefix}_db_transient_error_total`,
      )
      expect(metric).toContain('code="A2001"')
      expect(metric).toContain('retried="true"')
    })
  })
})

describe('isMarkedTransient', () => {
  it('trả về true khi error khai transient: true', () => {
    expect(isMarkedTransient({ transient: true })).toBe(true)
  })

  it('trả về false cho error thường hoặc null/undefined', () => {
    expect(isMarkedTransient(new Error('boom'))).toBe(false)
    expect(isMarkedTransient(null)).toBe(false)
    expect(isMarkedTransient(undefined)).toBe(false)
  })
})
