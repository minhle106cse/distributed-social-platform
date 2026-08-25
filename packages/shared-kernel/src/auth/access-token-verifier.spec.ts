import { generateKeyPairSync } from 'crypto'
import jwt from 'jsonwebtoken'
import { verifyAccessToken, InvalidAccessTokenError } from './access-token-verifier'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function signRs256(payload: object, expiresIn: jwt.SignOptions['expiresIn'] = '15m'): string {
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn })
}

const VALID_CLAIMS = {
  sub: 'user-1',
  email: 'a@b.c',
  roles: ['SUPER_ADMIN'],
  permissions: ['org:create'],
}

describe('verifyAccessToken', () => {
  it('returns the claims of a well-formed RS256 token', () => {
    expect(verifyAccessToken(signRs256(VALID_CLAIMS), publicKey)).toEqual(VALID_CLAIMS)
  })

  // The reason algorithms:['RS256'] is pinned. Without the pin, jsonwebtoken
  // honours the algorithm the TOKEN names — so an attacker re-signs with HS256
  // using the PUBLIC key (which they have, it is public) as the HMAC secret and
  // the signature verifies. This test fails loudly if the pin is ever removed.
  it('rejects an HS256 token forged with the public key as the HMAC secret (algorithm confusion)', () => {
    const forged = jwt.sign({ ...VALID_CLAIMS, permissions: ['org:create'] }, publicKey, {
      algorithm: 'HS256',
    })
    expect(() => verifyAccessToken(forged, publicKey)).toThrow(InvalidAccessTokenError)
  })

  it('rejects a token signed by a different key pair', () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const foreign = jwt.sign(VALID_CLAIMS, other.privateKey, { algorithm: 'RS256' })
    expect(() => verifyAccessToken(foreign, publicKey)).toThrow(InvalidAccessTokenError)
  })

  it('rejects an expired token', () => {
    expect(() => verifyAccessToken(signRs256(VALID_CLAIMS, -1), publicKey)).toThrow(
      InvalidAccessTokenError,
    )
  })

  it('rejects a validly-signed token with no subject', () => {
    const noSub = jwt.sign({ email: 'a@b.c' }, privateKey, { algorithm: 'RS256' })
    expect(() => verifyAccessToken(noSub, publicKey)).toThrow(InvalidAccessTokenError)
  })

  // The three guards used to blind-cast the payload, so these claims surfaced as
  // `undefined` inside a permission check instead of as normalised empty arrays.
  it('normalises missing roles/permissions claims to empty arrays', () => {
    const claims = verifyAccessToken(signRs256({ sub: 'user-1', email: 'a@b.c' }), publicKey)
    expect(claims.roles).toEqual([])
    expect(claims.permissions).toEqual([])
  })

  it('drops non-string entries from roles/permissions rather than passing them through', () => {
    const messy = signRs256({ ...VALID_CLAIMS, permissions: ['org:create', 42, null] })
    expect(verifyAccessToken(messy, publicKey).permissions).toEqual(['org:create'])
  })

  it('normalises a non-array permissions claim to an empty array', () => {
    const messy = signRs256({ ...VALID_CLAIMS, permissions: 'org:create' })
    expect(verifyAccessToken(messy, publicKey).permissions).toEqual([])
  })
})
