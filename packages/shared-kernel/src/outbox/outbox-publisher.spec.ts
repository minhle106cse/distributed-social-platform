import { OutboxPublisher } from './outbox-publisher.js'
import type { ClaimedOutboxEvent, IOutboxStore } from './outbox.ports.js'
import type { IMessagePublisher } from '../messaging/interfaces/message-publisher.interface.js'
import type { ILogger } from '../logger/index.js'

function row(over: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: 'row-1',
    aggregateType: 'KnowledgeItem',
    aggregateId: 'item-1',
    eventType: 'knowledge.published',
    orgId: 'org-1',
    payload: { title: 'x' },
    attempts: 0,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    traceparent: null,
    ...over,
  }
}

describe('OutboxPublisher', () => {
  let store: jest.Mocked<IOutboxStore>
  let publisher: jest.Mocked<IMessagePublisher>
  let logger: ILogger
  let onDeadLetter: jest.Mock

  const build = (maxAttempts = 3) => {
    onDeadLetter = jest.fn()
    return new OutboxPublisher({
      store,
      publisher,
      logger,
      sourcePrefix: '/cortex/core-api',
      maxAttempts,
      batchSize: 10,
      onDeadLetter,
    })
  }

  beforeEach(() => {
    store = {
      claimPendingBatch: jest.fn(),
      markProcessed: jest.fn(),
      markFailed: jest.fn(),
    }
    publisher = { publish: jest.fn() } as unknown as jest.Mocked<IMessagePublisher>
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as ILogger
  })

  it('nên không gọi publisher khi không claim được row nào', async () => {
    store.claimPendingBatch.mockResolvedValue([])

    const result = await build().pollOnce()

    expect(publisher.publish).not.toHaveBeenCalled()
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, deadLettered: 0 })
  })

  it('nên map row thành CloudEvent 1.0 với source ghép từ sourcePrefix + aggregateType', async () => {
    store.claimPendingBatch.mockResolvedValue([row({ traceparent: '00-abc-def-01' })])
    publisher.publish.mockResolvedValue(undefined)

    await build().pollOnce()

    expect(publisher.publish).toHaveBeenCalledWith({
      specversion: '1.0',
      id: 'row-1',
      source: '/cortex/core-api/KnowledgeItem',
      type: 'knowledge.published',
      time: '2026-08-24T00:00:00.000Z',
      subject: 'item-1',
      datacontenttype: 'application/json',
      data: { title: 'x' },
      orgid: 'org-1',
      partitionkey: 'item-1',
      traceparent: '00-abc-def-01',
    })
    expect(store.markProcessed).toHaveBeenCalledWith('row-1')
  })

  it('nên gửi traceparent là undefined (không phải null) khi row không có trace', async () => {
    store.claimPendingBatch.mockResolvedValue([row({ traceparent: null })])
    publisher.publish.mockResolvedValue(undefined)

    await build().pollOnce()

    expect(publisher.publish.mock.calls[0][0].traceparent).toBeUndefined()
  })

  it('một row lỗi KHÔNG được làm hỏng phần còn lại của batch', async () => {
    store.claimPendingBatch.mockResolvedValue([
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c' }),
    ])
    publisher.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('kafka down'))
      .mockResolvedValueOnce(undefined)

    const result = await build().pollOnce()

    expect(result).toEqual({ claimed: 3, published: 2, failed: 1, deadLettered: 0 })
    expect(store.markProcessed).toHaveBeenCalledWith('a')
    expect(store.markFailed).toHaveBeenCalledWith('b', 0, expect.any(String), 3)
    expect(store.markProcessed).toHaveBeenCalledWith('c')
  })

  it('nên tính DLQ theo attempts+1 >= maxAttempts, và chỉ khi đó mới gọi onDeadLetter', async () => {
    store.claimPendingBatch.mockResolvedValue([row({ id: 'last-try', attempts: 2 })])
    publisher.publish.mockRejectedValue(new Error('still down'))

    const result = await build(3).pollOnce()

    expect(result.deadLettered).toBe(1)
    expect(onDeadLetter).toHaveBeenCalledWith('knowledge.published')
  })

  it('chưa cạn budget thì KHÔNG được tính là dead-letter', async () => {
    store.claimPendingBatch.mockResolvedValue([row({ attempts: 0 })])
    publisher.publish.mockRejectedValue(new Error('transient'))

    const result = await build(3).pollOnce()

    expect(result.deadLettered).toBe(0)
    expect(onDeadLetter).not.toHaveBeenCalled()
  })

  it('lỗi từ claimPendingBatch phải thoát ra cho caller xử lý, không được nuốt', async () => {
    store.claimPendingBatch.mockRejectedValue(new Error('db blip'))

    await expect(build().pollOnce()).rejects.toThrow('db blip')
  })
})
