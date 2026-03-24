import { CoreSDKError } from './errors.js'

declare const EdgeRuntime: string | undefined

export const isEdgeRuntime = typeof EdgeRuntime !== 'undefined'

export interface SDKConfig {
  endpoint: string
  tenantId: string
  serviceName: string
  serviceToken?: string
  failMode: 'open' | 'closed'
  controlPlaneUrl?: string
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

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface FlagDecision {
  enabled: boolean
  key: string
}

export interface LicenseInfo {
  allowed: boolean
  plan: string
  features: string[]
}

export type ExplainResult = {
  requestId: string;
  outcome: 'allowed' | 'denied';
  auth: Record<string, unknown>;
  policy: Record<string, unknown>;
  rateLimit: Record<string, unknown>;
  masking: Record<string, unknown>;
  latencyMs: number;
};

export type AgentToken = {
  token: string;
  expiresInSeconds: number;
  agentChain: string[];
};

export type EgressDecision = {
  allowed: boolean;
  reason: string;
};

function configFromEnv(): SDKConfig {
  // CORESDK_SIDECAR_ADDR is the canonical env var (matches Python, Go, Rust sidecar).
  // CORESDK_ENDPOINT is accepted as a deprecated alias for backwards compatibility.
  const endpoint =
    process.env.CORESDK_SIDECAR_ADDR ??
    process.env.CORESDK_ENDPOINT ??
    'localhost:50051'
  const tenantId = process.env.CORESDK_TENANT_ID ?? ''
  const serviceName = process.env.CORESDK_SERVICE_NAME ?? 'unknown-service'
  const failMode = (process.env.CORESDK_FAIL_MODE ?? 'open') as 'open' | 'closed'
  const config: SDKConfig = { endpoint, tenantId, serviceName, failMode }
  if (process.env.CORESDK_SERVICE_TOKEN) config.serviceToken = process.env.CORESDK_SERVICE_TOKEN
  if (process.env.CORESDK_CONTROL_PLANE_URL) config.controlPlaneUrl = process.env.CORESDK_CONTROL_PLANE_URL
  if (process.env.CORESDK_TLS_CERT_FILE) config.tlsCertPath = process.env.CORESDK_TLS_CERT_FILE
  if (process.env.CORESDK_TLS_KEY_FILE) config.tlsKeyPath = process.env.CORESDK_TLS_KEY_FILE
  if (process.env.CORESDK_TLS_CA_FILE) config.tlsCaPath = process.env.CORESDK_TLS_CA_FILE
  return config
}

// ---------------------------------------------------------------------------
// Minimal protobuf wire encoding/decoding (no protoc dependency)
// ---------------------------------------------------------------------------

function encodeVarint(n: number): Buffer {
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n & 0x7f)
  return Buffer.from(bytes)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function encodeVarintField(fieldNum: number, value: number): Buffer {
  if (!value) return Buffer.alloc(0)
  const tag = encodeVarint((fieldNum << 3) | 0)
  const val = encodeVarint(value)
  return Buffer.concat([tag, val])
}

function encodeString(fieldNum: number, value: string): Buffer {
  if (!value) return Buffer.alloc(0)
  const encoded = Buffer.from(value, 'utf-8')
  const tag = encodeVarint((fieldNum << 3) | 2)
  const len = encodeVarint(encoded.length)
  return Buffer.concat([tag, len, encoded])
}

type DecodedFields = Record<number, (Buffer | number)[]>

function readVarint(data: Buffer, pos: number): [number, number] {
  let result = 0
  let shift = 0
  while (pos < data.length) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const b = data[pos++]!
    result |= (b & 0x7f) << shift
    if (!(b & 0x80)) break
    shift += 7
  }
  return [result, pos]
}

function decodeFields(data: Buffer): DecodedFields {
  const fields: DecodedFields = {}
  let i = 0
  while (i < data.length) {
    const [tag, nextI] = readVarint(data, i)
    i = nextI
    const fieldNum = tag >>> 3
    const wireType = tag & 0x7
    if (wireType === 0) {
      const [val, nextI2] = readVarint(data, i)
      i = nextI2
      ;(fields[fieldNum] ??= []).push(val)
    } else if (wireType === 2) {
      const [len, nextI2] = readVarint(data, i)
      i = nextI2
      ;(fields[fieldNum] ??= []).push(data.subarray(i, i + len))
      i += len
    } else if (wireType === 5) {
      i += 4
    } else if (wireType === 1) {
      i += 8
    } else {
      break
    }
  }
  return fields
}

function fieldStr(fields: DecodedFields, num: number): string {
  const val = fields[num]?.[0]
  if (val instanceof Buffer) return val.toString('utf-8')
  return ''
}

function fieldBool(fields: DecodedFields, num: number): boolean {
  const val = fields[num]?.[0]
  return typeof val === 'number' ? val !== 0 : false
}

function fieldUint(fields: DecodedFields, num: number): number {
  const val = fields[num]?.[0]
  return typeof val === 'number' ? val : 0
}

function fieldStrArray(fields: DecodedFields, num: number): string[] {
  return (fields[num] ?? []).map(v =>
    v instanceof Buffer ? v.toString('utf-8') : String(v),
  )
}

// gRPC frame: 1 byte compress flag + 4 byte big-endian length + payload
function grpcFrame(payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length)
  frame[0] = 0 // uncompressed
  frame.writeUInt32BE(payload.length, 1)
  payload.copy(frame, 5)
  return frame
}

function stripGrpcFrame(data: Buffer): Buffer {
  if (data.length < 5) return data
  return data.subarray(5)
}

// ---------------------------------------------------------------------------
// gRPC-over-HTTP/2 transport
// ---------------------------------------------------------------------------

function grpcCall(
  authority: string,
  path: string,
  payload: Buffer,
  config?: SDKConfig,
  timeoutMs = 5000,
): Promise<Buffer> {
  if (isEdgeRuntime) {
    throw new CoreSDKError({
      type: 'https://coresdk.io/errors/edge-runtime',
      title: 'Edge Runtime: gRPC transport unavailable',
      status: 500,
      detail: 'Edge Runtime does not support node:http2. Use the control plane REST API or call isEnabled() for flag checks.',
    })
  }

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const http2 = require('node:http2') as typeof import('node:http2')

    const url = authority.startsWith('http')
      ? authority
      : `http://${authority}`

    let tlsOptions: Record<string, unknown> | undefined
    if (config?.tlsCertPath && config.tlsKeyPath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs')
      tlsOptions = {
        cert: fs.readFileSync(config.tlsCertPath),
        key: fs.readFileSync(config.tlsKeyPath),
        ...(config.tlsCaPath ? { ca: fs.readFileSync(config.tlsCaPath) } : {}),
      }
    }

    const session = tlsOptions
      ? http2.connect(url.replace(/^http:/, 'https:'), tlsOptions)
      : http2.connect(url)
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; session.close(); reject(new Error(`gRPC timeout after ${String(timeoutMs)}ms`)) }
    }, timeoutMs)

    session.on('error', (err: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err) }
    })

    const headers: Record<string, string> = {
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/grpc',
      'te': 'trailers',
    }
    if (config?.serviceName) headers['x-service-name'] = config.serviceName
    if (config?.serviceToken) headers['x-service-token'] = config.serviceToken

    const req = session.request(headers)

    const chunks: Buffer[] = []
    let responseHeaders: Record<string, string> = {}
    let trailers: Record<string, string> = {}

    req.on('response', (hdrs) => { responseHeaders = hdrs as Record<string, string> })
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('trailers', (hdrs) => { trailers = hdrs as Record<string, string> })
    req.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      session.close()

      // gRPC status may be in response headers (sidecar) or trailers (standard)
      const grpcStatus = trailers['grpc-status'] ?? responseHeaders['grpc-status'] ?? '0'
      if (grpcStatus !== '0') {
        const msg = trailers['grpc-message'] ?? responseHeaders['grpc-message'] ?? `gRPC status ${grpcStatus}`
        reject(new Error(msg))
        return
      }

      resolve(stripGrpcFrame(Buffer.concat(chunks)))
    })
    req.on('error', (err: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); session.close(); reject(err) }
    })

    req.write(grpcFrame(payload))
    req.end()
  })
}

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------

export class SDK {
  private readonly config: SDKConfig

  constructor(config: SDKConfig) {
    this.config = config
  }

  static fromEnv(): SDK {
    return new SDK(configFromEnv())
  }

  async authorize(token: string, options?: { action?: string; resource?: string; tenantId?: string }): Promise<AuthDecision> {
    const resource = options?.resource ?? ''
    try {
      // ValidateTokenRequest: token(1), tenant(3 embedded), expectedAudience(4)
      // For simplicity, encode tenant_id as a string field and resource/action inline
      const payload = Buffer.concat([
        encodeString(1, token),
        encodeString(4, resource),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.AuthService/ValidateToken',
        payload,
        this.config,
      )

      // ValidateTokenResponse: valid(1 bool), subject(2), roles(3 repeated), claims(4 map), expiresAt(5)
      const fields = decodeFields(responseBytes)
      const valid = fieldBool(fields, 1)
      const subject = fieldStr(fields, 2)
      const roles = fieldStrArray(fields, 3)
      const expiresAt = fieldUint(fields, 5)

      return {
        allowed: valid,
        claims: {
          sub: subject,
          tenantId: this.config.tenantId,
          roles,
          exp: expiresAt,
        },
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
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
      // PolicyEvaluateRequest: rule(1), inputJson(2), tenantId(3)
      const payload = Buffer.concat([
        encodeString(1, rule),
        encodeString(2, JSON.stringify(input)),
        encodeString(3, this.config.tenantId),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.PolicyService/Evaluate',
        payload,
        this.config,
      )

      // PolicyEvaluateResponse: result(1 bool), reason(2), dryRun(3 bool)
      const fields = decodeFields(responseBytes)
      const result = fieldBool(fields, 1)

      return {
        result,
        allowed: result,
        tenantId: this.config.tenantId,
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] evaluatePolicy fail-open:', err)
      return { result: null, allowed: true, tenantId: this.config.tenantId }
    }
  }

  async isEnabled(flagKey: string): Promise<boolean> {
    const result = await this.evaluateFlag(flagKey)
    return result.enabled
  }

  async checkRateLimit(key: string): Promise<RateLimitDecision> {
    try {
      // RateLimitCheckRequest: key(1), tenant_id(2)
      const payload = Buffer.concat([
        encodeString(1, key),
        encodeString(2, this.config.tenantId),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.RateLimitService/Check',
        payload,
        this.config,
      )

      // RateLimitCheckResponse: allowed(1 bool), remaining(2 uint), reset_at(3 uint)
      const fields = decodeFields(responseBytes)
      return {
        allowed: fieldBool(fields, 1),
        remaining: fieldUint(fields, 2),
        resetAt: fieldUint(fields, 3),
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] checkRateLimit fail-open:', err)
      return { allowed: true, remaining: -1, resetAt: 0 }
    }
  }

  async emitAuditEvent(
    action: string,
    userId: string,
    outcome: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    try {
      // AuditEmitRequest: action(1), user_id(2), outcome(3), tenant_id(4), metadata_json(5)
      const parts = [
        encodeString(1, action),
        encodeString(2, userId),
        encodeString(3, outcome),
        encodeString(4, this.config.tenantId),
      ]
      if (metadata) {
        parts.push(encodeString(5, JSON.stringify(metadata)))
      }
      const payload = Buffer.concat(parts)

      await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.AuditService/Emit',
        payload,
        this.config,
      )
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] emitAuditEvent fail-open:', err)
    }
  }

  async evaluateFlag(key: string, userId?: string): Promise<FlagDecision> {
    try {
      // FlagEvaluateRequest: key(1), user_id(2), tenant_id(3)
      const parts = [
        encodeString(1, key),
        encodeString(3, this.config.tenantId),
      ]
      if (userId) {
        parts.push(encodeString(2, userId))
      }
      const payload = Buffer.concat(parts)

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.FlagService/Evaluate',
        payload,
        this.config,
      )

      // FlagEvaluateResponse: enabled(1 bool), key(2)
      const fields = decodeFields(responseBytes)
      return {
        enabled: fieldBool(fields, 1),
        key: fieldStr(fields, 2) || key,
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] evaluateFlag fail-open:', err)
      return { enabled: true, key }
    }
  }

  async checkEntitlement(key: string): Promise<LicenseInfo> {
    try {
      // LicenseCheckRequest: key(1), tenant_id(2)
      const payload = Buffer.concat([
        encodeString(1, key),
        encodeString(2, this.config.tenantId),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.LicenseService/CheckEntitlement',
        payload,
        this.config,
      )

      // LicenseCheckResponse: allowed(1 bool), plan(2), features(3 repeated)
      const fields = decodeFields(responseBytes)
      return {
        allowed: fieldBool(fields, 1),
        plan: fieldStr(fields, 2),
        features: fieldStrArray(fields, 3),
      }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] checkEntitlement fail-open:', err)
      return { allowed: true, plan: 'unknown', features: [] }
    }
  }

  async revokeToken(token: string): Promise<void> {
    try {
      // RevokeTokenRequest: token(1), tenant_id(2)
      const payload = Buffer.concat([
        encodeString(1, token),
        encodeString(2, this.config.tenantId),
      ])

      await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.AuthService/RevokeToken',
        payload,
        this.config,
      )
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] revokeToken fail-open:', err)
    }
  }

  async isRevoked(token: string): Promise<boolean> {
    try {
      // IsRevokedRequest: token(1), tenant_id(2)
      const payload = Buffer.concat([
        encodeString(1, token),
        encodeString(2, this.config.tenantId),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.AuthService/IsRevoked',
        payload,
        this.config,
      )

      // IsRevokedResponse: revoked(1 bool)
      const fields = decodeFields(responseBytes)
      return fieldBool(fields, 1)
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] isRevoked fail-open:', err)
      return false
    }
  }

  async explainAuthorize(token: string, path = '', action = ''): Promise<ExplainResult> {
    try {
      const decision = await this.authorize(token, { resource: path, action })
      return {
        requestId: '',
        outcome: decision.allowed ? 'allowed' : 'denied',
        auth: { allowed: decision.allowed, subject: decision.claims?.sub ?? '' },
        policy: {},
        rateLimit: {},
        masking: {},
        latencyMs: 0,
      }
    } catch (e) {
      return { requestId: '', outcome: 'denied', auth: { error: String(e) }, policy: {}, rateLimit: {}, masking: {}, latencyMs: 0 }
    }
  }

  async mintAgentToken(
    parentToken: string,
    targetService: string,
    scopes: string[],
    ttlSeconds = 300,
  ): Promise<AgentToken> {
    try {
      // MintAgentTokenRequest: parent_token(1), target_service(2), scopes(3 repeated), ttl_seconds(4), tenant_id(5)
      const parts: Buffer[] = [
        encodeString(1, parentToken),
        encodeString(2, targetService),
        ...scopes.map(s => encodeString(3, s)),
        encodeVarintField(4, Math.min(ttlSeconds, 300)),
        encodeString(5, this.config.tenantId),
      ]
      const payload = Buffer.concat(parts)

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.AuthService/MintAgentToken',
        payload,
        this.config,
      )

      // MintAgentTokenResponse: token(1), expires_in_seconds(2), agent_chain(3)
      const fields = decodeFields(responseBytes)
      const token = fieldStr(fields, 1)
      const expiresInSeconds = fieldUint(fields, 2) || 300
      const chainJson = fieldStr(fields, 3) || '[]'
      let agentChain: string[] = []
      try { agentChain = JSON.parse(chainJson) as string[] } catch { /* ignore */ }
      return { token, expiresInSeconds, agentChain }
    } catch (err) {
      if (this.config.failMode === 'closed') throw err
      // eslint-disable-next-line no-console
      console.warn('[coresdk] mintAgentToken fail-open:', err)
      return { token: '', expiresInSeconds: 0, agentChain: [] }
    }
  }

  async checkEgress(url: string): Promise<EgressDecision> {
    try {
      // CheckEgressRequest: url(1), tenant_id(2), service_name(3)
      const payload = Buffer.concat([
        encodeString(1, url),
        encodeString(2, this.config.tenantId),
        encodeString(3, this.config.serviceName),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.EgressService/CheckEgress',
        payload,
        this.config,
      )

      // CheckEgressResponse: allowed(1 bool), reason(2)
      const fields = decodeFields(responseBytes)
      return {
        allowed: fieldBool(fields, 1),
        reason: fieldStr(fields, 2),
      }
    } catch {
      // Fail-open: sidecar unreachable
      return { allowed: true, reason: 'sidecar unreachable (fail-open)' }
    }
  }
}
