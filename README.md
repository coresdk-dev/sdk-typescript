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

| Variable | Default |
|----------|---------|
| `CORESDK_ENDPOINT` | `http://127.0.0.1:50051` |
| `CORESDK_TENANT_ID` | (required) |
| `CORESDK_FAIL_MODE` | `open` |
