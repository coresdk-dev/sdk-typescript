import { describe, it, expect } from 'vitest'
import { MockSDK, assertNoPii } from '../testing.js'
import { SDK } from '../sdk.js'
import { isBlockedField, maskValue } from '../masking/processor.js'
import { unauthorizedError, forbiddenError, CoreSDKError } from '../errors.js'

describe('MockSDK', () => {
  it('allows by default', async () => {
    const sdk = new MockSDK()
    const result = await sdk.authorize('token', '/api/users', 'GET')
    expect(result.allowed).toBe(true)
  })

  it('can be configured to deny', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    const result = await sdk.authorize('token', '/api/admin', 'DELETE')
    expect(result.allowed).toBe(false)
  })

  it('tracks authorize calls', async () => {
    const sdk = new MockSDK()
    await sdk.authorize('tok123', '/api/users', 'GET')
    expect(sdk.authorizeCalls).toHaveLength(1)
    expect(sdk.authorizeCalls[0]?.token).toBe('tok123')
  })

  it('returns correct claims', async () => {
    const sdk = new MockSDK({ claims: { sub: 'user-42', tenantId: 'acme' } })
    const result = await sdk.authorize('tok', '/api', 'GET')
    expect(result.claims.sub).toBe('user-42')
    expect(result.claims.tenantId).toBe('acme')
  })
})

describe('PII masking', () => {
  it('blocks sensitive field names', () => {
    expect(isBlockedField('password')).toBe(true)
    expect(isBlockedField('Authorization')).toBe(true)
    expect(isBlockedField('username')).toBe(false)
  })

  it('redacts email addresses', () => {
    const result = maskValue('user is user@example.com ok')
    expect(result).not.toContain('@example.com')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens', () => {
    const result = maskValue('Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.abc')
    expect(result).toContain('[REDACTED]')
  })

  it('assertNoPii passes clean spans', () => {
    expect(() => assertNoPii([{ attributes: { 'http.method': 'GET', 'http.status_code': '200' } }])).not.toThrow()
  })

  it('assertNoPii throws on email in span', () => {
    expect(() =>
      assertNoPii([{ attributes: { 'user.email': 'alice@example.com' } }]),
    ).toThrow('PII found')
  })
})

describe('SDK fail modes', () => {
  it('fromEnv creates SDK with defaults', () => {
    const sdk = SDK.fromEnv()
    expect(sdk).toBeDefined()
  })
})

describe('PIIMaskingSpanProcessor', () => {
  it('masks phone numbers', () => {
    expect(maskValue('call 555-867-5309 now')).toBe('call [REDACTED] now')
  })

  it('passes clean values unchanged', () => {
    expect(maskValue('GET /api/users')).toBe('GET /api/users')
  })

  it('isBlockedField case-insensitive', () => {
    expect(isBlockedField('Password')).toBe(true)
    expect(isBlockedField('AUTHORIZATION')).toBe(true)
  })
})

describe('Error helpers', () => {
  it('unauthorizedError has status 401', () => {
    const err = unauthorizedError('missing token')
    expect(err).toBeInstanceOf(CoreSDKError)
    expect(err.status).toBe(401)
    expect(err.problem.type).toContain('unauthorized')
  })

  it('forbiddenError has status 403', () => {
    const err = forbiddenError()
    expect(err.status).toBe(403)
  })
})
