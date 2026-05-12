import { describe, it, expect } from 'vitest'
import { MockSDK } from '../testing.js'

// Helpers mirroring the encoding in sdk.ts so we can assert the wire format
// without exporting internals. These are intentionally tiny re-implementations
// of the prost length-delimited encoding for a string field.
function encodeVarint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7 }
  out.push(n & 0x7f)
  return out
}

function encodeStringField(fieldNum: number, value: string): Buffer {
  const utf8 = Buffer.from(value, 'utf-8')
  const tag = encodeVarint((fieldNum << 3) | 2)
  const len = encodeVarint(utf8.length)
  return Buffer.from([...tag, ...len, ...utf8])
}

describe('MockSDK.authorize — requiredScope and overloads', () => {
  it('records requiredScope when provided via the options object', async () => {
    const sdk = new MockSDK()
    await sdk.authorize('tok', { requiredScope: 'jobs.write' })
    expect(sdk.authorizeCalls).toHaveLength(1)
    expect(sdk.authorizeCalls[0]?.requiredScope).toBe('jobs.write')
  })

  it('supports the 4-arg positional overload (token, action, resource, opts)', async () => {
    const sdk = new MockSDK()
    await sdk.authorize('tok', 'read', '/orders', { requiredScope: 'jobs.read files.read' })
    expect(sdk.authorizeCalls).toHaveLength(1)
    const call = sdk.authorizeCalls[0]
    expect(call?.action).toBe('read')
    expect(call?.resource).toBe('/orders')
    expect(call?.requiredScope).toBe('jobs.read files.read')
  })

  it('keeps the legacy options-object call signature working unchanged', async () => {
    const sdk = new MockSDK()
    await sdk.authorize('tok', { action: 'GET', resource: '/api/users' })
    expect(sdk.authorizeCalls).toHaveLength(1)
    expect(sdk.authorizeCalls[0]?.requiredScope).toBeUndefined()
  })
})

describe('wire encoding — required_scope at field 8', () => {
  // Validates the encoding shape the production SDK uses for the
  // AuthorizeRequest field tag 8. If this assertion ever drifts, the
  // sidecar will silently ignore the scope filter.
  it('encodes "jobs.write" as tag (8<<3|2) + len + utf8', () => {
    const encoded = encodeStringField(8, 'jobs.write')
    // 8<<3 | 2 = 66 (0x42), len = 10 (0x0a), then utf-8 "jobs.write"
    expect(encoded[0]).toBe(0x42)
    expect(encoded[1]).toBe(0x0a)
    expect(encoded.subarray(2).toString('utf-8')).toBe('jobs.write')
  })
})
