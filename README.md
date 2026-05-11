# @coresdk/sdk — TypeScript/JavaScript SDK

Universal SDK client for CoreSDK — auth, policy, OTel, multi-tenancy.

**New here?** The [Getting Started guide](GETTING-STARTED.md) takes you from zero to a working sidecar + SDK call in 15 minutes, with a **why** explanation at every step.

## Install

```bash
npm install @coresdk/sdk
# or
pnpm add @coresdk/sdk
```

## Quick start

```typescript
import { SDK } from '@coresdk/sdk'

const sdk = SDK.fromEnv()

// Authorize a request
const decision = await sdk.authorize(token, { resource: '/api/invoices', action: 'read' })
if (!decision.allowed) throw forbiddenError()
```

## Express middleware

```typescript
import express from 'express'
import { coreSDKMiddleware } from '@coresdk/sdk/middleware/express'

const app = express()
app.use(coreSDKMiddleware({ sdk }))
```

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `CORESDK_SIDECAR_ADDR` | `localhost:50051` | gRPC address of the sidecar |
| `CORESDK_TENANT_ID` | | Your tenant identifier |
| `CORESDK_FAIL_MODE` | `open` | `open` = allow on sidecar error; `closed` = deny |

> `CORESDK_ENDPOINT` is accepted as a deprecated alias for `CORESDK_SIDECAR_ADDR`.

## mTLS

To enable mutual TLS between your application and the sidecar, set all three TLS environment variables:

| Variable | Description |
|----------|-------------|
| `CORESDK_TLS_CERT` | Path to the client certificate (PEM) |
| `CORESDK_TLS_KEY` | Path to the client private key (PEM) |
| `CORESDK_TLS_CA` | Path to the CA certificate (PEM) |

```bash
export CORESDK_TLS_CERT=/path/to/client.crt
export CORESDK_TLS_KEY=/path/to/client.key
export CORESDK_TLS_CA=/path/to/ca.crt
```

When all three are present, the SDK configures Connect-RPC with TLS mutual authentication. See the [core-sdk README](https://github.com/coresdk-dev/core-sdk#mtls-configuration) for certificate generation instructions.

## Sidecar

```bash
docker run --rm \
  -e CORESDK_ENV=development \
  -e CORESDK_SIDECAR_ADDR=[::]:50051 \
  -p 50051:50051 \
  -p 9091:9091 \
  ghcr.io/coresdk-dev/sidecar:latest
# Verify: curl http://localhost:9091/healthz  →  {"status":"ok"}
```

See the [Getting Started guide](GETTING-STARTED.md) for the full setup walkthrough.

## API Reference

### Authorization

```typescript
// Validate token only
const decision = await sdk.authorize('Bearer eyJ...')

// Validate + check action/resource
const decision = await sdk.authorize('Bearer eyJ...', { action: 'read', resource: '/api/orders' })
// decision.allowed: boolean
// decision.claims.sub, .tenantId, .roles, .exp
// decision.reason: string (populated on denial)
```

### Policy Evaluation

```typescript
const result = await sdk.evaluatePolicy('authz.allow', {
  action: 'read',
  roles: ['viewer'],
})
// result.allowed: boolean
```

### Feature Flags

```typescript
const flag = await sdk.evaluateFlag('new-checkout-flow', { userId: 'u123' })
// flag.enabled: boolean
// flag.variant: string
```

### Rate Limiting

```typescript
const rl = await sdk.checkRateLimit('user:u123')
if (!rl.allowed) {
  res.status(429).set('Retry-After', String(rl.retryAfterMs / 1000)).send()
}
```

### Audit Events

```typescript
await sdk.emitAuditEvent({
  action: 'order.placed',
  userId: 'u123',
  outcome: 'success',
  resourceType: 'order',
  resourceId: 'ord_456',
})
```

### Testing with MockSDK

```typescript
import { MockSDK } from '@coresdk/sdk'

const sdk = new MockSDK()
// All methods return sensible defaults (allowed: true, etc.)
// Override per test:
sdk.authorize = jest.fn().mockResolvedValue({ allowed: false, reason: 'denied', claims: {} })
```

### Framework Middleware

```typescript
// Express
import { createCoreSDKMiddleware } from '@coresdk/sdk/middleware/express'
app.use(createCoreSDKMiddleware(sdk))

// Fastify
import { coreSDKFastifyPlugin } from '@coresdk/sdk/middleware/fastify'
await fastify.register(coreSDKFastifyPlugin, { sdk })

// Next.js Edge
import { withCoreSDKAuth } from '@coresdk/sdk/middleware/next'
export default withCoreSDKAuth(handler, { sdk })
```

## Jobs (containerised long-running work)

`SDK` exposes the sidecar's `JobService` for async K8s-backed container
workloads with typed lifecycle events, blob-store I/O, and RBAC-gated
secret injection.

```typescript
import { SDK } from '@coresdk/sdk'
const sdk = SDK.fromEnv()

const job = await sdk.submitJob({
  kind: 'claude-cli',
  image: 'ghcr.io/zysec/cpod-claude-cli:latest',
  command: ['claude'],
  inlineFiles: { 'prompt.md': new TextEncoder().encode('hi') },
  secretBundles: ['anthropic-prod'],
  userId: 'alice@example.com',
  timeoutSeconds: 600,
})

for await (const ev of sdk.watchJob(job.jobId)) {
  if (ev.kind === 'progress') console.log(ev.stage, ev.detail)
  if (ev.kind === 'succeeded') {
    const out = await sdk.getJobOutput(job.jobId, 900)
    for (const f of out.files) console.log(f.key, f.presignedUrl)
  }
  if (ev.kind === 'failed') throw new Error(ev.error)
}
```

`watchJob` and `streamJobLogs` are async generators driven by a generic
`grpcServerStream` helper over `node:http2`. Public types: `Job`,
`JobEvent`, `JobEventKind`, `JobOutput`, `JobState`, `LogLine`,
`OutputFile`, `SecretRef`, `SubmitJobOptions`.

> **Edge Runtime:** the JobService methods require `node:http2` and are
> not available under Vercel/Cloudflare Edge. Use the gRPC SDKs from a
> Node.js server, or call the control-plane REST surface directly.
