import { BaseMeta } from "./base-meta.interface.js"

export class HttpResponseBuilder {
  public readonly success: boolean = true
  public readonly message?: string
  public readonly data?: unknown
  public readonly statusCode: number = 200

  constructor(data?: unknown, message?: string, statusCode: number = 200) {
    this.message = message
    this.data = data
    this.statusCode = statusCode
  }
}