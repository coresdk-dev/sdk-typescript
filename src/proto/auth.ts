// Hand-written proto stubs for coresdk.v1.AuthService.
// Replace with buf connect-es generated code when protoc/buf CLI is available.
//
// Interface shapes mirror proto/coresdk/v1/auth.proto and
// proto/coresdk/v1/common.proto exactly.

/** RFC 9457 Problem Details — mirrors coresdk.v1.ProblemDetail. */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  extensions: Record<string, string>;
}

/** Mirrors coresdk.v1.TenantContext. */
export interface TenantContext {
  tenantId: string;
  tenantName: string;
  roles: string[];
  attributes: Record<string, string>;
}

/** Mirrors coresdk.v1.RequestMetadata. */
export interface RequestMetadata {
  requestId: string;
  traceId: string;
  spanId: string;
  serviceName: string;
}

/** Mirrors coresdk.v1.ValidateTokenRequest. */
export interface ValidateTokenRequest {
  token: string;
  tenant?: TenantContext;
  metadata?: RequestMetadata;
  expectedAudience?: string;
}

/** Mirrors coresdk.v1.ValidateTokenResponse. */
export interface ValidateTokenResponse {
  valid: boolean;
  subject: string;
  roles: string[];
  claims: Record<string, string>;
  expiresAt: number;
  error?: ProblemDetail;
}

/** Mirrors coresdk.v1.AuthorizeRequest. */
export interface AuthorizeRequest {
  subject: string;
  action: string;
  resource: string;
  tenant?: TenantContext;
  metadata?: RequestMetadata;
  context?: Record<string, string>;
}

/** Mirrors coresdk.v1.AuthorizeResponse. */
export interface AuthorizeResponse {
  allowed: boolean;
  reason: string;
  error?: ProblemDetail;
}

/** Mirrors coresdk.v1.GetJwksRequest. */
export interface GetJwksRequest {
  tenant?: TenantContext;
}

/** Mirrors coresdk.v1.GetJwksResponse. */
export interface GetJwksResponse {
  jwksJson: string;
}
