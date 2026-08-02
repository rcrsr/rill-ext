/**
 * drive_upload callable — upload content to Google Drive.
 * drive_upload(content: str, filename: str, folderId: str?, options: dict?) → dict
 * Capability: drive.upload
 * Scope: drive.file
 */
import { randomBytes } from 'node:crypto';
import { failForbidden, failInput } from '../../errors.js';
import { isDict } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { resolveToken } from '../../auth/resolve.js';
import { mapGoogleError, mapFetchError } from '../../errors.js';
import type { GoogleAuth, DriveConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FILE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
/** Fixed request timeout. */
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MIME_TYPE = 'application/octet-stream';
export interface DriveUploadDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly driveConfig: DriveConfig | undefined;
}
/**
 * Factory returning the drive_upload inner function.
 * [DEVIATION] Uses raw fetch + resolveToken instead of googleFetch because
 * googleFetch always JSON.stringifies the body, but upload needs binary bytes.
 * Uses Google Drive uploadType=multipart so metadata and content are
 * uploaded atomically in a single request (no partial-state window).
 * Rejects folderId not in allowedFolderIds (when defined).
 * Rejects MIME type in deniedMimeTypes.
 * Rejects content byte size > maxUploadBytes (== is allowed).
 * Returns rill primitive dict.
 */
export function makeDriveUpload(
  deps: DriveUploadDeps
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
    // --- Validate required args ---
    const content = args['content'];
    if (typeof content !== 'string') {
      failInput(ctx, 'invalid_arg', 'google: content must be a string');
    }
    const filename = args['filename'];
    if (typeof filename !== 'string' || filename.trim() === '') {
      failInput(
        ctx,
        'invalid_arg',
        'google: filename must be a non-empty string'
      );
    }
    const folderId = args['folder_id'];
    const folderIdStr =
      folderId !== undefined &&
      folderId !== null &&
      typeof folderId === 'string'
        ? folderId
        : undefined;
    // Resolve mimeType from options
    const options = args['options'];
    let mimeType = DEFAULT_MIME_TYPE;
    if (options !== undefined && options !== null && isDict(options)) {
      const rawMime = options['mime_type'];
      if (typeof rawMime === 'string' && rawMime.trim() !== '') {
        mimeType = rawMime;
      }
    }
    // Check deniedMimeTypes
    const deniedMimeTypes = deps.driveConfig?.deniedMimeTypes ?? [];
    if (deniedMimeTypes.includes(mimeType)) {
      failInput(
        ctx,
        'invalid_arg',
        `google: MIME type '${mimeType}' not allowed`
      );
    }
    // Decode base64 content to bytes. Node's Buffer.from(_, 'base64') silently
    // skips characters outside the base64 alphabet, which can corrupt uploads.
    // Validate strictly against standard or URL-safe base64, then normalize to
    // standard alphabet before decoding.
    const stripped = content.replace(/\s+/g, '');
    if (
      !/^[A-Za-z0-9+/_-]*={0,2}$/.test(stripped) ||
      stripped.length % 4 === 1
    ) {
      failInput(ctx, 'invalid_arg', 'google: content is not valid base64');
    }
    const normalized = stripped.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Buffer.from(normalized, 'base64');
    const byteLength = bytes.length;
    // Check maxUploadBytes (inclusive: == is allowed)
    const maxUploadBytes = deps.driveConfig?.maxUploadBytes;
    if (maxUploadBytes !== undefined && byteLength > maxUploadBytes) {
      failInput(
        ctx,
        'invalid_arg',
        `google: file exceeds maximum upload size (${maxUploadBytes} bytes)`
      );
    }
    // Validate folderId against allowedFolderIds when defined
    if (folderIdStr !== undefined && folderIdStr !== '') {
      const allowed = deps.driveConfig?.allowedFolderIds;
      if (allowed !== undefined && !allowed.includes(folderIdStr)) {
        failForbidden(
          ctx,
          'forbidden',
          `google: folder '${folderIdStr}' not in allowed set`
        );
      }
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
      DRIVE_FILE_SCOPES,
      combinedSignal
    );
    // Atomic multipart/related upload: one POST carries metadata + bytes,
    // eliminating the partial-state window of the prior media-then-PATCH flow.
    const metadata: Record<string, unknown> = { name: filename };
    if (folderIdStr !== undefined && folderIdStr !== '') {
      metadata['parents'] = [folderIdStr];
    }
    const boundary = `rill-${randomBytes(16).toString('hex')}`;
    const metaJson = JSON.stringify(metadata);
    const part1 =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metaJson}\r\n`;
    const part2Header =
      `--${boundary}\r\n` + `Content-Type: ${mimeType}\r\n\r\n`;
    const closing = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(part1, 'utf8'),
      Buffer.from(part2Header, 'utf8'),
      bytes,
      Buffer.from(closing, 'utf8'),
    ]);
    const fields = 'id,name,mimeType,size,owners(displayName,emailAddress)';
    const uploadUrl =
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart` +
      `&fields=${encodeURIComponent(fields)}`;
    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: combinedSignal,
      });
    } catch (error) {
      throw mapFetchError(ctx, error, 'drive') as unknown as RillValue;
    }
    if (!uploadResponse.ok) {
      throw mapGoogleError(
        ctx,
        uploadResponse.status,
        'drive',
        'upload'
      ) as unknown as RillValue;
    }
    const data = (await uploadResponse.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      owners?: Array<{ displayName?: string; emailAddress?: string }>;
    };
    // Return rill primitive dict
    return {
      id: data.id ?? '',
      name: data.name ?? filename,
      mime_type: data.mimeType ?? mimeType,
      size: data.size !== undefined ? Number(data.size) : byteLength,
      owner:
        data.owners?.[0]?.emailAddress ?? data.owners?.[0]?.displayName ?? null,
    } as unknown as RillValue;
  };
}
