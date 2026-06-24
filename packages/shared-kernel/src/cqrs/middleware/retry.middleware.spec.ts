import { RetryMiddleware } from './retry.middleware.js'
import type { ICommand } from '../interfaces/command.interface.js'
import type { ILogger } from '../../logger/index.js'

describe('RetryMiddleware', () => {
  let logger: jest.Mocked<ILogger>
  let delays: number[]

  // Command mẫu; options.retryable quyết định middleware có vào vòng lặp retry hay không.
  const makeCommand = (retryable: boolean): ICommand =>
    ({ name: 'TestCommand', options: { retryable } }) as unknown as ICommand

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

  it('không retryable → chỉ gọi next() đúng 1 lần, không retry', async () => {
    const mw = new RetryMiddleware(logger, () => true)
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(false), next)

    expect(result).toBe('ok')
    expect(next).toHaveBeenCalledTimes(1)
    expect(delays).toHaveLength(0)
  })

  it('retryable + thành công ngay lần đầu → next() 1 lần, không delay', async () => {
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
