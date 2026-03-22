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
    // Mask attributes on start when the span is still mutable (ReadWriteSpan).
    // onEnd() receives a ReadableSpan with frozen attributes — mutating there
    // is undefined behaviour and silently fails in many OTel SDK versions.
    const rwSpan = span as Span & { attributes?: Record<string, unknown> }
    if (rwSpan.attributes) {
      for (const [key, value] of Object.entries(rwSpan.attributes)) {
        if (isBlockedField(key)) {
          (span as unknown as { setAttribute(k: string, v: string): void }).setAttribute(key, '[REDACTED]')
        } else if (typeof value === 'string') {
          (span as unknown as { setAttribute(k: string, v: string): void }).setAttribute(key, maskValue(value))
        }
      }
    }
    this.downstream.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    // ReadableSpan is immutable — no masking here. All redaction is in onStart.
    this.downstream.onEnd(span)
  }

  shutdown(): Promise<void> {
    return this.downstream.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.downstream.forceFlush()
  }
}
