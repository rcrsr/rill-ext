/**
 * Tests for kv-file extension factory.
 *
 * Verifies factory config validation.
 */

import { describe, it, expect } from 'vitest';
import { createFileKvExtension } from '../src/factory.js';
import { getStatus, RuntimeHaltSignal, type RillValue } from '@rcrsr/rill';
import { fnOf, makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

describe('kv-file extension factory', () => {
  describe('factory creation', () => {
    it('throws when neither mounts nor store provided', () => {
      expect(() => createFileKvExtension({}, makeFactoryCtx())).toThrow(
        'KV file extension requires either "mounts" or "store" configuration'
      );
    });
  });
});

describe('kv-file extension post-dispose shape', () => {
  it('returns a Promise rejecting with DISPOSED from mounts', async () => {
    const ext = createFileKvExtension(
      {
        mounts: { m: { store: '/tmp/rill-kv-file-unused.json', mode: 'read' } },
      },
      makeFactoryCtx()
    );
    await ext.dispose?.();

    const pending = fnOf(ext, 'mounts').fn(
      {},
      makeRuntimeCtx()
    ) as Promise<RillValue>;

    expect(pending).toBeInstanceOf(Promise);
    const halt: unknown = await pending.catch((e: unknown) => e);
    expect(halt).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((halt as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });
});
