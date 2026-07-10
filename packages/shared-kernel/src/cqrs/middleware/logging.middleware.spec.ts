import { LoggingMiddleware } from './logging.middleware.js'
import type { ICommand } from '../interfaces/command.interface.js'
import type { ILogger } from '../../logger/index.js'

const makeCommand = (name = 'TestCommand'): ICommand => ({ name }) as unknown as ICommand

describe('LoggingMiddleware', () => {
  let logger: jest.Mocked<ILogger>
  let mw: LoggingMiddleware

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    mw = new LoggingMiddleware(logger)
  })

  it('thành công: log info bắt đầu + kết thúc, debug input, KHÔNG log error', async () => {
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(), next)

    expect(result).toBe('ok')
    expect(logger.info).toHaveBeenCalledTimes(2) // executing + success
    expect(logger.debug).toHaveBeenCalledTimes(1) // input
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('thất bại: log error kèm lỗi, vẫn propagate lỗi ra ngoài (không nuốt)', async () => {
    const err = new Error('boom')
    const next = jest.fn().mockRejectedValue(err)

    await expect(mw.execute(makeCommand(), next)).rejects.toBe(err)

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [logObj] = logger.error.mock.calls[0]
    expect((logObj as unknown as { err: unknown }).err).toBe(err)
  })
})
