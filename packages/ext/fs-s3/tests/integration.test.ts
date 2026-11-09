/**
 * Integration tests for S3 fs contract functions.
 * Tests acceptance criteria for MinIO S3-compatible service.
 *
 * SETUP REQUIRED:
 * - MinIO server running on localhost:9000
 * - Access key: minioadmin
 * - Secret key: minioadmin
 * - Bucket 'test-bucket' created
 *
 * Tests skip gracefully if MinIO is unavailable, unless
 * RILL_EXT_REQUIRE_SERVICES=1, in which case the suite fails at load.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createS3FsExtension } from '../src/index.js';
import type { S3FsConfig } from '../src/types.js';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import {
  assertServiceAvailable,
  makeFactoryCtx,
  makeRuntimeCtx,
} from './_setup.js';

// MinIO configuration
const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_REGION = 'us-east-1';
const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';
const TEST_BUCKET = 'test-bucket';

/**
 * Check if MinIO is reachable by creating the test bucket (idempotent).
 */
async function isMinIOAvailable(): Promise<boolean> {
  const client = new S3Client({
    region: MINIO_REGION,
    endpoint: MINIO_ENDPOINT,
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
    forcePathStyle: true,
  });

  try {
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }), {
      abortSignal: AbortSignal.timeout(3000),
    });
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'BucketAlreadyOwnedByYou' ||
        error.name === 'BucketAlreadyExists')
    ) {
      return true;
    }
    return false;
  } finally {
    client.destroy();
  }
}

/**
 * Create MinIO config for testing.
 */
function createMinIOConfig(
  mounts: Record<string, S3FsConfig['mounts'][string]>
): S3FsConfig {
  return {
    region: MINIO_REGION,
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
    endpoint: MINIO_ENDPOINT,
    forcePathStyle: true,
    mounts,
  };
}

const minioAvailable = await isMinIOAvailable();
assertServiceAvailable('MinIO', minioAvailable);

const extensions: Array<{
  dispose?: (() => void | Promise<void>) | undefined;
}> = [];

/**
 * Create an extension that is disposed after the current test.
 */
function open(config: S3FsConfig): ReturnType<typeof createS3FsExtension> {
  const ext = createS3FsExtension(config, makeFactoryCtx());
  extensions.push(ext);
  return ext;
}

type FsExt = ReturnType<typeof createS3FsExtension>;

/**
 * Call a named host function and return its raw result (valid or invalid).
 */
async function call(
  ext: FsExt,
  name: string,
  args: Record<string, RillValue>
): Promise<RillValue> {
  const callable = (ext.value as Record<string, ApplicationCallable>)[name];
  if (callable === undefined) {
    throw new Error(`function ${name} missing from extension value`);
  }
  const result = await callable.fn(args, makeRuntimeCtx());
  return result;
}

/**
 * Call a host function and fail the test if the result is an invalid value.
 */
async function callOk(
  ext: FsExt,
  name: string,
  args: Record<string, RillValue>
): Promise<RillValue> {
  const result = await call(ext, name, args);
  expect(
    isInvalid(result),
    `${name} returned invalid: ${isInvalid(result) ? JSON.stringify(getStatus(result).raw) : ''}`
  ).toBe(false);
  return result;
}

/**
 * Assert a host function returns an invalid value with the given atom and raw.kind.
 */
async function expectInvalid(
  ext: FsExt,
  name: string,
  args: Record<string, RillValue>,
  code: string,
  kind: string
): Promise<void> {
  const result = await call(ext, name, args);
  expect(isInvalid(result)).toBe(true);
  const status = getStatus(result);
  expect(status.code.name).toBe(code);
  expect(status.raw['kind']).toBe(kind);
}

function asList(value: RillValue): RillValue[] {
  expect(Array.isArray(value)).toBe(true);
  return value as RillValue[];
}

afterEach(async () => {
  for (const ext of extensions) {
    await ext.dispose?.();
  }
  extensions.length = 0;
});

describe.skipIf(!minioAvailable)('Integration Tests', () => {
  describe('AC-1: Backend Swap Without Script Changes', () => {
    it('executes identical operations with same results', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac1-backend-swap/',
        },
      });

      const ext = open(config);

      // Perform series of write operations
      await callOk(ext, 'write', {
        path: '/storage/report.txt',
        content: 'Initial content',
      });
      await callOk(ext, 'write', {
        path: '/storage/data.json',
        content: '{"count":42}',
      });
      await callOk(ext, 'append', {
        path: '/storage/report.txt',
        content: '\nAppended line',
      });

      // Verify read operations
      const report = await callOk(ext, 'read', { path: '/storage/report.txt' });
      expect(report).toBe('Initial content\nAppended line');

      const data = await callOk(ext, 'read', { path: '/storage/data.json' });
      expect(data).toBe('{"count":42}');

      // Verify exists operation
      expect(await callOk(ext, 'exists', { path: '/storage/report.txt' })).toBe(
        true
      );
      expect(
        await callOk(ext, 'exists', { path: '/storage/missing.txt' })
      ).toBe(false);

      // Verify list operation
      const files = await callOk(ext, 'list', { path: '/storage' });
      expect(files).toHaveLength(2);
      expect(files).toContainEqual({
        name: 'report.txt',
        type: 'file',
        size: expect.any(Number) as unknown,
      });

      // Verify stat operation
      const stat = await callOk(ext, 'stat', { path: '/storage/report.txt' });
      expect(stat).toEqual({
        name: expect.any(String) as unknown,
        type: 'file',
        size: expect.any(Number) as unknown,
        modified: expect.any(String) as unknown,
      });

      // Verify remove operation
      expect(await callOk(ext, 'remove', { path: '/storage/data.json' })).toBe(
        true
      );
      expect(await callOk(ext, 'exists', { path: '/storage/data.json' })).toBe(
        false
      );
    });
  });

  describe('AC-4: S3 Multi-Server File Access', () => {
    it('reads file written by another client instance', async () => {
      const config = createMinIOConfig({
        output: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac4-multi-server/',
        },
      });

      // Client A writes file
      const clientA = open(config);
      await callOk(clientA, 'write', {
        path: '/output/report.txt',
        content: 'Server A content',
      });

      // Client B reads file (simulates different server)
      const clientB = open(config);
      const content = await callOk(clientB, 'read', {
        path: '/output/report.txt',
      });

      expect(content).toBe('Server A content');
    });

    it('handles concurrent writes from multiple clients', async () => {
      const config = createMinIOConfig({
        shared: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac4-concurrent/',
        },
      });

      // Simulate 3 concurrent clients writing different files
      const writePromises = Array.from({ length: 3 }, async (_, index) => {
        const client = open(config);
        await callOk(client, 'write', {
          path: `/shared/file-${index}.txt`,
          content: `Content from client ${index}`,
        });
      });

      await Promise.all(writePromises);

      // Verify all writes succeeded
      const reader = open(config);
      const files = await callOk(reader, 'list', { path: '/shared' });

      expect(files).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const content = await callOk(reader, 'read', {
          path: `/shared/file-${i}.txt`,
        });
        expect(content).toBe(`Content from client ${i}`);
      }
    });
  });

  describe('AC-5: S3 Compatible Service Support (MinIO)', () => {
    it('completes full fs operation suite against MinIO', async () => {
      const config = createMinIOConfig({
        test: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac5-full-suite/',
          maxFileSize: 1024,
        },
      });

      const ext = open(config);

      // Test write
      await callOk(ext, 'write', {
        path: '/test/sample.txt',
        content: 'Hello MinIO',
      });

      // Test read
      const content = await callOk(ext, 'read', { path: '/test/sample.txt' });
      expect(content).toBe('Hello MinIO');

      // Test append
      await callOk(ext, 'append', {
        path: '/test/sample.txt',
        content: ' from rill',
      });
      const appended = await callOk(ext, 'read', { path: '/test/sample.txt' });
      expect(appended).toBe('Hello MinIO from rill');

      // Test exists
      expect(await callOk(ext, 'exists', { path: '/test/sample.txt' })).toBe(
        true
      );
      expect(await callOk(ext, 'exists', { path: '/test/missing.txt' })).toBe(
        false
      );

      // Test stat
      const stat = await callOk(ext, 'stat', { path: '/test/sample.txt' });
      expect(stat).toEqual({
        name: expect.any(String) as unknown,
        type: 'file',
        size: expect.any(Number) as unknown,
        modified: expect.any(String) as unknown,
      });

      // Test copy
      expect(
        await callOk(ext, 'copy', {
          src: '/test/sample.txt',
          dest: '/test/sample-copy.txt',
        })
      ).toBe(true);
      const copied = await callOk(ext, 'read', {
        path: '/test/sample-copy.txt',
      });
      expect(copied).toBe('Hello MinIO from rill');

      // Test move
      expect(
        await callOk(ext, 'move', {
          src: '/test/sample-copy.txt',
          dest: '/test/sample-moved.txt',
        })
      ).toBe(true);
      expect(
        await callOk(ext, 'exists', { path: '/test/sample-copy.txt' })
      ).toBe(false);
      expect(
        await callOk(ext, 'exists', { path: '/test/sample-moved.txt' })
      ).toBe(true);

      // Test list
      const files = await callOk(ext, 'list', { path: '/test' });
      expect(asList(files).length).toBeGreaterThanOrEqual(2);

      // Test find (recursive)
      const found = await callOk(ext, 'find', { path: '/test', pattern: '*' });
      expect(asList(found).length).toBeGreaterThanOrEqual(2);

      // Test remove
      expect(await callOk(ext, 'remove', { path: '/test/sample.txt' })).toBe(
        true
      );
      expect(await callOk(ext, 'exists', { path: '/test/sample.txt' })).toBe(
        false
      );

      // Test mkdir (no-op that returns true)
      expect(await callOk(ext, 'mkdir', { path: '/test/subdir' })).toBe(true);

      // Test mounts
      const mounts = await callOk(ext, 'mounts', {});
      expect(mounts).toEqual([
        {
          name: 'test',
          mode: 'read-write',
          glob: '',
          bucket: TEST_BUCKET,
          prefix: 'ac5-full-suite/',
        },
      ]);
    });
  });

  describe('AC-7: Unknown Mount Name', () => {
    it('returns unknown_mount invalid for all fs functions', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac7-unknown-mount/',
        },
        cache: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac7-cache/',
        },
      });

      const ext = open(config);

      // Test all functions throw for unknown mount
      await expectInvalid(
        ext,
        'read',
        { path: '/unknown/file.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'write',
        { path: '/unknown/file.txt', content: 'content' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'append',
        { path: '/unknown/file.txt', content: 'content' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'list',
        { path: '/unknown' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'find',
        { path: '/unknown', pattern: '' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'exists',
        { path: '/unknown/file.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'remove',
        { path: '/unknown/file.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'stat',
        { path: '/unknown/file.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'mkdir',
        { path: '/unknown/dir' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'copy',
        { src: '/unknown/src.txt', dest: '/unknown/dest.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
      await expectInvalid(
        ext,
        'move',
        { src: '/unknown/src.txt', dest: '/unknown/dest.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
    });
  });

  describe('AC-8: Read-Only Mode Enforcement', () => {
    it('returns mode_not_permitted invalid for write operations on read-only mount', async () => {
      const config = createMinIOConfig({
        'readonly-mount': {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly/',
        },
      });

      const ext = open(config);

      // Test all write operations throw
      await expectInvalid(
        ext,
        'write',
        { path: '/readonly-mount/file.txt', content: 'content' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'append',
        { path: '/readonly-mount/file.txt', content: 'content' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'remove',
        { path: '/readonly-mount/file.txt' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'copy',
        {
          src: '/readonly-mount/src.txt',
          dest: '/readonly-mount/dest.txt',
        },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'move',
        {
          src: '/readonly-mount/src.txt',
          dest: '/readonly-mount/dest.txt',
        },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
    });

    it('allows read operations on read-only mount', async () => {
      // Setup: write file with read-write mount
      const writeConfig = createMinIOConfig({
        setup: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly-reads/',
        },
      });

      const writer = open(writeConfig);
      await callOk(writer, 'write', {
        path: '/setup/data.txt',
        content: 'Read-only test',
      });

      // Open as read-only
      const readConfig = createMinIOConfig({
        'readonly-mount': {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac8-readonly-reads/',
        },
      });

      const reader = open(readConfig);

      // Read operations should succeed
      const content = await callOk(reader, 'read', {
        path: '/readonly-mount/data.txt',
      });
      expect(content).toBe('Read-only test');

      expect(
        await callOk(reader, 'exists', { path: '/readonly-mount/data.txt' })
      ).toBe(true);

      const files = await callOk(reader, 'list', { path: '/readonly-mount' });
      expect(files).toHaveLength(1);

      const stat = await callOk(reader, 'stat', {
        path: '/readonly-mount/data.txt',
      });
      expect(stat).toEqual({
        name: expect.any(String) as unknown,
        type: 'file',
        size: expect.any(Number) as unknown,
        modified: expect.any(String) as unknown,
      });
    });
  });

  describe('AC-9, EC-9: File Size Limit Violation', () => {
    it('returns file_too_large invalid when reading file exceeding maxFileSize', async () => {
      // Setup: write large file without limit
      const writeConfig = createMinIOConfig({
        unlimited: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ac9-size-limit/',
        },
      });

      const writer = open(writeConfig);
      const largeContent = 'x'.repeat(2000); // 2KB file
      await callOk(writer, 'write', {
        path: '/unlimited/large.txt',
        content: largeContent,
      });

      // Read with size limit
      const readConfig = createMinIOConfig({
        limited: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ac9-size-limit/',
          maxFileSize: 1024, // 1KB limit
        },
      });

      const reader = open(readConfig);

      // Should throw size error
      await expectInvalid(
        reader,
        'read',
        { path: '/limited/large.txt' },
        'INVALID_INPUT',
        'file_too_large'
      );
    });

    it('returns file_too_large invalid when writing file exceeding maxFileSize', async () => {
      const config = createMinIOConfig({
        limited: {
          mode: 'write',
          bucket: TEST_BUCKET,
          prefix: 'ac9-write-limit/',
          maxFileSize: 100,
        },
      });

      const ext = open(config);

      // Should throw size error
      const largeContent = 'x'.repeat(200);
      await expectInvalid(
        ext,
        'write',
        { path: '/limited/large.txt', content: largeContent },
        'INVALID_INPUT',
        'file_too_large'
      );
    });
  });

  describe('EC-8: File Not Found', () => {
    it('returns NOT_FOUND invalid for read on non-existent file', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec8-not-found/',
        },
      });

      const ext = open(config);

      await expectInvalid(
        ext,
        'read',
        { path: '/storage/missing.txt' },
        'NOT_FOUND',
        'object_missing'
      );
    });

    it('returns false for exists on non-existent file', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec8-exists/',
        },
      });

      const ext = open(config);

      expect(
        await callOk(ext, 'exists', { path: '/storage/missing.txt' })
      ).toBe(false);
    });
  });

  describe('EC-10: Write on Read-Only Mount', () => {
    it('returns mode_not_permitted invalid for all write operations', async () => {
      const config = createMinIOConfig({
        readonly: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec10-readonly/',
        },
      });

      const ext = open(config);

      // All write operations should throw
      await expectInvalid(
        ext,
        'write',
        { path: '/readonly/test.txt', content: 'content' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'append',
        { path: '/readonly/test.txt', content: 'content' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
      await expectInvalid(
        ext,
        'remove',
        { path: '/readonly/test.txt' },
        'INVALID_INPUT',
        'mode_not_permitted'
      );
    });
  });

  describe('EC-11: Parent Directory Missing on S3 Write', () => {
    it('succeeds writing to path with non-existent parent directories', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'write',
          bucket: TEST_BUCKET,
          prefix: 'ec11-no-parent/',
        },
      });

      const ext = open(config);

      // Write to deeply nested path without creating parent directories
      await callOk(ext, 'write', {
        path: '/storage/a/b/c/d/file.txt',
        content: 'content',
      });

      // Verify file was written
      const readConfig = createMinIOConfig({
        storage: {
          mode: 'read',
          bucket: TEST_BUCKET,
          prefix: 'ec11-no-parent/',
        },
      });

      const reader = open(readConfig);
      const content = await callOk(reader, 'read', {
        path: '/storage/a/b/c/d/file.txt',
      });
      expect(content).toBe('content');
    });
  });

  describe('EC-12: mkdir is No-Op Returning True', () => {
    it('returns true without creating directory marker', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec12-mkdir/',
        },
      });

      const ext = open(config);

      // mkdir should return true
      expect(await callOk(ext, 'mkdir', { path: '/storage/subdir' })).toBe(
        true
      );
      expect(await callOk(ext, 'mkdir', { path: '/storage/a/b/c' })).toBe(true);

      // No directory markers should be created
      const files = await callOk(ext, 'list', { path: '/storage' });
      expect(files).toHaveLength(0);
    });
  });

  describe('Unknown mount is invalid', () => {
    it('returns unknown_mount for a path outside configured mounts', async () => {
      const config = createMinIOConfig({
        storage: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec13-mount-error/',
        },
        cache: {
          mode: 'read-write',
          bucket: TEST_BUCKET,
          prefix: 'ec13-cache/',
        },
      });

      const ext = open(config);

      await expectInvalid(
        ext,
        'read',
        { path: '/unknown/file.txt' },
        'INVALID_INPUT',
        'unknown_mount'
      );
    });
  });
});
