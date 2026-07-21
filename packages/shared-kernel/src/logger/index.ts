import pino from 'pino'

export * from './log-context.js'

const SENSITIVE_LOG_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
] as const

/**
 * Secret field paths masked in-process before any transport, via pino's
 * built-in `redact` option. `*.x` matches EXACTLY one nesting level (e.g.
 * `input.password`) — a payload like `{ input: { user: { password } } }` (2+
 * levels deep) is NOT caught by this alone (fast-redact's wildcard has no
 * "any depth" syntax). This stays as a cheap first-pass safety net; the real
 * depth-agnostic defense is `deepRedact`/`redactLogMethodHook` below, which
 * `createLogger` wires in as a pino hook. Exported so it has a single source
 * of truth and can be asserted in tests.
 */
export const LOG_REDACT_PATHS = [
  ...SENSITIVE_LOG_KEYS,
  ...SENSITIVE_LOG_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
]

export const LOG_REDACT_CENSOR = '[REDACTED]'

const SENSITIVE_LOG_KEY_SET = new Set<string>(SENSITIVE_LOG_KEYS)

/**
 * Depth-agnostic secret masking — walks the ENTIRE object graph (any nesting
 * level, arrays included) and blanks any key in SENSITIVE_LOG_KEY_SET wherever
 * it appears, unlike LOG_REDACT_PATHS above which only matches a fixed depth.
 * Returns a NEW object graph (no in-place mutation) so the caller's original
 * object is untouched even after logging. `seen` guards against circular
 * references re-entering the same object.
 */
export function deepRedact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_LOG_KEY_SET.has(key) ? LOG_REDACT_CENSOR : deepRedact(val, seen)
  }
  return out
}

/**
 * pino `hooks.logMethod` — runs BEFORE fast-redact/serialization/transport,
 * deep-redacting the first log argument if it's an object. Exported (not
 * inlined in createLogger) so tests can build a pino instance with the exact
 * same behavior the real root logger gets, instead of re-deriving it.
 */
export const redactLogMethodHook: NonNullable<pino.LoggerOptions['hooks']>['logMethod'] = function (
  inputArgs,
  method,
) {
  if (typeof inputArgs[0] === 'object' && inputArgs[0] !== null) {
    inputArgs[0] = deepRedact(inputArgs[0]) as object
  }
  method.apply(this, inputArgs as Parameters<typeof method>)
}

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
      // a full payload/body/headers object is logged anywhere. `redact` is the
      // cheap fixed-depth pass; `hooks.logMethod` is the depth-agnostic pass
      // that actually catches secrets nested 2+ levels deep (see deepRedact).
      redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
      hooks: { logMethod: redactLogMethodHook },
    },
    transport,
  )
}
