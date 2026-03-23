import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { coreSDKMiddleware, requireAuth } from '../middleware/express.js'
import { coreSdkPlugin } from '../middleware/fastify.js'
import { MockSDK, assertNoPII, FakeSpanExporter } from '../testing.js'

// ---------------------------------------------------------------------------
// Minimal Express mock helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    path: '/api/test',
    method: 'GET',
    ...overrides,
  } as unknown as Request
}

function mockRes(): Response & { _status: number; _body: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code
      return res
    },
    json(body: unknown) {
      res._body = body
      return res
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value
      return res
    },
  }
  return res as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> }
}

// ---------------------------------------------------------------------------
// Express middleware tests
// ---------------------------------------------------------------------------

describe('coreSDKMiddleware', () => {
  let sdk: MockSDK
  const next = vi.fn() as unknown as NextFunction

  beforeEach(() => {
    sdk = new MockSDK()
    vi.clearAllMocks()
  })

  it('calls next() with a valid Bearer token', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } })
    const res = mockRes()
    const middleware = coreSDKMiddleware({ sdk: sdk as unknown as import('../sdk.js').SDK })
    await new Promise<void>((resolve) => {
      const wrappedNext: NextFunction = (...args) => {
        (next as ReturnType<typeof vi.fn>)(...args)
        resolve()
      }
      middleware(req, res, wrappedNext)
    })
    expect(next).toHaveBeenCalled()
    expect(res._status).toBe(200)
  })

  it('returns 401 RFC 9457 when Bearer token is missing', async () => {
    const req = mockReq({ headers: {} })
    const res = mockRes()
    const middleware = requireAuth(sdk as unknown as import('../sdk.js').SDK)
    await new Promise<void>((resolve) => {
      middleware(req, res, () => { resolve(); })
      // the handler returns immediately for missing token
      resolve()
    })
    expect(res._status).toBe(401)
    const body = res._body as Record<string, unknown>
    expect(body.type).toBe('https://coresdk.io/errors/unauthorized')
    expect(body.status).toBe(401)
    expect(typeof body.title).toBe('string')
  })

  it('returns 403 when SDK denies the request', async () => {
    sdk = new MockSDK({ defaultAllow: false })
    const req = mockReq({ headers: { authorization: 'Bearer some-token' } })
    const res = mockRes()
    const middleware = coreSDKMiddleware({ sdk: sdk as unknown as import('../sdk.js').SDK })
    await new Promise<void>((resolve) => {
      middleware(req, res, () => { resolve(); })
      setTimeout(resolve, 200)
    })
    expect(res._status).toBe(403)
    const body = res._body as Record<string, unknown>
    expect(body.type).toBe('https://coresdk.io/errors/forbidden')
  })
})

// ---------------------------------------------------------------------------
// assertNoPII catches email in span attributes
// ---------------------------------------------------------------------------

describe('assertNoPII', () => {
  it('passes when spans have no PII', () => {
    const spans = [
      { attributes: { 'http.method': 'GET', 'http.status_code': '200' } },
      { attributes: { 'coresdk.tenant_id': 'acme-corp' } },
    ]
    expect(() => { assertNoPII(spans); }).not.toThrow()
  })

  it('throws when a span attribute contains an email address', () => {
    const spans = [
      { attributes: { 'user.email': 'alice@example.com', 'http.method': 'POST' } },
    ]
    expect(() => { assertNoPII(spans); }).toThrow('PII found')
  })

  it('throws when a span attribute contains an SSN', () => {
    const spans = [{ attributes: { 'user.ssn': '123-45-6789' } }]
    expect(() => { assertNoPII(spans); }).toThrow('PII found')
  })

  it('throws when a span attribute contains a Bearer token', () => {
    const spans = [{ attributes: { 'http.request.header.authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.abc' } }]
    expect(() => { assertNoPII(spans); }).toThrow('PII found')
  })
})

// ---------------------------------------------------------------------------
// FakeSpanExporter
// ---------------------------------------------------------------------------

describe('FakeSpanExporter', () => {
  it('collects exported spans', () => {
    const exporter = new FakeSpanExporter()
    const fakeSpan = { attributes: { 'http.method': 'GET' } } as unknown as import('@opentelemetry/sdk-trace-node').ReadableSpan
    exporter.export([fakeSpan], // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_result) => { /* no-op result callback */ })
    expect(exporter.spans).toHaveLength(1)
  })

  it('reset clears spans', () => {
    const exporter = new FakeSpanExporter()
    const fakeSpan = { attributes: {} } as unknown as import('@opentelemetry/sdk-trace-node').ReadableSpan
    exporter.export([fakeSpan], // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_result) => { /* no-op result callback */ })
    exporter.reset()
    expect(exporter.spans).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fastify middleware tests (using Fastify's test helpers)
// ---------------------------------------------------------------------------

describe('coreSdkPlugin (Fastify)', () => {
  async function buildApp(sdk: MockSDK, required = true) {
    const { default: Fastify } = await import('fastify')
    const app = Fastify()
    // coreSdkPlugin is a Fastify plugin (encapsulated). Register the route
    // in the same plugin context by wrapping both in a single register call.
    const sdkRef = sdk as unknown as import('../sdk.js').SDK
    await app.register(coreSdkPlugin, { sdk: sdkRef, required })
    // Routes must be in the same context — use after() to ensure plugin is loaded
    // eslint-disable-next-line @typescript-eslint/require-await
    app.get('/api/test', async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it('allows request with valid Bearer token', async () => {
    const sdk = new MockSDK()
    const app = await buildApp(sdk)
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: 'Bearer valid-token' } })
    expect(res.statusCode).toBe(200)
    expect(sdk.authorizeCalls).toHaveLength(1)
    expect(sdk.authorizeCalls[0]?.token).toBe('valid-token')
  })

  it('returns 401 when token is missing', async () => {
    const sdk = new MockSDK()
    const app = await buildApp(sdk)
    const res = await app.inject({ method: 'GET', url: '/api/test' })
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.type).toBe('https://coresdk.io/errors/unauthorized')
  })

  it('returns 403 when SDK denies the request', async () => {
    const sdk = new MockSDK({ defaultAllow: false })
    const app = await buildApp(sdk)
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: 'Bearer some-token' } })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.type).toBe('https://coresdk.io/errors/forbidden')
  })

  it('passes through when not required and token is missing', async () => {
    const sdk = new MockSDK()
    const app = await buildApp(sdk, false)
    const res = await app.inject({ method: 'GET', url: '/api/test' })
    expect(res.statusCode).toBe(200)
    expect(sdk.authorizeCalls).toHaveLength(0)
  })
})
