/**
 * Capability guards for Google Workspace extension.
 * Capability denials surface as invalid RillValues carrying `#FORBIDDEN`.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import { failForbidden } from './errors.js';

/**
 * Check that a named capability is enabled.
 * Throws an invalid RillValue (`#FORBIDDEN`) when disabled.
 */
export function checkCapability(
  ctx: RuntimeContext,
  enabled: boolean,
  name: string
): void {
  if (!enabled) {
    failForbidden(ctx, 'capability_disabled', `google: ${name} not enabled`);
  }
}
