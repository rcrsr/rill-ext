/**
 * Capability and folder access guards for Outlook extension.
 * Throws RuntimeError before any API call when access is not permitted.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Check that a named capability is enabled.
 * Throws RuntimeError RILL-R004 when the capability flag is false.
 *
 * @param enabled - Whether the capability is enabled
 * @param name - Human-readable capability name for the error message
 * @throws RuntimeError (RILL-R004) when enabled is false [EC-2, EC-5, EC-7, EC-10]
 */
export function checkCapability(enabled: boolean, name: string): void {
  if (!enabled) {
    throw new RuntimeError('RILL-R004', `outlook: ${name} not enabled`);
  }
}

/**
 * Check that a folder name is in the configured allowlist.
 * Throws RuntimeError RILL-R004 when the folder is not accessible.
 *
 * @param folders - Allowlist of accessible folder names
 * @param name - Folder name to check
 * @throws RuntimeError (RILL-R004) when name is not in folders [EC-4]
 */
export function checkFolder(folders: readonly string[], name: string): void {
  if (!folders.includes(name)) {
    throw new RuntimeError(
      'RILL-R004',
      `outlook: folder '${name}' not accessible`
    );
  }
}

