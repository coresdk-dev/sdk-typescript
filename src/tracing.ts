import { trace as otelTrace, SpanStatusCode, type Span } from '@opentelemetry/api'
import { claimsFrom } from './context.js'

export const tracer = otelTrace.getTracer('coresdk', '0.1.0')

export async function trace<T>(
  name: string,
  intent: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttribute('coresdk.intent', intent)
    const claims = claimsFrom()
    if (claims) {
      span.setAttribute('coresdk.tenant_id', claims.tenantId)
      // NEVER set user PII on spans — masked by PIIMaskingSpanProcessor
    }
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}

export function setupOtel(serviceName: string): void {
  // Only configure if no global provider exists
  if (otelTrace.getActiveSpan() !== undefined) return
  // In production: configure OTLP exporter pointing at sidecar
  // NodeSDK setup would go here
  // eslint-disable-next-line no-console
  console.info(`[coresdk] OTel setup for service: ${serviceName}`)
}
