# @coresdk/sdk — TypeScript/JavaScript SDK

Universal SDK client for CoreSDK — auth, policy, OTel, multi-tenancy.

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
const decision = await sdk.authorize(token, '/api/invoices', 'read')
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
