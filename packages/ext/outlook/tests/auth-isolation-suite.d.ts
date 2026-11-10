/**
 * Type declaration for the shared credential-isolation suite that
 * vitest.config.ts aliases to source. It stays ambient so the package declares
 * no dependency on the suite's location.
 */

declare module '@rcrsr/rill-ext-auth-shared/isolation-suite' {
  export function describeCredentialIsolation(
    extensionName: string,
    harness: import('@rcrsr/rill-ext-auth-shared').CredentialIsolationHarness
  ): void;
}
