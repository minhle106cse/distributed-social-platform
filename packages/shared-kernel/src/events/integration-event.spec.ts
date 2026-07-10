import { defineEvent } from './integration-event.js'

interface TestPayload {
  itemId: string
}

describe('defineEvent', () => {
  it('nên bind eventType/aggregateType 1 lần, create() sinh input đầy đủ và đúng field', () => {
    const TestEvent = defineEvent<TestPayload>({
      eventType: 'TEST_EVENT' as never,
      aggregateType: 'TestAggregate',
    })

    const input = TestEvent.create({
      aggregateId: 'agg-1',
      orgId: 'org-1',
      payload: { itemId: 'item-1' },
    })

    expect(input).toEqual({
      eventType: 'TEST_EVENT',
      aggregateType: 'TestAggregate',
      aggregateId: 'agg-1',
      orgId: 'org-1',
      payload: { itemId: 'item-1' },
    })
  })

  it('nên expose lại eventType trên chính EventDefinition (không chỉ trong output của create())', () => {
    const TestEvent = defineEvent<TestPayload>({
      eventType: 'TEST_EVENT' as never,
      aggregateType: 'TestAggregate',
    })

    expect(TestEvent.eventType).toBe('TEST_EVENT')
  })

  it('create() nên trả về plain object (serializable), không phải class instance', () => {
    const TestEvent = defineEvent<TestPayload>({
      eventType: 'TEST_EVENT' as never,
      aggregateType: 'TestAggregate',
    })

    const input = TestEvent.create({ aggregateId: 'a', orgId: 'o', payload: { itemId: 'i' } })

    expect(input.constructor).toBe(Object)
    expect(() => JSON.stringify(input)).not.toThrow()
  })
})
