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
  type RuntimeContext,
} from '@rcrsr/rill';
import { withEventEmission } from '../src/events.js';

function makeCtx(opts?: { onLogEvent?: (e: unknown) => void }): RuntimeContext {
  return createRuntimeContext({
    callbacks: { onLogEvent: opts?.onLogEvent ?? (() => {}) },
  });
}

describe('withEventEmission', () => {
  const provider = 'testdb';
  const operation = 'upsert';

  describe('success path', () => {
    it('emits success event with provider:operation, metadata, and duration', async () => {
      const onLogEvent = vi.fn();
      const result = await withEventEmission(
        makeCtx({ onLogEvent }),
        provider,
        operation,
        { id: 'vec-1', count: 10 },
        async () => 'success' as RillValue
      );
      expect(result).toBe('success');
      expect(onLogEvent).toHaveBeenCalledTimes(1);
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe(`${provider}:${operation}`);
      expect(event['subsystem']).toBe(`extension:${provider}`);
      expect(event['id']).toBe('vec-1');
      expect(event['count']).toBe(10);
      expect(typeof event['duration']).toBe('number');
    });

    it('returns fn result without modification', async () => {
      const expectedResult = { data: 'complex', nested: { value: 42 } };
      const result = await withEventEmission(
        makeCtx(),
        provider,
        operation,
        {},
        async () => expectedResult as unknown as RillValue
      );
      expect(result).toEqual(expectedResult);
    });

    it('handles empty metadata object', async () => {
      const onLogEvent = vi.fn();
      await withEventEmission(
        makeCtx({ onLogEvent }),
        provider,
        operation,
        {},
        async () => 'done' as RillValue
      );
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe(`${provider}:${operation}`);
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
        async () => {
          throw new Error('Database connection failed');
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
        async () => {
          throw new Error('401 unauthorized');
        }
      );
      expect(getStatus(result).message).toContain(
        'authentication failed (401)'
      );
    });
  });

  describe('provider naming', () => {
    it('uses provider name in event and subsystem', async () => {
      const onLogEvent = vi.fn();
      await withEventEmission(
        makeCtx({ onLogEvent }),
        'chroma',
        'query',
        {},
        async () => 'result' as RillValue
      );
      const event = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
      expect(event['event']).toBe('chroma:query');
      expect(event['subsystem']).toBe('extension:chroma');
    });
  });
});
