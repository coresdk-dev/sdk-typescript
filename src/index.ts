export { SDK, isEdgeRuntime, type SDKConfig, type AuthDecision, type Claims, type PolicyResult, type RateLimitDecision, type FlagDecision, type LicenseInfo } from './sdk.js'
export {
  type ProblemDetail,
  CoreSDKError,
  ProblemDetailError,
  unauthorizedError,
  forbiddenError,
  sendProblemDetail,
} from './errors.js'
export { trace, setupOtel } from './tracing.js'
export { withClaims, claimsFrom } from './context.js'
export { PIIMaskingSpanProcessor, maskValue, isBlockedField, maskString, maskAttributes, PII_PATTERNS } from './masking/index.js'
export { MockSDK, type MockSDKOptions, FakeSpanExporter, assertNoPii, assertNoPII } from './testing.js'
