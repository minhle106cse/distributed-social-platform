import type { ErrorDetails } from '../errors/app-error.js'
import type { ErrorResponse, SuccessResponse } from './response.js'

export function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_SERVER_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
  }
  return map[status] ?? 'INTERNAL_SERVER_ERROR'
}

export function buildErrorBody(params: {
  code: string
  message: string
  details?: ErrorDetails
  requestId: string
}): ErrorResponse {
  return {
    success: false,
    message: params.message,
    error: { code: params.code, details: params.details },
    meta: { requestId: params.requestId, timestamp: new Date().toISOString(), version: '1.0.0' },
  }
}

export function buildSuccessBody(params: {
  data?: unknown
  message?: string
  requestId: string
}): SuccessResponse {
  return {
    success: true,
    data: params.data,
    message: params.message,
    meta: { requestId: params.requestId, timestamp: new Date().toISOString(), version: '1.0.0' },
  }
}
