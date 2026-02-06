export type ErrorDetails =
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | undefined;

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  readonly?: string;
  readonly details?: ErrorDetails;

  protected constructor(message: string, details?: ErrorDetails) {
    super(message);
    this.details = details;
  }
}
