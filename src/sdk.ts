import * as http2 from 'node:http2'

export interface SDKConfig {
  endpoint: string
  tenantId: string
  failMode: 'open' | 'closed'
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
  // CORESDK_SIDECAR_ADDR is the canonical env var (matches Python, Go, Rust sidecar).
  // CORESDK_ENDPOINT is accepted as a deprecated alias for backwards compatibility.
  const endpoint =
    process.env.CORESDK_SIDECAR_ADDR ??
    process.env.CORESDK_ENDPOINT ??
    'localhost:50051'
  const tenantId = process.env.CORESDK_TENANT_ID ?? ''
  const failMode = (process.env.CORESDK_FAIL_MODE ?? 'open') as 'open' | 'closed'
  return { endpoint, tenantId, failMode }
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

function encodeString(fieldNum: number, value: string): Buffer {
  if (!value) return Buffer.alloc(0)
  const encoded = Buffer.from(value, 'utf-8')
  const tag = encodeVarint((fieldNum << 3) | 2)
  const len = encodeVarint(encoded.length)
  return Buffer.concat([tag, len, encoded])
}

interface DecodedFields {
  [fieldNum: number]: (Buffer | number)[]
}

function readVarint(data: Buffer, pos: number): [number, number] {
  let result = 0
  let shift = 0
  while (pos < data.length) {
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
  timeoutMs = 5000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = authority.startsWith('http')
      ? authority
      : `http://${authority}`

    const session = http2.connect(url)
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; session.close(); reject(new Error(`gRPC timeout after ${timeoutMs}ms`)) }
    }, timeoutMs)

    session.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err) }
    })

    const req = session.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/grpc',
      'te': 'trailers',
    })

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
    req.on('error', (err) => {
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

  async authorize(token: string, resource: string, action: string): Promise<AuthDecision> {
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
      // PolicyEvaluateRequest: rule(1), inputJson(2)
      const payload = Buffer.concat([
        encodeString(1, rule),
        encodeString(2, JSON.stringify(input)),
      ])

      const responseBytes = await grpcCall(
        this.config.endpoint,
        '/coresdk.v1.PolicyService/Evaluate',
        payload,
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
}
