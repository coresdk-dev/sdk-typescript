import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import type { SDK } from '../sdk.js'
import { withClaims } from '../context.js'

export interface FastifyPluginOptions {
  sdk: SDK
  required?: boolean
}

export const coreSdkPlugin: FastifyPluginAsync<FastifyPluginOptions> = async (
  fastify,
  opts,
) => {
  const required = opts.required ?? true

  fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = (req.headers.authorization as string | undefined) ?? ''
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
        const decision = await opts.sdk.authorize(token, req.url, req.method)
        if (!decision.allowed) {
          await reply.code(403).send({
            type: 'https://coresdk.io/errors/forbidden',
            title: 'Forbidden',
            status: 403,
          })
          return
        }
        ;(req as FastifyRequest & { claims: unknown }).claims = decision.claims
      } catch {
        if (required) {
          await reply.code(503).send({ title: 'Service Unavailable', status: 503 })
        }
      }
    }
  })
}
