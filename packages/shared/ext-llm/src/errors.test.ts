/**
 * Unit tests for error mapping functions.
 *
 * Tests `mapProviderError` returns invalid RillValues with the correct
 * generic atom code (`#AUTH`, `#RATE_LIMIT`, `#UNAVAILABLE`, etc.) so
 * scripts can `guard #ATOM`.
 */

import { describe, it, expect } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RuntimeContext,
} from '@rcrsr/rill';
import { mapProviderError } from './errors.js';
import type { ProviderErrorDetector } from './types.js';

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

describe('mapProviderError', () => {
  describe('detector returns non-null', () => {
    it('emits #AUTH on HTTP 401', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => ({
        status: 401,
        message: 'Invalid API key',
      });
      const result = mapProviderError(ctx, 'anthropic', new Error('e'), detector);
      expect(isInvalid(result)).toBe(true);
      const status = getStatus(result);
      expect(status.code.name).toBe('AUTH');
      expect(status.provider).toBe('anthropic');
      expect(status.message).toContain('HTTP 401');
      expect(status.message).toContain('Invalid API key');
    });

    it('emits #RATE_LIMIT on HTTP 429', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => ({
        status: 429,
        message: 'Rate limit exceeded',
      });
      const result = mapProviderError(ctx, 'openai', new Error('e'), detector);
      expect(getStatus(result).code.name).toBe('RATE_LIMIT');
    });

    it('emits #FORBIDDEN on HTTP 403', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => ({
        status: 403,
        message: 'Forbidden',
      });
      const result = mapProviderError(ctx, 'gemini', new Error('e'), detector);
      expect(getStatus(result).code.name).toBe('FORBIDDEN');
    });

    it('emits #UNAVAILABLE on HTTP 500', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => ({
        status: 500,
        message: 'Internal server error',
      });
      const result = mapProviderError(ctx, 'foundry', new Error('e'), detector);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
    });

    it('emits #UNAVAILABLE when status is undefined', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => ({ message: 'no status' });
      const result = mapProviderError(ctx, 'openai', new Error('e'), detector);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
      expect(getStatus(result).raw['kind']).toBe('provider_error');
    });
  });

  describe('detector returns null', () => {
    it('maps TypeError to #UNAVAILABLE / connection_failed', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => null;
      const result = mapProviderError(
        ctx,
        'openai',
        new TypeError('fetch failed'),
        detector
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('UNAVAILABLE');
      expect(status.raw['kind']).toBe('connection_failed');
    });

    it('maps SyntaxError to #PROTOCOL', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => null;
      const result = mapProviderError(
        ctx,
        'openai',
        new SyntaxError('bad json'),
        detector
      );
      expect(getStatus(result).code.name).toBe('PROTOCOL');
    });

    it('maps generic Error to #UNAVAILABLE / unknown_error', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => null;
      const result = mapProviderError(
        ctx,
        'openai',
        new Error('Network timeout'),
        detector
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('UNAVAILABLE');
      expect(status.message).toContain('Network timeout');
    });

    it('maps non-Error values to #UNAVAILABLE', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => null;
      const result = mapProviderError(ctx, 'openai', { code: 'X' }, detector);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
    });
  });

  describe('halt-style errors', () => {
    it('maps DOMException AbortError to #TIMEOUT', () => {
      const ctx = makeCtx();
      const detector: ProviderErrorDetector = () => null;
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      const result = mapProviderError(ctx, 'openai', abortError, detector);
      expect(getStatus(result).code.name).toBe('TIMEOUT');
    });
  });
});
