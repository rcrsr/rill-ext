/**
 * Capability guards for Google Workspace extension.
 * Throws RuntimeError before any API call when access is not permitted.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Check that a named capability is enabled.
 * Throws RuntimeError RILL-R004 when the capability flag is false.
 *
 * @param enabled - Whether the capability is enabled
 * @param name - Human-readable capability name for the error message
 * @throws RuntimeError (RILL-R004) when enabled is false [IR-24]
 */
export function checkCapability(enabled: boolean, name: string): void {
  if (!enabled) {
    throw new RuntimeError('RILL-R004', `google: ${name} not enabled`);
  }
}
