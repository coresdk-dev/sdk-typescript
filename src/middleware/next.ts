import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { SDK } from '../sdk.js'
import { isEdgeRuntime } from '../sdk.js'

export interface NextMiddlewareOptions {
  sdk: SDK
  /** Path prefixes that require auth. Default: ['/api', '/dashboard'] */
  protectedPaths?: string[]
}

/**
 * Wrap a Next.js App Router handler with CoreSDK auth.
 * Usage: export default withCoreSDK(sdk)(handler)
 */
export function withCoreSDK(
  sdk: SDK,
  opts?: Omit<NextMiddlewareOptions, 'sdk'>,
): (handler: (req: NextRequest) => Promise<NextResponse> | NextResponse) => (req: NextRequest) => Promise<NextResponse> {
  return (handler) => async (req: NextRequest) => {
    const authResult = await coreSdkNextMiddleware(req, { sdk, ...opts })
    // If the middleware returned a non-2xx response, return it directly
    if (authResult.status !== 200 || !authResult.headers.has('x-coresdk-tenant')) {
      // Pass-through only if it's a genuine NextResponse.next() (no explicit status set)
      const isPassThrough = authResult.status === 200
      if (!isPassThrough) return authResult
    }
    return handler(req)
  }
}

/**
 * Create a standalone Next.js middleware function.
 * Usage in middleware.ts: export default createMiddleware(sdk)
 */
export function createMiddleware(sdk: SDK, opts?: Omit<NextMiddlewareOptions, 'sdk'>): (req: NextRequest) => Promise<NextResponse> {
  return (req: NextRequest) => coreSdkNextMiddleware(req, { sdk, ...opts })
}

export async function coreSdkNextMiddleware(
  req: NextRequest,
  opts: NextMiddlewareOptions,
): Promise<NextResponse> {
  const protectedPaths = opts.protectedPaths ?? ['/api', '/dashboard']
  const path = req.nextUrl.pathname

  if (!protectedPaths.some((p) => path.startsWith(p))) {
    return NextResponse.next()
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return NextResponse.json(
      { type: 'https://coresdk.io/errors/unauthorized', title: 'Unauthorized', status: 401 },
      { status: 401 },
    )
  }

  try {
    if (isEdgeRuntime) {
      // eslint-disable-next-line no-console
      console.warn('[coresdk] Edge Runtime detected — gRPC transport unavailable, passing through. Use control plane REST API for edge auth.')
      return NextResponse.next()
    }
    const decision = await opts.sdk.authorize(token, { resource: path, action: req.method })
    if (!decision.allowed) {
      return NextResponse.json(
        { type: 'https://coresdk.io/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      )
    }
    const response = NextResponse.next()
    response.headers.set('x-coresdk-tenant', decision.claims.tenantId)
    return response
  } catch {
    // fail-open for network errors
    return NextResponse.next()
  }
}
