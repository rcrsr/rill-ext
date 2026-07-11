/**
 * Drive callable tests for Google Workspace extension.
 * Covers: IR-9..IR-14, EC-7, EC-8, EC-9, EC-10, EC-11, EC-14, EC-15, EC-17, EC-18,
 *         BC-2, BC-8, AC-4, AC-12, AC-13.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RuntimeError,
  createRuntimeContext,
  type ApplicationCallable,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createGoogleWorkspaceExtension } from '../src/factory.js';

// ============================================================
// HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

async function callDrive(
  ext: { value: unknown },
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return getCallable(ext, name).fn(
    args as Record<string, import('@rcrsr/rill').RillValue>,
    createRuntimeContext()
  );
}

// ============================================================
// FIXTURES
// ============================================================

/** Config with all Drive capabilities enabled, no restrictions. */
const DRIVE_ALL_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
  },
};

/** Config with all capabilities disabled. */
const NO_CAPS_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    drive: {
      read: false,
      list: false,
      upload: false,
      download: false,
      share: false,
      delete: false,
    },
  },
};

/** A valid 100-byte buffer base64-encoded. */
const BYTES_100 = Buffer.alloc(100, 0x41);
const BASE64_100 = BYTES_100.toString('base64');

/** A valid 101-byte buffer base64-encoded. */
const BYTES_101 = Buffer.alloc(101, 0x41);
const BASE64_101 = BYTES_101.toString('base64');

// ============================================================
// MOCK SETUP
// ============================================================

// Track original fetch for restoration.
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn() as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ============================================================
// AC-4: Capability gating
// ============================================================

describe('AC-4: capability gating', () => {
  it('drive_list with list:false → #FORBIDDEN "google: drive.list not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_list', {})) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe('google: drive.list not enabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_upload with upload:false → #FORBIDDEN "google: drive.upload not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_upload', {
      content: BASE64_100,
      filename: 'file.txt',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe('google: drive.upload not enabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_download with download:false → #FORBIDDEN "google: drive.download not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_download', {
      file_id: 'f1',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe(
      'google: drive.download not enabled'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_share with share:false → #FORBIDDEN "google: drive.share not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_share', {
      file_id: 'f1',
      email: 'a@b.com',
      role: 'reader',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe('google: drive.share not enabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_delete with delete:false → #FORBIDDEN "google: drive.delete not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_delete', {
      file_id: 'f1',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe('google: drive.delete not enabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_get_metadata with read:false → #FORBIDDEN "google: drive.read not enabled"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      NO_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_get_metadata', {
      file_id: 'f1',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe('google: drive.read not enabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// Success cases [AC-12, AC-13]
// ============================================================

describe('drive_list success cases', () => {
  it('returns { files: list[dict] } with file entries [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    const fileEntry = {
      id: 'f1',
      name: 'doc.txt',
      mimeType: 'text/plain',
      size: '100',
      owners: [{ displayName: 'Alice', emailAddress: 'alice@example.com' }],
      createdTime: '2024-01-01T00:00:00Z',
      modifiedTime: '2024-01-02T00:00:00Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [fileEntry] }),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_list', {})) as {
      files: unknown[];
    };

    expect(result).toHaveProperty('files');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toHaveLength(1);

    const file = result.files[0] as Record<string, unknown>;
    expect(file['id']).toBe('f1');
    expect(file['name']).toBe('doc.txt');
    expect(file['mime_type']).toBe('text/plain');
    expect(file['size']).toBe(100);
  });

  it('BC-2: empty folder result → { files: [] } (no error)', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_list', {})) as {
      files: unknown[];
    };

    expect(result).toHaveProperty('files');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toHaveLength(0);
  });

  it('AC-13: emits "google:drive:list" event with duration on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    }) as typeof fetch;

    await getCallable(ext, 'drive_list').fn(
      {} as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:list' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('drive_upload success cases', () => {
  it('returns dict with id, name, mimeType, size, owner [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    // Single multipart/related POST carries metadata + bytes atomically.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'u1',
          name: 'file.txt',
          mimeType: 'text/plain',
          size: '100',
          owners: [{ emailAddress: 'owner@example.com', displayName: 'Owner' }],
        }),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_upload', {
      content: BASE64_100,
      filename: 'file.txt',
    })) as Record<string, unknown>;

    expect(result['id']).toBe('u1');
    expect(result['name']).toBe('file.txt');
    expect(result['mime_type']).toBe('text/plain');
    expect(result['size']).toBe(100);
    expect(result['owner']).toBe('owner@example.com');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]! as [string, RequestInit];
    expect(calledUrl).toContain('uploadType=multipart');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const bodyBuf = calledInit.body as Buffer;
    const bodyStr = bodyBuf.toString('utf8');
    expect(bodyStr).toContain('Content-Type: application/json; charset=UTF-8');
    expect(bodyStr).toContain('"name":"file.txt"');
    expect(bodyStr).toContain('Content-Type: application/octet-stream');
  });

  it('AC-13: emits "google:drive:upload" event with duration on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'u1',
          name: 'f.txt',
          mimeType: 'application/octet-stream',
        }),
    }) as typeof fetch;

    await getCallable(ext, 'drive_upload').fn(
      { content: BASE64_100, filename: 'f.txt' } as Record<
        string,
        import('@rcrsr/rill').RillValue
      >,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:upload' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('drive_download success cases', () => {
  it('returns base64-encoded string of file bytes [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    // Create an isolated ArrayBuffer from "Hello"
    const srcBytes = Buffer.from('Hello', 'utf8');
    const arrayBuf = srcBytes.buffer.slice(
      srcBytes.byteOffset,
      srcBytes.byteOffset + srcBytes.byteLength
    ) as ArrayBuffer;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(arrayBuf),
    }) as typeof fetch;

    const result = await callDrive(ext, 'drive_download', { file_id: 'f1' });

    expect(typeof result).toBe('string');
    const decoded = Buffer.from(result as string, 'base64').toString('utf8');
    expect(decoded).toBe('Hello');
  });

  it('AC-13: emits "google:drive:download" event on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    const emptyBuf = new ArrayBuffer(0);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(emptyBuf),
    }) as typeof fetch;

    await getCallable(ext, 'drive_download').fn(
      { file_id: 'f1' } as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:download' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('drive_share success cases', () => {
  it('returns true on successful permission grant with default role [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'perm1' }),
    }) as typeof fetch;

    const result = await callDrive(ext, 'drive_share', {
      file_id: 'f1',
      email: 'user@example.com',
      role: 'reader',
    });

    expect(result).toBe(true);
  });

  it('AC-13: emits "google:drive:share" event on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }) as typeof fetch;

    await getCallable(ext, 'drive_share').fn(
      { file_id: 'f1', email: 'u@example.com', role: 'writer' } as Record<
        string,
        import('@rcrsr/rill').RillValue
      >,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:share' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('drive_delete success cases', () => {
  it('returns true when file deleted (204 No Content) [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as typeof fetch;

    const result = await callDrive(ext, 'drive_delete', { file_id: 'f1' });

    expect(result).toBe(true);
  });

  it('AC-13: emits "google:drive:delete" event on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as typeof fetch;

    await getCallable(ext, 'drive_delete').fn(
      { file_id: 'f1' } as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:delete' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('drive_get_metadata success cases', () => {
  it('returns dict with file metadata fields [AC-12]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    const metadata = {
      id: 'f1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: '2048',
      owners: [{ displayName: 'Bob', emailAddress: 'bob@example.com' }],
      createdTime: '2024-01-01T00:00:00Z',
      modifiedTime: '2024-01-15T12:00:00Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(metadata),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_get_metadata', {
      file_id: 'f1',
    })) as Record<string, unknown>;

    expect(result['id']).toBe('f1');
    expect(result['name']).toBe('report.pdf');
    expect(result['mime_type']).toBe('application/pdf');
    expect(result['size']).toBe(2048);
    expect(Array.isArray(result['owners'])).toBe(true);
    const owners = result['owners'] as Array<Record<string, string>>;
    expect(owners[0]!['email_address']).toBe('bob@example.com');
    expect(result['created_time']).toBe('2024-01-01T00:00:00Z');
    expect(result['modified_time']).toBe('2024-01-15T12:00:00Z');
  });

  it('AC-13: emits "google:drive:get_metadata" event on success', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: 'f1', name: 'doc.txt', mimeType: 'text/plain' }),
    }) as typeof fetch;

    await getCallable(ext, 'drive_get_metadata').fn(
      { file_id: 'f1' } as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:drive:get_metadata' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

// ============================================================
// EC-7: allowedFolderIds
// ============================================================

describe('EC-7: allowedFolderIds restriction', () => {
  const config = {
    auth: { type: 'bearer' as const, token: 'test-token' },
    capabilities: {
      drive: {
        read: true,
        list: true,
        upload: true,
        download: true,
        share: true,
        delete: true,
      },
    },
    drive: { allowedFolderIds: ['F1'] },
  };

  it('drive_list with folderId not in allowedFolderIds → #FORBIDDEN; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());
    const caught = (await callDrive(ext, 'drive_list', {
      folder_id: 'F2',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe(
      "google: folder 'F2' not in allowed set"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drive_list with allowed folderId=F1 → proceeds to fetch', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_list', {
      folder_id: 'F1',
    })) as { files: unknown[] };
    expect(result.files).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('drive_list without folderId → no allowlist check; fetch proceeds', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    }) as typeof fetch;

    const result = (await callDrive(ext, 'drive_list', {})) as {
      files: unknown[];
    };
    expect(result.files).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('drive_upload with folderId not in allowedFolderIds → #FORBIDDEN; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());
    const caught = (await callDrive(ext, 'drive_upload', {
      content: BASE64_100,
      filename: 'file.txt',
      folder_id: 'F2',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe(
      "google: folder 'F2' not in allowed set"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// EC-8: deniedMimeTypes
// ============================================================

describe('EC-8: deniedMimeTypes restriction', () => {
  const config = {
    auth: { type: 'bearer' as const, token: 'test-token' },
    capabilities: {
      drive: {
        read: true,
        list: true,
        upload: true,
        download: true,
        share: true,
        delete: true,
      },
    },
    drive: { deniedMimeTypes: ['application/x-evil'] },
  };

  it('drive_upload with denied MIME type → #INVALID_INPUT; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());
    const caught = (await callDrive(ext, 'drive_upload', {
      content: BASE64_100,
      filename: 'evil.bin',
      options: { mime_type: 'application/x-evil' },
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toBe(
      "google: MIME type 'application/x-evil' not allowed"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// EC-9 / BC-8: maxUploadBytes
// ============================================================

describe('EC-9 / BC-8: maxUploadBytes enforcement', () => {
  const config = {
    auth: { type: 'bearer' as const, token: 'test-token' },
    capabilities: {
      drive: {
        read: true,
        list: true,
        upload: true,
        download: true,
        share: true,
        delete: true,
      },
    },
    drive: { maxUploadBytes: 100 },
  };

  it('drive_upload with 101-byte content → #INVALID_INPUT "file exceeds maximum"; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());
    const caught = (await callDrive(ext, 'drive_upload', {
      content: BASE64_101,
      filename: 'big.bin',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught as RillValue).message).toBe(
      'google: file exceeds maximum upload size (100 bytes)'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('BC-8: drive_upload with exactly 100-byte content → succeeds (inclusive boundary)', async () => {
    const ext = createGoogleWorkspaceExtension(config, makeFactoryCtx());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'u1',
          name: 'ok.bin',
          mimeType: 'application/octet-stream',
        }),
    }) as typeof fetch;

    // Must not throw
    const result = (await callDrive(ext, 'drive_upload', {
      content: BASE64_100,
      filename: 'ok.bin',
    })) as Record<string, unknown>;

    expect(result['id']).toBe('u1');
  });
});

// ============================================================
// EC-10: Invalid role for drive_share
// ============================================================

describe('EC-10: invalid role for drive_share', () => {
  it('drive_share with role="invalid-role" → #INVALID_INPUT with role message; no fetch', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const caught = (await callDrive(ext, 'drive_share', {
      file_id: 'f1',
      email: 'user@example.com',
      role: 'invalid-role',
    })) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught as RillValue).message).toBe(
      "google: drive.share role must be 'reader', 'commenter', or 'writer'"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// HTTP error mapping [EC-14, EC-15, EC-17, EC-18]
// ============================================================

// ============================================================
// Integration depth: AC-13 subsystem field verification
// ============================================================

describe('AC-13: drive events include subsystem field', () => {
  it('drive_list emits event with subsystem extension:google-workspace [AC-13]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ files: [] }),
    }) as typeof fetch;

    await getCallable(ext, 'drive_list').fn(
      {} as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledOnce();
    const payload = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload['event']).toBe('google:drive:list');
    expect(payload['subsystem']).toBe('extension:google-workspace');
    expect(typeof payload['duration']).toBe('number');
  });

  it('drive_upload emits event with subsystem extension:google-workspace [AC-13]', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: 'u1', name: 'f.txt', mimeType: 'text/plain' }),
    }) as typeof fetch;

    await getCallable(ext, 'drive_upload').fn(
      { content: BASE64_100, filename: 'f.txt' } as Record<
        string,
        import('@rcrsr/rill').RillValue
      >,
      ctx
    );

    const payload = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload['subsystem']).toBe('extension:google-workspace');
  });
});

// ============================================================
// Integration depth: AC-11 AbortSignal verification
// ============================================================

describe('AC-11: drive callables pass AbortSignal to fetch', () => {
  it('drive_download passes a combined AbortSignal instance [AC-11]', async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi
      .fn()
      .mockImplementation((_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        const emptyBuf = new ArrayBuffer(0);
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(emptyBuf),
        });
      }) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'drive_download').fn(
      { file_id: 'f1' } as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    // AC-11: signal must be an AbortSignal instance (combined controller + 30s timeout)
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('drive_list passes a combined AbortSignal instance [AC-11]', async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi
      .fn()
      .mockImplementation((_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ files: [] }),
        });
      }) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'drive_list').fn(
      {} as Record<string, import('@rcrsr/rill').RillValue>,
      ctx
    );

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });
});

// ============================================================
// HTTP error mapping [EC-14, EC-15, EC-17, EC-18]
// ============================================================

describe('HTTP error mapping for drive_list', () => {
  it('EC-14: 401 → #AUTH "google: invalid Drive token"', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as typeof fetch;

    const caught = (await callDrive(ext, 'drive_list', {})) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('AUTH');
    expect(getStatus(caught).message).toBe('google: invalid Drive token');
  });

  it('EC-15: 403 → #FORBIDDEN "google: insufficient Drive scopes for list"', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as typeof fetch;

    const caught = (await callDrive(ext, 'drive_list', {})) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe(
      'google: insufficient Drive scopes for list'
    );
  });

  it('EC-17: 429 → #RATE_LIMIT "google: rate limit exceeded; retry after delay"', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }) as typeof fetch;

    const caught = (await callDrive(ext, 'drive_list', {})) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('RATE_LIMIT');
    expect(getStatus(caught).message).toBe(
      'google: rate limit exceeded; retry after delay'
    );
  });

  it('EC-18: 503 → #UNAVAILABLE "google: Drive server error (503); temporarily unavailable"', async () => {
    const ext = createGoogleWorkspaceExtension(
      DRIVE_ALL_CONFIG,
      makeFactoryCtx()
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const caught = (await callDrive(ext, 'drive_list', {})) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('UNAVAILABLE');
    expect(getStatus(caught as RillValue).message).toBe(
      'google: Drive server error (503); temporarily unavailable'
    );
  });
});
