import type { SDK, AuthDecision, Claims, PolicyResult } from './sdk.js'
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-node'

// Inline ExportResult to avoid a hard dep on @opentelemetry/core
const ExportResultCode = { SUCCESS: 0, FAILED: 1 } as const
type ExportResultCode = (typeof ExportResultCode)[keyof typeof ExportResultCode]
interface ExportResult { code: ExportResultCode; error?: Error }

export interface MockSDKOptions {
  defaultAllow?: boolean
  claims?: Partial<Claims>
}

export class MockSDK implements Pick<SDK, 'authorize' | 'evaluatePolicy'> {
  readonly authorizeCalls: Array<{ token: string; resource: string; action: string }> = []
  readonly policyEvalCalls: Array<{ rule: string; input: Record<string, unknown> }> = []

  private readonly defaultAllow: boolean
  private readonly defaultClaims: Claims

  constructor(opts: MockSDKOptions = {}) {
    this.defaultAllow = opts.defaultAllow ?? true
    this.defaultClaims = {
      sub: 'test-user',
      tenantId: 'test-tenant',
      roles: ['member'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...opts.claims,
    }
  }

  async authorize(token: string, resource: string, action: string): Promise<AuthDecision> {
    this.authorizeCalls.push({ token, resource, action })
    return { allowed: this.defaultAllow, claims: this.defaultClaims }
  }

  async evaluatePolicy(rule: string, input: Record<string, unknown>): Promise<PolicyResult> {
    this.policyEvalCalls.push({ rule, input })
    return { result: this.defaultAllow, allowed: this.defaultAllow, tenantId: this.defaultClaims.tenantId }
  }

  static fromEnv(): MockSDK { return new MockSDK() }
}

/** In-memory SpanExporter for use in tests */
export class FakeSpanExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = []

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.spans.push(...spans)
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }

  reset(): void {
    this.spans.length = 0
  }
}

/** Assert that no span attribute value contains PII patterns (alias with uppercase PII) */
export function assertNoPII(spans: Array<{ attributes: Record<string, unknown> }>): void {
  return assertNoPii(spans)
}

/** Assert that no span attribute value contains PII patterns */
export function assertNoPii(spans: Array<{ attributes: Record<string, unknown> }>): void {
  const patterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
  ]
  for (const span of spans) {
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value === 'string') {
        for (const pattern of patterns) {
          if (pattern.test(value)) {
            throw new Error(`PII found in span attribute "${key}": ${value}`)
          }
        }
      }
    }
  }
}
