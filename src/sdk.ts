
export interface SDKConfig {
  endpoint: string
  tenantId: string
  failMode: 'open' | 'closed'
  restEndpoint?: string
  tlsCertPath?: string
  tlsKeyPath?: string
  tlsCaPath?: string
}

export interface Claims {
  sub: string
  tenantId: string
  roles: string[]
  exp: number
  [key: string]: unknown
}

export interface AuthDecision {
  allowed: boolean
  claims: Claims
  reason?: string
}

export interface PolicyResult {
  result: unknown
  allowed: boolean
  tenantId: string
}

function configFromEnv(): SDKConfig {
  const endpoint = process.env.CORESDK_ENDPOINT ?? 'http://127.0.0.1:50051'
  const tenantId = process.env.CORESDK_TENANT_ID ?? ''
  const failMode = (process.env.CORESDK_FAIL_MODE ?? 'open') as 'open' | 'closed'
  return { endpoint, tenantId, failMode }
}

/**
 * Derive the REST endpoint from a gRPC endpoint string.
 * If the endpoint contains a port, replace just the port with 8080.
 * If the endpoint starts with grpc://, replace the scheme with http://.
 * Otherwise use as-is with a warning.
 */
function deriveRestEndpoint(endpoint: string): string {
  let base = endpoint
  if (base.startsWith('grpc://')) {
    base = 'http://' + base.slice('grpc://'.length)
  }
  // Replace port number in the URL (e.g. :50051 → :8080)
  const portMatch = base.match(/^(https?:\/\/[^:/?#]+):(\d+)(\/.*)?$/)
  if (portMatch) {
    const [, host, , path] = portMatch
    return `${host ?? ''}:8080${path ?? ''}`
  }
  // No port found — use as-is
  // eslint-disable-next-line no-console
  console.warn('[coresdk] Could not derive REST endpoint from gRPC endpoint, using as-is:', base)
  return base
}

export class SDK {
  private readonly config: SDKConfig

  constructor(config: SDKConfig) {
    this.config = config
  }

  static fromEnv(): SDK {
    return new SDK(configFromEnv())
  }

  async authorize(token: string, resource: string, action: string): Promise<AuthDecision> {
    try {
      // gRPC call to sidecar — lazy connect
      const response = await this._grpcCall('Authorize', {
        token,
        resource,
        action,
        tenant_id: this.config.tenantId,
      })
      return {
        allowed: response.allowed as boolean,
        claims: response.claims as Claims,
        reason: response.reason as string | undefined,
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // fail-open: allow but log
      // eslint-disable-next-line no-console
      console.warn('[coresdk] authorize fail-open:', err)
      return {
        allowed: true,
        claims: { sub: 'unknown', tenantId: this.config.tenantId, roles: [], exp: 0 },
        reason: 'fail-open',
      }
    }
  }

  async evaluatePolicy(rule: string, input: Record<string, unknown>): Promise<PolicyResult> {
    try {
      const response = await this._grpcCall('EvaluatePolicy', {
        rule,
        input_json: JSON.stringify(input),
        tenant_id: this.config.tenantId,
      })
      return {
        result: response.result,
        allowed: response.allowed as boolean,
        tenantId: this.config.tenantId,
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] evaluatePolicy fail-open:', err)
      return { result: null, allowed: true, tenantId: this.config.tenantId }
    }
  }

  private async _grpcCall(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Use HTTP/JSON transport to sidecar REST API
    const httpEndpoint = this.config.restEndpoint ?? deriveRestEndpoint(this.config.endpoint)

    const pathMap: Record<string, string> = {
      'Authorize': '/api/v1/auth/validate',
      'EvaluatePolicy': '/api/v1/policy/evaluate',
    }

    const path = pathMap[method]
    if (!path) {
      throw new Error(`coresdk: unknown method ${method}`)
    }

    const response = await fetch(`${httpEndpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, tenant_id: this.config.tenantId }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as Record<string, unknown>
      const title = typeof problem.title === 'string' ? problem.title : `HTTP ${String(response.status)}`
      throw Object.assign(new Error(title), problem)
    }

    return response.json() as Promise<Record<string, unknown>>
  }
}
