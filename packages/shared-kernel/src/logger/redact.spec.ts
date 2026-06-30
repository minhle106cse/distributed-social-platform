import pino from 'pino'
import { LOG_REDACT_PATHS, LOG_REDACT_CENSOR } from './index.js'

describe('log redaction (root logger secret masking)', () => {
  // Build a pino logger with the SAME redact config the real root logger uses,
  // writing to an in-memory sink so we can assert the serialized output.
  function capture() {
    const chunks: string[] = []
    const sink = { write: (s: string) => chunks.push(s) }
    const logger = pino(
      { redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR } },
      sink as unknown as pino.DestinationStream,
    )
    return { logger, lines: () => chunks.map((c) => JSON.parse(c) as Record<string, any>) }
  }

  it('masks nested secrets in a command payload but keeps non-secret fields', () => {
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
    expect(line.input.email).toBe('a@b.com')
    expect(line.input.name).toBe('LoginCommand')
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
})
