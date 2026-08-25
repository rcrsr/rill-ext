/**
 * S3 file system extension for rill.
 * Provides file system operations backed by S3-compatible storage.
 */

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { S3FsConfig, S3FsMountConfig } from './types.js';
import { createRequire } from 'node:module';
import {
  RuntimeError,
  RuntimeHaltSignal,
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionConfigSchema,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type ExtensionManifest,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { FsExtensionContract } from '@rcrsr/rill-ext-fs-shared';
import { p } from '@rcrsr/rill-ext-param-shared';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

const PROVIDER = 'fs-s3';

// ============================================================
// PUBLIC TYPES
// ============================================================
export type { S3FsMountConfig, S3Credentials, S3FsConfig } from './types.js';

// ============================================================
// ERROR MAPPING
// ============================================================

interface S3ErrorLike {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

function mapS3Error(ctx: RuntimeContext, error: unknown): RillValue {
  if (error instanceof RuntimeHaltSignal) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_cancelled', message: 'fs-s3: request cancelled' },
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_timeout', message: 'fs-s3: request timeout' },
    });
  }

  const err = error as S3ErrorLike;
  const message = err?.message ?? String(error);
  const status = err?.$metadata?.httpStatusCode;
  const name = err?.name;

  if (name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchBucket') {
    return ctx.invalidate(error, {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: {
        kind: name === 'NoSuchBucket' ? 'bucket_missing' : 'object_missing',
        name,
        message,
      },
    });
  }

  if (name === 'QuotaExceededException' || status === 507) {
    return ctx.invalidate(error, {
      code: 'QUOTA_EXCEEDED',
      provider: PROVIDER,
      raw: { kind: 'quota_exceeded', name, status, message },
    });
  }

  if (status === 401) {
    return ctx.invalidate(error, {
      code: 'AUTH',
      provider: PROVIDER,
      raw: { kind: 'authentication_failed', status, message },
    });
  }
  if (status === 403 || name === 'AccessDenied') {
    return ctx.invalidate(error, {
      code: 'FORBIDDEN',
      provider: PROVIDER,
      raw: { kind: 'access_denied', name, status, message },
    });
  }
  if (status === 404) {
    return ctx.invalidate(error, {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: { kind: 'object_missing', status, message },
    });
  }
  if (status === 409 || status === 412) {
    return ctx.invalidate(error, {
      code: 'CONFLICT',
      provider: PROVIDER,
      raw: { kind: 'conflict', status, message },
    });
  }
  if (status === 429) {
    return ctx.invalidate(error, {
      code: 'RATE_LIMIT',
      provider: PROVIDER,
      raw: { kind: 'rate_limit_exceeded', status, message },
    });
  }
  if (status !== undefined && status >= 500) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'server_error', status, message },
    });
  }

  if (error instanceof TypeError) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'connection_failed', message },
    });
  }

  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'unknown_error', name, status, message },
  });
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create S3 filesystem extension with S3-compatible storage backend.
 */
export function createS3FsExtension(
  config: S3FsConfig,
  ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  if (!config.region || config.region.trim() === '') {
    throw new RuntimeError(
      'RILL-R001',
      'S3 configuration requires non-empty region'
    );
  }

  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new RuntimeError(
      'RILL-R001',
      'S3 configuration requires at least one mount'
    );
  }

  if (config.endpoint !== undefined) {
    if (typeof config.endpoint !== 'string' || config.endpoint.trim() === '') {
      throw new RuntimeError(
        'RILL-R001',
        'S3 endpoint must be a non-empty string'
      );
    }
    try {
      new URL(config.endpoint);
    } catch {
      throw new RuntimeError(
        'RILL-R001',
        `S3 endpoint must be a valid URL: ${config.endpoint}`
      );
    }
  }

  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
    endpoint?: string;
    forcePathStyle?: boolean;
  } = {
    region: config.region,
  };

  if (config.credentials !== undefined)
    clientConfig.credentials = config.credentials;
  if (config.endpoint !== undefined) clientConfig.endpoint = config.endpoint;
  if (config.forcePathStyle !== undefined)
    clientConfig.forcePathStyle = config.forcePathStyle;

  const s3Client = new S3Client(clientConfig);

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    s3Client.destroy();
  };

  if (ctx?.signal) {
    if (ctx.signal.aborted) {
      void dispose();
    } else {
      ctx.signal.addEventListener(
        'abort',
        () => {
          void dispose();
        },
        { once: true }
      );
    }
  }

  function requestSignal(): AbortSignal {
    return ctx?.signal ?? new AbortController().signal;
  }

  function disposedInvalid(runCtx: RuntimeContext): RillValue {
    return runCtx.invalidate(new Error('S3 fs extension disposed'), {
      code: 'DISPOSED',
      provider: PROVIDER,
      raw: { kind: 'extension_disposed' },
    });
  }

  // ============================================================
  // HELPERS
  // ============================================================

  type ParsedPath =
    | {
        ok: true;
        mount: S3FsMountConfig;
        mountName: string;
        relativePath: string;
        key: string;
      }
    | { ok: false; invalid: RillValue };

  const parseMountPath = (
    runCtx: RuntimeContext,
    fullPath: string
  ): ParsedPath => {
    const normalized = fullPath.startsWith('/') ? fullPath.slice(1) : fullPath;
    const sortedNames = Object.keys(config.mounts).sort(
      (a, b) => b.length - a.length
    );

    for (const name of sortedNames) {
      if (normalized === name) {
        const mount = config.mounts[name]!;
        return {
          ok: true,
          mount,
          mountName: name,
          relativePath: '',
          key: mount.prefix,
        };
      }
      if (normalized.startsWith(name + '/')) {
        const mount = config.mounts[name]!;
        const relativePath = normalized.slice(name.length + 1);
        return {
          ok: true,
          mount,
          mountName: name,
          relativePath,
          key: mount.prefix + relativePath,
        };
      }
    }

    return {
      ok: false,
      invalid: runCtx.invalidate(
        new Error(`unknown mount in path: ${fullPath}`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'unknown_mount',
            path: fullPath,
            availableMounts: Object.keys(config.mounts),
          },
        }
      ),
    };
  };

  const checkMode = (
    runCtx: RuntimeContext,
    mount: S3FsMountConfig,
    operation: 'read' | 'write'
  ): RillValue | null => {
    if (mount.mode === 'read-write') return null;
    if (mount.mode === 'read' && operation === 'read') return null;
    if (mount.mode === 'write' && operation === 'write') return null;
    return runCtx.invalidate(
      new Error(
        `mount does not permit ${operation} operations (mode: ${mount.mode})`
      ),
      {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'mode_not_permitted', mode: mount.mode, operation },
      }
    );
  };

  const checkFileSize = (
    runCtx: RuntimeContext,
    size: number,
    mount: S3FsMountConfig,
    key: string
  ): RillValue | null => {
    const max = mount.maxFileSize ?? 10485760;
    if (size > max) {
      return runCtx.invalidate(
        new Error(`file exceeds size limit (${size} > ${max} bytes): ${key}`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'file_too_large', size, maxFileSize: max, key },
        }
      );
    }
    return null;
  };

  const matchesGlob = (filename: string, pattern: string): boolean => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.') && !pattern.includes('{')) {
      const ext = pattern.slice(1);
      return filename.endsWith(ext);
    }
    if (pattern.startsWith('*.{') && pattern.endsWith('}')) {
      const extensionsStr = pattern.slice(3, -1);
      const extensions = extensionsStr.split(',').map((e) => `.${e.trim()}`);
      return extensions.some((ext) => filename.endsWith(ext));
    }
    if (pattern.startsWith('**/')) {
      return matchesGlob(filename, pattern.slice(3));
    }
    return false;
  };

  const getFilename = (key: string): string => {
    const parts = key.split('/');
    return parts[parts.length - 1] ?? '';
  };

  const streamToString = async (
    runCtx: RuntimeContext,
    output: GetObjectCommandOutput
  ): Promise<string | RillValue> => {
    if (!output.Body) {
      return runCtx.invalidate(new Error('S3 response body is empty'), {
        code: 'PROTOCOL',
        provider: PROVIDER,
        raw: { kind: 'empty_body' },
      });
    }
    return await output.Body.transformToString();
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  const read: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const modeCheck = checkMode(runCtx, mount, 'read');
    if (modeCheck) return modeCheck;

    try {
      const headResult = await s3Client.send(
        new HeadObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      const size = headResult.ContentLength ?? 0;
      const sizeCheck = checkFileSize(runCtx, size, mount, key);
      if (sizeCheck) return sizeCheck;

      const getResult = await s3Client.send(
        new GetObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      const content = await streamToString(runCtx, getResult);
      return content;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const write: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const content = args['content'] as string;
    const modeCheck = checkMode(runCtx, mount, 'write');
    if (modeCheck) return modeCheck;
    const contentSize = Buffer.byteLength(content, 'utf-8');
    const sizeCheck = checkFileSize(runCtx, contentSize, mount, key);
    if (sizeCheck) return sizeCheck;

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: mount.bucket,
          Key: key,
          Body: content,
          ContentType: 'text/plain; charset=utf-8',
        }),
        { abortSignal: requestSignal() }
      );
      return String(contentSize);
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const append: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const content = args['content'] as string;
    const modeCheck = checkMode(runCtx, mount, 'write');
    if (modeCheck) return modeCheck;

    let existingContent = '';
    try {
      const getResult = await s3Client.send(
        new GetObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      const stream = await streamToString(runCtx, getResult);
      if (typeof stream !== 'string') return stream;
      existingContent = stream;
    } catch (error) {
      const name = (error as S3ErrorLike)?.name;
      if (name !== 'NoSuchKey' && name !== 'NotFound') {
        return mapS3Error(runCtx, error);
      }
    }

    const newContent = existingContent + content;
    const contentSize = Buffer.byteLength(newContent, 'utf-8');
    const sizeCheck = checkFileSize(runCtx, contentSize, mount, key);
    if (sizeCheck) return sizeCheck;

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: mount.bucket,
          Key: key,
          Body: newContent,
          ContentType: 'text/plain; charset=utf-8',
        }),
        { abortSignal: requestSignal() }
      );
      return String(Buffer.byteLength(content, 'utf-8'));
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const list: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const modeCheck = checkMode(runCtx, mount, 'read');
    if (modeCheck) return modeCheck;

    const prefix = key;
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';

    try {
      const result = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: mount.bucket,
          Prefix: normalizedPrefix,
          Delimiter: '/',
        }),
        { abortSignal: requestSignal() }
      );

      const items: RillValue[] = [];

      if (result.Contents) {
        for (const obj of result.Contents) {
          if (!obj.Key || obj.Key === normalizedPrefix) continue;
          const filename = getFilename(obj.Key);
          if (mount.glob && !matchesGlob(filename, mount.glob)) continue;
          items.push({ name: filename, type: 'file', size: obj.Size ?? 0 });
        }
      }

      if (result.CommonPrefixes) {
        for (const cp of result.CommonPrefixes) {
          if (!cp.Prefix) continue;
          const dirName = cp.Prefix.slice(normalizedPrefix.length).replace(
            /\/$/,
            ''
          );
          items.push({ name: dirName, type: 'directory', size: 0 });
        }
      }

      return items;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const find: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const pattern = (args['pattern'] as string | undefined) ?? '*';
    const modeCheck = checkMode(runCtx, mount, 'read');
    if (modeCheck) return modeCheck;

    const results: string[] = [];
    let continuationToken: string | undefined;

    try {
      do {
        const result = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: mount.bucket,
            Prefix: key,
            ContinuationToken: continuationToken,
          }),
          { abortSignal: requestSignal() }
        );

        if (result.Contents) {
          for (const obj of result.Contents) {
            if (!obj.Key) continue;
            const filename = getFilename(obj.Key);
            if (matchesGlob(filename, pattern)) {
              if (!mount.glob || matchesGlob(filename, mount.glob)) {
                const relativePath = obj.Key.slice(mount.prefix.length);
                results.push(relativePath);
              }
            }
          }
        }

        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      return results;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const exists: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const modeCheck = checkMode(runCtx, mount, 'read');
    if (modeCheck) return modeCheck;

    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      return true;
    } catch (error) {
      const name = (error as S3ErrorLike)?.name;
      const status = (error as S3ErrorLike)?.$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404)
        return false;
      return mapS3Error(runCtx, error);
    }
  };

  const remove: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const modeCheck = checkMode(runCtx, mount, 'write');
    if (modeCheck) return modeCheck;

    try {
      try {
        await s3Client.send(
          new HeadObjectCommand({ Bucket: mount.bucket, Key: key }),
          { abortSignal: requestSignal() }
        );
      } catch (error) {
        const name = (error as S3ErrorLike)?.name;
        const status = (error as S3ErrorLike)?.$metadata?.httpStatusCode;
        if (name === 'NotFound' || name === 'NoSuchKey' || status === 404)
          return false;
        return mapS3Error(runCtx, error);
      }

      await s3Client.send(
        new DeleteObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      return true;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const stat: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    const { mount, key } = parsed;
    const modeCheck = checkMode(runCtx, mount, 'read');
    if (modeCheck) return modeCheck;

    try {
      const result = await s3Client.send(
        new HeadObjectCommand({ Bucket: mount.bucket, Key: key }),
        { abortSignal: requestSignal() }
      );
      const filename = getFilename(key);
      return {
        name: filename,
        type: 'file',
        size: result.ContentLength ?? 0,
        modified: result.LastModified?.toISOString() ?? '',
      };
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const mkdir: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const parsed = parseMountPath(runCtx, args['path'] as string);
    if (!parsed.ok) return parsed.invalid;
    return true;
  };

  const copy: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const src = parseMountPath(runCtx, args['src'] as string);
    if (!src.ok) return src.invalid;
    const dest = parseMountPath(runCtx, args['dest'] as string);
    if (!dest.ok) return dest.invalid;

    if (src.mountName !== dest.mountName) {
      return runCtx.invalidate(
        new Error(
          `copy requires same mount for src and dest (got "${src.mountName}" and "${dest.mountName}")`
        ),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'cross_mount_copy',
            srcMount: src.mountName,
            destMount: dest.mountName,
          },
        }
      );
    }

    const srcMode = checkMode(runCtx, src.mount, 'read');
    if (srcMode) return srcMode;
    const destMode = checkMode(runCtx, dest.mount, 'write');
    if (destMode) return destMode;

    try {
      const headResult = await s3Client.send(
        new HeadObjectCommand({ Bucket: src.mount.bucket, Key: src.key }),
        { abortSignal: requestSignal() }
      );
      const size = headResult.ContentLength ?? 0;
      const sizeCheck = checkFileSize(runCtx, size, dest.mount, dest.key);
      if (sizeCheck) return sizeCheck;

      await s3Client.send(
        new CopyObjectCommand({
          Bucket: src.mount.bucket,
          CopySource: `${src.mount.bucket}/${src.key}`,
          Key: dest.key,
        }),
        { abortSignal: requestSignal() }
      );
      return true;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const move: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const copied = await copy(args, runtimeCtx);
    if (copied !== true) return copied;

    const src = parseMountPath(runCtx, args['src'] as string);
    if (!src.ok) return src.invalid;

    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: src.mount.bucket, Key: src.key }),
        { abortSignal: requestSignal() }
      );
      return true;
    } catch (error) {
      return mapS3Error(runCtx, error);
    }
  };

  const mountsList: CallableFn = async () => {
    const result: RillValue[] = [];
    for (const [name, mount] of Object.entries(config.mounts)) {
      result.push({
        name,
        mode: mount.mode,
        glob: mount.glob ?? '',
        bucket: mount.bucket,
        prefix: mount.prefix,
      });
    }
    return result;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const fnDict: {
    read: RillFunction;
    write: RillFunction;
    append: RillFunction;
    list: RillFunction;
    find: RillFunction;
    exists: RillFunction;
    remove: RillFunction;
    stat: RillFunction;
    mkdir: RillFunction;
    copy: RillFunction;
    move: RillFunction;
    mounts: RillFunction;
  } = {
    read: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: read,
      annotations: { description: 'Read file contents from S3' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    write: {
      params: [
        p.str('path', 'Combined /mount/path'),
        p.str('content', 'Content to write'),
      ],
      fn: write,
      annotations: { description: 'Write file to S3, replacing if exists' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    append: {
      params: [
        p.str('path', 'Combined /mount/path'),
        p.str('content', 'Content to append'),
      ],
      fn: append,
      annotations: { description: 'Append content to file in S3' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    list: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: list,
      annotations: { description: 'List directory contents in S3' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            name: { type: { kind: 'string' } },
            type: { type: { kind: 'string' } },
            size: { type: { kind: 'number' } },
          },
        },
      }),
    },
    find: {
      params: [
        p.str('path', 'Combined /mount/path base directory'),
        {
          ...p.str('pattern', 'Glob pattern for filtering'),
          defaultValue: '*',
        },
      ],
      fn: find,
      annotations: { description: 'Recursive file search in S3' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'string' },
      }),
    },
    exists: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: exists,
      annotations: { description: 'Check if file exists in S3' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    remove: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: remove,
      annotations: { description: 'Delete file from S3' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    stat: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: stat,
      annotations: { description: 'Get file metadata from S3' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          type: { type: { kind: 'string' } },
          size: { type: { kind: 'number' } },
          modified: { type: { kind: 'string' } },
        },
      }),
    },
    mkdir: {
      params: [p.str('path', 'Combined /mount/path')],
      fn: mkdir,
      annotations: { description: 'Create directory (no-op for S3)' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    copy: {
      params: [
        p.str('src', 'Source as /mount/path'),
        p.str('dest', 'Destination as /mount/path'),
      ],
      fn: copy,
      annotations: { description: 'Copy file within S3' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    move: {
      params: [
        p.str('src', 'Source as /mount/path'),
        p.str('dest', 'Destination as /mount/path'),
      ],
      fn: move,
      annotations: { description: 'Move file within S3' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    mounts: {
      params: [],
      fn: mountsList,
      annotations: { description: 'List configured S3 mounts' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            name: { type: { kind: 'string' } },
            mode: { type: { kind: 'string' } },
            glob: { type: { kind: 'string' } },
            bucket: { type: { kind: 'string' } },
            prefix: { type: { kind: 'string' } },
          },
        },
      }),
    },
  };

  const callableDict = {
    read: toCallable(fnDict.read),
    write: toCallable(fnDict.write),
    append: toCallable(fnDict.append),
    list: toCallable(fnDict.list),
    find: toCallable(fnDict.find),
    exists: toCallable(fnDict.exists),
    remove: toCallable(fnDict.remove),
    stat: toCallable(fnDict.stat),
    mkdir: toCallable(fnDict.mkdir),
    copy: toCallable(fnDict.copy),
    move: toCallable(fnDict.move),
    mounts: toCallable(fnDict.mounts),
  } satisfies FsExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  region: { type: 'string', required: true },
  endpoint: { type: 'string' },
  forcePathStyle: { type: 'boolean' },
  mounts: { type: 'string' },
};

// ============================================================
// VERSION
// ============================================================
export const VERSION = _pkg.version;

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: createS3FsExtension,
  configSchema,
  version: VERSION,
};
