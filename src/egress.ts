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
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const decision = await sdk.checkEgress(url);
    if (!decision.allowed) {
      throw new Error(`CoreSDK SSRF firewall blocked request to ${url}: ${decision.reason}`);
    }
    return fetch(input, init);
  };
}

/**
 * Creates an axios interceptor that blocks requests to disallowed URLs.
 * Usage: const axiosInstance = createCoreAxios(sdk);
 */
/**
 * Creates an axios instance with CoreSDK egress checking.
 * Requires axios to be installed separately: `npm install axios`
 *
 * @example
 * const axiosInstance = await createCoreAxios(sdk)
 */
export async function createCoreAxios(sdk: SDK): Promise<unknown> {
  const { default: axios } = await import('axios');
  const instance = axios.create();
  instance.interceptors.request.use(async (config: { url?: string; [k: string]: unknown }) => {
    const url = config.url ?? '';
    const decision = await sdk.checkEgress(url);
    if (!decision.allowed) {
      throw new Error(`CoreSDK egress blocked: ${decision.reason}`);
    }
    return config;
  });
  return instance;
}
