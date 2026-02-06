import { AppError } from './app-error'

export abstract class InfrastructureError extends AppError {
  readonly statusCode = 500
}