import pino from 'pino'
import { LOG_REDACT_PATHS, LOG_REDACT_CENSOR, redactLogMethodHook } from './index.js'

describe('log redaction (root logger secret masking)', () => {
  // Build a pino logger with the SAME redact config (paths + hook) the real
  // root logger uses, writing to an in-memory sink so we can assert the
  // serialized output.
  function capture() {
    const chunks: string[] = []
    const sink = { write: (s: string) => chunks.push(s) }
    const logger = pino(
      {
        redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
        hooks: { logMethod: redactLogMethodHook },
      },
      sink as unknown as pino.DestinationStream,
    )
    return { logger, lines: () => chunks.map((c) => JSON.parse(c) as Record<string, any>) }
  }

  it('masks nested secrets AND PII (email) in a command payload but keeps non-sensitive fields', () => {
    const { logger, lines } = capture()

    logger.info(
      {
        context: 'CommandBus',
        input: { name: 'LoginCommand', email: 'a@b.com', password: 'hunter2' },
      },
      'Input for LoginCommand',
    )

    const [line] = lines()
    expect(line.input.password).toBe('[REDACTED]')
    // PII policy (2026-07-22): email is masked like a secret, not kept visible.
    expect(line.input.email).toBe('[REDACTED]')
    expect(line.input.name).toBe('LoginCommand')
  })

  it('masks PII keys email + username at any depth', () => {
    const { logger, lines } = capture()

    logger.info({ input: { profile: { username: 'jdoe', email: 'a@b.com', bio: 'hi' } } }, 'x')

    const [line] = lines()
    expect(line.input.profile.username).toBe('[REDACTED]')
    expect(line.input.profile.email).toBe('[REDACTED]')
    expect(line.input.profile.bio).toBe('hi')
  })

  it('masks refreshToken (nested) and token (top level)', () => {
    const { logger, lines } = capture()

    logger.info({ input: { refreshToken: 'rt_secret' }, token: 'jwt_abc' }, 'x')

    const [line] = lines()
    expect(line.input.refreshToken).toBe('[REDACTED]')
    expect(line.token).toBe('[REDACTED]')
  })

  it('masks request auth headers', () => {
    const { logger, lines } = capture()

    logger.info({ req: { headers: { authorization: 'Bearer xyz', 'user-agent': 'jest' } } }, 'x')

    const [line] = lines()
    expect(line.req.headers.authorization).toBe('[REDACTED]')
    expect(line.req.headers['user-agent']).toBe('jest')
  })

  // Gap found in audit (2026-07-19): LOG_REDACT_PATHS' `*.x` wildcard only
  // matches ONE nesting level — `input.password` is caught, but
  // `input.user.password` (2 levels) or deeper sails straight through
  // fast-redact untouched. deepRedact/redactLogMethodHook is the fix; these
  // tests would have failed before that hook was wired in.
  it('masks a secret nested 2 levels deep (input.user.password) — the gap the wildcard-only redact missed', () => {
    const { logger, lines } = capture()

    logger.info({ input: { user: { password: 'hunter2', email: 'a@b.com' } } }, 'x')

    const [line] = lines()
    expect(line.input.user.password).toBe('[REDACTED]')
    expect(line.input.user.email).toBe('[REDACTED]')
  })

  it('masks a secret nested 3+ levels deep, arbitrary depth', () => {
    const { logger, lines } = capture()

    logger.info({ a: { b: { c: { d: { refreshToken: 'rt_secret', keep: 'me' } } } } }, 'x')

    const [line] = lines()
    expect(line.a.b.c.d.refreshToken).toBe('[REDACTED]')
    expect(line.a.b.c.d.keep).toBe('me')
  })

  it('masks secrets nested inside arrays of objects', () => {
    const { logger, lines } = capture()

    logger.info(
      {
        users: [
          { email: 'a@b.com', password: 'p1' },
          { email: 'c@d.com', password: 'p2' },
        ],
      },
      'x',
    )

    const [line] = lines()
    expect(line.users[0].password).toBe('[REDACTED]')
    expect(line.users[1].password).toBe('[REDACTED]')
    expect(line.users[0].email).toBe('[REDACTED]')
  })

  it('không mutate object gốc của caller — deepRedact trả object MỚI, không sửa in-place', () => {
    const { logger } = capture()
    const original = { input: { user: { password: 'hunter2' } } }

    logger.info(original, 'x')

    expect(original.input.user.password).toBe('hunter2')
  })
})
