import type { SDK, AuthDecision, AuthorizeOptions, Claims, PolicyResult, RateLimitDecision, FlagDecision, LicenseInfo, ExplainResult, AgentToken, EgressDecision } from './sdk.js'
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-node'

// Inline ExportResult to avoid a hard dep on @opentelemetry/core
const ExportResultCode = { SUCCESS: 0, FAILED: 1 } as const
type ExportResultCode = (typeof ExportResultCode)[keyof typeof ExportResultCode]
interface ExportResult { code: ExportResultCode; error?: Error }

export interface MockSDKOptions {
  defaultAllow?: boolean
  claims?: Partial<Claims>
}

export class MockSDK implements Pick<SDK, 'authorize' | 'evaluatePolicy' | 'isEnabled' | 'checkRateLimit' | 'emitAuditEvent' | 'evaluateFlag' | 'checkEntitlement' | 'revokeToken' | 'isRevoked' | 'explainAuthorize' | 'mintAgentToken' | 'checkEgress'> {
  readonly authorizeCalls: { token: string; resource: string; action: string; tenantId?: string; requiredScope?: string }[] = []
  readonly policyEvalCalls: { rule: string; input: Record<string, unknown> }[] = []
  readonly rateLimitCalls: { key: string }[] = []
  readonly auditCalls: { action: string; userId: string; outcome: string; metadata?: Record<string, string> }[] = []
  readonly flagCalls: { key: string; userId?: string }[] = []
  readonly entitlementCalls: { key: string }[] = []
  readonly revokeTokenCalls: { token: string }[] = []
  readonly isRevokedCalls: { token: string }[] = []

  private readonly defaultAllow: boolean
  private readonly defaultClaims: Claims
  private readonly revokedTokens = new Set<string>()

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

  authorize(token: string, options?: AuthorizeOptions): Promise<AuthDecision>
  authorize(token: string, action: string, resource: string, options?: AuthorizeOptions): Promise<AuthDecision>
  authorize(
    token: string,
    arg2?: string | AuthorizeOptions,
    arg3?: string,
    arg4?: AuthorizeOptions,
  ): Promise<AuthDecision> {
    let options: AuthorizeOptions
    if (typeof arg2 === 'string') {
      options = { ...(arg4 ?? {}) }
      options.action = arg2
      if (arg3 !== undefined) options.resource = arg3
    } else {
      options = { ...(arg2 ?? {}) }
    }
    const callEntry: { token: string; resource: string; action: string; tenantId?: string; requiredScope?: string } = {
      token,
      resource: options.resource ?? '',
      action: options.action ?? '',
    }
    if (options.tenantId !== undefined) callEntry.tenantId = options.tenantId
    if (options.requiredScope !== undefined) callEntry.requiredScope = options.requiredScope
    this.authorizeCalls.push(callEntry)
    return Promise.resolve({ allowed: this.defaultAllow, claims: this.defaultClaims })
  }

  evaluatePolicy(rule: string, input: Record<string, unknown>): Promise<PolicyResult> {
    this.policyEvalCalls.push({ rule, input })
    return Promise.resolve({ result: this.defaultAllow, allowed: this.defaultAllow, tenantId: this.defaultClaims.tenantId })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isEnabled(_flagKey: string): Promise<boolean> {
    return Promise.resolve(this.defaultAllow)
  }

  checkRateLimit(key: string): Promise<RateLimitDecision> {
    this.rateLimitCalls.push({ key })
    return Promise.resolve({ allowed: this.defaultAllow, remaining: 100, resetAt: Math.floor(Date.now() / 1000) + 60 })
  }

  emitAuditEvent(action: string, userId: string, outcome: string, metadata?: Record<string, string>): Promise<void> {
    const entry: { action: string; userId: string; outcome: string; metadata?: Record<string, string> } = { action, userId, outcome }
    if (metadata !== undefined) entry.metadata = metadata
    this.auditCalls.push(entry)
    return Promise.resolve()
  }

  evaluateFlag(key: string, userId?: string): Promise<FlagDecision> {
    const entry: { key: string; userId?: string } = { key }
    if (userId !== undefined) entry.userId = userId
    this.flagCalls.push(entry)
    return Promise.resolve({ enabled: this.defaultAllow, key })
  }

  checkEntitlement(key: string): Promise<LicenseInfo> {
    this.entitlementCalls.push({ key })
    return Promise.resolve({ allowed: this.defaultAllow, plan: 'enterprise', features: [key] })
  }

  revokeToken(token: string): Promise<void> {
    this.revokeTokenCalls.push({ token })
    this.revokedTokens.add(token)
    return Promise.resolve()
  }

  isRevoked(token: string): Promise<boolean> {
    this.isRevokedCalls.push({ token })
    return Promise.resolve(this.revokedTokens.has(token))
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  explainAuthorize(_token: string, _path?: string, _action?: string): Promise<ExplainResult> {
    return Promise.resolve({ requestId: 'mock', outcome: 'allowed', auth: {}, policy: {}, rateLimit: {}, masking: {}, latencyMs: 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mintAgentToken(_parentToken: string, targetService: string, _scopes: string[], _ttlSeconds?: number): Promise<AgentToken> {
    return Promise.resolve({ token: 'mock-agent-token', expiresInSeconds: 300, agentChain: [targetService] })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  checkEgress(_url: string): Promise<EgressDecision> {
    return Promise.resolve({ allowed: true, reason: '' })
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
export function assertNoPII(spans: { attributes: Record<string, unknown> }[]): void {
  assertNoPii(spans);
}

/** Assert that no span attribute value contains PII patterns */
export function assertNoPii(spans: { attributes: Record<string, unknown> }[]): void {
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
