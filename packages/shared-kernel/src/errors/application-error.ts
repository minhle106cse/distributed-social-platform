import { AppError } from "./app-error.js";

export abstract class ApplicationError extends AppError {
  constructor(
    message: string,
    details?: Record<string, unknown> | Array<Record<string, unknown>>,
  ) {
    super(message, details);
  }
}
