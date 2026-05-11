// JobService bindings — mirrors sdk-python/coresdk/_jobs.py and
// sdk-go/jobs.go. Manual prost-style wire encoding over the same
// node:http2 transport used by sdk.ts. No protoc dependency.
//
// See proto/coresdk/v1/jobs.proto for the canonical message layout.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type JobState =
  | 'pending'
  | 'scheduling'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type JobEventKind =
  | 'created'
  | 'scheduled'
  | 'started'
  | 'progress'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface SecretRef {
  name: string
  path: string
  provider?: string
  version?: string
  /** "env" | "file" | "" (server default) */
  delivery?: '' | 'env' | 'file'
}

export interface Job {
  jobId: string
  kind: string
  image: string
  state: JobState
  exitCode: number
  error: string
  inputS3Uri: string
  outputS3Uri: string
  logsS3Uri: string
  createdAt: number
  startedAt: number
  finishedAt: number
  tenantId: string
  userId: string
  k8sNamespace: string
  k8sJobName: string
  resolvedSecretNames: string[]
}

export interface JobEvent {
  jobId: string
  kind: JobEventKind
  ts: number
  // populated based on kind:
  stage?: string
  percent?: number
  detail?: Record<string, any>
  nodeName?: string
  image?: string
  exitCode?: number
  outputS3Uri?: string
  error?: string
  reason?: string
}

export interface LogLine {
  jobId: string
  ts: number
  stream: 'stdout' | 'stderr' | 'unspecified'
  line: string
}

export interface OutputFile {
  key: string
  s3Uri: string
  presignedUrl: string
  size: number
  contentType: string
}

export interface JobOutput {
  files: OutputFile[]
}

export interface SubmitJobOptions {
  kind: string
  image?: string
  command?: string[]
  args?: string[]
  env?: Record<string, string>
  inlineFiles?: Record<string, Uint8Array>
  inputS3Uri?: string
  secretRefs?: SecretRef[]
  secretBundles?: string[]
  timeoutSeconds?: number
  captureLogs?: boolean
  captureOutput?: boolean
  outputPrefix?: string
  userId?: string
  tenantId?: string
}

// ── wire helpers ────────────────────────────────────────────────────────────

function varint(n: number): Buffer {
  const bytes: number[] = []
  // JS numbers are doubles; for safety with sizes < 2^53 we use BigInt for
  // shifts above 30 bits. For all realistic field tags + lengths this is
  // identical to the plain loop.
  let v = BigInt(n)
  while (true) {
    const lo = Number(v & 0x7fn)
    v >>= 7n
    if (v !== 0n) {
      bytes.push(lo | 0x80)
    } else {
      bytes.push(lo)
      break
    }
  }
  return Buffer.from(bytes)
}

function encodeStringField(fieldNum: number, value: string): Buffer {
  if (!value) return Buffer.alloc(0)
  const b = Buffer.from(value, 'utf8')
  return Buffer.concat([
    varint((fieldNum << 3) | 2),
    varint(b.length),
    b,
  ])
}

function encodeBytesField(fieldNum: number, value: Uint8Array): Buffer {
  return Buffer.concat([
    varint((fieldNum << 3) | 2),
    varint(value.length),
    Buffer.from(value),
  ])
}

function encodeVarintField(fieldNum: number, value: number): Buffer {
  return Buffer.concat([varint(fieldNum << 3), varint(value)])
}

function encodeMessage(fieldNum: number, payload: Buffer): Buffer {
  return Buffer.concat([
    varint((fieldNum << 3) | 2),
    varint(payload.length),
    payload,
  ])
}

function encodeStringMap(fieldNum: number, m: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(m)) {
    const entry = Buffer.concat([encodeStringField(1, k), encodeStringField(2, v)])
    parts.push(encodeMessage(fieldNum, entry))
  }
  return Buffer.concat(parts)
}

function encodeBytesMap(fieldNum: number, m: Record<string, Uint8Array>): Buffer {
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(m)) {
    const entry = Buffer.concat([encodeStringField(1, k), encodeBytesField(2, v)])
    parts.push(encodeMessage(fieldNum, entry))
  }
  return Buffer.concat(parts)
}

function encodeTenant(fieldNum: number, tenantId: string): Buffer {
  if (!tenantId) return Buffer.alloc(0)
  return encodeMessage(fieldNum, encodeStringField(1, tenantId))
}

function encodeSecretRef(r: SecretRef): Buffer {
  const parts: Buffer[] = [
    encodeStringField(1, r.name),
    encodeStringField(2, r.provider ?? ''),
    encodeStringField(3, r.path),
    encodeStringField(4, r.version ?? ''),
  ]
  if (r.delivery === 'env') parts.push(encodeVarintField(5, 1))
  else if (r.delivery === 'file') parts.push(encodeVarintField(5, 2))
  return encodeMessage(7, Buffer.concat(parts))
}

function encodeInput(inline?: Record<string, Uint8Array>, inputS3Uri?: string): Buffer {
  if (inline && Object.keys(inline).length > 0) {
    return encodeMessage(6, encodeMessage(1, encodeBytesMap(1, inline)))
  }
  if (inputS3Uri) {
    return encodeMessage(6, encodeStringField(2, inputS3Uri))
  }
  return Buffer.alloc(0)
}

export function encodeSubmitJobRequest(opts: SubmitJobOptions, defaultTenantId: string): Buffer {
  const parts: Buffer[] = [
    encodeStringField(1, opts.kind),
    encodeStringField(2, opts.image ?? ''),
  ]
  for (const c of opts.command ?? []) parts.push(encodeStringField(3, c))
  for (const a of opts.args ?? []) parts.push(encodeStringField(4, a))
  if (opts.env) parts.push(encodeStringMap(5, opts.env))
  parts.push(encodeInput(opts.inlineFiles, opts.inputS3Uri))
  for (const r of opts.secretRefs ?? []) parts.push(encodeSecretRef(r))
  for (const b of opts.secretBundles ?? []) parts.push(encodeStringField(8, b))
  if (opts.timeoutSeconds) parts.push(encodeVarintField(10, opts.timeoutSeconds))
  if (opts.captureLogs !== false) parts.push(encodeVarintField(11, 1))
  if (opts.captureOutput !== false) parts.push(encodeVarintField(12, 1))
  if (opts.outputPrefix) parts.push(encodeStringField(13, opts.outputPrefix))
  parts.push(encodeTenant(14, opts.tenantId ?? defaultTenantId))
  if (opts.userId) parts.push(encodeStringField(15, opts.userId))
  return Buffer.concat(parts)
}

interface DecodedFields {
  [fieldNum: number]: Array<Buffer | number>
}

function readVarint(data: Buffer, pos: number): [number, number] {
  let result = 0n
  let shift = 0n
  let i = pos
  while (i < data.length) {
    const b = data[i]!
    result |= BigInt(b & 0x7f) << shift
    i++
    if ((b & 0x80) === 0) {
      return [Number(result), i - pos]
    }
    shift += 7n
    if (shift > 64n) break
  }
  return [0, 0]
}

function decodeFields(data: Buffer): DecodedFields {
  const fields: DecodedFields = {}
  let i = 0
  while (i < data.length) {
    const [tag, n1] = readVarint(data, i)
    if (n1 === 0) break
    i += n1
    const fieldNum = tag >>> 3
    const wireType = tag & 0x7
    if (wireType === 0) {
      const [val, n2] = readVarint(data, i)
      if (n2 === 0) break
      i += n2
      ;(fields[fieldNum] ??= []).push(val)
    } else if (wireType === 2) {
      const [length, n2] = readVarint(data, i)
      if (n2 === 0) break
      i += n2
      ;(fields[fieldNum] ??= []).push(data.subarray(i, i + length))
      i += length
    } else {
      break
    }
  }
  return fields
}

function fStr(f: DecodedFields, num: number): string {
  const v = f[num]?.[0]
  if (v === undefined) return ''
  return Buffer.isBuffer(v) ? v.toString('utf8') : ''
}

function fNum(f: DecodedFields, num: number): number {
  const v = f[num]?.[0]
  if (v === undefined) return 0
  return typeof v === 'number' ? v : 0
}

function fStrArr(f: DecodedFields, num: number): string[] {
  const arr = f[num] ?? []
  return arr.filter(Buffer.isBuffer).map((b) => b.toString('utf8'))
}

const JOB_STATE_BY_ENUM: Record<number, JobState> = {
  0: 'pending',
  1: 'pending',
  2: 'scheduling',
  3: 'running',
  4: 'succeeded',
  5: 'failed',
  6: 'cancelled',
}

export function decodeJob(body: Buffer): Job {
  const f = decodeFields(body)
  return {
    jobId: fStr(f, 1),
    kind: fStr(f, 2),
    image: fStr(f, 3),
    state: JOB_STATE_BY_ENUM[fNum(f, 4)] ?? 'pending',
    exitCode: fNum(f, 5),
    error: fStr(f, 6),
    inputS3Uri: fStr(f, 7),
    outputS3Uri: fStr(f, 8),
    logsS3Uri: fStr(f, 9),
    createdAt: fNum(f, 10),
    startedAt: fNum(f, 11),
    finishedAt: fNum(f, 12),
    tenantId: fStr(f, 13),
    userId: fStr(f, 14),
    k8sNamespace: fStr(f, 15),
    k8sJobName: fStr(f, 16),
    resolvedSecretNames: fStrArr(f, 17),
  }
}

export function decodeJobEvent(body: Buffer): JobEvent {
  const f = decodeFields(body)
  const out: JobEvent = {
    jobId: fStr(f, 1),
    ts: fNum(f, 2),
    kind: 'unknown',
  }
  const oneof = (n: number) => {
    const arr = f[n]
    if (arr && arr.length > 0 && Buffer.isBuffer(arr[0])) return arr[0] as Buffer
    return null
  }
  let sub = oneof(10)
  if (sub) {
    out.kind = 'created'
    out.image = fStr(decodeFields(sub), 1)
    return out
  }
  sub = oneof(11)
  if (sub) {
    out.kind = 'scheduled'
    out.nodeName = fStr(decodeFields(sub), 1)
    return out
  }
  sub = oneof(12)
  if (sub) {
    out.kind = 'started'
    return out
  }
  sub = oneof(13)
  if (sub) {
    const sf = decodeFields(sub)
    out.kind = 'progress'
    out.stage = fStr(sf, 1)
    out.percent = fNum(sf, 2)
    const raw = fStr(sf, 3)
    if (raw) {
      try {
        out.detail = JSON.parse(raw)
      } catch {
        out.detail = { raw }
      }
    } else {
      out.detail = {}
    }
    return out
  }
  sub = oneof(14)
  if (sub) {
    const sf = decodeFields(sub)
    out.kind = 'succeeded'
    out.exitCode = fNum(sf, 1)
    out.outputS3Uri = fStr(sf, 2)
    return out
  }
  sub = oneof(15)
  if (sub) {
    const sf = decodeFields(sub)
    out.kind = 'failed'
    out.exitCode = fNum(sf, 1)
    out.error = fStr(sf, 2)
    return out
  }
  sub = oneof(16)
  if (sub) {
    out.kind = 'cancelled'
    out.reason = fStr(decodeFields(sub), 1)
    return out
  }
  return out
}

export function decodeLogLine(body: Buffer): LogLine {
  const f = decodeFields(body)
  const s = fNum(f, 2)
  return {
    jobId: '',
    ts: fNum(f, 1),
    stream: s === 1 ? 'stdout' : s === 2 ? 'stderr' : 'unspecified',
    line: fStr(f, 3),
  }
}

export function decodeJobOutput(body: Buffer): JobOutput {
  const f = decodeFields(body)
  const files: OutputFile[] = []
  for (const raw of f[1] ?? []) {
    if (!Buffer.isBuffer(raw)) continue
    const sf = decodeFields(raw)
    files.push({
      key: fStr(sf, 1),
      s3Uri: fStr(sf, 2),
      presignedUrl: fStr(sf, 3),
      size: fNum(sf, 4),
      contentType: fStr(sf, 5),
    })
  }
  return { files }
}

export function encodeGetJob(jobId: string, tenantId: string): Buffer {
  return Buffer.concat([encodeStringField(1, jobId), encodeTenant(2, tenantId)])
}

export function encodeCancel(jobId: string, reason: string, tenantId: string): Buffer {
  return Buffer.concat([
    encodeStringField(1, jobId),
    encodeStringField(2, reason),
    encodeTenant(3, tenantId),
  ])
}

export function encodeList(tenantId: string, state: string, limit: number): Buffer {
  return Buffer.concat([
    encodeTenant(1, tenantId),
    encodeStringField(2, state),
    limit ? encodeVarintField(3, limit) : Buffer.alloc(0),
  ])
}

export function encodeOutput(jobId: string, ttlSecs: number, tenantId: string): Buffer {
  return Buffer.concat([
    encodeStringField(1, jobId),
    ttlSecs ? encodeVarintField(2, ttlSecs) : Buffer.alloc(0),
    encodeTenant(3, tenantId),
  ])
}

export function encodeWatch(jobId: string, tenantId: string): Buffer {
  return Buffer.concat([encodeStringField(1, jobId), encodeTenant(3, tenantId)])
}

export function encodeLogs(jobId: string, follow: boolean, tail: number, tenantId: string): Buffer {
  return Buffer.concat([
    encodeStringField(1, jobId),
    follow ? encodeVarintField(2, 1) : Buffer.alloc(0),
    tail ? encodeVarintField(3, tail) : Buffer.alloc(0),
    encodeTenant(4, tenantId),
  ])
}

export function decodeJobList(body: Buffer): Job[] {
  const f = decodeFields(body)
  return (f[1] ?? [])
    .filter(Buffer.isBuffer)
    .map((b) => decodeJob(b as Buffer))
}

// ── streaming helper ────────────────────────────────────────────────────────

/**
 * Server-streaming gRPC call. Returns an async iterator of length-prefixed
 * payload buffers (5-byte gRPC frame already stripped). The caller decodes
 * each yielded Buffer via decodeJobEvent / decodeLogLine.
 */
export async function* grpcServerStream(
  authority: string,
  path: string,
  payload: Buffer,
  config: {
    serviceName?: string
    serviceToken?: string
    tlsCertPath?: string
    tlsKeyPath?: string
    tlsCaPath?: string
  },
): AsyncIterable<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const http2 = require('node:http2') as typeof import('node:http2')
  const url = authority.startsWith('http') ? authority : `http://${authority}`

  let tlsOptions: Record<string, unknown> | undefined
  if (config.tlsCertPath && config.tlsKeyPath) {
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

  const headers: Record<string, string> = {
    ':method': 'POST',
    ':path': path,
    'content-type': 'application/grpc',
    'te': 'trailers',
  }
  if (config.serviceName) headers['x-service-name'] = config.serviceName
  if (config.serviceToken) headers['x-service-token'] = config.serviceToken

  const req = session.request(headers)
  // Frame the request payload exactly like grpcCall does in sdk.ts.
  const frame = Buffer.concat([
    Buffer.from([0]),
    (() => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(payload.length, 0)
      return len
    })(),
    payload,
  ])
  req.write(frame)
  req.end()

  const queue: Buffer[] = []
  let pending: ((b: Buffer | null) => void) | null = null
  let closed = false
  let trailerStatus = '0'
  let trailerMsg = ''
  let buffered = Buffer.alloc(0)

  const finish = () => {
    closed = true
    if (pending) {
      const p = pending
      pending = null
      p(null)
    }
    session.close()
  }

  req.on('response', (h) => {
    trailerStatus = (h['grpc-status'] as string) ?? trailerStatus
    trailerMsg = (h['grpc-message'] as string) ?? trailerMsg
  })
  req.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    // Parse one or more complete frames.
    while (buffered.length >= 5) {
      const len = buffered.readUInt32BE(1)
      if (buffered.length < 5 + len) break
      const body = buffered.subarray(5, 5 + len)
      buffered = buffered.subarray(5 + len)
      if (pending) {
        const p = pending
        pending = null
        p(body)
      } else {
        queue.push(body)
      }
    }
  })
  req.on('trailers', (t) => {
    trailerStatus = (t['grpc-status'] as string) ?? trailerStatus
    trailerMsg = (t['grpc-message'] as string) ?? trailerMsg
  })
  req.on('end', finish)
  req.on('error', finish)

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!
      continue
    }
    if (closed) break
    const next = await new Promise<Buffer | null>((resolve) => {
      pending = resolve
    })
    if (next === null) break
    yield next
  }
  if (trailerStatus !== '0') {
    throw new Error(`gRPC ${trailerStatus}: ${trailerMsg}`)
  }
}
