import type { ExtensionFactoryResult, RillValue } from '@rcrsr/rill';

/**
 * Adapter for the shared credential-isolation suite. Each createExtension
 * call must return an extension in session mode that reads its token from the
 * host context under `tokenKey`.
 */
export interface CredentialIsolationHarness {
  createExtension(tokenKey: string): ExtensionFactoryResult;
  /** Host function to probe and the arguments to call it with. */
  readonly call: {
    readonly name: string;
    readonly args: Readonly<Record<string, RillValue>>;
  };
  /** JSON body the stubbed fetch returns for a 200 response. */
  readonly okBody: unknown;
}
