/**
 * drive_share callable — share a Drive file with a user.
 * IR-12: drive_share(fileId: str, email: str, role: str?) → bool
 * Capability: drive.share
 * Scope: drive.file
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_FILE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const VALID_ROLES = ['reader', 'commenter', 'writer'] as const;
type DriveRole = (typeof VALID_ROLES)[number];

export interface DriveShareDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}

/**
 * Factory returning the drive_share inner function.
 * EC-10: Rejects role not in {reader, commenter, writer}.
 * AC-12: Returns boolean true on success.
 */
export function makeDriveShare(deps: DriveShareDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const fileId = args['fileId'];
    if (typeof fileId !== 'string' || fileId.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: fileId must be a non-empty string');
    }

    const email = args['email'];
    if (typeof email !== 'string' || email.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: email must be a non-empty string');
    }

    // EC-10: Validate role — default to "reader"
    const rawRole = args['role'];
    const role: DriveRole =
      typeof rawRole === 'string' && rawRole.trim() !== ''
        ? (rawRole as DriveRole)
        : 'reader';

    if (!VALID_ROLES.includes(role)) {
      throw new RuntimeError(
        'RILL-R004',
        "google: drive.share role must be 'reader', 'commenter', or 'writer'"
      );
    }

    const path = `/files/${encodeURIComponent(fileId)}/permissions`;
    const body = {
      role,
      type: 'user',
      emailAddress: email,
    };

    await googleFetch(
      'POST',
      DRIVE_BASE,
      path,
      'drive',
      'share',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      DRIVE_FILE_SCOPES,
      body,
      undefined,
      fileId
    );

    return true as unknown as RillValue;
  };
}
