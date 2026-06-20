import { AppError } from './app-error.js'

export abstract class InfrastructureError extends AppError {
  readonly statusCode = 500
}

export class UnreachableError extends InfrastructureError {
  readonly code = 'UNREACHABLE'

  constructor(message = 'Unreachable code block executed') {
    super(message)
  }
}

export class ResponseFormatError extends InfrastructureError {
  readonly code = 'RESPONSE_FORMAT_ERROR'

  constructor() {
    super('Route handler returned an unexpected response type. Use ApiResponse for all route return values.')
  }
}
