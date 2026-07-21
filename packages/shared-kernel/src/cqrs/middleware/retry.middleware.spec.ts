import { RetryMiddleware } from './retry.middleware.js'
import type { ICommand } from '../interfaces/command.interface.js'
import type { ILogger } from '../../logger/index.js'

describe('RetryMiddleware', () => {
  let logger: jest.Mocked<ILogger>
  let delays: number[]

  // Command mẫu; options.transactional quyết định middleware có vào vòng lặp retry hay không
  // (không còn field retryable riêng — xem RetryMiddleware's doc comment, 2026-07-14).
  const makeCommand = (transactional: boolean): ICommand =>
    ({ name: 'TestCommand', options: { transactional } }) as unknown as ICommand

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>

    // Thay setTimeout thật bằng bản ghi-lại-delay + chạy callback ngay lập tức,
    // để test không phải chờ thật và vẫn assert được chính xác giá trị delay.
    delays = []
    jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      delays.push(ms ?? 0)
      cb()
      return 0 as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('không transactional → chỉ gọi next() đúng 1 lần, không retry', async () => {
    const mw = new RetryMiddleware(logger, () => true)
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(false), next)

    expect(result).toBe('ok')
    expect(next).toHaveBeenCalledTimes(1)
    expect(delays).toHaveLength(0)
  })

  it('transactional + thành công ngay lần đầu → next() 1 lần, không delay', async () => {
    const mw = new RetryMiddleware(logger, () => true)
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(true), next)

    expect(result).toBe('ok')
    expect(next).toHaveBeenCalledTimes(1)
    expect(delays).toHaveLength(0)
  })

  it('lỗi transient rồi thành công → retry và trả kết quả', async () => {
    const mw = new RetryMiddleware(logger, () => true)
    const next = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered')

    const result = await mw.execute(makeCommand(true), next)

    expect(result).toBe('recovered')
    expect(next).toHaveBeenCalledTimes(2)
    expect(delays).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('lỗi transient liên tục → ném lỗi sau maxRetries, gọi next() maxRetries+1 lần', async () => {
    const mw = new RetryMiddleware(logger, () => true, 3)
    const err = new Error('always transient')
    const next = jest.fn().mockRejectedValue(err)

    await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)
    expect(next).toHaveBeenCalledTimes(4) // 1 lần đầu + 3 retry
    expect(delays).toHaveLength(3)
  })

  it('lỗi KHÔNG transient → ném ngay, không retry', async () => {
    const mw = new RetryMiddleware(logger, () => false)
    const err = new Error('domain error')
    const next = jest.fn().mockRejectedValue(err)

    await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)
    expect(next).toHaveBeenCalledTimes(1)
    expect(delays).toHaveLength(0)
  })

  it('predicate được gọi với đúng error vừa ném ra', async () => {
    const isTransient = jest.fn().mockReturnValue(false)
    const mw = new RetryMiddleware(logger, isTransient)
    const err = new Error('boom')
    const next = jest.fn().mockRejectedValue(err)

    await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)
    expect(isTransient).toHaveBeenCalledWith(err)
  })

  describe('onError observability hook', () => {
    it('gọi onError(error, willRetry=true) khi còn attempt và predicate transient', async () => {
      const onError = jest.fn()
      const mw = new RetryMiddleware(logger, () => true, 3, 100, 2000, onError)
      const err = new Error('t')
      const next = jest.fn().mockRejectedValueOnce(err).mockResolvedValue('ok')

      await mw.execute(makeCommand(true), next)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(err, true)
    })

    it('gọi onError(error, willRetry=false) khi predicate không transient', async () => {
      const onError = jest.fn()
      const mw = new RetryMiddleware(logger, () => false, 3, 100, 2000, onError)
      const err = new Error('not transient')
      const next = jest.fn().mockRejectedValue(err)

      await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(err, false)
    })

    it('gọi onError(error, willRetry=false) ở lần thử cuối dù predicate transient (hết budget)', async () => {
      const onError = jest.fn()
      const mw = new RetryMiddleware(logger, () => true, 1, 100, 2000, onError)
      const err = new Error('always transient')
      const next = jest.fn().mockRejectedValue(err)

      await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)

      expect(onError).toHaveBeenCalledTimes(2) // attempt 1 (retry) + attempt 2 (budget hết)
      expect(onError).toHaveBeenNthCalledWith(1, err, true)
      expect(onError).toHaveBeenNthCalledWith(2, err, false)
    })

    it('không truyền onError vẫn hoạt động bình thường (optional, backward-compatible)', async () => {
      const mw = new RetryMiddleware(logger, () => true)
      const next = jest.fn().mockResolvedValue('ok')

      await expect(mw.execute(makeCommand(true), next)).resolves.toBe('ok')
    })
  })

  describe('full jitter backoff', () => {
    it('delay = random × min(cap, base·2^(n-1)); random=1 cho giá trị trần', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(1)
      const mw = new RetryMiddleware(logger, () => true, 3, 100, 2000)
      const next = jest.fn().mockRejectedValue(new Error('t'))

      await expect(mw.execute(makeCommand(true), next)).rejects.toThrow()
      expect(delays).toEqual([100, 200, 400])
    })

    it('cap maxDelayMs chặn trần của backoff', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(1)
      const mw = new RetryMiddleware(logger, () => true, 4, 1000, 2000)
      const next = jest.fn().mockRejectedValue(new Error('t'))

      await expect(mw.execute(makeCommand(true), next)).rejects.toThrow()
      // 1000, 2000, rồi bị cap ở 2000 cho các lần sau
      expect(delays).toEqual([1000, 2000, 2000, 2000])
    })

    it('random=0 → delay 0 (cho phép retry gần như tức thì cho deadlock)', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0)
      const mw = new RetryMiddleware(logger, () => true, 1, 100, 2000)
      const next = jest.fn().mockRejectedValue(new Error('t'))

      await expect(mw.execute(makeCommand(true), next)).rejects.toThrow()
      expect(delays).toEqual([0])
    })
  })
})
