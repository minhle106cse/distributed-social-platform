import { AppError } from './app-error.js'

export abstract class DomainError extends AppError {
  readonly statusCode = 400
}