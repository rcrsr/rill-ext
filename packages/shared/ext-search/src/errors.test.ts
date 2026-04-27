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

// Use a pre-registered generic atom; consuming extensions register their own EXT_* atoms.
const ERROR_CODE = 'R001';

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
    const result = mapSearchError(ctx, provider, halt, ERROR_CODE);
    const status = statusOf(result);
    expect(status.code.name).toBe('TIMEOUT');
    expect(status.message).toBe(`${provider}: request cancelled`);
  });

  it('maps AbortError name to TIMEOUT atom', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    const result = mapSearchError(ctx, provider, error, ERROR_CODE);
    const status = statusOf(result);
    expect(status.code.name).toBe('TIMEOUT');
    expect(status.message).toBe(`${provider}: request timeout`);
  });

  it('maps TypeError to connection_failed', () => {
    const result = mapSearchError(
      ctx,
      provider,
      new TypeError('Failed to fetch'),
      ERROR_CODE
    );
    const status = statusOf(result);
    expect(status.code.name).toBe('R001');
    expect(status.message).toBe(`${provider}: connection failed`);
    expect(status.raw['kind']).toBe('connection_failed');
  });

  it('maps SyntaxError to unexpected_response_format', () => {
    const result = mapSearchError(
      ctx,
      provider,
      new SyntaxError('Unexpected token'),
      ERROR_CODE
    );
    const status = statusOf(result);
    expect(status.message).toBe(`${provider}: unexpected response format`);
    expect(status.raw['kind']).toBe('unexpected_response_format');
  });

  it.each([
    [401, 'authentication failed'],
    [403, 'authentication failed'],
    [429, 'rate limit exceeded'],
    [500, 'server error (500)'],
    [502, 'server error (502)'],
    [503, 'server error (503)'],
  ])('maps HTTP status %d to %s', (status, fragment) => {
    const result = mapSearchError(ctx, provider, { status }, ERROR_CODE);
    expect(statusOf(result).message).toBe(`${provider}: ${fragment}`);
  });

  it('maps generic Error to provider-prefixed message', () => {
    const result = mapSearchError(
      ctx,
      provider,
      new Error('something unexpected'),
      ERROR_CODE
    );
    expect(statusOf(result).message).toBe(`${provider}: something unexpected`);
  });

  it('maps non-Error values via String() conversion', () => {
    const result = mapSearchError(ctx, provider, 'raw string error', ERROR_CODE);
    expect(statusOf(result).message).toBe(`${provider}: raw string error`);
  });

  it('prefixes provider name in messages', () => {
    const result = mapSearchError(
      ctx,
      'my-provider',
      new Error('test'),
      ERROR_CODE
    );
    expect(statusOf(result).message).toContain('my-provider');
  });
});

describe('mapProviderSearchError', () => {
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = makeCtx();
  });

  it('maps exa 402 to credits depleted', () => {
    const result = mapProviderSearchError(ctx, 'exa', 402, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('exa: credits depleted');
  });

  it('does not apply exa override to other providers at 402', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 402, {}, ERROR_CODE);
    expect(statusOf(result).message).not.toBe('exa: credits depleted');
  });

  it('maps tavily 432 to plan limit exceeded', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 432, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('tavily: plan limit exceeded');
  });

  it('maps tavily 433 to pay-as-you-go limit exceeded', () => {
    const result = mapProviderSearchError(ctx, 'tavily', 433, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('tavily: pay-as-you-go limit exceeded');
  });

  it('maps brave 403 with error.code to access denied', () => {
    const body = { error: { code: 'SUBSCRIPTION_TOKEN_EXPIRED' } };
    const result = mapProviderSearchError(ctx, 'brave', 403, body, ERROR_CODE);
    expect(statusOf(result).message).toBe(
      'brave: access denied (SUBSCRIPTION_TOKEN_EXPIRED)'
    );
  });

  it('maps brave 403 without error.code falls back to authentication failed', () => {
    const result = mapProviderSearchError(ctx, 'brave', 403, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('brave: authentication failed');
  });

  it('maps brave 403 with null error.code falls back to authentication failed', () => {
    const body = { error: { code: null } };
    const result = mapProviderSearchError(ctx, 'brave', 403, body, ERROR_CODE);
    expect(statusOf(result).message).toBe('brave: authentication failed');
  });

  it('falls back to generic 401 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 401, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('serper: authentication failed');
  });

  it('falls back to generic 429 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 429, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('serper: rate limit exceeded');
  });

  it('falls back to generic 500 mapping for unknown provider', () => {
    const result = mapProviderSearchError(ctx, 'serper', 500, {}, ERROR_CODE);
    expect(statusOf(result).message).toBe('serper: server error (500)');
  });
});
