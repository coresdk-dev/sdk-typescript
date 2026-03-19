import { AsyncLocalStorage } from 'node:async_hooks'
import type { Claims } from './sdk.js'

const store = new AsyncLocalStorage<Claims>()

export function withClaims<T>(claims: Claims, fn: () => Promise<T>): Promise<T> {
  return store.run(claims, fn)
}

export function claimsFrom(): Claims | undefined {
  return store.getStore()
}
