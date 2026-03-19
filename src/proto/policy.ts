// Hand-written proto stubs for coresdk.v1.PolicyService.
// Replace with buf connect-es generated code when protoc/buf CLI is available.
//
// Interface shapes mirror proto/coresdk/v1/policy.proto exactly.

import type { TenantContext, RequestMetadata, ProblemDetail } from "./auth.js";

export type { TenantContext, RequestMetadata, ProblemDetail };

/** Mirrors coresdk.v1.PolicyEvaluateRequest. */
export interface PolicyEvaluateRequest {
  rule: string;       // e.g. "data.authz.allow"
  inputJson: string;  // JSON-encoded input document
  tenant?: TenantContext;
  metadata?: RequestMetadata;
}

/** Mirrors coresdk.v1.PolicyEvaluateResponse. */
export interface PolicyEvaluateResponse {
  result: boolean;
  reason: string;
  dryRun: boolean;
  error?: ProblemDetail;
}

/** Mirrors coresdk.v1.WatchPolicyUpdatesRequest. */
export interface WatchPolicyUpdatesRequest {
  tenant?: TenantContext;
  lastBundleVersion?: string;
}

/** Mirrors coresdk.v1.PolicyBundleUpdate. */
export interface PolicyBundleUpdate {
  bundleVersion: string;
  bundleData: Uint8Array;
  updatedAt: number;
}
