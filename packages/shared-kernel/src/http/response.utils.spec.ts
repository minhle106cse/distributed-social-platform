import { httpStatusToCode, buildErrorBody, buildSuccessBody } from './response.utils.js'

describe('httpStatusToCode', () => {
  it('nên map đúng các status code đã biết', () => {
    expect(httpStatusToCode(404)).toBe('NOT_FOUND')
    expect(httpStatusToCode(409)).toBe('CONFLICT')
    expect(httpStatusToCode(429)).toBe('TOO_MANY_REQUESTS')
  })

  it('nên fallback về INTERNAL_SERVER_ERROR cho status code không có trong map', () => {
    expect(httpStatusToCode(418)).toBe('INTERNAL_SERVER_ERROR')
  })
})

describe('buildErrorBody', () => {
  it('nên dựng đúng shape ErrorResponse với success:false và meta.requestId', () => {
    const body = buildErrorBody({
      code: 'NOT_FOUND',
      message: 'Not found',
      details: { field: 'id' },
      requestId: 'req-1',
    })

    expect(body).toMatchObject({
      success: false,
      message: 'Not found',
      error: { code: 'NOT_FOUND', details: { field: 'id' } },
      meta: { requestId: 'req-1', version: '1.0.0' },
    })
    expect(body.meta.timestamp).toEqual(expect.any(String))
  })
})

describe('buildSuccessBody', () => {
  it('nên dựng đúng shape SuccessResponse với success:true và data truyền vào', () => {
    const body = buildSuccessBody({ data: { id: 1 }, message: 'ok', requestId: 'req-1' })

    expect(body).toMatchObject({
      success: true,
      data: { id: 1 },
      message: 'ok',
      meta: { requestId: 'req-1', version: '1.0.0' },
    })
  })
})
