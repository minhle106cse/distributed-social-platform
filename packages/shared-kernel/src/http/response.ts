import type { ErrorDetails } from '../errors/app-error.js'

export interface BaseMeta {
  requestId: string
  timestamp: string
  version: string
}

export interface ErrorResponse {
  success: false
  message?: string
  error: {
    code: string
    details?: ErrorDetails
  }
  meta: BaseMeta
}

export interface SuccessResponse {
  success: true
  data?: unknown
  message?: string
  meta: BaseMeta
}

export class ApiResponse {
  public readonly success: boolean = true
  public readonly message?: string
  public readonly data?: unknown
  public readonly statusCode: number

  constructor(data?: unknown, message?: string, statusCode = 200) {
    this.data = data
    this.message = message
    this.statusCode = statusCode
  }
}
