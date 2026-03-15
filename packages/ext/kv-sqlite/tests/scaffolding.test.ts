/**
 * Basic scaffolding tests for kv-sqlite package.
 * Verifies package structure and exports.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import {
  createSqliteKvExtension,
  VERSION,
  type SqliteKvConfig,
} from '../src/index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('Package scaffolding', () => {
  describe('exports', () => {
    it('exports createSqliteKvExtension factory function', () => {
      expect(createSqliteKvExtension).toBeDefined();
      expect(typeof createSqliteKvExtension).toBe('function');
    });

    it('exports VERSION matching package.json', () => {
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
      expect(VERSION).toBe(_pkg.version);
    });

    it('exports SqliteKvConfig type', () => {
      // Type-only export test - compilation validates this
      const config: SqliteKvConfig = {};
      expect(config).toBeDefined();
    });
  });

  describe('createSqliteKvExtension', () => {
    it('returns ExtensionResult with dispose method', () => {
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: ':memory:',
            table: 'kv_test',
          },
        },
      };
      const result = createSqliteKvExtension(config);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(typeof result.dispose).toBe('function');

      result.dispose?.();
    });

    it('dispose method can be called without errors', () => {
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: ':memory:',
            table: 'kv_test',
          },
        },
      };
      const result = createSqliteKvExtension(config);

      expect(() => result.dispose?.()).not.toThrow();
    });
  });
});
