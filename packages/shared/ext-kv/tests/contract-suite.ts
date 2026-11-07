/**
 * Backend-neutral contract suite for kv extensions.
 *
 * Each backend supplies a harness that builds an extension over fresh,
 * isolated storage; the suite exercises the public host functions only.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type ExtensionFactoryResult,
  type RillValue,
} from '@rcrsr/rill';
import type {
  KvContractHarness,
  KvContractMount,
  SchemaEntry,
} from '../src/types.js';

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_VALUE_SIZE = 102400;

const NAME_SCHEMA: Record<string, SchemaEntry> = {
  name: { type: 'string', default: 'Anonymous' },
  count: { type: 'number', default: 0 },
};

type Mounts = Readonly<Record<string, KvContractMount>>;

function callFn(
  ext: ExtensionFactoryResult,
  name: string,
  args: Record<string, RillValue>
): Promise<RillValue> {
  const callable = (ext.value as Record<string, ApplicationCallable>)[name];
  if (callable === undefined) {
    return Promise.reject(new Error(`extension has no function '${name}'`));
  }
  return Promise.resolve().then(() =>
    callable.fn(args, createRuntimeContext())
  );
}

/** Returns what a call throws or rejects with, or undefined when it resolves. */
async function captureThrown(
  call: () => Promise<RillValue>
): Promise<{ threw: boolean; thrown: unknown }> {
  try {
    await call();
  } catch (e) {
    return { threw: true, thrown: e };
  }
  return { threw: false, thrown: undefined };
}

function expectInvalid(
  result: RillValue,
  code: string,
  messagePart: string
): void {
  expect(isInvalid(result)).toBe(true);
  const status = getStatus(result);
  expect(status.code.name).toBe(code);
  expect(status.message).toContain(messagePart);
}

function jsonBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

/** Registers the shared kv contract cases for one backend. */
export function describeKvContract(
  backend: string,
  harness: KvContractHarness
): void {
  describe(`${backend} kv contract`, () => {
    const created: ExtensionFactoryResult[] = [];

    afterEach(async () => {
      for (const ext of created) {
        await ext.dispose?.();
      }
      created.length = 0;
    });

    function make(mounts: Mounts): ExtensionFactoryResult {
      const ext = harness.createExtension(mounts);
      created.push(ext);
      return ext;
    }

    const state: Mounts = { state: { mode: 'read-write' } };

    describe('get', () => {
      it('returns schema default for missing key in declared mode', async () => {
        const ext = make({
          user: { mode: 'read-write', schema: NAME_SCHEMA },
        });

        expect(await callFn(ext, 'get', { mount: 'user', key: 'name' })).toBe(
          'Anonymous'
        );
        expect(await callFn(ext, 'get', { mount: 'user', key: 'count' })).toBe(
          0
        );
      });

      it('returns empty string for missing key in open mode', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'get', { mount: 'state', key: 'missing' })
        ).toBe('');
      });

      it('returns stored value when key exists', async () => {
        const ext = make(state);
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'name',
          value: 'Alice',
        });

        expect(await callFn(ext, 'get', { mount: 'state', key: 'name' })).toBe(
          'Alice'
        );
      });

      it('rejects a key that is not in the declared schema', async () => {
        const ext = make({
          typed: {
            mode: 'read-write',
            schema: { count: { type: 'number', default: 0 } },
          },
        });

        expectInvalid(
          await callFn(ext, 'get', { mount: 'typed', key: 'unknown' }),
          'INVALID_INPUT',
          'not declared in schema'
        );
      });
    });

    describe('get_or', () => {
      it('returns fallback for missing key', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'get_or', {
            mount: 'state',
            key: 'missing',
            fallback: 'fallback',
          })
        ).toBe('fallback');
      });

      it('returns stored value when key exists', async () => {
        const ext = make(state);
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'key',
          value: 'stored',
        });

        expect(
          await callFn(ext, 'get_or', {
            mount: 'state',
            key: 'key',
            fallback: 'fallback',
          })
        ).toBe('stored');
      });
    });

    describe('set', () => {
      it('returns true and stores the value', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'set', {
            mount: 'state',
            key: 'key',
            value: 'value',
          })
        ).toBe(true);
        expect(await callFn(ext, 'get', { mount: 'state', key: 'key' })).toBe(
          'value'
        );
      });

      it('rejects writes to a read-only mount', async () => {
        const ext = make({ ro: { mode: 'read' } });

        expectInvalid(
          await callFn(ext, 'set', { mount: 'ro', key: 'key', value: 'v' }),
          'INVALID_INPUT',
          "Mount 'ro' is read-only"
        );
      });

      it('rejects a value that exceeds maxValueSize', async () => {
        const ext = make({ limited: { mode: 'read-write', maxValueSize: 10 } });

        expectInvalid(
          await callFn(ext, 'set', {
            mount: 'limited',
            key: 'key',
            value: 'x'.repeat(20),
          }),
          'INVALID_INPUT',
          'exceeds size limit'
        );
      });

      it('rejects a key that is not in the declared schema', async () => {
        const ext = make({
          typed: {
            mode: 'read-write',
            schema: { count: { type: 'number', default: 0 } },
          },
        });

        expectInvalid(
          await callFn(ext, 'set', {
            mount: 'typed',
            key: 'unknown',
            value: 1,
          }),
          'INVALID_INPUT',
          'not declared in schema'
        );
      });

      it('rejects a new key once maxEntries is reached', async () => {
        const ext = make({ small: { mode: 'read-write', maxEntries: 2 } });
        await callFn(ext, 'set', { mount: 'small', key: 'a', value: 1 });
        await callFn(ext, 'set', { mount: 'small', key: 'b', value: 2 });

        expectInvalid(
          await callFn(ext, 'set', { mount: 'small', key: 'c', value: 3 }),
          'INVALID_INPUT',
          'entry limit'
        );
      });

      it('allows updating an existing key at maxEntries', async () => {
        const ext = make({ small: { mode: 'read-write', maxEntries: 2 } });
        await callFn(ext, 'set', { mount: 'small', key: 'a', value: 1 });
        await callFn(ext, 'set', { mount: 'small', key: 'b', value: 2 });

        expect(
          await callFn(ext, 'set', {
            mount: 'small',
            key: 'a',
            value: 'updated',
          })
        ).toBe(true);
        expect(await callFn(ext, 'get', { mount: 'small', key: 'a' })).toBe(
          'updated'
        );
      });
    });

    describe('merge', () => {
      it('merges a partial dict into an existing dict', async () => {
        const ext = make(state);
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'config',
          value: { a: 1, b: 2 },
        });

        expect(
          await callFn(ext, 'merge', {
            mount: 'state',
            key: 'config',
            partial: { b: 3, c: 4 },
          })
        ).toBe(true);
        expect(
          await callFn(ext, 'get', { mount: 'state', key: 'config' })
        ).toEqual({ a: 1, b: 3, c: 4 });
      });

      it('creates a new dict when the key does not exist', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'merge', {
            mount: 'state',
            key: 'new',
            partial: { x: 10 },
          })
        ).toBe(true);
        expect(
          await callFn(ext, 'get', { mount: 'state', key: 'new' })
        ).toEqual({ x: 10 });
      });

      it('rejects merging into a non-dict value', async () => {
        const ext = make(state);
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'string',
          value: 'value',
        });

        expectInvalid(
          await callFn(ext, 'merge', {
            mount: 'state',
            key: 'string',
            partial: { x: 1 },
          }),
          'INVALID_INPUT',
          'Cannot merge into non-dict value'
        );
      });

      it('rejects merging into a read-only mount', async () => {
        const ext = make({ ro: { mode: 'read' } });

        expectInvalid(
          await callFn(ext, 'merge', {
            mount: 'ro',
            key: 'key',
            partial: { x: 1 },
          }),
          'INVALID_INPUT',
          "Mount 'ro' is read-only"
        );
      });

      it('rejects a merge whose result exceeds maxValueSize and keeps the original', async () => {
        const ext = make({
          limited: { mode: 'read-write', maxValueSize: 100 },
        });
        await callFn(ext, 'set', {
          mount: 'limited',
          key: 'data',
          value: { a: 1 },
        });

        expectInvalid(
          await callFn(ext, 'merge', {
            mount: 'limited',
            key: 'data',
            partial: { b: 'x'.repeat(200) },
          }),
          'INVALID_INPUT',
          'exceeds size limit'
        );
        expect(
          await callFn(ext, 'get', { mount: 'limited', key: 'data' })
        ).toEqual({ a: 1 });
      });
    });

    describe('delete', () => {
      it('deletes an existing key and returns true', async () => {
        const ext = make(state);
        await callFn(ext, 'set', { mount: 'state', key: 'key', value: 'v' });

        expect(
          await callFn(ext, 'delete', { mount: 'state', key: 'key' })
        ).toBe(true);
        expect(await callFn(ext, 'has', { mount: 'state', key: 'key' })).toBe(
          false
        );
      });

      it('returns false when the key does not exist', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'delete', { mount: 'state', key: 'missing' })
        ).toBe(false);
      });
    });

    describe('keys', () => {
      it('returns all keys in the mount', async () => {
        const ext = make(state);
        for (const key of ['key1', 'key2', 'key3']) {
          await callFn(ext, 'set', { mount: 'state', key, value: key });
        }

        const keys = await callFn(ext, 'keys', { mount: 'state' });

        expect(keys).toHaveLength(3);
        expect(keys).toEqual(expect.arrayContaining(['key1', 'key2', 'key3']));
      });

      it('returns an empty list for a mount with no keys', async () => {
        const ext = make(state);

        expect(await callFn(ext, 'keys', { mount: 'state' })).toEqual([]);
      });
    });

    describe('has', () => {
      it('returns true when the key exists', async () => {
        const ext = make(state);
        await callFn(ext, 'set', { mount: 'state', key: 'key', value: 'v' });

        expect(await callFn(ext, 'has', { mount: 'state', key: 'key' })).toBe(
          true
        );
      });

      it('returns false when the key does not exist', async () => {
        const ext = make(state);

        expect(
          await callFn(ext, 'has', { mount: 'state', key: 'missing' })
        ).toBe(false);
      });
    });

    describe('clear', () => {
      it('removes all keys in the mount', async () => {
        const ext = make(state);
        for (const key of ['key1', 'key2', 'key3']) {
          await callFn(ext, 'set', { mount: 'state', key, value: key });
        }

        expect(await callFn(ext, 'clear', { mount: 'state' })).toBe(true);
        expect(await callFn(ext, 'keys', { mount: 'state' })).toEqual([]);
      });

      it('restores schema defaults in declared mode', async () => {
        const ext = make({
          user: { mode: 'read-write', schema: NAME_SCHEMA },
        });
        await callFn(ext, 'set', {
          mount: 'user',
          key: 'name',
          value: 'Alice',
        });
        await callFn(ext, 'set', { mount: 'user', key: 'count', value: 42 });

        await callFn(ext, 'clear', { mount: 'user' });

        expect(await callFn(ext, 'get', { mount: 'user', key: 'name' })).toBe(
          'Anonymous'
        );
        expect(await callFn(ext, 'get', { mount: 'user', key: 'count' })).toBe(
          0
        );
      });
    });

    describe('getAll', () => {
      it('returns all entries as a dict', async () => {
        const ext = make(state);
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'key1',
          value: 'value1',
        });
        await callFn(ext, 'set', { mount: 'state', key: 'key2', value: 42 });
        await callFn(ext, 'set', {
          mount: 'state',
          key: 'key3',
          value: { nested: true },
        });

        expect(await callFn(ext, 'getAll', { mount: 'state' })).toEqual({
          key1: 'value1',
          key2: 42,
          key3: { nested: true },
        });
      });

      it('returns an empty dict for a mount with no keys', async () => {
        const ext = make(state);

        expect(await callFn(ext, 'getAll', { mount: 'state' })).toEqual({});
      });
    });

    describe('schema', () => {
      it('returns schema entries in declared mode', async () => {
        const ext = make({
          user: {
            mode: 'read-write',
            schema: {
              name: { type: 'string', default: '', description: 'User name' },
              count: { type: 'number', default: 0 },
            },
          },
        });

        const result = await callFn(ext, 'schema', { mount: 'user' });

        expect(result).toHaveLength(2);
        expect(result).toContainEqual({
          key: 'name',
          type: 'string',
          description: 'User name',
        });
        expect(result).toContainEqual({
          key: 'count',
          type: 'number',
          description: '',
        });
      });

      it('returns an empty list in open mode', async () => {
        const ext = make(state);

        expect(await callFn(ext, 'schema', { mount: 'state' })).toEqual([]);
      });
    });

    describe('mounts', () => {
      it('returns metadata for every configured mount', async () => {
        const ext = make({
          user: {
            mode: 'read-write',
            schema: { name: { type: 'string', default: '' } },
            maxEntries: 1000,
            maxValueSize: 5000,
          },
          cache: { mode: 'read' },
        });

        const result = await callFn(ext, 'mounts', {});

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(
          expect.objectContaining({
            name: 'user',
            mode: 'read-write',
            schema: 'declared',
            max_entries: 1000,
            max_value_size: 5000,
          })
        );
        expect(result).toContainEqual(
          expect.objectContaining({
            name: 'cache',
            mode: 'read',
            schema: 'open',
            max_entries: DEFAULT_MAX_ENTRIES,
            max_value_size: DEFAULT_MAX_VALUE_SIZE,
          })
        );
      });
    });

    describe('unknown mount', () => {
      const unknownMountCalls: ReadonlyArray<{
        fn: string;
        args: Record<string, RillValue>;
      }> = [
        { fn: 'get', args: { key: 'key' } },
        { fn: 'get_or', args: { key: 'key', fallback: 'fallback' } },
        { fn: 'set', args: { key: 'key', value: 'value' } },
        { fn: 'merge', args: { key: 'key', partial: {} } },
        { fn: 'delete', args: { key: 'key' } },
        { fn: 'keys', args: {} },
        { fn: 'has', args: { key: 'key' } },
        { fn: 'clear', args: {} },
        { fn: 'getAll', args: {} },
        { fn: 'schema', args: {} },
      ];

      it.each(unknownMountCalls)(
        'rejects $fn for an unknown mount',
        async ({ fn, args }) => {
          const ext = make({ known: { mode: 'read-write' } });

          expectInvalid(
            await callFn(ext, fn, { mount: 'unknown', ...args }),
            'INVALID_INPUT',
            "Mount 'unknown' not found"
          );
        }
      );
    });

    describe('read-only mount', () => {
      const writeCalls: ReadonlyArray<{
        fn: string;
        args: Record<string, RillValue>;
      }> = [
        { fn: 'set', args: { key: 'key', value: 'value' } },
        { fn: 'merge', args: { key: 'key', partial: {} } },
        { fn: 'delete', args: { key: 'key' } },
        { fn: 'clear', args: {} },
      ];

      it.each(writeCalls)(
        'rejects $fn on a read-only mount',
        async ({ fn, args }) => {
          const ext = make({ readonly: { mode: 'read' } });

          expectInvalid(
            await callFn(ext, fn, { mount: 'readonly', ...args }),
            'INVALID_INPUT',
            "Mount 'readonly' is read-only"
          );
        }
      );

      it('allows reads on a read-only mount', async () => {
        const ext = make({ readonly: { mode: 'read' } });

        expect(
          await callFn(ext, 'get', { mount: 'readonly', key: 'key' })
        ).toBe('');
        expect(await callFn(ext, 'keys', { mount: 'readonly' })).toEqual([]);
      });
    });

    describe('empty mount', () => {
      it('returns empty results for all query operations in open mode', async () => {
        const ext = make({ empty: { mode: 'read-write' } });

        expect(await callFn(ext, 'keys', { mount: 'empty' })).toEqual([]);
        expect(await callFn(ext, 'getAll', { mount: 'empty' })).toEqual({});
        expect(await callFn(ext, 'schema', { mount: 'empty' })).toEqual([]);
        expect(
          await callFn(ext, 'has', { mount: 'empty', key: 'nonexistent' })
        ).toBe(false);
        expect(
          await callFn(ext, 'get', { mount: 'empty', key: 'nonexistent' })
        ).toBe('');
      });

      it('returns schema defaults for a cleared declared mount', async () => {
        const ext = make({
          declared: {
            mode: 'read-write',
            schema: {
              name: { type: 'string', default: 'Default' },
              count: { type: 'number', default: 0 },
            },
          },
        });
        await callFn(ext, 'clear', { mount: 'declared' });

        expect(await callFn(ext, 'schema', { mount: 'declared' })).toHaveLength(
          2
        );
        const keys = await callFn(ext, 'keys', { mount: 'declared' });
        expect([...(keys as string[])].sort()).toEqual(['count', 'name']);
        expect(
          await callFn(ext, 'get', { mount: 'declared', key: 'name' })
        ).toBe('Default');
        expect(
          await callFn(ext, 'get', { mount: 'declared', key: 'count' })
        ).toBe(0);
      });
    });

    describe('value size boundary', () => {
      const limit = 1024;

      it('accepts a value exactly at the size limit', async () => {
        const ext = make({
          limited: { mode: 'read-write', maxValueSize: limit },
        });
        // A JSON string adds two quote bytes around its characters.
        const value = 'x'.repeat(limit - 2);
        expect(jsonBytes(value)).toBe(limit);

        expect(
          await callFn(ext, 'set', { mount: 'limited', key: 'exact', value })
        ).toBe(true);
        expect(
          await callFn(ext, 'get', { mount: 'limited', key: 'exact' })
        ).toBe(value);
      });

      it('rejects a value one byte over the size limit', async () => {
        const ext = make({
          limited: { mode: 'read-write', maxValueSize: limit },
        });
        const value = 'x'.repeat(limit - 1);
        expect(jsonBytes(value)).toBe(limit + 1);

        expectInvalid(
          await callFn(ext, 'set', { mount: 'limited', key: 'over', value }),
          'INVALID_INPUT',
          'exceeds size limit'
        );
      });
    });

    describe('after dispose', () => {
      it('throws #DISPOSED from every host function', async () => {
        const ext = make(state);
        await ext.dispose?.();
        const names = Object.keys(ext.value as Record<string, unknown>);
        expect(names.length).toBeGreaterThan(0);

        for (const name of names) {
          const { threw, thrown } = await captureThrown(() =>
            callFn(ext, name, {
              mount: 'state',
              key: 'k',
              value: 'v',
              partial: { a: 1 },
              fallback: 'x',
            })
          );

          expect(threw).toBe(true);
          expect(isInvalid(thrown as RillValue)).toBe(true);
          const status = getStatus(thrown as RillValue);
          expect(status.code.name).toBe('DISPOSED');
          expect(status.raw['kind']).toBe('extension_disposed');
          expect(status.provider).toBe(backend);
        }
      });

      it('disposes twice without error', async () => {
        const ext = make(state);
        await ext.dispose?.();

        await expect(Promise.resolve(ext.dispose?.())).resolves.toBeUndefined();
      });
    });
  });
}
