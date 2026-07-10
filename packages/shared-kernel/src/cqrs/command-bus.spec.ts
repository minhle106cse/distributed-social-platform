import { CommandBus } from './command-bus.js'
import type { ICommand } from './interfaces/command.interface.js'
import type { ICommandHandler } from './interfaces/command-handler.interface.js'
import type { ICommandMiddleware, NextFn } from './interfaces/command-middleware.interface.js'
import { CommandHandlerNotFoundError } from './errors/cqrs.error.js'

const makeCommand = (name = 'TestCommand'): ICommand => ({ name }) as unknown as ICommand

describe('CommandBus', () => {
  let bus: CommandBus

  beforeEach(() => {
    bus = new CommandBus()
  })

  it('nên ném CommandHandlerNotFoundError khi chưa register handler cho command đó', async () => {
    await expect(bus.execute(makeCommand('Unregistered'))).rejects.toThrow(
      CommandHandlerNotFoundError,
    )
  })

  it('nên dispatch tới đúng handler đã register và trả về kết quả', async () => {
    const handler: jest.Mocked<ICommandHandler> = { execute: jest.fn().mockResolvedValue('ok') }
    bus.register('TestCommand', handler)

    const result = await bus.execute(makeCommand('TestCommand'))

    expect(result).toBe('ok')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  it('nên chạy middleware theo đúng thứ tự (onion), trước và sau khi gọi next()', async () => {
    const order: string[] = []
    const handler: jest.Mocked<ICommandHandler> = {
      execute: jest.fn().mockImplementation(async () => {
        order.push('handler')
        return 'result'
      }),
    }
    const mw1 = {
      execute: async (_cmd: ICommand, next: NextFn<unknown>) => {
        order.push('mw1-before')
        const r = await next()
        order.push('mw1-after')
        return r
      },
    } as unknown as ICommandMiddleware
    const mw2 = {
      execute: async (_cmd: ICommand, next: NextFn<unknown>) => {
        order.push('mw2-before')
        const r = await next()
        order.push('mw2-after')
        return r
      },
    } as unknown as ICommandMiddleware

    bus.register('TestCommand', handler)
    bus.use(mw1, mw2)

    const result = await bus.execute(makeCommand('TestCommand'))

    expect(result).toBe('result')
    expect(order).toEqual(['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after'])
  })

  it('middleware nên có thể chặn (short-circuit) chuỗi mà không gọi next()', async () => {
    const handler: jest.Mocked<ICommandHandler> = { execute: jest.fn() }
    const blocking = { execute: async () => 'blocked-early' } as unknown as ICommandMiddleware

    bus.register('TestCommand', handler)
    bus.use(blocking)

    const result = await bus.execute(makeCommand('TestCommand'))

    expect(result).toBe('blocked-early')
    expect(handler.execute).not.toHaveBeenCalled()
  })

  it('nên ném lỗi nếu middleware gọi next() nhiều hơn 1 lần', async () => {
    const handler: jest.Mocked<ICommandHandler> = { execute: jest.fn().mockResolvedValue('ok') }
    const doubleCall = {
      execute: async (_cmd: ICommand, next: NextFn<unknown>) => {
        await next()
        return next() // gọi lần 2 — phải bị chặn
      },
    } as unknown as ICommandMiddleware

    bus.register('TestCommand', handler)
    bus.use(doubleCall)

    await expect(bus.execute(makeCommand('TestCommand'))).rejects.toThrow(
      'next() called multiple times',
    )
  })
})
