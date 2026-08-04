import { CommandBus, type RetryPolicy } from './command-bus.js'
import type { ICommand } from './interfaces/command.interface.js'
import type {
  ISagaCommandHandler,
  ITransactionalCommandHandler,
} from './interfaces/command-handler.interface.js'
import type { SagaContext } from './interfaces/saga-context.interface.js'
import type { ISagaCompensationStore } from './interfaces/saga-compensation-store.interface.js'
import type { ITxRunner } from '../database/tx-scope.js'
import {
  CommandHandlerNotFoundError,
  DuplicateCommandHandlerError,
  NestedSagaDispatchError,
  UnknownHandlerKindError,
} from './errors/cqrs.error.js'
import type { ILogger } from '../logger/index.js'

interface TestScope {
  writes: string[]
}

const makeCommand = (name = 'TestCommand'): ICommand => ({ name })

/** Records every transaction opened, so "fresh transaction per retry" is observable. */
class FakeTxRunner implements ITxRunner<TestScope> {
  readonly opened: TestScope[] = []

  async run<R>(fn: (repos: TestScope) => Promise<R>): Promise<R> {
    const scope: TestScope = { writes: [] }
    this.opened.push(scope)
    return fn(scope)
  }
}

const makeLogger = (): jest.Mocked<ILogger> =>
  ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<ILogger>

describe('CommandBus', () => {
  let logger: jest.Mocked<ILogger>
  let txRunner: FakeTxRunner

  // baseDelay 0 so the jitter backoff doesn't slow the suite down.
  const makeBus = (
    isTransient: (e: unknown) => boolean = () => false,
    compensationStore?: ISagaCompensationStore,
    retryPolicy: RetryPolicy = { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 },
  ) =>
    new CommandBus(
      logger,
      txRunner,
      { isTransient, recordObservation: () => {} },
      retryPolicy,
      compensationStore,
    )

  beforeEach(() => {
    logger = makeLogger()
    txRunner = new FakeTxRunner()
  })

  const txHandler = (
    fn: (command: ICommand, tx: TestScope) => Promise<unknown>,
  ): ITransactionalCommandHandler<ICommand, unknown, TestScope> => ({
    kind: 'transactional',
    execute: fn,
  })

  const sagaHandler = (
    fn: (command: ICommand, ctx: SagaContext) => Promise<unknown>,
    dispatches: readonly string[] = [],
  ): ISagaCommandHandler<ICommand, unknown> => ({
    kind: 'saga',
    dispatches,
    execute: fn,
  })

  describe('register — validation lúc boot', () => {
    it('ném DuplicateCommandHandlerError khi register 2 handler cho cùng 1 command', () => {
      const bus = makeBus()
      bus.register(
        'TestCommand',
        txHandler(async () => 'a'),
      )

      expect(() =>
        bus.register(
          'TestCommand',
          txHandler(async () => 'b'),
        ),
      ).toThrow(DuplicateCommandHandlerError)
    })

    it('cho phép register saga handler mà không cần TxScope', () => {
      const bus = makeBus()
      expect(() =>
        bus.register(
          'SagaCommand',
          sagaHandler(async () => 'ok'),
        ),
      ).not.toThrow()
    })

    it('ném UnknownHandlerKindError khi handler thiếu `kind` (không phải transactional lẫn saga)', () => {
      const bus = makeBus()
      const malformed = { execute: async () => 'never' } as unknown as ITransactionalCommandHandler<
        ICommand,
        unknown,
        TestScope
      >

      expect(() => bus.register('TestCommand', malformed)).toThrow(UnknownHandlerKindError)
    })
  })

  describe('RetryPolicy — validation lúc construct', () => {
    it('ném RangeError khi maxRetries âm hoặc NaN, thay vì để retry loop không chạy lần nào', () => {
      expect(() =>
        makeBus(undefined, undefined, { maxRetries: -1, baseDelayMs: 0, maxDelayMs: 0 }),
      ).toThrow(RangeError)
      expect(() =>
        makeBus(undefined, undefined, { maxRetries: Number.NaN, baseDelayMs: 0, maxDelayMs: 0 }),
      ).toThrow(RangeError)
    })
  })

  describe('transactional handler', () => {
    it('ném CommandHandlerNotFoundError khi chưa register', async () => {
      const bus = makeBus()
      await expect(bus.execute(makeCommand('Unregistered'))).rejects.toThrow(
        CommandHandlerNotFoundError,
      )
    })

    it('chạy handler BÊN TRONG transaction và trả kết quả', async () => {
      const bus = makeBus()
      bus.register(
        'TestCommand',
        txHandler(async (_cmd, tx) => {
          tx.writes.push('insert')
          return 'ok'
        }),
      )

      const result = await bus.execute(makeCommand())

      expect(result).toBe('ok')
      expect(txRunner.opened).toHaveLength(1)
      expect(txRunner.opened[0].writes).toEqual(['insert'])
    })

    it('gọi afterCommit CHỈ SAU KHI transaction đã resolve, với kết quả execute() trả về', async () => {
      const bus = makeBus()
      const afterCommit = jest.fn()
      let afterCommitCalledBeforeReturn = false
      bus.register('TestCommand', {
        kind: 'transactional',
        execute: async () => {
          afterCommitCalledBeforeReturn = afterCommit.mock.calls.length > 0
          return 'ok'
        },
        afterCommit,
      })

      await bus.execute(makeCommand())

      expect(afterCommitCalledBeforeReturn).toBe(false)
      expect(afterCommit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'TestCommand' }),
        'ok',
      )
    })

    it('KHÔNG gọi afterCommit khi execute() ném lỗi', async () => {
      const bus = makeBus()
      const afterCommit = jest.fn()
      bus.register('TestCommand', {
        kind: 'transactional',
        execute: async () => {
          throw new Error('boom')
        },
        afterCommit,
      })

      await expect(bus.execute(makeCommand())).rejects.toThrow('boom')
      expect(afterCommit).not.toHaveBeenCalled()
    })

    it('nuốt lỗi từ afterCommit — command ĐÃ commit thành công không được báo lỗi ra ngoài vì logging fail', async () => {
      const bus = makeBus()
      bus.register('TestCommand', {
        kind: 'transactional',
        execute: async () => 'ok',
        afterCommit: () => {
          throw new Error('audit sink down')
        },
      })

      await expect(bus.execute(makeCommand())).resolves.toBe('ok')
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'TestCommand' }),
        expect.stringContaining('afterCommit threw'),
      )
    })

    it('await afterCommit async — reject của nó cũng bị nuốt, không phải unhandled rejection', async () => {
      const bus = makeBus()
      bus.register('TestCommand', {
        kind: 'transactional',
        execute: async () => 'ok',
        afterCommit: async () => {
          throw new Error('async audit sink down')
        },
      })

      await expect(bus.execute(makeCommand())).resolves.toBe('ok')
    })
  })

  describe('retry — chỉ áp cho transactional, mỗi lần thử một transaction MỚI', () => {
    it('retry lỗi transient và mở transaction mới cho từng lần thử', async () => {
      const bus = makeBus((e) => (e as Error).message === 'deadlock')
      let attempts = 0
      bus.register(
        'TestCommand',
        txHandler(async (_cmd, tx) => {
          attempts++
          tx.writes.push(`attempt-${attempts}`)
          if (attempts < 3) throw new Error('deadlock')
          return 'recovered'
        }),
      )

      const result = await bus.execute(makeCommand())

      expect(result).toBe('recovered')
      expect(attempts).toBe(3)
      // 3 transaction riêng biệt — không phải retry bên trong 1 transaction đã abort.
      expect(txRunner.opened).toHaveLength(3)
      expect(txRunner.opened.map((s) => s.writes)).toEqual([
        ['attempt-1'],
        ['attempt-2'],
        ['attempt-3'],
      ])
    })

    it('KHÔNG retry lỗi không transient', async () => {
      const bus = makeBus(() => false)
      let attempts = 0
      bus.register(
        'TestCommand',
        txHandler(async () => {
          attempts++
          throw new Error('business rule violated')
        }),
      )

      await expect(bus.execute(makeCommand())).rejects.toThrow('business rule violated')
      expect(attempts).toBe(1)
      expect(txRunner.opened).toHaveLength(1)
    })

    it('ném lỗi gốc sau khi hết maxRetries', async () => {
      const bus = makeBus(() => true)
      let attempts = 0
      bus.register(
        'TestCommand',
        txHandler(async () => {
          attempts++
          throw new Error('deadlock')
        }),
      )

      await expect(bus.execute(makeCommand())).rejects.toThrow('deadlock')
      expect(attempts).toBe(4) // lần đầu + 3 retry
    })

    it('KHÔNG retry saga (side effect của saga không rollback được)', async () => {
      const bus = makeBus(() => true)
      let attempts = 0
      bus.register(
        'SagaCommand',
        sagaHandler(async () => {
          attempts++
          throw new Error('deadlock')
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).rejects.toThrow('deadlock')
      expect(attempts).toBe(1)
    })
  })

  describe('saga — compensation stack', () => {
    it('chạy compensation theo thứ tự NGƯỢC khi execute thất bại', async () => {
      const bus = makeBus()
      const undone: string[] = []
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => {
          ctx.onCompensate({ type: 'undo-1', payload: {} }, async () => {
            undone.push('undo-step-1')
          })
          ctx.onCompensate({ type: 'undo-2', payload: {} }, async () => {
            undone.push('undo-step-2')
          })
          throw new Error('step 3 failed')
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).rejects.toThrow('step 3 failed')
      expect(undone).toEqual(['undo-step-2', 'undo-step-1'])
    })

    it('KHÔNG chạy compensation khi saga thành công', async () => {
      const bus = makeBus()
      const undone: string[] = []
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => {
          ctx.onCompensate({ type: 'undo', payload: {} }, async () => {
            undone.push('undo')
          })
          return 'ok'
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).resolves.toBe('ok')
      expect(undone).toEqual([])
    })

    it('lỗi trong compensation KHÔNG được che lỗi gốc', async () => {
      const bus = makeBus()
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => {
          ctx.onCompensate({ type: 'undo', payload: {} }, async () => {
            throw new Error('compensation blew up')
          })
          throw new Error('original failure')
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).rejects.toThrow('original failure')
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Compensation step failed'),
      )
    })

    it('ghi vào compensationStore khi compensation tự fail — kho lưu trữ, không chỉ log', async () => {
      const recordFailed = jest.fn().mockResolvedValue(undefined)
      const store: ISagaCompensationStore = { recordFailed }
      const bus = makeBus(() => false, store)
      const compensationError = new Error('cancel-provisioned-user blew up')
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => {
          ctx.onCompensate(
            { type: 'cancel-provisioned-user', payload: { userId: 'u-1' } },
            async () => {
              throw compensationError
            },
          )
          throw new Error('original failure')
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).rejects.toThrow('original failure')

      expect(recordFailed).toHaveBeenCalledWith(
        'SagaCommand',
        { type: 'cancel-provisioned-user', payload: { userId: 'u-1' } },
        compensationError,
      )
    })

    it('KHÔNG gọi compensationStore khi compensation tự chạy thành công', async () => {
      const recordFailed = jest.fn().mockResolvedValue(undefined)
      const store: ISagaCompensationStore = { recordFailed }
      const bus = makeBus(() => false, store)
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => {
          ctx.onCompensate({ type: 'undo', payload: {} }, async () => {})
          throw new Error('original failure')
        }),
      )

      await expect(bus.execute(makeCommand('SagaCommand'))).rejects.toThrow('original failure')
      expect(recordFailed).not.toHaveBeenCalled()
    })

    it('ctx.dispatch đi vòng lại qua bus (saga điều phối command transactional)', async () => {
      const bus = makeBus()
      bus.register(
        'InnerCommand',
        txHandler(async (_cmd, tx) => {
          tx.writes.push('inner-write')
          return 'inner-result'
        }),
      )
      bus.register(
        'SagaCommand',
        sagaHandler(async (_cmd, ctx) => ctx.dispatch<string>(makeCommand('InnerCommand')), [
          'InnerCommand',
        ]),
      )

      const result = await bus.execute(makeCommand('SagaCommand'))

      expect(result).toBe('inner-result')
      expect(txRunner.opened).toHaveLength(1)
      expect(txRunner.opened[0].writes).toEqual(['inner-write'])
    })

    it('ném NestedSagaDispatchError ngay lúc register (boot-time), không đợi tới lúc chạy — dù đăng ký theo thứ tự nào', () => {
      // Outer registered first, inner second: violation only becomes visible
      // once InnerSaga lands, so it must throw from THAT register() call.
      const busOuterFirst = makeBus()
      busOuterFirst.register(
        'OuterSaga',
        sagaHandler(async (_cmd, ctx) => ctx.dispatch(makeCommand('InnerSaga')), ['InnerSaga']),
      )
      expect(() =>
        busOuterFirst.register(
          'InnerSaga',
          sagaHandler(async () => 'inner-result'),
        ),
      ).toThrow(NestedSagaDispatchError)

      // Inner registered first, outer second: violation becomes visible when
      // OuterSaga lands, so THAT call must throw instead.
      const busInnerFirst = makeBus()
      busInnerFirst.register(
        'InnerSaga2',
        sagaHandler(async () => 'inner-result'),
      )
      expect(() =>
        busInnerFirst.register(
          'OuterSaga2',
          sagaHandler(async (_cmd, ctx) => ctx.dispatch(makeCommand('InnerSaga2')), ['InnerSaga2']),
        ),
      ).toThrow(NestedSagaDispatchError)
    })
  })

  describe('logging — pipeline cố định, luôn bọc ngoài cùng', () => {
    it('log info lúc bắt đầu và lúc thành công (kèm durationMs)', async () => {
      const bus = makeBus()
      bus.register(
        'TestCommand',
        txHandler(async () => 'ok'),
      )

      await bus.execute(makeCommand())

      expect(logger.info).toHaveBeenCalledWith(expect.anything(), 'Executing TestCommand...')
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: expect.any(Number) }),
        'Successfully executed TestCommand',
      )
    })

    it('log error khi handler ném', async () => {
      const bus = makeBus()
      bus.register(
        'TestCommand',
        txHandler(async () => {
          throw new Error('boom')
        }),
      )

      await expect(bus.execute(makeCommand())).rejects.toThrow('boom')
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to execute TestCommand',
      )
    })
  })
})
