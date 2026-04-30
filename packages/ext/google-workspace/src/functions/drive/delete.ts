/**
 * drive_delete callable — permanently delete a file from Google Drive.
 * IR-13: drive_delete(fileId: str) → bool
 * Capability: drive.delete
 * Scope: drive.file
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_FILE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export interface DriveDeleteDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the drive_delete inner function.
 * Permanent delete via DELETE /files/{id}.
 * googleFetch returns null for 204 No Content — converted to true.
 * AC-12: Returns boolean true on success.
 */
export function makeDriveDelete(deps: DriveDeleteDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const fileId = args['file_id'];
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: file_id must be a non-empty string');
    }
    const path = `/files/${encodeURIComponent(fileId)}`;
    // DELETE returns 204 No Content; googleFetch returns null for 204
    await googleFetch(
      'DELETE',
      DRIVE_BASE,
      path,
      'drive',
      'delete',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      DRIVE_FILE_SCOPES,
      undefined,
      undefined,
      fileId
    );
    // 204 → null from googleFetch; treat as success
    return true as unknown as RillValue;
  };
}
