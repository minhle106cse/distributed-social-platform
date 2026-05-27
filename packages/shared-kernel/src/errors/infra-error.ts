import { AppError } from './app-error.js'

export abstract class InfrastructureError extends AppError {
  readonly statusCode = 500
}