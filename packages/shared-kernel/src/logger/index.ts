import pino from 'pino'

export * from './log-context.js'

/**
 * Secret field paths masked in-process before any transport. `*.x` matches one
 * nesting level (e.g. `input.password`, `req.body.password`). Exported so it has
 * a single source of truth and can be asserted in tests.
 */
export const LOG_REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
]

export const LOG_REDACT_CENSOR = '[REDACTED]'

export interface ILogger {
  // Structured form (object first) — used to attach the `context` field and
  // other structured bindings. Mirrors pino / nestjs-pino LogFn overloads.
  info(obj: object, msg?: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  error(obj: object, msg?: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  warn(obj: object, msg?: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  debug(obj: object, msg?: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

export const createLogger = (serviceName: string) => {
  const isDevelopment = process.env.NODE_ENV !== 'production'

  // Ở local/development, chúng ta dùng pino-pretty để xuất log ra console đẹp mắt
  // Và BẮN TRỰC TIẾP lên Elasticsearch qua pino-elasticsearch (đã cài ở shared-kernel)

  // NOTE: Trong môi trường production thực tế, tốt nhất là ghi log ra console dạng JSON
  // và để FluentBit/Filebeat scrape log đẩy lên ES, không nên push trực tiếp từ App.
  // Tuy nhiên, ở Phase 0/Local, push trực tiếp là cách dễ nhất để monitor.

  const transport = isDevelopment
    ? pino.transport({
        targets: [
          {
            target: 'pino-pretty',
            options: { colorize: true },
          },
          {
            target: 'pino-elasticsearch',
            options: {
              index: 'dsp-logs',
              node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
              opType: 'create',
            },
          },
        ],
      })
    : pino.transport({
        target: 'pino/file',
        options: { destination: 1 }, // stdout
      })

  return pino(
    {
      name: serviceName,
      level: process.env.LOG_LEVEL || 'info',
      base: { serviceContext: serviceName },
      // Defense-in-depth secret masking: applied in-process BEFORE any transport
      // (pretty/Elasticsearch), so a secret can never reach the log sink even if
      // a full payload/body/headers object is logged anywhere.
      redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
    },
    transport,
  )
}
