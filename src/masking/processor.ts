import {
  type SpanProcessor,
  type ReadableSpan,
  type Span,
} from '@opentelemetry/sdk-trace-node'
import type { Context } from '@opentelemetry/api'

const BLOCKED_FIELDS = new Set([
  'password', 'secret', 'token', 'authorization', 'cookie',
  'credit_card', 'ssn', 'email', 'phone', 'dob',
])

const PII_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                          // phone
  /\b\d{3}-\d{2}-\d{4}\b/g,                                  // SSN
  /\b4\d{12}(?:\d{3})?\b/g,                                  // Visa card
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,                         // Bearer token
]

export function isBlockedField(key: string): boolean {
  return BLOCKED_FIELDS.has(key.toLowerCase())
}

export function maskValue(value: string): string {
  let out = value
  for (const pattern of PII_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]')
  }
  return out
}

export class PIIMaskingSpanProcessor implements SpanProcessor {
  private readonly downstream: SpanProcessor

  constructor(downstream: SpanProcessor) {
    this.downstream = downstream
  }

  onStart(span: Span, parentContext: Context): void {
    this.downstream.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    // Mask attributes before forwarding downstream.
    // ReadableSpan.attributes is nominally read-only, but we own the processor
    // chain and mutate in-place to avoid allocating a new attributes object.
    const attrs = span.attributes
    for (const [key, value] of Object.entries(attrs)) {
      if (isBlockedField(key)) {
        (attrs as Record<string, unknown>)[key] = '[REDACTED]'
      } else if (typeof value === 'string') {
        (attrs as Record<string, unknown>)[key] = maskValue(value)
      }
    }
    this.downstream.onEnd(span)
  }

  shutdown(): Promise<void> {
    return this.downstream.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.downstream.forceFlush()
  }
}
