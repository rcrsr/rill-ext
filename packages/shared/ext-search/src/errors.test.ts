/**
 * Test suite for search error mapping utilities.
 * Errors map to invalid RillValues via ctx.invalidate; tests inspect
 * the resulting status sidecar.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  RuntimeHaltSignal,
  type RuntimeContext,
  type RillValue,
} from '@rcrsr/rill';
import { mapSearchError, mapProviderSearchError } from './errors.js';

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

function statusOf(value: RillValue) {
  return getStatus(value);
}

describe('mapSearchError', () => {
  const provider = 'testsearch';
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = makeCtx();
  });

  it('maps RuntimeHaltSignal to TIMEOUT atom', () => {
    const halt = new RuntimeHaltSignal(null as unknown as RillValue, true);
    const result = mapSearchError(ctx, provider, halt);
    const status = statusOf(result);
    expect(status.code.name).toBe('TIMEOUT');
    expect(status.message).toBe(`${provider}: request cancelled`);
  });

  it('maps AbortError name to TIMEOUT atom', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    const result = mapSearchError(ctx, provider, error);
    const status = statusOf(result);
    expect(status.code.name).toBe('TIMEOUT');
    expect(status.message).toBe(`${provider}: request timeout`);
  });

  it('maps TypeError to UNAVAILABLE with connection_failed kind', () => {
    const result = mapSearchError(ctx, provider, new TypeError('Failed to fetch'));
    const status = statusOf(result);
    expect(status.code.name).toBe('UNAVAILABLE');
    expect(status.message).toBe(`${provider}: connection failed`);
    expect(status.raw['kind']).toBe('connection_failed');
  });

  it('maps SyntaxError to PROTOCOL with unexpected_response_format kind', () => {
    const result = mapSearchError(ctx, provider, new SyntaxError('Unexpected token'));
    const status = statusOf(result);
    expect(status.code.name).toBe('PROTOCOL');
    expect(status.message).toBe(`${provider}: unexpected response format`);
    expect(status.raw['kind']).toBe('unexpected_response_format');
  });

  it.each([
    [401, 'AUTH', 'authentication failed'],
    [403, 'FORBIDDEN', 'forbidden'],
    [404, 'NOT_FOUND', 'not found'],
    [408, 'TIMEOUT', 'request failed (408)'],
    [409, 'CONFLICT', 'request failed (409)'],
    [429, 'RATE_LIMIT', 'rate limit exceeded'],
    [402, 'QUOTA_EXCEEDED', 'quota exceeded'],
    [500, 'UNAVAILABLE', 'server error (500)'],
    [502, 'UNAVAILABLE', 'server error (502)'],
    [503, 'UNAVAILABLE', 'server error (503)'],
  ])('maps HTTP status %d to atom #%s with message "%s"', (status, atom, fragment) => {
    const result = mapSearchError(ctx, provider, { status });
    expect(statusOf(result).code.name).toBe(atom);
    expect(statusOf(result).message).toBe(`${provider}: ${fragment}`);
  });

  it('maps generic Error to UNAVAILABLE with provider-prefixed message', () => {
    const result = mapSearchError(ctx, provider, new Error('something unexpected'));
    expect(statusOf(result).code.name).toBe('UNAVAILABLE');
    expect(statusOf(result).message).toBe(`${provider}: something unexpected`);
  });

  it('maps non-Error values via String() conversion', () => {
    const result = mapSearchError(ctx, provider, 'raw string error');
    expect(statusOf(result).message).toBe(`${provider}: raw string error`);
  });

  it('prefixes provider name in messages', () => {
    const result = mapSearchError(ctx, 'my-provider', new Error('test'));
    expect(statusOf(result).message).toContain('my-provider');
  });
});

describe('mapProviderSearchError', () => {
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = makeCtx();
  });

  it('maps exa 402 to QUOTA_EXCEEDED with credits_depleted kind', () => {
    const result = mapProviderSearchError(ctx, 'exa', 402, {});
    const status = statusOf(result);
    expect(status.code.name).toBe('QUOTA_EXCEEDED');
    expect(status.message).toBe('exa: credits depleted');
    expect(status.raw['kind']).toBe('credits_depleted');
  });

  it('does not apply exa override to other providers at 402', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 402, {});
    expect(statusOf(result).message).not.toBe('exa: credits depleted');
  });

  it('maps tavily 432 to QUOTA_EXCEEDED with plan_limit_exceeded kind', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 432, {});
    const status = statusOf(result);
    expect(status.code.name).toBe('QUOTA_EXCEEDED');
    expect(status.message).toBe('tavily: plan limit exceeded');
    expect(status.raw['kind']).toBe('plan_limit_exceeded');
  });

  it('maps tavily 433 to QUOTA_EXCEEDED with payg_limit_exceeded kind', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 433, {});
    const status = statusOf(result);
    expect(status.code.name).toBe('QUOTA_EXCEEDED');
    expect(status.message).toBe('tavily: pay-as-you-go limit exceeded');
    expect(status.raw['kind']).toBe('payg_limit_exceeded');
  });

  it('maps brave 403 with error.code to FORBIDDEN with access_denied kind', () => {
    const body = { error: { code: 'SUBSCRIPTION_TOKEN_EXPIRED' } };
    const result = mapProviderSearchError(ctx, 'brave', 403, body);
    const status = statusOf(result);
    expect(status.code.name).toBe('FORBIDDEN');
    expect(status.message).toBe('brave: access denied (SUBSCRIPTION_TOKEN_EXPIRED)');
    expect(status.raw['kind']).toBe('access_denied');
  });

  it('maps brave 403 without error.code falls back to FORBIDDEN', () => {
    const result = mapProviderSearchError(ctx, 'brave', 403, {});
    const status = statusOf(result);
    expect(status.code.name).toBe('FORBIDDEN');
    expect(status.message).toBe('brave: forbidden');
  });

  it('maps brave 403 with null error.code falls back to FORBIDDEN', () => {
    const body = { error: { code: null } };
    const result = mapProviderSearchError(ctx, 'brave', 403, body);
    const status = statusOf(result);
    expect(status.code.name).toBe('FORBIDDEN');
    expect(status.message).toBe('brave: forbidden');
  });

  it('falls back to generic 401 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 401, {});
    expect(statusOf(result).code.name).toBe('AUTH');
    expect(statusOf(result).message).toBe('serper: authentication failed');
  });

  it('falls back to generic 429 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 429, {});
    expect(statusOf(result).code.name).toBe('RATE_LIMIT');
    expect(statusOf(result).message).toBe('serper: rate limit exceeded');
  });

  it('falls back to generic 500 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 500, {});
    expect(statusOf(result).code.name).toBe('UNAVAILABLE');
    expect(statusOf(result).message).toBe('serper: server error (500)');
  });
});
