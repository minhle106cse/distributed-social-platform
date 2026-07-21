import type { ILogger } from '../logger/index.js'
import { CircuitBreaker } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  let mockLogger: jest.Mocked<ILogger>

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
  })

  it('should start CLOSED and pass through a successful call', async () => {
    const breaker = new CircuitBreaker('test-closed-pass', mockLogger, 3, 60_000)

    const result = await breaker.execute(async () => 'ok')

    expect(result).toBe('ok')
    expect(breaker.currentState).toBe('closed')
  })

  it('should stay CLOSED and count failures below the threshold', async () => {
    const breaker = new CircuitBreaker('test-below-threshold', mockLogger, 3, 60_000)
    const failing = () => Promise.reject(new Error('boom'))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    await expect(breaker.execute(failing)).rejects.toThrow('boom')

    expect(breaker.currentState).toBe('closed')
  })

  it('should trip OPEN after reaching the failure threshold, then fail fast without calling fn again', async () => {
    const breaker = new CircuitBreaker('test-trip-open', mockLogger, 2, 60_000)
    const failing = jest.fn(() => Promise.reject(new Error('boom')))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.currentState).toBe('open')

    const callCountBeforeFastFail = failing.mock.calls.length
    await expect(breaker.execute(failing)).rejects.toThrow('Circuit open')
    expect(failing).toHaveBeenCalledTimes(callCountBeforeFastFail) // fn was NOT invoked again
  })

  it('should move to HALF-OPEN after the timeout elapses and CLOSE again on a successful probe', async () => {
    const breaker = new CircuitBreaker('test-half-open-recover', mockLogger, 1, 50)
    const failing = () => Promise.reject(new Error('boom'))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.currentState).toBe('open')

    await new Promise((resolve) => setTimeout(resolve, 60))

    const result = await breaker.execute(async () => 'recovered')

    expect(result).toBe('recovered')
    expect(breaker.currentState).toBe('closed')
  })

  it('should re-open immediately if the HALF-OPEN probe itself fails', async () => {
    const breaker = new CircuitBreaker('test-half-open-fail', mockLogger, 1, 50)
    const failing = () => Promise.reject(new Error('boom'))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    await new Promise((resolve) => setTimeout(resolve, 60))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.currentState).toBe('open')
  })

  it('should let only ONE concurrent caller probe in HALF-OPEN, blocking the rest until it resolves', async () => {
    const breaker = new CircuitBreaker('test-half-open-race', mockLogger, 1, 50)
    const failing = () => Promise.reject(new Error('boom'))

    await expect(breaker.execute(failing)).rejects.toThrow('boom')
    expect(breaker.currentState).toBe('open')
    await new Promise((resolve) => setTimeout(resolve, 60))

    // A slow probe that hasn't resolved yet, plus 4 concurrent callers arriving
    // right as the timeout elapses — only the probe itself should reach fn();
    // the rest must fail fast with 'Circuit open', not pile onto the recovering
    // dependency (the bug this test guards against).
    let probeCalls = 0
    const slowProbe = () =>
      new Promise<string>((resolve) => {
        probeCalls++
        setTimeout(() => resolve('recovered'), 30)
      })

    const [probeResult, ...rest] = await Promise.allSettled([
      breaker.execute(slowProbe),
      breaker.execute(slowProbe),
      breaker.execute(slowProbe),
      breaker.execute(slowProbe),
    ])

    expect(probeCalls).toBe(1) // only ONE of the 4 concurrent calls actually invoked fn()
    expect(probeResult).toEqual({ status: 'fulfilled', value: 'recovered' })
    for (const r of rest) {
      expect(r.status).toBe('rejected')
      if (r.status === 'rejected') expect(r.reason.message).toBe('Circuit open')
    }
    expect(breaker.currentState).toBe('closed') // the successful probe closed it
  })
})
