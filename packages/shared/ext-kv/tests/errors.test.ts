/**
 * Unit tests for kv error mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  RuntimeHaltSignal,
  createRuntimeContext,
  getStatus,
} from '@rcrsr/rill';
import { mapKvError } from '../src/errors.js';

function disposedHalt(): RuntimeHaltSignal {
  const ctx = createRuntimeContext();
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error('kv-test: extension disposed'), {
      code: 'DISPOSED',
      provider: 'kv-test',
      raw: { kind: 'extension_disposed' },
    }),
    true
  );
}

describe('mapKvError', () => {
  describe('with a halt signal', () => {
    it('rethrows a DISPOSED halt unchanged', () => {
      const ctx = createRuntimeContext();
      const halt = disposedHalt();

      expect(() => mapKvError(ctx, 'kv-test', halt)).toThrow(halt);
    });

    it('maps any other halt to TIMEOUT request_cancelled', () => {
      const ctx = createRuntimeContext();
      const other = new RuntimeHaltSignal(
        ctx.invalidate(new Error('stop'), {
          code: 'TIMEOUT',
          provider: 'host',
          raw: {},
        }),
        true
      );

      const status = getStatus(mapKvError(ctx, 'kv-test', other));

      expect(status.code.name).toBe('TIMEOUT');
      expect(status.raw['kind']).toBe('request_cancelled');
    });
  });
});
