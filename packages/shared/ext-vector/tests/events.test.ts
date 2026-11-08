/**
 * Test suite for vector event emission wrapper.
 * On error, returns an invalid RillValue (does not throw).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RillValue,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import { withEventEmission } from '../src/events.js';

function makeCtx(opts?: { onLogEvent?: (e: unknown) => void }): RuntimeContext {
  return createRuntimeContext({
    callbacks: { onLogEvent: opts?.onLogEvent ?? (() => {}) },
  });
}

function failWith(error: Error): Promise<never> {
  return Promise.reject(error);
}

describe('withEventEmission', () => {
  const provider = 'testdb';
  const operation = 'upsert';

  describe('success path', () => {
    it('emits success event with provider:operation, metadata, and duration, returning fn result unmodified', async () => {
      const onLogEvent = vi.fn();
      const expectedResult = { data: 'complex', nested: { value: 42 } };
      const result = await withEventEmission(
        makeCtx({ onLogEvent }),
        provider,
        operation,
        { id: 'vec-1', count: 10 },
        async () => expectedResult as unknown as RillValue
      );
      expect(result).toEqual(expectedResult);
      expect(onLogEvent).toHaveBeenCalledTimes(1);
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe(`${provider}:${operation}`);
      expect(event['subsystem']).toBe(`extension:${provider}`);
      expect(event['id']).toBe('vec-1');
      expect(event['count']).toBe(10);
      expect(typeof event['duration']).toBe('number');
    });
  });

  describe('error path', () => {
    it('returns invalid RillValue and emits error event when fn throws', async () => {
      const onLogEvent = vi.fn();
      const result = await withEventEmission(
        makeCtx({ onLogEvent }),
        provider,
        operation,
        {},
        () => {
          return failWith(new Error('Database connection failed'));
        }
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toContain('Database connection failed');
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe(`${provider}:error`);
      expect(event['subsystem']).toBe(`extension:${provider}`);
      expect(event['error']).toContain('Database connection failed');
      expect(typeof event['duration']).toBe('number');
    });

    it('maps 401 to authentication_failed via mapVectorError', async () => {
      const result = await withEventEmission(
        makeCtx(),
        provider,
        operation,
        {},
        () => {
          return failWith(new Error('401 unauthorized'));
        }
      );
      expect(getStatus(result).message).toContain(
        'authentication failed (401)'
      );
    });
  });
  describe('disposal', () => {
    const abortError = (): Error =>
      Object.assign(new Error('aborted'), { name: 'AbortError' });

    it('throws DISPOSED halt when disposed and fn fails abort-shaped', async () => {
      const onLogEvent = vi.fn();
      const thrown = await withEventEmission(
        makeCtx({ onLogEvent }),
        provider,
        operation,
        {},
        () => {
          return failWith(abortError());
        },
        { isDisposed: true }
      ).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
      expect(status.message).toBe(`${provider}: extension disposed`);
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe(`${provider}:error`);
    });

    it('keeps the mapped code when disposed and fn fails non-abort', async () => {
      const result = await withEventEmission(
        makeCtx(),
        provider,
        operation,
        {},
        () => {
          return failWith(new Error('401 unauthorized'));
        },
        { isDisposed: true }
      );
      expect(getStatus(result).code.name).toBe('AUTH');
    });

    it('returns mapped invalid when abort-shaped but not disposed', async () => {
      const result = await withEventEmission(
        makeCtx(),
        provider,
        operation,
        {},
        () => {
          return failWith(abortError());
        },
        { isDisposed: false }
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).not.toBe('DISPOSED');
    });
  });
});
