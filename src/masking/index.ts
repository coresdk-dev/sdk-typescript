/**
 * PII masking utilities. Re-exports from processor.ts plus standalone helpers.
 */
export { PIIMaskingSpanProcessor, maskValue, isBlockedField } from './processor.js'

export const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b/g,
  apiKey: /\b(?:sk|pk|Bearer)\s+[A-Za-z0-9\-._~+/]{20,}=*/g,
} as const

/**
 * Mask PII in a plain string value.
 * Replaces all known PII patterns with "[REDACTED]".
 */
export function maskString(s: string): string {
  let out = s
  for (const pattern of Object.values(PII_PATTERNS)) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    out = out.replace(pattern, '[REDACTED]')
  }
  return out
}

/**
 * Recursively mask PII in all string values of an attributes object.
 */
export function maskAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string') {
      result[key] = maskString(value)
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskAttributes(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
