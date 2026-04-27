/**
 * generate() function tests for Gemini extension
 * Validates structured output generation, schema handling, and events
 *
 * Covered by this file:
 *   AC-1, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12
 *   AC-18/EC-3, AC-25/EC-3, AC-19/EC-4
 *   AC-21/EC-5, AC-22/EC-5, AC-23/EC-5, AC-24/EC-5
 *   AC-27/EC-6, AC-34, AC-35
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeError,
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';
import { expectRejectedHalt } from './_halt-helpers.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Create a mock Gemini generateContent response for structured output.
 */
function createGenerateMockResponse(jsonContent: string) {
  return {
    responseId: 'resp_123',
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
    text: jsonContent,
    modelVersion: 'gemini-2.0-flash-001',
  };
}

/** Build a RillTypeValue from a TypeStructure for test usage. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return { __rill_type: true, typeName: structure.kind, structure } as unknown as RillTypeValue;
}

// Mock the Google GenAI SDK at module level
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        embedContent: vi.fn(),
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

const baseConfig: GeminiExtensionConfig = {
  api_key: 'test-key',
  model: 'gemini-2.0-flash',
};

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  const PERSON_SCHEMA = typeVal({ kind: 'dict', fields: { name: { type: { kind: 'string' } }, age: { type: { kind: 'number' } } } });
  const NAME_SCHEMA = typeVal({ kind: 'dict', fields: { name: { type: { kind: 'string' } } } });

  describe('success cases', () => {
    // AC-1: data field contains schema-matching keys
    it('returns data dict with keys matching the schema', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: PERSON_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(data).toBeDefined();
      expect(data['name']).toBe('Alice');
      expect(data['age']).toBe(30);
      expect(Object.keys(data).sort()).toEqual(['age', 'name']);
    });

    // AC-6: Return dict has exactly 6 keys
    it('returns dict with exactly 6 keys: data, raw, model, usage, stop_reason, id', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: PERSON_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      const keys = Object.keys(result).sort();
      expect(keys).toEqual([
        'data',
        'id',
        'model',
        'raw',
        'stop_reason',
        'usage',
      ]);
      expect(keys).toHaveLength(6);
    });

    // AC-7: usage is dict with input: number and output: number
    it('returns usage dict with input and output as numbers', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"score":99}')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'rate something', schema: typeVal({ kind: 'dict', fields: { score: { type: { kind: 'number' } } } }), options: {} },
        ctx
      )) as Record<string, unknown>;

      const usage = result['usage'] as Record<string, unknown>;
      expect(usage).toBeDefined();
      expect(typeof usage['input']).toBe('number');
      expect(typeof usage['output']).toBe('number');
      expect(usage['input']).toBe(50);
      expect(usage['output']).toBe(20);
    });

    // AC-8: raw contains original JSON string from response.text
    it('returns raw as the original JSON string from response.text', async () => {
      const jsonText = '{"name":"Alice","age":30}';
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse(jsonText)
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: PERSON_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonText);
      expect(typeof result['raw']).toBe('string');
    });

    // AC-9: system option overrides factory default
    it('uses system option to override factory-configured default', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"answer":"yes"}')
      );

      const configWithSystem: GeminiExtensionConfig = {
        ...baseConfig,
        system: 'Default system prompt.',
      };

      const ext = createGeminiExtension(configWithSystem);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'question',
          schema: typeVal({ kind: 'dict', fields: { answer: { type: { kind: 'string' } } } }),
          options: { system: 'Override system.' },
        },
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

    // AC-10: max_tokens option caps output tokens
    it('passes max_tokens option to the API as maxOutputTokens', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"result":"ok"}')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({ kind: 'dict', fields: { result: { type: { kind: 'string' } } } }),
          options: { max_tokens: 512 },
        },
        ctx
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 512,
          }),
        })
      );
    });

    // AC-11: messages option prepends conversation context
    it('prepends messages option as conversation context before the prompt', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"summary":"brief"}')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      const priorMessages = [
        { role: 'user', content: 'Context message.' },
        { role: 'assistant', content: 'Acknowledged.' },
      ];

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'final prompt',
          schema: typeVal({ kind: 'dict', fields: { summary: { type: { kind: 'string' } } } }),
          options: { messages: priorMessages },
        },
        ctx
      );

      const callArgs = mockGenerateContent.mock.calls[0]?.[0] as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      };
      expect(callArgs.contents[0]).toMatchObject({
        role: 'user',
        parts: [{ text: 'Context message.' }],
      });
      expect(callArgs.contents[1]).toMatchObject({
        role: 'model',
        parts: [{ text: 'Acknowledged.' }],
      });
      // Prompt is the last content entry
      const lastContent = callArgs.contents[callArgs.contents.length - 1];
      expect(lastContent).toMatchObject({
        role: 'user',
        parts: [{ text: 'final prompt' }],
      });
    });

    // AC-12: absent system uses factory-configured default
    it('uses factory system when no system override in options', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"value":1}')
      );

      const configWithSystem: GeminiExtensionConfig = {
        ...baseConfig,
        system: 'Factory default system.',
      };

      const ext = createGeminiExtension(configWithSystem);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({ kind: 'dict', fields: { value: { type: { kind: 'number' } } } }),
          options: {},
        },
        ctx
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'Factory default system.',
          }),
        })
      );
    });
  });

  describe('error cases', () => {
    // AC-18/EC-3: Missing schema throws RILL-R005
    it('throws RILL-R005 with "generate requires a type expression as schema" when schema is absent', async () => {
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx), { message: 'generate requires a type expression as schema' });
    });

    // AC-18/EC-3: Missing schema throws RuntimeError
    it('throws a RuntimeError instance when schema is absent', async () => {
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R005');
    });

    // AC-25/EC-3: No HTTP call when schema is missing
    it('makes no API call when schema option is absent', async () => {
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)).rejects.toThrow();

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    // AC-19/EC-4: Unsupported type throws RILL-R005 before HTTP
    it('throws RILL-R005 for unsupported schema type before making any API call', async () => {
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          {
            prompt: 'prompt',
            schema: typeVal({ kind: 'dict', fields: { field: { type: { kind: 'unsupported_type' } } } }),
            options: {},
          },
          ctx
        )
      , { message: 'unsupported type: unsupported_type' });

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    // AC-21/EC-5: "not json" response throws RILL-R005
    it('throws RILL-R005 when response text is not valid JSON', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('not json')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        )
      , { message: 'generate: failed to parse response JSON:' });
    });

    // AC-22/EC-5: "{broken" response throws with original parse error detail
    it('includes original parse error detail in thrown message for malformed JSON', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{broken')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        );
      } catch (err) {
        thrown = err;
      }

      const message = (thrown as RuntimeError).message;
      expect(message).toContain('generate: failed to parse response JSON:');
      // Message must contain the native JSON parse error detail beyond the prefix
      expect(message.length).toBeGreaterThan(
        'generate: failed to parse response JSON:'.length
      );
    });

    // AC-23/EC-5: Parse error is RuntimeError with RILL-R005
    it('throws a RuntimeError with RILL-R005 code when response parse fails', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{broken')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R005');
    });

    // AC-24/EC-5: Parse failure returns no partial dict
    it('rejects rather than resolving with partial data on parse failure', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('not json')
      );

      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        )
      ).rejects.toThrow();
    });

    // AC-27/EC-6: Provider API error emits gemini:error
    it('emits gemini:error event when the provider API returns an error', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('API request failed (500)')
      );

      const events: Array<Record<string, unknown>> = [];
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        )
      ).rejects.toThrow();

      const errorEvent = events.find((e) => e['event'] === 'gemini:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['error']).toBe('string');
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });

  describe('event emission', () => {
    // AC-34: Success emits gemini:generate with model, usage, duration
    it('emits gemini:generate event on success with model, usage, and duration', async () => {
      mockGenerateContent.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const events: Array<Record<string, unknown>> = [];
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: PERSON_SCHEMA, options: {} },
        ctx
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:generate',
        subsystem: 'extension:gemini',
        model: 'gemini-2.0-flash',
        usage: { input: 50, output: 20 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    // AC-35: Failure emits gemini:error (provider API rejection)
    it('emits gemini:error event on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('network error'));

      const events: Array<Record<string, unknown>> = [];
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} },
          ctx
        )
      ).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'gemini:error',
        subsystem: 'extension:gemini',
      });
      expect(typeof events[0]?.['error']).toBe('string');
      expect(typeof events[0]?.['duration']).toBe('number');
    });

    // AC-35/EC-3: Validation-path RuntimeError also emits gemini:error
    it('emits gemini:error event when schema is absent (EC-3/AC-35)', async () => {
      const events: Array<Record<string, unknown>> = [];
      const ext = createGeminiExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)).rejects.toThrow();

      const errorEvent = events.find((e) => e['event'] === 'gemini:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });
});
