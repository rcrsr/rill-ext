/**
 * drive_list callable — list files in Google Drive.
 * IR-9: drive_list(folderId: str?, options: dict?) → { files: list[dict] }
 * Capability: drive.list
 * Scope: drive.readonly
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failForbidden } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth, DriveConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
export interface DriveListDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly driveConfig: DriveConfig | undefined;
}
/**
 * Factory returning the drive_list inner function.
 * BC-2: Empty folder returns { files: [] }, not an error.
 * EC-7: Rejects folderId not in allowedFolderIds (when defined).
 * AC-12: Returns rill primitive dict { files: list[dict] }.
 */
export function makeDriveList(deps: DriveListDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const folderId = args['folderId'];
    const folderIdStr =
      folderId !== undefined && folderId !== null && typeof folderId === 'string'
        ? folderId
        : undefined;
    // EC-7: Validate folderId against allowedFolderIds when defined
    if (folderIdStr !== undefined && folderIdStr !== '') {
      const allowed = deps.driveConfig?.allowedFolderIds;
      if (allowed !== undefined && !allowed.includes(folderIdStr)) {
        failForbidden(ctx, 'forbidden', `google: folder '${folderIdStr}' not in allowed set`);
      }
    }
    // Build query: list files in the given folder, or all files
    let query = 'trashed=false';
    if (folderIdStr !== undefined && folderIdStr !== '') {
      query = `'${folderIdStr}' in parents and trashed=false`;
    }
    const path = `/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,owners,createdTime,modifiedTime)`;
    const response = await googleFetch(
      'GET',
      DRIVE_BASE,
      path,
      'drive',
      'list',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      DRIVE_READ_SCOPES,
      undefined,
      undefined,
      undefined
    );
    // BC-2: Empty folder returns { files: [] }
    const data = response as {
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        owners?: Array<{ displayName?: string; emailAddress?: string }>;
        createdTime?: string;
        modifiedTime?: string;
      }>;
    } | null;
    const rawFiles = data?.files ?? [];
    const files = rawFiles.map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      size: f.size !== undefined ? Number(f.size) : null,
      owners: (f.owners ?? []).map((o) => ({
        displayName: o.displayName ?? '',
        emailAddress: o.emailAddress ?? '',
      })),
      createdTime: f.createdTime ?? '',
      modifiedTime: f.modifiedTime ?? '',
    }));
    return { files } as unknown as RillValue;
  };
}
