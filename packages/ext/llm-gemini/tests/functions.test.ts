/**
 * Function behavior tests for message() and messages()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, callable, type RillValue } from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock Google API response.
 */
function createMockResponse(content: string) {
  return {
    text: content,
  };
}

// Mock the Google GenAI SDK at module level
const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        embedContent: mockEmbedContent,
      };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
    },
  };
});

// ============================================================
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe('success cases', () => {
    // AC-2: message("text") returns dict with required fields
    it('returns dict with content, model, usage, stop_reason, id, messages', async () => {
      mockGenerateContent.mockResolvedValue(
        createMockResponse('Hello from Google!')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.message.fn({ text: 'Hello' }, ctx)) as Record<
        string,
        unknown
      >;

      expect(result).toBeDefined();
      expect(result['content']).toBe('Hello from Google!');
      expect(result['model']).toBe('gemini-2.0-flash');
      expect(result['usage']).toEqual({ input: 0, output: 0 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['id']).toBe('');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from Google!' },
      ]);
    });

    it('sends correct parameters to Google API without system prompt', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        temperature: 0.7,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn({ text: 'What is 2+2?' }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'What is 2+2?' }],
          },
        ],
        config: {
          maxOutputTokens: 8192,
          temperature: 0.7,
        },
      });
    });

    it('sends system instruction via config parameter', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn({ text: 'What is 2+2?' }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'What is 2+2?' }],
          },
        ],
        config: {
          systemInstruction: 'You are helpful.',
          maxOutputTokens: 8192,
          temperature: 0.7,
        },
      });
    });

    it('accepts options dict with system override', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        system: 'Default system.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn({ text: 'Test', options: { system: 'Override system.' } }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'Override system.',
          }),
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        max_tokens: 1000,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn({ text: 'Test', options: { max_tokens: 2000 } }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 2000,
          }),
        })
      );
    });

    it('uses default max_tokens when not specified', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.message.fn({ text: 'Test' }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 8192,
          }),
        })
      );
    });

    it('includes system message in messages field when system provided', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        system: 'You are helpful.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.message.fn({ text: 'Test' }, ctx)) as Record<
        string,
        unknown
      >;

      expect(result['messages']).toEqual([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Test' },
        { role: 'assistant', content: 'Response' },
      ]);
    });
  });

  describe('error cases', () => {
    // EC-5: Empty prompt text
    it('throws RuntimeError for empty prompt text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: '' }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    it('throws RuntimeError for whitespace-only prompt text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: '   ' }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-7: API authentication failure
    it('throws RuntimeError for 401 authentication error', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('authentication failed (401)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: 'Test' }, ctx)).rejects.toThrow(
        'Gemini API error (HTTP 401): authentication failed (401)'
      );
    });

    // EC-6: API rate limit error
    it('throws RuntimeError for 429 rate limit error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('rate limit exceeded'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: 'Test' }, ctx)).rejects.toThrow(
        'Gemini API error: rate limit exceeded'
      );
    });

    // EC-8: Network timeout error
    it('throws RuntimeError for timeout error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: 'Test' }, ctx)).rejects.toThrow(
        'Gemini API error: Request timeout'
      );
    });

    // EC-9: Generic API error with status
    it('throws RuntimeError for generic API error', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('Internal server error (500)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.message.fn({ text: 'Test' }, ctx)).rejects.toThrow(
        'Gemini API error (HTTP 500): Internal server error (500)'
      );
    });
  });
});

// ============================================================
// MESSAGES() TESTS
// ============================================================

describe('messages() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe('success cases', () => {
    // AC-3: messages([...]) handles conversation history
    it('returns dict with conversation history', async () => {
      mockGenerateContent.mockResolvedValue(
        createMockResponse('Sure, I can help!')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
      ];

      const result = (await ext.messages.fn({ messages: inputMessages }, ctx)) as Record<
        string,
        unknown
      >;

      expect(result['content']).toBe('Sure, I can help!');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
        { role: 'assistant', content: 'Sure, I can help!' },
      ]);
    });

    it('sends system instruction via config parameter', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        system: 'You are helpful.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Hello' }];

      await ext.messages.fn({ messages: inputMessages }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'You are helpful.',
          }),
        })
      );
    });

    it('accepts options dict with system override', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        system: 'Default system.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];

      await ext.messages.fn(
        { messages: inputMessages, options: { system: 'Override system.' } },
        ctx
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'Override system.',
          }),
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];

      await ext.messages.fn({ messages: inputMessages, options: { max_tokens: 2000 } }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 2000,
          }),
        })
      );
    });

    it('translates assistant role to model role for Google API', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      await ext.messages.fn({ messages: inputMessages }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
          {
            role: 'model',
            parts: [{ text: 'Hi there!' }],
          },
          {
            role: 'user',
            parts: [{ text: 'How are you?' }],
          },
        ],
        config: {
          maxOutputTokens: 8192,
        },
      });
    });

    it('translates tool role to user role for Google API', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'tool', content: 'Sunny, 72°F' },
      ];

      await ext.messages.fn({ messages: inputMessages }, ctx);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'What is the weather?' }],
          },
          {
            role: 'user',
            parts: [{ text: 'Sunny, 72°F' }],
          },
        ],
        config: {
          maxOutputTokens: 8192,
        },
      });
    });
  });

  describe('validation error cases', () => {
    // AC-23: Empty messages list raises error
    it('throws RuntimeError for empty messages list', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.messages.fn({ messages: [] }, ctx)).rejects.toThrow(
        'messages list cannot be empty'
      );
    });

    // EC-10: Missing role field
    it('throws RuntimeError for message missing role field', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ content: 'Hello' }];

      await expect(ext.messages.fn({ messages: invalidMessages }, ctx)).rejects.toThrow(
        "message missing required 'role' field"
      );
    });

    // EC-11: Invalid role value
    it('throws RuntimeError for invalid role value', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'system', content: 'Hello' }];

      await expect(ext.messages.fn({ messages: invalidMessages }, ctx)).rejects.toThrow(
        "invalid role 'system'"
      );
    });

    // EC-12: User message missing content
    it('throws RuntimeError for user message missing content', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user' }];

      await expect(ext.messages.fn({ messages: invalidMessages }, ctx)).rejects.toThrow(
        "user message requires 'content'"
      );
    });

    // EC-13: Assistant message missing both content and tool_calls
    it('throws RuntimeError for assistant message missing content and tool_calls', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'assistant' }];

      await expect(ext.messages.fn({ messages: invalidMessages }, ctx)).rejects.toThrow(
        "assistant message requires 'content' or 'tool_calls'"
      );
    });

    it('accepts assistant message with content', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      await expect(
        ext.messages.fn({ messages: validMessages }, ctx)
      ).resolves.toBeDefined();
    });

    it('accepts tool message with content', async () => {
      mockGenerateContent.mockResolvedValue(createMockResponse('Response'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'Tool output' },
      ];

      await expect(
        ext.messages.fn({ messages: validMessages }, ctx)
      ).resolves.toBeDefined();
    });

    it('throws RuntimeError for tool message missing content', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'tool' }];

      await expect(ext.messages.fn({ messages: invalidMessages }, ctx)).rejects.toThrow(
        "tool message requires 'content'"
      );
    });
  });

  describe('API error cases', () => {
    // EC-14: API errors apply to messages() too
    it('throws RuntimeError for 401 authentication error', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('authentication failed (401)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn({ messages: messages }, ctx)).rejects.toThrow(
        'Gemini API error (HTTP 401): authentication failed (401)'
      );
    });

    it('throws RuntimeError for 429 rate limit error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('rate limit exceeded'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn({ messages: messages }, ctx)).rejects.toThrow(
        'Gemini API error: rate limit exceeded'
      );
    });

    it('throws RuntimeError for timeout error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn({ messages: messages }, ctx)).rejects.toThrow(
        'Gemini API error: Request timeout'
      );
    });

    it('throws RuntimeError for generic API error', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('Internal server error (500)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];

      await expect(ext.messages.fn({ messages: messages }, ctx)).rejects.toThrow(
        'Gemini API error (HTTP 500): Internal server error (500)'
      );
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
  });

  describe('success cases', () => {
    // AC-4: embed() returns vector with .model and .dimensions
    it('returns RillVector with model and dimensions', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockEmbedContent.mockResolvedValue({
        embeddings: [{ values: mockEmbedding }],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed.fn({ text: 'Hello world' }, ctx)) as {
        __rill_vector: true;
        data: Float32Array;
        model: string;
      };

      expect(result.__rill_vector).toBe(true);
      expect(result.model).toBe('text-embedding-004');
      expect(result.data.length).toBe(4);
      // Check approximate equality due to Float32Array precision
      for (let i = 0; i < mockEmbedding.length; i++) {
        expect(result.data[i]).toBeCloseTo(mockEmbedding[i]!, 5);
      }
    });

    it('sends correct parameters to Google embedContent API', async () => {
      mockEmbedContent.mockResolvedValue({
        embeddings: [{ values: [0.1, 0.2] }],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await ext.embed.fn({ text: 'Test text' }, ctx);

      expect(mockEmbedContent).toHaveBeenCalledWith({
        model: 'text-embedding-004',
        contents: ['Test text'],
      });
    });
  });

  describe('error cases', () => {
    // EC-15: Empty text
    it('throws RuntimeError for empty text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn({ text: '' }, ctx)).rejects.toThrow(
        'embed text cannot be empty'
      );
    });

    // EC-16: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn({ text: 'Hello' }, ctx)).rejects.toThrow(
        'embed_model not configured'
      );
    });

    // EC-17: API errors
    it('throws RuntimeError for authentication error', async () => {
      mockEmbedContent.mockRejectedValue(
        new Error('401: authentication failed')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.embed.fn({ text: 'Hello' }, ctx)).rejects.toThrow(
        'Gemini API error: 401: authentication failed'
      );
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
  });

  describe('success cases', () => {
    // AC-5: embed_batch() returns list of vectors
    it('returns list of RillVector values', async () => {
      const mockEmbeddings = [
        { values: [0.1, 0.2] },
        { values: [0.3, 0.4] },
        { values: [0.5, 0.6] },
      ];
      mockEmbedContent.mockResolvedValue({
        embeddings: mockEmbeddings,
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await ext.embed_batch.fn(
        { texts: ['Hello', 'World', 'Test'] },
        ctx
      )) as Array<{
        __rill_vector: true;
        data: Float32Array;
        model: string;
      }>;

      expect(result).toHaveLength(3);
      expect(result[0]?.__rill_vector).toBe(true);
      expect(result[0]?.model).toBe('text-embedding-004');
      expect(result[0]?.data[0]).toBeCloseTo(0.1, 5);
      expect(result[0]?.data[1]).toBeCloseTo(0.2, 5);
    });

    // AC-24: Empty list returns empty list
    it('returns empty list for empty input without API call', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = await ext.embed_batch.fn({ texts: [] }, ctx);

      expect(result).toEqual([]);
      expect(mockEmbedContent).not.toHaveBeenCalled();
    });
  });

  describe('error cases', () => {
    // EC-18: Non-string element
    it('throws RuntimeError for non-string element', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn({ texts: ['Hello', 123, 'World'] }, ctx)
      ).rejects.toThrow('embed_batch requires list of strings');
    });

    // EC-19: Empty string in list
    it('throws RuntimeError for empty string at specific index', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn({ texts: ['Hello', '', 'World'] }, ctx)
      ).rejects.toThrow('embed text cannot be empty at index 1');
    });

    // EC-20: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.embed_batch.fn({ texts: ['Hello', 'World'] }, ctx)
      ).rejects.toThrow('embed_model not configured');
    });
  });
});

/**
 * Create an ApplicationCallable with description and param metadata for tool_loop tests.
 */
function makeTool(
  fn: (args: Record<string, RillValue>) => RillValue | Promise<RillValue>,
  options?: {
    description?: string;
    params?: Array<{ name: string; type: string; description?: string }>;
  }
): RillValue {
  const tool = callable(fn);
  if (options?.description !== undefined) {
    (tool as Record<string, unknown>)['description'] = options.description;
  }
  if (options?.params !== undefined) {
    (tool as Record<string, unknown>)['params'] = options.params.map((p) => ({
      name: p.name,
      type: { type: p.type },
      defaultValue: undefined,
      annotations: p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe('success cases', () => {
    // AC-6: tool_loop() executes agentic loop
    it('returns dict with content, turns, and messages', async () => {
      // First call: LLM makes tool call
      mockGenerateContent
        .mockResolvedValueOnce({
          text: '',
          functionCalls: [
            {
              name: 'get_weather',
              args: { location: 'NYC' },
              id: 'call_1',
            },
          ],
        })
        // Second call: LLM returns final text
        .mockResolvedValueOnce({
          text: 'The weather in NYC is sunny.',
          functionCalls: undefined,
        });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('sunny');
      const options = {
        tools: {
          get_weather: makeTool(mockToolFn, {
            description: 'Get weather for location',
          }),
        },
      };

      const result = (await ext.tool_loop.fn(
        { prompt: 'What is the weather in NYC?', options },
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('The weather in NYC is sunny.');
      expect(result['turns']).toBe(2);
      expect(result['stop_reason']).toBe('stop');
      expect(mockToolFn).toHaveBeenCalledTimes(1);
    });

    // AC-26: tool_loop() with 0 tool calls returns immediately
    it('returns immediately when LLM does not call tools', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'I cannot help with that.',
        functionCalls: undefined,
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn();
      const options = {
        tools: {
          get_weather: makeTool(mockToolFn),
        },
      };

      const result = (await ext.tool_loop.fn(
        { prompt: 'Hello', options },
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('I cannot help with that.');
      expect(result['turns']).toBe(1);
      expect(mockToolFn).not.toHaveBeenCalled();
    });

    // AC-25: tool_loop() with max_turns:1 stops after one response
    it('stops after one turn when max_turns is 1', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '',
        functionCalls: [
          {
            name: 'get_weather',
            args: {},
            id: 'call_1',
          },
        ],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const options = {
        tools: {
          get_weather: makeTool(vi.fn().mockResolvedValue('sunny')),
        },
        max_turns: 1,
      };

      const result = (await ext.tool_loop.fn({ prompt: 'Test', options }, ctx)) as Record<
        string,
        unknown
      >;

      expect(result['stop_reason']).toBe('max_turns');
      expect(result['turns']).toBe(1);
    });
  });

  describe('error cases', () => {
    // EC-22: Empty prompt
    it('throws RuntimeError for empty prompt', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const options = {
        tools: { test: makeTool(vi.fn()) },
      };

      await expect(ext.tool_loop.fn({ prompt: '   ', options }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-23: Missing tools option
    it('throws RuntimeError when tools option missing', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.tool_loop.fn({ prompt: 'Hello', options: {} }, ctx)).rejects.toThrow(
        "tool_loop requires 'tools' option"
      );
    });

    // EC-24: Unknown tool called by LLM
    it('throws RuntimeError for unknown tool after max_errors', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '',
        functionCalls: [
          {
            name: 'unknown_tool',
            args: {},
            id: 'call_1',
          },
        ],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const options = {
        tools: {
          get_weather: makeTool(vi.fn()),
        },
        max_errors: 3,
      };

      await expect(ext.tool_loop.fn({ prompt: 'Test', options }, ctx)).rejects.toThrow(
        'Tool execution failed: 3 consecutive errors'
      );
    });

    // EC-25: max_errors exceeded
    it('throws RuntimeError after max_errors consecutive errors', async () => {
      // LLM keeps calling tool that errors
      mockGenerateContent.mockResolvedValue({
        text: '',
        functionCalls: [
          {
            name: 'failing_tool',
            args: {},
            id: 'call_1',
          },
        ],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const options = {
        tools: {
          failing_tool: makeTool(
            vi.fn().mockRejectedValue(new Error('Tool failed'))
          ),
        },
        max_errors: 2,
      };

      await expect(ext.tool_loop.fn({ prompt: 'Test', options }, ctx)).rejects.toThrow(
        'Tool execution failed: 2 consecutive errors'
      );
    });
  });

  describe('concurrent independent calls', () => {
    // AC-27: Multiple concurrent tool_loop() calls operate independently
    it('handles multiple concurrent tool_loop calls independently', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext1 = createGeminiExtension(config);
      const ext2 = createGeminiExtension(config);
      const ctx1 = createRuntimeContext();
      const ctx2 = createRuntimeContext();

      // Mock responses for two independent calls
      mockGenerateContent
        .mockResolvedValueOnce({
          text: 'Response 1',
          functionCalls: undefined,
        })
        .mockResolvedValueOnce({
          text: 'Response 2',
          functionCalls: undefined,
        });

      const tools = {
        tool: makeTool(vi.fn(), { description: 'Tool' }),
      };

      const [result1, result2] = await Promise.all([
        ext1.tool_loop.fn({ prompt: 'Prompt 1', options: { tools } }, ctx1),
        ext2.tool_loop.fn({ prompt: 'Prompt 2', options: { tools } }, ctx2),
      ]);

      const r1 = result1 as Record<string, unknown>;
      const r2 = result2 as Record<string, unknown>;

      expect(r1['content']).toBe('Response 1');
      expect(r2['content']).toBe('Response 2');
      expect(r1['turns']).toBe(1);
      expect(r2['turns']).toBe(1);
    });
  });
});
