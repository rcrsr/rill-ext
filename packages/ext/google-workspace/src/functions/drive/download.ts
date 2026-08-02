/**
 * drive_download callable — download a file from Google Drive as base64.
 * drive_download(fileId: str) → str (base64-encoded content)
 * Capability: drive.download
 * Scope: drive.readonly
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { resolveToken } from '../../auth/resolve.js';
import { mapGoogleError, mapFetchError } from '../../errors.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_READ_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
/** Fixed request timeout. */
const REQUEST_TIMEOUT_MS = 30_000;
export interface DriveDownloadDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the drive_download inner function.
 * [DEVIATION] Uses raw fetch + resolveToken instead of googleFetch because
 * googleFetch always returns response.json(), but download needs raw bytes
 * (arrayBuffer) to base64-encode.
 * Returns base64-encoded string (rill primitive).
 */
export function makeDriveDownload(
  deps: DriveDownloadDeps
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
    // compose lifecycle (ctx.signal), caller signal, and 30s hard timeout
    const signals: AbortSignal[] = [
      controller.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ];
    if (ctx.signal !== undefined) signals.unshift(ctx.signal);
    const combinedSignal = AbortSignal.any(signals);
    // Resolve Bearer token
    const token = await resolveToken(
      deps.auth,
      ctx,
      deps.cache,
      DRIVE_READ_SCOPES,
      combinedSignal
    );
    // GET /files/{id}?alt=media returns raw file bytes
    const url = `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: combinedSignal,
      });
    } catch (error) {
      throw mapFetchError(ctx, error, 'drive') as unknown as RillValue;
    }
    if (!response.ok) {
      throw mapGoogleError(
        ctx,
        response.status,
        'drive',
        'download',
        fileId
      ) as unknown as RillValue;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return base64 as unknown as RillValue;
  };
}
