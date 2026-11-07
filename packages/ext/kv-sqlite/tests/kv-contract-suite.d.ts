/**
 * Type declaration for the shared kv contract suite that vitest.config.ts
 * aliases to source. It stays ambient so the package declares no dependency
 * on the suite's location.
 */

declare module '@rcrsr/rill-ext-kv-shared/contract-suite' {
  export function describeKvContract(
    backend: string,
    harness: import('@rcrsr/rill-ext-kv-shared').KvContractHarness
  ): void;
}
