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
  // Avoid double-init if a provider is already registered
  const existingProvider = otelTrace.getTracerProvider()
  // The NoopTracerProvider has no 'resource' property — detect real providers
  if ('resource' in existingProvider) return

  const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node')
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc') as typeof import('@opentelemetry/exporter-trace-otlp-grpc')
  const { Resource } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources')
  const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions')
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node')
  const { PIIMaskingSpanProcessor } = require('./masking/index.js') as typeof import('./masking/index.js')

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
  })

  const provider = new NodeTracerProvider({ resource })

  // PII masking processor runs first so span attributes are scrubbed before export
  provider.addSpanProcessor(new PIIMaskingSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter())))

  provider.register()
}
