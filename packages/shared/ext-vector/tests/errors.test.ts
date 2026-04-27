/**
 * Test suite for vector error mapping. Errors map to invalid RillValues
 * via ctx.invalidate; tests inspect the resulting status sidecar.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  type RuntimeContext,
} from '@rcrsr/rill';
import { mapVectorError } from '../src/errors.js';

const ERROR_CODE = 'R001';

function statusOf(value: ReturnType<typeof mapVectorError>) {
  return getStatus(value);
}

describe('mapVectorError', () => {
  const provider = 'testdb';
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = createRuntimeContext();
  });

  describe('EC-1: Authentication failures', () => {
    it('maps 401 status code in message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('HTTP 401 unauthorized'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(
        `${provider}: authentication failed (401)`
      );
    });

    it('maps "unauthorized" keyword (case-insensitive)', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('Request UNAUTHORIZED by server'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(
        `${provider}: authentication failed (401)`
      );
    });
  });

  describe('EC-2: Collection not found', () => {
    it('maps "collection" + "not found" keywords', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('collection my-collection not found'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: collection not found`);
    });

    it('matches case-insensitively', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('Collection NOT FOUND in database'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: collection not found`);
    });

    it('requires both keywords', () => {
      const a = mapVectorError(
        ctx,
        provider,
        new Error('resource not found'),
        ERROR_CODE
      );
      const b = mapVectorError(
        ctx,
        provider,
        new Error('collection exists'),
        ERROR_CODE
      );
      expect(statusOf(a).message).not.toBe(`${provider}: collection not found`);
      expect(statusOf(b).message).not.toBe(`${provider}: collection not found`);
    });
  });

  describe('EC-3: Rate limit exceeded', () => {
    it('maps 429 status code in message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('HTTP 429 too many requests'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: rate limit exceeded`);
    });

    it('maps "rate limit" keywords (case-insensitive)', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('RATE LIMIT exceeded for API key'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: rate limit exceeded`);
    });
  });

  describe('EC-4: Request timeout', () => {
    it('maps AbortError by name', () => {
      const error = new Error('Operation aborted');
      error.name = 'AbortError';
      const result = mapVectorError(ctx, provider, error, ERROR_CODE);
      const status = statusOf(result);
      expect(status.code.name).toBe('TIMEOUT');
      expect(status.message).toBe(`${provider}: request timeout`);
    });

    it('maps "timeout" keyword in message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('Request TIMEOUT after 30s'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: request timeout`);
    });
  });

  describe('EC-5: Dimension mismatch', () => {
    it('extracts dimensions from "expected X got Y" format', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('dimension mismatch: expected 384 but got 512'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(
        `${provider}: dimension mismatch (expected 384, got 512)`
      );
    });

    it('extracts dimensions from "Y dimensions, expected X" format', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('received 512 dimensions, expected 384'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(
        `${provider}: dimension mismatch (expected 384, got 512)`
      );
    });

    it('handles dimension keyword without numbers', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('dimension error occurred'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: dimension mismatch`);
    });
  });

  describe('EC-6: Collection already exists', () => {
    it('maps "already exists" keywords', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('collection my-collection already exists'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: collection already exists`);
    });
  });

  describe('EC-7: Generic Error instance', () => {
    it('returns provider-prefixed error message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('Custom SDK error message'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: Custom SDK error message`);
    });
  });

  describe('EC-8: Non-Error values', () => {
    it('maps string throws to "unknown error"', () => {
      const result = mapVectorError(ctx, provider, 'string error', ERROR_CODE);
      expect(statusOf(result).message).toBe(`${provider}: unknown error`);
    });

    it('maps number throws', () => {
      const result = mapVectorError(ctx, provider, 42, ERROR_CODE);
      expect(statusOf(result).message).toBe(`${provider}: unknown error`);
    });

    it('maps null throws', () => {
      const result = mapVectorError(ctx, provider, null, ERROR_CODE);
      expect(statusOf(result).message).toBe(`${provider}: unknown error`);
    });
  });

  describe('Error precedence', () => {
    it('prioritizes authentication over generic message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('401 unauthorized: custom details'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(
        `${provider}: authentication failed (401)`
      );
    });

    it('prioritizes rate limit over generic message', () => {
      const result = mapVectorError(
        ctx,
        provider,
        new Error('429 rate limit exceeded for user'),
        ERROR_CODE
      );
      expect(statusOf(result).message).toBe(`${provider}: rate limit exceeded`);
    });
  });
});
