/**
 * Grounding function tests for Azure AI Foundry extension.
 * Tests the callGround/ground host function: AzureOpenAI responses API mocking,
 * return shape, config validation, and event emission.
 *
 * Covers: AC-10, AC-20, EC-9.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';
import { expectRejectedHalt } from './_halt-helpers.js';

// ============================================================
// MODULE MOCK
// ============================================================

// mockResponsesCreate is module-scoped so per-test configuration works.
const mockResponsesCreate = vi.fn();

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
      responses = {
        create: (...args: unknown[]) => mockResponsesCreate(...args),
      };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = { completions: { create: vi.fn(), stream: vi.fn() } };
      embeddings = { create: vi.fn() };
      responses = {
        create: (...args: unknown[]) => mockResponsesCreate(...args),
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

type AsyncHostFn = (
  args: Record<string, unknown>,
  ctx: unknown
) => Promise<unknown>;
type ExtValue = Record<string, { fn: AsyncHostFn }>;

function getHostFn(ext: { value: unknown }, name: string) {
  return (ext.value as ExtValue)[name]!;
}

// ============================================================
// FIXTURES
// ============================================================

/** Config with grounding and inference configured. */
function configWithGrounding(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    inference: {
      model: 'gpt-4o',
      apiVersion: '2025-01-01-preview',
    },
    grounding: {
      connectionId:
        '/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry/connections/bing-search',
    },
  };
}

/** Config with grounding using an explicit model. */
function configWithGroundingModel(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    grounding: {
      connectionId: '/subscriptions/sub-123/resourceGroups/rg/connections/bing',
      model: 'gpt-4o-grounding',
    },
    inference: {
      model: 'gpt-4o',
      apiVersion: '2025-01-01-preview',
    },
  };
}

/** Config without grounding. */
function configWithoutGrounding(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
  };
}

/**
 * Build a mock AzureOpenAI responses.create() result.
 * Includes one message output item with output_text content and url_citation annotation.
 */
function buildGroundingResponse(
  answer: string,
  citations: Array<{ url: string; title: string }>
) {
  const annotations = citations.map((c, i) => ({
    type: 'url_citation' as const,
    url: c.url,
    title: c.title,
    start_index: i * 100,
    end_index: i * 100 + 50,
  }));

  return {
    output_text: answer,
    output: [
      {
        type: 'message' as const,
        content: [
          {
            type: 'output_text' as const,
            text: answer,
            annotations,
          },
        ],
      },
    ],
    model: 'gpt-4o',
    usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 },
  };
}

/** Empty grounding response with no citations. */
const EMPTY_GROUNDING_RESPONSE = buildGroundingResponse(
  'No results found.',
  []
);

/** Grounding response with one citation. */
const ONE_CITATION_RESPONSE = buildGroundingResponse(
  'Azure is a cloud platform.',
  [{ url: 'https://azure.microsoft.com', title: 'Microsoft Azure' }]
);

/** Grounding response with two citations. */
const TWO_CITATION_RESPONSE = buildGroundingResponse(
  'Azure AI Foundry provides AI services.',
  [
    { url: 'https://azure.microsoft.com/ai', title: 'Azure AI' },
    { url: 'https://learn.microsoft.com/azure', title: 'Azure Docs' },
  ]
);

// ============================================================
// TESTS
// ============================================================

describe('ground() host function', () => {
  beforeEach(() => {
    mockResponsesCreate.mockReset();
  });

  // --------------------------------------------------------
  // AC-10: Returns { answer, citations }
  // --------------------------------------------------------

  describe('returns { answer, citations } [AC-10]', () => {
    it('returns a dict with answer and citations fields [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'What is Azure?' },
        ctx
      )) as Record<string, unknown>;

      expect('answer' in result).toBe(true);
      expect('citations' in result).toBe(true);
    });

    it('answer is the response output_text string [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'What is Azure?' },
        ctx
      )) as Record<string, unknown>;

      expect(result['answer']).toBe('Azure is a cloud platform.');
    });

    it('citations is a list of dicts [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'What is Azure?' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['citations'])).toBe(true);
    });

    it('each citation has url and title fields [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'What is Azure?' },
        ctx
      )) as Record<string, unknown>;

      const citations = result['citations'] as Array<Record<string, unknown>>;
      expect(citations.length).toBe(1);
      expect(citations[0]!['url']).toBe('https://azure.microsoft.com');
      expect(citations[0]!['title']).toBe('Microsoft Azure');
    });

    it('returns multiple citations when response contains multiple [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(TWO_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'Tell me about Azure AI' },
        ctx
      )) as Record<string, unknown>;

      const citations = result['citations'] as Array<Record<string, unknown>>;
      expect(citations.length).toBe(2);
    });

    it('returns empty citations list when no url_citation annotations [AC-10]', async () => {
      mockResponsesCreate.mockResolvedValue(EMPTY_GROUNDING_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'ground').fn(
        { query: 'something' },
        ctx
      )) as Record<string, unknown>;

      const citations = result['citations'] as Array<Record<string, unknown>>;
      expect(citations.length).toBe(0);
    });
  });

  // --------------------------------------------------------
  // API call structure
  // --------------------------------------------------------

  describe('API call structure', () => {
    it('calls responses.create with bing_grounding tool', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'ground').fn({ query: 'What is Azure?' }, ctx);

      expect(mockResponsesCreate).toHaveBeenCalledOnce();
      const [callArgs] = mockResponsesCreate.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(Array.isArray(callArgs['tools'])).toBe(true);
      const tools = callArgs['tools'] as Array<Record<string, unknown>>;
      expect(tools[0]!['type']).toBe('bing_grounding');
    });

    it('passes query as input to responses.create', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'ground').fn({ query: 'What is Azure?' }, ctx);

      const [callArgs] = mockResponsesCreate.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(callArgs['input']).toBe('What is Azure?');
    });

    it('uses grounding.connectionId in bing_grounding tool config', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'ground').fn({ query: 'test' }, ctx);

      const [callArgs] = mockResponsesCreate.mock.calls[0] as [
        Record<string, unknown>,
      ];
      const tools = callArgs['tools'] as Array<Record<string, unknown>>;
      const bingTool = tools[0] as Record<string, unknown>;
      const bingGrounding = bingTool['bing_grounding'] as {
        search_configurations: Array<{ project_connection_id: string }>;
      };
      expect(
        bingGrounding.search_configurations[0]!.project_connection_id
      ).toContain('bing-search');
    });

    it('uses grounding.model when set instead of inference.model', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGroundingModel());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'ground').fn({ query: 'test' }, ctx);

      const [callArgs] = mockResponsesCreate.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(callArgs['model']).toBe('gpt-4o-grounding');
    });

    it('falls back to inference.model when grounding.model not set', async () => {
      mockResponsesCreate.mockResolvedValue(ONE_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'ground').fn({ query: 'test' }, ctx);

      const [callArgs] = mockResponsesCreate.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(callArgs['model']).toBe('gpt-4o');
    });
  });

  // --------------------------------------------------------
  // AC-20, EC-9: grounding not configured
  // --------------------------------------------------------

  describe('grounding not configured [AC-20, EC-9]', () => {
    it('halts with #UNAVAILABLE when grounding config absent [AC-20, EC-9]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutGrounding());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx),
        { code: 'UNAVAILABLE', provider: 'foundry' }
      );
    });

    it('error message is "foundry: grounding connection not configured" [EC-9]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutGrounding());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx),
        { message: 'foundry: grounding connection not configured' }
      );
    });

    it('responses.create is not called when grounding not configured [AC-20]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutGrounding());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx)
      ).rejects.toThrow();

      expect(mockResponsesCreate).not.toHaveBeenCalled();
    });

    it('throws when neither grounding.model nor inference.model is set', async () => {
      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-api-key' },
        grounding: {
          connectionId: '/subscriptions/sub-123/connections/bing',
          // no model
        },
        // no inference.model
      };

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx),
        { message: 'grounding requires a model' }
      );
    });
  });

  // --------------------------------------------------------
  // Event emission
  // --------------------------------------------------------

  describe('event emission', () => {
    it('emits foundry:ground event with citationCount on success', async () => {
      mockResponsesCreate.mockResolvedValue(TWO_CITATION_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getHostFn(ext, 'ground').fn({ query: 'azure ai' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:ground',
          subsystem: 'extension:foundry',
          citationCount: 2,
        })
      );
    });

    it('emits foundry:ground:error event on failure', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('API error'));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx)
      ).rejects.toThrow();

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:ground:error',
          subsystem: 'extension:foundry',
          error: expect.any(String),
        })
      );
    });
  });

  // --------------------------------------------------------
  // Error mapping
  // --------------------------------------------------------

  describe('error mapping', () => {
    it('wraps unexpected error as halt via mapProviderError', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network failure'));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx),
        { provider: 'foundry' }
      );
    });

    it('error message includes original error message', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Connection refused'));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithGrounding());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'ground').fn({ query: 'test' }, ctx),
        { message: 'Connection refused' }
      );
    });
  });
});
