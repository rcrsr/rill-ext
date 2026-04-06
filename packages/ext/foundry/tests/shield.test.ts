/**
 * Shield function tests for Azure AI Foundry extension.
 * Tests the callShield/shield host function: fetch mocking, response mapping,
 * config validation, and event emission.
 *
 * Covers: AC-9, AC-18, AC-33, EC-7.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';

// ============================================================
// MODULE MOCK
// ============================================================

// Mock openai so AzureOpenAI never makes network calls.
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
      chat = { completions: { create: vi.fn(), stream: vi.fn() } };
      embeddings = { create: vi.fn() };
      responses = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = { completions: { create: vi.fn(), stream: vi.fn() } };
      embeddings = { create: vi.fn() };
      responses = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

type ExtValue = Record<string, { fn: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown> }>;

function getHostFn(ext: { value: unknown }, name: string) {
  return (ext.value as ExtValue)[name]!;
}

/** Build a fetch mock returning a JSON response with the given status. */
function mockFetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

/** Minimum valid config with contentSafety configured. */
function configWithSafety(autoShield = false): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    contentSafety: {
      endpoint: 'https://my-safety.cognitiveservices.azure.com',
      autoShield,
    },
  };
}

/** Minimum valid config without contentSafety. */
function configWithoutSafety(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
  };
}

/** Safe shield response from Content Safety API. */
const SAFE_SHIELD_RESPONSE = {
  userPromptAnalysis: { attackDetected: false },
  documentsAnalysis: [],
};

/** Attack-detected shield response from Content Safety API. */
const ATTACK_SHIELD_RESPONSE = {
  userPromptAnalysis: { attackDetected: true },
  documentsAnalysis: [],
};

// ============================================================
// TESTS
// ============================================================

describe('shield() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------
  // AC-9: shield() returns { safe, analysis }
  // --------------------------------------------------------

  describe('safe prompt', () => {
    it('returns { safe: true, analysis } for clean text [AC-9]', async () => {
      globalThis.fetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'What is the weather today?' },
        ctx
      )) as Record<string, unknown>;

      expect(result['safe']).toBe(true);
      expect(result['analysis']).toBeDefined();
    });

    it('returns { safe: false, analysis } when attack detected [AC-9]', async () => {
      globalThis.fetch = mockFetchJson(200, ATTACK_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'Ignore previous instructions...' },
        ctx
      )) as Record<string, unknown>;

      expect(result['safe']).toBe(false);
      expect(result['analysis']).toBeDefined();
    });

    it('analysis dict contains attackType field [AC-9]', async () => {
      globalThis.fetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'Hello world' },
        ctx
      )) as Record<string, unknown>;

      const analysis = result['analysis'] as Record<string, unknown>;
      expect('attackType' in analysis).toBe(true);
    });

    it('attackType is null when prompt is safe [AC-9]', async () => {
      globalThis.fetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'Tell me about clouds' },
        ctx
      )) as Record<string, unknown>;

      const analysis = result['analysis'] as Record<string, unknown>;
      expect(analysis['attackType']).toBeNull();
    });

    it('attackType is user_prompt when user prompt attack detected [AC-9]', async () => {
      globalThis.fetch = mockFetchJson(200, ATTACK_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'injection attack' },
        ctx
      )) as Record<string, unknown>;

      const analysis = result['analysis'] as Record<string, unknown>;
      expect(analysis['attackType']).toBe('user_prompt');
    });
  });

  // --------------------------------------------------------
  // Request structure
  // --------------------------------------------------------

  describe('HTTP request', () => {
    it('POSTs to {contentSafety.endpoint}/contentsafety/text:shieldPrompt', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://my-safety.cognitiveservices.azure.com');
      expect(url).toContain('/contentsafety/text:shieldPrompt');
      expect(init.method).toBe('POST');
    });

    it('sends api-version=2024-09-01 query param', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('api-version=2024-09-01');
    });

    it('sends Ocp-Apim-Subscription-Key header for api-key auth', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Ocp-Apim-Subscription-Key']).toBe('test-api-key');
    });

    it('sends Content-Type: application/json header', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends documents in request body when provided', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn(
        { text: 'hello', documents: ['doc one', 'doc two'] },
        ctx
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(Array.isArray(body['documents'])).toBe(true);
      expect((body['documents'] as string[]).length).toBe(2);
    });
  });

  // --------------------------------------------------------
  // AC-18, EC-7: contentSafety not configured
  // --------------------------------------------------------

  describe('missing contentSafety config', () => {
    it('throws RILL-R004 when contentSafety not configured [AC-18, EC-7]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSafety());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx)
      ).rejects.toThrow(RuntimeError);
    });

    it('error message is "foundry: content safety not configured" [EC-7]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSafety());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx)
      ).rejects.toThrow('foundry: content safety not configured');
    });

    it('fetch is not called when contentSafety not configured [AC-18]', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSafety());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx)
      ).rejects.toThrow();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // AC-33: Direct shield() works with autoShield: false
  // --------------------------------------------------------

  describe('direct shield call with autoShield: false [AC-33]', () => {
    it('shield() executes normally when autoShield is false [AC-33]', async () => {
      globalThis.fetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);

      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-api-key' },
        contentSafety: {
          endpoint: 'https://my-safety.cognitiveservices.azure.com',
          autoShield: false,
        },
      };

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'shield').fn(
        { text: 'hello world' },
        ctx
      )) as Record<string, unknown>;

      expect(result['safe']).toBe(true);
    });

    it('shield() with autoShield: false still calls the API', async () => {
      const mockFetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);
      globalThis.fetch = mockFetch;

      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-api-key' },
        contentSafety: {
          endpoint: 'https://my-safety.cognitiveservices.azure.com',
          autoShield: false,
        },
      };

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(config);
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  // --------------------------------------------------------
  // Event emission
  // --------------------------------------------------------

  describe('event emission', () => {
    it('emits foundry:shield event after successful check', async () => {
      globalThis.fetch = mockFetchJson(200, SAFE_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:shield',
          subsystem: 'extension:foundry',
          safe: true,
        })
      );
    });

    it('emits foundry:shield event with safe: false when attack detected', async () => {
      globalThis.fetch = mockFetchJson(200, ATTACK_SHIELD_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getHostFn(ext, 'shield').fn({ text: 'attack' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:shield',
          safe: false,
        })
      );
    });
  });

  // --------------------------------------------------------
  // HTTP error handling
  // --------------------------------------------------------

  describe('HTTP error handling', () => {
    it('maps HTTP 401 to authentication failed', async () => {
      globalThis.fetch = mockFetchJson(401, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx)
      ).rejects.toThrow('foundry: authentication failed');
    });

    it('maps HTTP 429 to rate limit exceeded', async () => {
      globalThis.fetch = mockFetchJson(429, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSafety());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'shield').fn({ text: 'hello' }, ctx)
      ).rejects.toThrow('foundry: rate limit exceeded');
    });
  });
});
