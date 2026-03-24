/**
 * SSRF-safe HTTP wrappers.
 *
 * Usage:
 *   import { SDK } from '@coresdk/sdk'
 *   import { createCoreFetch } from '@coresdk/sdk/egress'
 *
 *   const sdk = SDK.fromEnv()
 *   const safeFetch = createCoreFetch(sdk)
 *   const res = await safeFetch('https://api.stripe.com/v1/charges', { method: 'GET' })
 */
import type { SDK } from './sdk.js';

/**
 * Returns a fetch-compatible function that checks outbound URLs
 * against the CoreSDK SSRF firewall before making the request.
 */
export function createCoreFetch(sdk: SDK): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async function coreFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const decision = await sdk.checkEgress(url);
    if (!decision.allowed) {
      throw new Error(`CoreSDK SSRF firewall blocked request to ${url}: ${decision.reason}`);
    }
    return fetch(input as Parameters<typeof fetch>[0], init);
  };
}

/**
 * Creates an axios interceptor that blocks requests to disallowed URLs.
 * Usage: const axiosInstance = createCoreAxios(sdk);
 */
export function createCoreAxios(sdk: SDK) {
  // Dynamic import to avoid hard dep on axios
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const axios = require('axios');
  const instance = axios.create();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance.interceptors.request.use(async (config: any) => {
    const url = config.url || '';
    const decision = await sdk.checkEgress(url);
    if (!decision.allowed) {
      throw new Error(`CoreSDK egress blocked: ${decision.reason}`);
    }
    return config;
  });
  return instance;
}
