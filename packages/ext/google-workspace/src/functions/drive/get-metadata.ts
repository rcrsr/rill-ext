/**
 * drive_get_metadata callable — retrieve file metadata from Google Drive.
 * IR-14: drive_get_metadata(fileId: str) → dict
 * Capability: drive.read
 * Scope: drive.readonly
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const METADATA_FIELDS = 'id,name,mimeType,size,owners,createdTime,modifiedTime';
export interface DriveGetMetadataDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the drive_get_metadata inner function.
 * AC-12: Returns rill primitive dict with file metadata.
 */
export function makeDriveGetMetadata(
  deps: DriveGetMetadataDeps
): (
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
      failInput(
        ctx,
        'invalid_arg',
        'google: file_id must be a non-empty string'
      );
    }
    const path = `/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(METADATA_FIELDS)}`;
    const response = await googleFetch(
      'GET',
      DRIVE_BASE,
      path,
      'drive',
      'get_metadata',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      DRIVE_READ_SCOPES,
      undefined,
      undefined,
      fileId
    );
    const data = response as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      owners?: Array<{ displayName?: string; emailAddress?: string }>;
      createdTime?: string;
      modifiedTime?: string;
    } | null;
    // AC-12: Return rill primitive dict
    return {
      id: data?.id ?? '',
      name: data?.name ?? '',
      mime_type: data?.mimeType ?? '',
      size: data?.size !== undefined ? Number(data.size) : null,
      owners: (data?.owners ?? []).map((o) => ({
        display_name: o.displayName ?? '',
        email_address: o.emailAddress ?? '',
      })),
      created_time: data?.createdTime ?? '',
      modified_time: data?.modifiedTime ?? '',
    } as unknown as RillValue;
  };
}
