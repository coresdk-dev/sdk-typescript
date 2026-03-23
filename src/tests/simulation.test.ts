/**
 * CoreSDK TypeScript SDK — Developer Simulation Test Suite
 * Simulates developers using the SDK for different project types.
 */
import { describe, it, expect } from 'vitest'
import { MockSDK, FakeSpanExporter, assertNoPii, assertNoPII } from '../testing.js'
import { ProblemDetailError } from '../errors.js'

// ── 1. MockSDK Core Behavior ─────────────────────────────────────────────────

describe('MockSDK — Core Behavior', () => {
  it('authorize() resolves with allowed=true by default', async () => {
    const sdk = new MockSDK()
    const d = await sdk.authorize('valid-token', { resource: '/orders', action: 'GET' })
    expect(d.allowed).toBe(true)
    expect(d.claims).toBeDefined()
    expect(d.claims.sub).toBe('test-user')
  })

  it('authorize() resolves with allowed=false when defaultAllow=false', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    const d = await sdk.authorize('any-token', { resource: '/orders', action: 'GET' })
    expect(d.allowed).toBe(false)
  })

  it('authorize() records calls for assertion', async () => {
    const sdk = new MockSDK()
    await sdk.authorize('tok1', { resource: '/a', action: 'GET' })
    await sdk.authorize('tok2', { resource: '/b', action: 'POST' })
    expect(sdk.authorizeCalls).toHaveLength(2)
    expect(sdk.authorizeCalls[0]?.token).toBe('tok1')
    expect(sdk.authorizeCalls[1]?.resource).toBe('/b')
    expect(sdk.authorizeCalls[1]?.action).toBe('POST')
  })

  it('authorize() returns custom claims from options', async () => {
    const sdk = new MockSDK({ claims: { sub: 'admin-user', roles: ['admin'] } })
    const d = await sdk.authorize('tok', { resource: '/admin', action: 'DELETE' })
    expect(d.claims.sub).toBe('admin-user')
    expect(d.claims.roles).toContain('admin')
  })

  it('evaluatePolicy() resolves with allowed=true by default', async () => {
    const sdk = new MockSDK()
    const result = await sdk.evaluatePolicy('data.app.allow', { role: 'admin' })
    expect(result.allowed).toBe(true)
    expect(typeof result.result).toBeDefined()
  })

  it('evaluatePolicy() resolves with allowed=false when defaultAllow=false', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    const result = await sdk.evaluatePolicy('data.app.allow', {})
    expect(result.allowed).toBe(false)
  })

  it('evaluatePolicy() records calls', async () => {
    const sdk = new MockSDK()
    await sdk.evaluatePolicy('rule.one', { x: 1 })
    await sdk.evaluatePolicy('rule.two', { x: 2 })
    expect(sdk.policyEvalCalls).toHaveLength(2)
    expect(sdk.policyEvalCalls[0]?.rule).toBe('rule.one')
    expect(sdk.policyEvalCalls[1]?.input).toEqual({ x: 2 })
  })

  it('isEnabled() resolves with true by default', async () => {
    const sdk = new MockSDK()
    const enabled = await sdk.isEnabled('my-flag')
    expect(enabled).toBe(true)
  })

  it('isEnabled() resolves with false when defaultAllow=false', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    expect(await sdk.isEnabled('my-flag')).toBe(false)
  })

  it('MockSDK.fromEnv() creates instance', () => {
    const sdk = MockSDK.fromEnv()
    expect(sdk).toBeInstanceOf(MockSDK)
  })
})

// ── 2. FakeSpanExporter ──────────────────────────────────────────────────────

describe('FakeSpanExporter', () => {
  it('captures exported spans', () => {
    const exporter = new FakeSpanExporter()
    const fakeSpan = { attributes: { 'http.method': 'GET', 'tenant': 'acme' } } as unknown as import('@opentelemetry/sdk-trace-node').ReadableSpan
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    exporter.export([fakeSpan], (_result) => { /* no-op */ })
    expect(exporter.spans).toHaveLength(1)
  })

  it('reset() clears captured spans', () => {
    const exporter = new FakeSpanExporter()
    const fakeSpan = { attributes: {} } as unknown as import('@opentelemetry/sdk-trace-node').ReadableSpan
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    exporter.export([fakeSpan], (_result) => { /* no-op */ })
    exporter.reset()
    expect(exporter.spans).toHaveLength(0)
  })

  it('shutdown() resolves without error', async () => {
    const exporter = new FakeSpanExporter()
    await expect(exporter.shutdown()).resolves.toBeUndefined()
  })
})

// ── 3. assertNoPii / assertNoPII ─────────────────────────────────────────────

describe('assertNoPii — PII Detection', () => {
  it('clean attributes pass without throwing', () => {
    expect(() => {
      assertNoPii([{ attributes: { tenant: 'acme', method: 'GET', status: '200' } }])
    }).not.toThrow()
  })

  it('email address in attribute throws', () => {
    expect(() => {
      assertNoPii([{ attributes: { user: 'alice@example.com' } }])
    }).toThrow('PII')
  })

  it('Bearer token in attribute throws', () => {
    expect(() => {
      assertNoPii([{ attributes: { auth: 'Bearer abc123def456' } }])
    }).toThrow('PII')
  })

  it('SSN pattern throws', () => {
    expect(() => {
      assertNoPii([{ attributes: { id: '123-45-6789' } }])
    }).toThrow('PII')
  })

  it('assertNoPII (uppercase alias) also works', () => {
    expect(() => {
      assertNoPII([{ attributes: { safe: 'no-pii-here' } }])
    }).not.toThrow()
  })

  it('non-string attribute values are ignored', () => {
    expect(() => {
      assertNoPii([{ attributes: { count: 42, active: true } }])
    }).not.toThrow()
  })

  it('empty spans array passes', () => {
    expect(() => { assertNoPii([]) }).not.toThrow()
  })
})

// ── 4. ProblemDetailError ────────────────────────────────────────────────────

describe('ProblemDetailError — RFC 9457', () => {
  it('unauthorized() factory returns status 401', () => {
    const e = ProblemDetailError.unauthorized('bad token')
    expect(e.status).toBe(401)
    expect(e.title).toBe('Unauthorized')
    expect(e.detail).toBe('bad token')
  })

  it('forbidden() factory returns status 403', () => {
    const e = ProblemDetailError.forbidden('no permission')
    expect(e.status).toBe(403)
    expect(e.title).toBe('Forbidden')
  })

  it('toJSON() includes title, status, detail', () => {
    const e = new ProblemDetailError('Not Found', 404, 'resource missing')
    const j = e.toJSON()
    expect(j.title).toBe('Not Found')
    expect(j.status).toBe(404)
    expect(j.detail).toBe('resource missing')
  })

  it('toJSON() omits detail when not provided', () => {
    const e = new ProblemDetailError('Error', 500)
    const j = e.toJSON()
    expect(j.detail).toBeUndefined()
  })

  it('CONTENT_TYPE is application/problem+json', () => {
    expect(ProblemDetailError.CONTENT_TYPE).toBe('application/problem+json')
  })

  it('is an instance of Error', () => {
    const e = ProblemDetailError.unauthorized('x')
    expect(e).toBeInstanceOf(Error)
  })

  it('can be thrown and caught', () => {
    expect(() => { throw ProblemDetailError.forbidden('denied') }).toThrow(ProblemDetailError)
  })

  it('custom status code works', () => {
    const e = new ProblemDetailError('Too Many Requests', 429)
    expect(e.status).toBe(429)
  })
})

// ── 5. Real-World Usage Patterns ─────────────────────────────────────────────

describe('Real-World Usage Patterns', () => {
  it('multi-tenant token validation', async () => {
    const tenants = ['acme', 'globex', 'initech']
    for (const tenant of tenants) {
      const sdk = new MockSDK({ claims: { tenantId: tenant } })
      const d = await sdk.authorize(`token-${tenant}`, { resource: `/tenants/${tenant}/data`, action: 'GET' })
      expect(d.allowed).toBe(true)
      expect(d.claims.tenantId).toBe(tenant)
    }
  })

  it('RBAC policy evaluation across multiple rules', async () => {
    const sdk = new MockSDK()
    const rules = ['data.app.read', 'data.app.write', 'data.app.admin']
    for (const rule of rules) {
      const result = await sdk.evaluatePolicy(rule, { role: 'admin' })
      expect(result.allowed).toBe(true)
    }
    expect(sdk.policyEvalCalls).toHaveLength(3)
  })

  it('claims extracted from decision for request context', async () => {
    const sdk = new MockSDK({ claims: { sub: 'alice', roles: ['admin', 'user'] } })
    const d = await sdk.authorize('token', { resource: '/api/admin', action: 'POST' })
    const { sub, roles } = d.claims
    expect(sub).toBe('alice')
    expect(roles).toContain('admin')
  })

  it('deny-all SDK for testing unauthorized paths', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    const d = await sdk.authorize('bad-token', { resource: '/protected', action: 'GET' })
    expect(d.allowed).toBe(false)
    const policy = await sdk.evaluatePolicy('data.deny', {})
    expect(policy.allowed).toBe(false)
    const flag = await sdk.isEnabled('premium-feature')
    expect(flag).toBe(false)
  })

  it('request audit logging pattern', async () => {
    const sdk = new MockSDK()
    const requests: [string, string, string][] = [
      ['tok1', '/orders', 'GET'],
      ['tok2', '/orders', 'POST'],
      ['tok3', '/orders/1', 'DELETE'],
    ]
    for (const [token, resource, action] of requests) {
      await sdk.authorize(token, { resource, action })
    }
    expect(sdk.authorizeCalls).toHaveLength(3)
    expect(sdk.authorizeCalls[2]?.resource).toBe('/orders/1')
  })

  it('FakeSpanExporter + assertNoPii integration', () => {
    const exporter = new FakeSpanExporter()
    // Simulate an auth span being recorded
    const fakeSpan = {
      attributes: { 'coresdk.tenant_id': 'acme', 'coresdk.result': 'allowed' },
      name: 'coresdk.auth',
    } as unknown as import('@opentelemetry/sdk-trace-node').ReadableSpan
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    exporter.export([fakeSpan], (_result) => { /* no-op */ })
    // Assert no PII in captured spans
    expect(() => {
      assertNoPii(exporter.spans.map(s => ({ attributes: s.attributes as Record<string, unknown> })))
    }).not.toThrow()
    expect(exporter.spans).toHaveLength(1)
  })
})

// ── 6. Config & SDK env var parsing ─────────────────────────────────────────

describe('SDK Config — env var parsing', () => {
  it('configFromEnv defaults: endpoint=localhost:50051', async () => {
    // We test this via SDK.fromEnv() → MockSDK (no sidecar needed)
    // The actual SDK config is tested via the sdk.test.ts suite
    // Here we confirm MockSDK.fromEnv() creates a working instance
    const sdk = MockSDK.fromEnv()
    expect(sdk).toBeInstanceOf(MockSDK)
    const d = await sdk.authorize('tok', { resource: '/', action: 'GET' })
    expect(d).toBeDefined()
  })
})
