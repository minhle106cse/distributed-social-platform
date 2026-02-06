import { ErrorDetails } from "../errors/app-error";
import { ApplicationError } from "../errors/application-error";
import { BaseMeta } from "./base-meta.interface";

export interface ErrorResponse {
  success: false;
  message?: string;
  error: {
    code: string;
    details?: ErrorDetails;
  };
  meta: BaseMeta;
}

export class HttpResponseError extends ApplicationError {
  readonly statusCode: number
  readonly code: string

  constructor(details?: ErrorDetails) {
    super('Invalid response format', details)
    this.statusCode = 500
    this.code = 'HTTP_RESPONSE_ERROR'
  }
}
