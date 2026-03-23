import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import type { SDK } from '../sdk.js'

export interface FastifyPluginOptions {
  sdk: SDK
  required?: boolean
}

/* eslint-disable @typescript-eslint/require-await */
// FastifyPluginAsync requires the plugin function signature to be async,
// even though plugin registration itself is synchronous (hooks are registered via addHook).
// Skip encapsulation so the hook applies to all routes (equivalent to fastify-plugin).
const plugin: FastifyPluginAsync<FastifyPluginOptions> = async (
  fastify,
  opts,
) => {
  /* eslint-enable @typescript-eslint/require-await */
  const required = opts.required ?? true

  fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token && required) {
      await reply.code(401).send({
        type: 'https://coresdk.io/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
      })
      return
    }

    if (token) {
      try {
        const decision = await opts.sdk.authorize(token, { resource: req.url, action: req.method })
        if (!decision.allowed) {
          await reply.code(403).send({
            type: 'https://coresdk.io/errors/forbidden',
            title: 'Forbidden',
            status: 403,
          })
          return
        }
        // Inject tenant/user headers for downstream services
        if (decision.claims.tenantId) {
          void reply.header('X-Tenant-ID', decision.claims.tenantId)
        }
        if (decision.claims.sub) {
          void reply.header('X-User-UUID', decision.claims.sub)
        }

        (req as FastifyRequest & { claims: unknown }).claims = decision.claims
      } catch {
        if (required) {
          await reply.code(503).send({ title: 'Service Unavailable', status: 503 })
        }
      }
    }
  })
}

// Break Fastify plugin encapsulation so the hook applies to all sibling routes
// (equivalent to wrapping with fastify-plugin without adding the dependency)
;(plugin as unknown as Record<string | symbol, unknown>)[Symbol.for('skip-override')] = true

export const coreSdkPlugin = plugin
