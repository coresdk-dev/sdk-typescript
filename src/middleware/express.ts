import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { SDK } from '../sdk.js'
import { withClaims } from '../context.js'
import { tracer } from '../tracing.js'
import { SpanStatusCode } from '@opentelemetry/api'

export interface ExpressMiddlewareOptions {
  sdk: SDK
  /** If true, 401 on missing/invalid token. Default: true */
  required?: boolean
}

export function requireAuth(sdk: SDK): RequestHandler {
  return coreSDKMiddleware({ sdk, required: true })
}

export function coreSDKMiddleware(opts: ExpressMiddlewareOptions): RequestHandler {
  const required = opts.required ?? true

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token && required) {
      res.status(401).json({
        type: 'https://coresdk.io/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing Bearer token',
      })
      return
    }

    void tracer.startActiveSpan('coresdk.auth', async (span) => {
      try {
        const decision = await opts.sdk.authorize(token, req.path, req.method)
        if (!decision.allowed) {
          span.setStatus({ code: SpanStatusCode.ERROR })
          res.status(403).json({
            type: 'https://coresdk.io/errors/forbidden',
            title: 'Forbidden',
            status: 403,
          })
          return
        }
        span.setStatus({ code: SpanStatusCode.OK })
        await withClaims(decision.claims, () => new Promise<void>((resolve) => {
          (req as Request & { claims: unknown }).claims = decision.claims
          next()
          resolve()
        }))
      } catch {
        span.setStatus({ code: SpanStatusCode.ERROR })
        if (!required) {
          next()
        } else {
          res.status(500).json({
            type: 'https://coresdk.io/errors/internal',
            title: 'Internal Server Error',
            status: 500,
          })
        }
      } finally {
        span.end()
      }
    })
  }
}
