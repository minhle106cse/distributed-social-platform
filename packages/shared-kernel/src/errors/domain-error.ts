import { AppError } from './app-error'

export abstract class DomainError extends AppError {
  readonly statusCode = 400
}