/**
 * Error mapping tests for the Foundry extension.
 * Covers AC-23, AC-24, AC-25, AC-26, AC-28,
 * EC-12, EC-13, EC-14, EC-15, EC-17.
 */

import { describe, it, expect, vi } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// MODULE MOCK
// ============================================================

// We need OpenAI.APIError to be constructable in tests.
vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: unknown,
      message: string,
      _headers: unknown
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAzureOpenAI {
      chat = {
        completions: {
          create: vi.fn(),
          stream: vi.fn(),
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = {
        completions: {
          create: vi.fn(),
          stream: vi.fn(),
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// detectFoundryError TESTS
// ============================================================

describe('detectFoundryError', () => {
  it('returns status and message for OpenAI.APIError instances', async () => {
    const OpenAI = await import('openai');
    const { detectFoundryError } = await import('../src/errors.js');

    const error = new OpenAI.APIError(401, {}, 'Unauthorized', {});
    const result = detectFoundryError(error);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    expect(result!.message).toBe('Unauthorized');
  });

  it('returns null for non-APIError errors', async () => {
    const { detectFoundryError } = await import('../src/errors.js');

    const result = detectFoundryError(new Error('generic error'));
    expect(result).toBeNull();
  });

  it('returns null for plain objects', async () => {
    const { detectFoundryError } = await import('../src/errors.js');

    const result = detectFoundryError({ message: 'not an api error' });
    expect(result).toBeNull();
  });
});

// ============================================================
// mapRestError TESTS
// ============================================================

describe('mapRestError', () => {
  // EC-12 / AC-23: HTTP 401
  it('maps 401 to authentication failed message (EC-12, AC-23)', async () => {
    const { mapRestError } = await import('../src/errors.js');

    const error = mapRestError(401);

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.errorId).toBe('RILL-R005');
    expect(error.message).toBe('foundry: authentication failed (401)');
  });

  // EC-13 / AC-24: HTTP 429
  it('maps 429 to rate limit exceeded message (EC-13, AC-24)', async () => {
    const { mapRestError } = await import('../src/errors.js');

    const error = mapRestError(429);

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.errorId).toBe('RILL-R005');
    expect(error.message).toBe('foundry: rate limit exceeded');
  });

  it('maps other status codes with HTTP status in message', async () => {
    const { mapRestError } = await import('../src/errors.js');

    const error = mapRestError(500);

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.errorId).toBe('RILL-R005');
    expect(error.message).toContain('HTTP 500');
  });

  it('includes body error message when available', async () => {
    const { mapRestError } = await import('../src/errors.js');

    const error = mapRestError(500, { error: { message: 'Internal server error detail' } });

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.message).toContain('Internal server error detail');
  });
});

// ============================================================
// createTimeoutError TESTS
// ============================================================

describe('createTimeoutError', () => {
  // EC-14 / AC-25: Timeout
  it('returns RuntimeError with timeout message (EC-14, AC-25)', async () => {
    const { createTimeoutError } = await import('../src/errors.js');

    const error = createTimeoutError();

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.errorId).toBe('RILL-R005');
    expect(error.message).toBe('foundry: request timeout');
  });
});

// ============================================================
// createModelNotDeployedError TESTS
// ============================================================

describe('createModelNotDeployedError', () => {
  // EC-15 / AC-26: Model not deployed
  it('returns RuntimeError with model name in message (EC-15, AC-26)', async () => {
    const { createModelNotDeployedError } = await import('../src/errors.js');

    const error = createModelNotDeployedError('gpt-4-turbo');

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.errorId).toBe('RILL-R005');
    expect(error.message).toBe("foundry: model 'gpt-4-turbo' not deployed");
  });

  it('includes the deployment name verbatim', async () => {
    const { createModelNotDeployedError } = await import('../src/errors.js');

    const error = createModelNotDeployedError('my-custom-deployment-name');

    expect(error.message).toContain('my-custom-deployment-name');
  });
});

// ============================================================
// resolveVariables TESTS
// ============================================================

describe('resolveVariables', () => {
  // EC-17 / AC-28: Unresolved @{VAR} reference
  it('throws for unresolvable @{VAR} reference (EC-17, AC-28)', async () => {
    const { resolveVariables } = await import('../src/errors.js');

    const lookup = (_name: string) => undefined;

    expect(() => resolveVariables('Hello @{NAME}', lookup)).toThrow(
      "foundry: unresolved variable 'NAME'"
    );
  });

  it('thrown error has RILL-R005 code (EC-17)', async () => {
    const { resolveVariables } = await import('../src/errors.js');

    const lookup = (_name: string) => undefined;

    let caught: unknown;
    try {
      resolveVariables('Query: @{QUERY}', lookup);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R005');
  });

  it('includes the variable name in the error message (EC-17)', async () => {
    const { resolveVariables } = await import('../src/errors.js');

    const lookup = (_name: string) => undefined;

    expect(() => resolveVariables('@{MY_VAR}', lookup)).toThrow(
      "foundry: unresolved variable 'MY_VAR'"
    );
  });

  it('resolves known variables without error', async () => {
    const { resolveVariables } = await import('../src/errors.js');

    const lookup = (name: string) => (name === 'NAME' ? 'World' : undefined);

    const result = resolveVariables('Hello @{NAME}', lookup);
    expect(result).toBe('Hello World');
  });

  it('resolves multiple variables in one string', async () => {
    const { resolveVariables } = await import('../src/errors.js');

    const vars: Record<string, string> = { A: 'alpha', B: 'beta' };
    const lookup = (name: string) => vars[name];

    const result = resolveVariables('@{A} and @{B}', lookup);
    expect(result).toBe('alpha and beta');
  });
});

// ============================================================
// mapProviderError integration with detectFoundryError
// ============================================================

describe('mapProviderError + detectFoundryError integration', () => {
  async function runMap(error: unknown): Promise<{ code: string; message: string }> {
    const { detectFoundryError } = await import('../src/errors.js');
    const { mapProviderError } = await import('@rcrsr/rill-ext-llm-shared');
    const { createRuntimeContext, getStatus } = await import('@rcrsr/rill');
    const ctx = createRuntimeContext();
    const result = mapProviderError(ctx, 'Foundry', error, detectFoundryError);
    const status = getStatus(result);
    return { code: status.code.name, message: status.message };
  }

  // EC-12 / AC-23: 401 → #AUTH
  it('produces #AUTH for 401 APIError (EC-12)', async () => {
    const OpenAI = await import('openai');
    const error = new OpenAI.APIError(401, {}, 'Unauthorized', {});
    const { code, message } = await runMap(error);
    expect(code).toBe('AUTH');
    expect(message).toBe('Foundry API error (HTTP 401): Unauthorized');
  });

  // EC-13 / AC-24: 429 → #RATE_LIMIT
  it('produces #RATE_LIMIT for 429 APIError (EC-13)', async () => {
    const OpenAI = await import('openai');
    const error = new OpenAI.APIError(429, {}, 'Too Many Requests', {});
    const { code, message } = await runMap(error);
    expect(code).toBe('RATE_LIMIT');
    expect(message).toBe('Foundry API error (HTTP 429): Too Many Requests');
  });

  // EC-14 / AC-25: Timeout via generic Error path → #UNAVAILABLE
  it('wraps timeout error via generic Error fallback (EC-14)', async () => {
    const error = new Error('Request aborted due to timeout');
    const { message } = await runMap(error);
    expect(message).toContain('Request aborted due to timeout');
  });

  // EC-15 / AC-26: 404 → #NOT_FOUND
  it('produces #NOT_FOUND for 404 APIError (EC-15)', async () => {
    const OpenAI = await import('openai');
    const error = new OpenAI.APIError(404, {}, 'Deployment not found', {});
    const { code, message } = await runMap(error);
    expect(code).toBe('NOT_FOUND');
    expect(message).toBe('Foundry API error (HTTP 404): Deployment not found');
  });
});
