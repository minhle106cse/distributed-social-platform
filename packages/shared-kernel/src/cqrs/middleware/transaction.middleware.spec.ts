import { TransactionMiddleware } from './transaction.middleware.js'
import type { ICommand } from '../interfaces/command.interface.js'
import type { ITransactionManager } from '../../database/transaction-manager.interface.js'
import type { ILogger } from '../../logger/index.js'

const makeCommand = (transactional: boolean): ICommand =>
  ({ name: 'TestCommand', options: { transactional } }) as unknown as ICommand

describe('TransactionMiddleware', () => {
  let logger: jest.Mocked<ILogger>
  let txManager: jest.Mocked<ITransactionManager>
  let mw: TransactionMiddleware

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ILogger>
    txManager = { run: jest.fn((cb) => cb()) } as unknown as jest.Mocked<ITransactionManager>
    mw = new TransactionMiddleware(txManager, logger)
  })

  it('command KHÔNG transactional → bỏ qua transactionManager, gọi next() trực tiếp', async () => {
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(false), next)

    expect(result).toBe('ok')
    expect(txManager.run).not.toHaveBeenCalled()
  })

  it('command transactional → bọc next() trong transactionManager.run()', async () => {
    const next = jest.fn().mockResolvedValue('ok')

    const result = await mw.execute(makeCommand(true), next)

    expect(result).toBe('ok')
    expect(txManager.run).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('next() ném lỗi bên trong transaction → lỗi propagate ra ngoài (transactionManager tự rollback)', async () => {
    const err = new Error('db error')
    const next = jest.fn().mockRejectedValue(err)

    await expect(mw.execute(makeCommand(true), next)).rejects.toBe(err)
  })
})
