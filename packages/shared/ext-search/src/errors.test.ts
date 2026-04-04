/**
 * Test suite for search error mapping utilities.
 * Validates all error contract cases (EC-1 through EC-12).
 */

import { describe, it, expect } from 'vitest';
import { mapSearchError, mapProviderSearchError } from './errors.js';
import { RuntimeError } from '@rcrsr/rill';

describe('mapSearchError', () => {
  const provider = 'testsearch';

  describe('EC-4: AbortError — request timeout', () => {
    it('maps error with name AbortError to request timeout', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      const result = mapSearchError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: request timeout`);
    });
  });

  describe('EC-5: TypeError — connection failed', () => {
    it('maps TypeError to connection failed', () => {
      const error = new TypeError('Failed to fetch');
      const result = mapSearchError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: connection failed`);
    });

    it('maps TypeError with DNS failure message', () => {
      const error = new TypeError('getaddrinfo ENOTFOUND');
      const result = mapSearchError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: connection failed`);
    });
  });

  describe('EC-6: SyntaxError — unexpected response format', () => {
    it('maps SyntaxError from JSON.parse to unexpected response format', () => {
      const error = new SyntaxError('Unexpected token < in JSON');
      const result = mapSearchError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: unexpected response format`);
    });
  });

  describe('RuntimeError passthrough', () => {
    it('returns already-mapped RuntimeError without wrapping', () => {
      const original = new RuntimeError('RILL-R004', 'already mapped');
      const result = mapSearchError(provider, original);

      expect(result).toBe(original);
      expect(result.message).toBe('already mapped');
    });
  });

  describe('EC-1: HTTP 401/403 — authentication failed', () => {
    it('maps status 401 to authentication failed', () => {
      const result = mapSearchError(provider, { status: 401 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: authentication failed`);
    });

    it('maps status 403 to authentication failed', () => {
      const result = mapSearchError(provider, { status: 403 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: authentication failed`);
    });
  });

  describe('EC-2: HTTP 429 — rate limit exceeded', () => {
    it('maps status 429 to rate limit exceeded', () => {
      const result = mapSearchError(provider, { status: 429 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: rate limit exceeded`);
    });
  });

  describe('EC-3: HTTP 5xx — server error', () => {
    it('maps status 500 to server error (500)', () => {
      const result = mapSearchError(provider, { status: 500 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: server error (500)`);
    });

    it('maps status 502 to server error (502)', () => {
      const result = mapSearchError(provider, { status: 502 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: server error (502)`);
    });

    it('maps status 503 to server error (503)', () => {
      const result = mapSearchError(provider, { status: 503 });

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: server error (503)`);
    });
  });

  describe('EC-7: Unknown error — provider-prefixed message', () => {
    it('maps generic Error to provider-prefixed message', () => {
      const error = new Error('something unexpected');
      const result = mapSearchError(provider, error);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(`${provider}: something unexpected`);
    });

    it('maps unknown object via String() conversion', () => {
      const result = mapSearchError(provider, 'raw string error');

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: raw string error`);
    });

    it('maps null-ish non-Error values via String() conversion', () => {
      const result = mapSearchError(provider, 42);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe(`${provider}: 42`);
    });
  });

  describe('Provider name in messages', () => {
    it('prefixes all messages with provider name', () => {
      const customProvider = 'my-provider';
      const result = mapSearchError(customProvider, new Error('test'));

      expect(result.message).toContain(customProvider);
    });
  });
});

describe('mapProviderSearchError', () => {
  describe('EC-8: Exa 402 — credits depleted', () => {
    it('maps exa + 402 to credits depleted', () => {
      const result = mapProviderSearchError('exa', 402, {});

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('exa: credits depleted');
    });

    it('does not apply exa override to other providers at 402', () => {
      const result = mapProviderSearchError('tavily', 402, {});

      expect(result.message).not.toBe('exa: credits depleted');
    });
  });

  describe('EC-9: Tavily 432 — plan limit exceeded', () => {
    it('maps tavily + 432 to plan limit exceeded', () => {
      const result = mapProviderSearchError('tavily', 432, {});

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('tavily: plan limit exceeded');
    });
  });

  describe('EC-10: Tavily 433 — pay-as-you-go limit exceeded', () => {
    it('maps tavily + 433 to pay-as-you-go limit exceeded', () => {
      const result = mapProviderSearchError('tavily', 433, {});

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe('tavily: pay-as-you-go limit exceeded');
    });
  });

  describe('EC-11: Brave 403 with error code — access denied', () => {
    it('maps brave + 403 with error.code to access denied (code)', () => {
      const body = { error: { code: 'SUBSCRIPTION_TOKEN_EXPIRED' } };
      const result = mapProviderSearchError('brave', 403, body);

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.errorId).toBe('RILL-R004');
      expect(result.message).toBe(
        'brave: access denied (SUBSCRIPTION_TOKEN_EXPIRED)'
      );
    });

    it('maps brave + 403 without error code falls back to authentication failed', () => {
      const result = mapProviderSearchError('brave', 403, {});

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe('brave: authentication failed');
    });

    it('maps brave + 403 with null error code falls back to authentication failed', () => {
      const body = { error: { code: null } };
      const result = mapProviderSearchError('brave', 403, body);

      expect(result.message).toBe('brave: authentication failed');
    });
  });

  describe('Fallback to mapSearchError for unknown provider/status', () => {
    it('falls back to generic 401 mapping for unknown provider', () => {
      const result = mapProviderSearchError('serper', 401, {});

      expect(result).toBeInstanceOf(RuntimeError);
      expect(result.message).toBe('serper: authentication failed');
    });

    it('falls back to generic 429 mapping for unknown provider', () => {
      const result = mapProviderSearchError('serper', 429, {});

      expect(result.message).toBe('serper: rate limit exceeded');
    });

    it('falls back to generic 500 mapping for unknown provider', () => {
      const result = mapProviderSearchError('serper', 500, {});

      expect(result.message).toBe('serper: server error (500)');
    });
  });
});
