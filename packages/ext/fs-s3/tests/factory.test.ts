/**
 * Tests for S3 fs extension factory.
 * Validates configuration, S3 client initialization, and function exports.
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue } from '@rcrsr/rill';
import { createS3FsExtension } from '../src/index.js';
import type { S3FsConfig } from '../src/types.js';
import { makeFactoryCtx } from './_setup.js';

type FnDefView = {
  params: unknown[];
  fn: unknown;
  annotations?: Record<string, unknown>;
  returnType: unknown;
};

function getDef(view: Record<string, FnDefView>, name: string): FnDefView {
  const def = view[name];
  if (def === undefined) {
    throw new Error(`function ${name} missing from extension value`);
  }
  return def;
}

describe('createS3FsExtension', () => {
  describe('configuration validation', () => {
    it('throws for missing region', () => {
      const config: Omit<S3FsConfig, 'region'> = {
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() =>
        createS3FsExtension(config as S3FsConfig, makeFactoryCtx())
      ).toThrow('region');
    });

    it('throws for empty region', () => {
      const config: S3FsConfig = {
        region: '',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'region'
      );
    });

    it('throws for whitespace-only region', () => {
      const config: S3FsConfig = {
        region: '   ',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'region'
      );
    });

    it('throws for missing mounts', () => {
      const config = {
        region: 'us-west-2',
      } as S3FsConfig;

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'at least one mount'
      );
    });

    it('throws for empty mounts object', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        mounts: {},
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'at least one mount'
      );
    });

    it('throws for invalid endpoint (empty string)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: '',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'non-empty string'
      );
    });

    it('throws for invalid endpoint (whitespace only)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: '   ',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'non-empty string'
      );
    });

    it('throws for invalid endpoint (malformed URL)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        endpoint: 'not-a-url',
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      expect(() => createS3FsExtension(config, makeFactoryCtx())).toThrow(
        'valid URL'
      );
    });
  });

  describe('valid configuration acceptance', () => {
    it('accepts minimal AWS S3 configuration', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts S3-compatible service configuration (MinIO)', () => {
      const config: S3FsConfig = {
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
        },
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        mounts: {
          local: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts Cloudflare R2 configuration', () => {
      const config: S3FsConfig = {
        region: 'auto',
        credentials: {
          accessKeyId: 'r2-key',
          secretAccessKey: 'r2-secret',
        },
        endpoint: 'https://account123.r2.cloudflarestorage.com',
        mounts: {
          storage: {
            mode: 'read-write',
            bucket: 'my-r2-bucket',
            prefix: 'app-data/',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts configuration without credentials (uses default provider chain)', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts multiple mounts', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'uploads-bucket',
            prefix: 'user-files/',
          },
          backups: {
            mode: 'read',
            bucket: 'backups-bucket',
            prefix: 'database/',
          },
          logs: {
            mode: 'write',
            bucket: 'logs-bucket',
            prefix: 'app-logs/',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts mount with glob pattern', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          images: {
            mode: 'read-write',
            bucket: 'assets-bucket',
            prefix: 'images/',
            glob: '*.{jpg,png,gif}',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });

    it('accepts mount with custom maxFileSize', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          uploads: {
            mode: 'read-write',
            bucket: 'uploads-bucket',
            prefix: 'files/',
            maxFileSize: 5242880, // 5 MB
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(
        (ext.value as unknown as Record<string, unknown>)['read']
      ).toBeDefined();
      ext.dispose?.();
    });
  });

  describe('function exports', () => {
    it('exports all 12 filesystem functions', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      const v = ext.value as unknown as Record<string, FnDefView>;

      // Verify all 12 functions exist
      expect(v['read']).toBeDefined();
      expect(v['write']).toBeDefined();
      expect(v['append']).toBeDefined();
      expect(v['list']).toBeDefined();
      expect(v['find']).toBeDefined();
      expect(v['exists']).toBeDefined();
      expect(v['remove']).toBeDefined();
      expect(v['stat']).toBeDefined();
      expect(v['mkdir']).toBeDefined();
      expect(v['copy']).toBeDefined();
      expect(v['move']).toBeDefined();
      expect(v['mounts']).toBeDefined();

      ext.dispose?.();
    });

    it('all functions have correct HostFunctionDefinition structure', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());
      const v = ext.value as unknown as Record<string, FnDefView>;

      // Verify structure for read function (all follow same pattern)
      expect(getDef(v, 'read').params).toBeDefined();
      expect(Array.isArray(getDef(v, 'read').params)).toBe(true);
      expect(getDef(v, 'read').params.length).toBeGreaterThan(0);
      expect(getDef(v, 'read').fn).toBeTypeOf('function');
      expect(getDef(v, 'read').annotations?.['description']).toBeTypeOf(
        'string'
      );
      expect(getDef(v, 'read').returnType).toEqual(
        structureToTypeValue({ kind: 'string' })
      );

      // Verify structure for write function
      expect(getDef(v, 'write').params).toBeDefined();
      expect(Array.isArray(getDef(v, 'write').params)).toBe(true);
      expect(getDef(v, 'write').fn).toBeTypeOf('function');
      expect(getDef(v, 'write').annotations?.['description']).toBeTypeOf(
        'string'
      );
      expect(getDef(v, 'write').returnType).toEqual(
        structureToTypeValue({ kind: 'string' })
      );

      // Verify structure for mounts function (no params)
      expect(getDef(v, 'mounts').params).toBeDefined();
      expect(Array.isArray(getDef(v, 'mounts').params)).toBe(true);
      expect(getDef(v, 'mounts').params.length).toBe(0);
      expect(getDef(v, 'mounts').fn).toBeTypeOf('function');
      expect(getDef(v, 'mounts').annotations?.['description']).toBeTypeOf(
        'string'
      );
      expect(getDef(v, 'mounts').returnType).toEqual(
        structureToTypeValue({
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
        })
      );

      ext.dispose?.();
    });

    it('exports dispose function', () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());

      expect(ext.dispose).toBeDefined();
      expect(ext.dispose).toBeTypeOf('function');

      ext.dispose?.();
    });
  });

  describe('dispose lifecycle', () => {
    it('handles dispose without error', async () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());

      await expect(ext.dispose?.()).resolves.toBeUndefined();
    });

    it('is idempotent (can call dispose multiple times)', async () => {
      const config: S3FsConfig = {
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        mounts: {
          test: {
            mode: 'read-write',
            bucket: 'test-bucket',
            prefix: '',
          },
        },
      };

      const ext = createS3FsExtension(config, makeFactoryCtx());

      await expect(ext.dispose?.()).resolves.toBeUndefined();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
    });
  });
});
