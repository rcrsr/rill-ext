/**
 * Capability and folder access guards for Outlook extension.
 *
 * Capability and folder denials surface as invalid RillValues
 * carrying `#FORBIDDEN` (capability disabled) or `#INVALID_INPUT`
 * (folder not in allowlist). Helpers throw the invalid value so
 * the wrap()'s catch block passes it through unchanged.
 */

import type { RillValue, RuntimeContext } from '@rcrsr/rill';

const PROVIDER = 'outlook';

/**
 * Check that a named capability is enabled.
 * Throws an invalid RillValue (`#FORBIDDEN`) when disabled.
 */
export function checkCapability(
  ctx: RuntimeContext,
  enabled: boolean,
  name: string,
): void {
  if (!enabled) {
    const message = `outlook: ${name} not enabled`;
    throw ctx.invalidate(new Error(message), {
      code: 'FORBIDDEN',
      provider: PROVIDER,
      raw: { kind: 'capability_disabled', capability: name, message },
    }) as unknown as RillValue;
  }
}

/**
 * Check that a folder name is in the configured allowlist.
 * Throws an invalid RillValue (`#FORBIDDEN`) when not accessible.
 */
export function checkFolder(
  ctx: RuntimeContext,
  folders: readonly string[],
  name: string,
): void {
  if (!folders.includes(name)) {
    const message = `outlook: folder '${name}' not accessible`;
    throw ctx.invalidate(new Error(message), {
      code: 'FORBIDDEN',
      provider: PROVIDER,
      raw: { kind: 'folder_not_allowed', folder: name, message },
    }) as unknown as RillValue;
  }
}
