/**
 * What the browser bundle gets in place of `node:net`, `node:dns` and
 * `node:https`.
 *
 * The listing editor reads each adapter in the browser, for its requirement
 * specs and its name, so the adapter modules are in the client graph. An
 * adapter that talks to a creator-named host loads its HTTP client on demand
 * and never in the browser, but the bundler still has to resolve everything
 * the client could load, and a browser has no `net`. Next ships its own fallback for `crypto`;
 * these three are aliased here, in `next.config.ts`, under the `browser`
 * condition only.
 *
 * Nothing here works. That is the point: a browser must never make an
 * outbound request on a creator's behalf with a store's keys, and a call
 * that reaches this file is a bug that should fail loudly rather than fetch.
 */

const REASON = "lib/net is server-only and was reached from a browser bundle"

export function isIP(): number {
  throw new Error(REASON)
}

export class BlockList {
  addSubnet(): void {
    throw new Error(REASON)
  }
  check(): boolean {
    throw new Error(REASON)
  }
}

export const promises = {
  lookup(): Promise<never> {
    return Promise.reject(new Error(REASON))
  },
}

export function request(): never {
  throw new Error(REASON)
}
