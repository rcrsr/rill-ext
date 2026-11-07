/**
 * Tests for kv-file extension behavior specific to the file backend.
 *
 * Generic kv operations are covered by contract.test.ts. This file verifies
 * type-mismatch reporting, persistence, and the size limit on the file store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getStatus,
  isInvalid,
  RuntimeHaltSignal,
  type RillValue,
} from '@rcrsr/rill';
import { createFileKvExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx, fnOf } from './_setup.js';

describe('kv-file functions', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-kv-file-test-'));
    storePath = path.join(tempDir, 'test-store.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('declared mode (with schema)', () => {
    it('returns invalid value for type mismatch', async () => {
      const ext = createFileKvExtension(
        {
          store: storePath,
          schema: { count: { type: 'number', default: 0 } },
        },
        makeFactoryCtx()
      );
      const result = await fnOf(ext, 'set').fn(
        { mount: 'default', key: 'count', value: 'not a number' },
        makeRuntimeCtx()
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expects number/);
    });
  });

  describe('persistence', () => {
    it('flushes to disk on dispose', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await fnOf(ext, 'set').fn(
        { mount: 'default', key: 'k1', value: 'v1' },
        makeRuntimeCtx()
      );
      await ext.dispose!();

      const content = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      expect(content).toEqual({ k1: 'v1' });
    });

    it('loads existing store on creation', async () => {
      await fs.writeFile(storePath, JSON.stringify({ existing: 'data' }));
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await fnOf(ext, 'get').fn(
        { mount: 'default', key: 'existing' },
        makeRuntimeCtx()
      );
      expect(result).toBe('data');
    });

    it('returns invalid value for corrupt store file', async () => {
      await fs.writeFile(storePath, 'not valid json{{{');
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await fnOf(ext, 'get').fn(
        { mount: 'default', key: 'k1' },
        makeRuntimeCtx()
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('UNAVAILABLE');
      expect(status.message).toMatch(/state file corrupt/);
    });
  });

  describe('size limits', () => {
    it('returns invalid value when value exceeds maxValueSize', async () => {
      const ext = createFileKvExtension(
        {
          store: storePath,
          maxValueSize: 10,
        },
        makeFactoryCtx()
      );
      const result = await fnOf(ext, 'set').fn(
        { mount: 'default', key: 'k1', value: 'a'.repeat(100) },
        makeRuntimeCtx()
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/exceeds size limit/);
    });
  });

  describe('dispose', () => {
    it('disposes twice without error', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.dispose!();

      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('throws #DISPOSED on set and leaves the store file unchanged', async () => {
      await fs.writeFile(storePath, JSON.stringify({ existing: 'data' }));
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.dispose!();
      const before = await fs.readFile(storePath);

      let threw = false;
      let thrown: unknown;
      let halt: RuntimeHaltSignal | undefined;
      try {
        await fnOf(ext, 'set').fn(
          { mount: 'default', key: 'k', value: 'v' },
          makeRuntimeCtx()
        );
      } catch (e) {
        threw = true;
        if (e instanceof RuntimeHaltSignal) {
          halt = e;
          thrown = e.value;
        } else {
          thrown = e;
        }
      }

      expect(threw).toBe(true);
      expect(halt).toBeInstanceOf(RuntimeHaltSignal);
      expect(halt?.catchable).toBe(true);
      expect(isInvalid(thrown as RillValue)).toBe(true);
      const status = getStatus(thrown as RillValue);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
      expect(status.provider).toBe('kv-file');
      expect(Buffer.compare(await fs.readFile(storePath), before)).toBe(0);
    });
  });
});
