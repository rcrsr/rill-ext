/**
 * Function behavior tests for generate()
 * Validates structured output, error handling, and event emission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeHaltSignal,
  getStatus,
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import type { ExtensionEvent } from '@rcrsr/rill';
import { expectRejectedHalt } from './_halt-helpers.js';

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Build a RillTypeValue from a TypeStructure for test usage. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return {
    __rill_type: true,
    typeName: structure.kind,
    structure,
  } as unknown as RillTypeValue;
}

// ============================================================
// TEST HELPERS
// ============================================================

const BASE_CONFIG: AnthropicExtensionConfig = {
  api_key: 'test-key',
  model: 'claude-3-5-sonnet-20241022',
};

/**
 * Create mock Anthropic API response for generate tests.
 * The content text field holds the JSON string returned by the model.
 */
function createMockGenerateResponse(
  jsonText: string,
  model = 'claude-3-5-sonnet-20241022'
) {
  return {
    id: 'msg_123',
    model,
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 20 },
    content: [{ type: 'text', text: jsonText }],
  };
}

/**
 * Create event collector array for onLogEvent callback.
 */
function createEventCollector(): ExtensionEvent[] {
  return [];
}

/**
 * Create runtime context with event collector attached.
 */
function createCtxWithEvents(events: ExtensionEvent[]) {
  return createRuntimeContext({
    callbacks: {
      onLog: vi.fn(),
      onLogEvent: (event) => events.push(event),
    },
  });
}

// ============================================================
// SDK MOCK
// ============================================================

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(status: number, _error: any, message: string, _headers: any) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const PERSON_SCHEMA = typeVal({
    kind: 'dict',
    fields: {
      name: { type: { kind: 'string' } },
      age: { type: { kind: 'number' } },
    },
  });
  const NAME_SCHEMA = typeVal({
    kind: 'dict',
    fields: { name: { type: { kind: 'string' } } },
  });

  // --------------------------------------------------------
  // SUCCESS CASES
  // --------------------------------------------------------

  describe('success cases', () => {
    // AC-1: Returns data with schema-matching keys
    it('returns data with schema-matching keys', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'Generate a person',
          schema: typeVal({
            kind: 'dict',
            fields: {
              name: { type: { kind: 'string' } },
              age: { type: { kind: 'number' } },
            },
          }),
        },
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(data['name']).toBe('Alice');
      expect(data['age']).toBe(30);
    });

    // AC-3: Nested dict schema returns data.addr as dict with expected keys
    it('returns nested dict data when schema has nested dict', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse(
          '{"addr":{"street":"123 Main St","city":"Springfield"}}'
        )
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'Generate an address',
          schema: typeVal({
            kind: 'dict',
            fields: {
              addr: {
                type: {
                  kind: 'dict',
                  fields: {
                    street: { type: { kind: 'string' } },
                    city: { type: { kind: 'string' } },
                  },
                },
              },
            },
          }),
        },
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      const addr = data['addr'] as Record<string, unknown>;
      expect(typeof addr).toBe('object');
      expect(addr['street']).toBe('123 Main St');
      expect(addr['city']).toBe('Springfield');
    });

    // AC-4: List schema returns data.tags as list
    it('returns list data when schema has list field', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"tags":["typescript","node","testing"]}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'Generate tags',
          schema: typeVal({
            kind: 'dict',
            fields: {
              tags: { type: { kind: 'list', element: { kind: 'string' } } },
            },
          }),
        },
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(Array.isArray(data['tags'])).toBe(true);
      expect(data['tags']).toEqual(['typescript', 'node', 'testing']);
    });

    // AC-6: Return dict contains exactly 7 keys (includes messages)
    it('returns dict with exactly 7 keys', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: PERSON_SCHEMA },
        ctx
      )) as Record<string, unknown>;

      expect(Object.keys(result)).toHaveLength(7);
      expect(Object.keys(result).sort()).toEqual(
        [
          'data',
          'id',
          'messages',
          'model',
          'raw',
          'stop_reason',
          'usage',
        ].sort()
      );
    });

    // AC-7: usage is dict with input: number and output: number
    it('usage contains input and output as numbers', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: PERSON_SCHEMA },
        ctx
      )) as Record<string, unknown>;

      const usage = result['usage'] as Record<string, unknown>;
      expect(typeof usage['input']).toBe('number');
      expect(typeof usage['output']).toBe('number');
      expect(usage['input']).toBe(50);
      expect(usage['output']).toBe(20);
    });

    // AC-8: raw contains original JSON string from model
    it('raw contains original JSON string returned by the model', async () => {
      const jsonText = '{"name":"Alice","age":30}';
      mockCreate.mockResolvedValue(createMockGenerateResponse(jsonText));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: PERSON_SCHEMA },
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonText);
    });

    // AC-9: factory system is forwarded to Anthropic API
    it('factory-configured system prompt is forwarded to Anthropic API', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension({
        ...BASE_CONFIG,
        system: 'Factory system prompt.',
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'Generate',
          schema: NAME_SCHEMA,
        },
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'Factory system prompt.' })
      );
    });

    // AC-10: factory max_tokens is forwarded to Anthropic API
    it('factory max_tokens is forwarded to Anthropic API', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension({ ...BASE_CONFIG, max_tokens: 512 });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: NAME_SCHEMA },
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 512 })
      );
    });

    // AC-11: list prompt prepends conversation context before final user turn
    it('messages option prepends conversation context before prompt via list prompt', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      // Pass conversation history + final prompt as list (content-sugar format)
      const promptList = [
        { role: 'user', content: 'What format do you prefer?' },
        { role: 'assistant', content: 'I prefer JSON.' },
        { role: 'user', content: 'Generate a name' },
      ];

      await getCallable(ext, 'generate').fn(
        {
          prompt: promptList,
          schema: NAME_SCHEMA,
        },
        ctx
      );

      const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<Record<string, unknown>>;

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'What format do you prefer?',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'I prefer JSON.',
      });
      expect(messages[2]).toEqual({ role: 'user', content: 'Generate a name' });
    });

    // AC-12: Absent system uses factory-configured default
    it('uses factory system prompt when no system option provided', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice"}')
      );

      const ext = createAnthropicExtension({
        ...BASE_CONFIG,
        system: 'Factory system prompt.',
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: NAME_SCHEMA },
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'Factory system prompt.' })
      );
    });
  });

  // --------------------------------------------------------
  // ERROR CASES
  // --------------------------------------------------------

  describe('error cases', () => {
    // AC-18 / EC-3: Missing schema throws RILL-R005
    it('throws RILL-R005 when schema option is missing', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'Generate something' }, ctx),
        {
          code: 'INVALID_INPUT',
          message: 'generate requires a type expression as schema',
        }
      );
    });

    // AC-25 / EC-3: No HTTP call when schema is missing
    it('makes no HTTP call when schema option is missing', async () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'Generate something' }, ctx)
      );

      expect(mockCreate).not.toHaveBeenCalled();
    });

    // AC-21 / EC-5: "not json" response throws RILL-R005
    it('throws RILL-R005 when model returns non-JSON text', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        ),
        { code: 'PROTOCOL' }
      );
    });

    // AC-22 / EC-5: "{broken" response includes original parse error detail
    it('throws RILL-R005 with original parse error detail for malformed JSON', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('{broken'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        ),
        { code: 'PROTOCOL', message: 'failed to parse response JSON' }
      );
    });

    // AC-23 / EC-5: Parse failure error is instance of RuntimeError with RILL-R005
    it('parse failure throws RuntimeError instance with RILL-R005', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expect(getStatus((thrown as RuntimeHaltSignal).value).code.name).toBe(
        'PROTOCOL'
      );
    });

    // AC-24 / EC-5: Parse failure never returns a partial dict
    it('parse failure does not return a partial result', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      let result: unknown = undefined;
      try {
        result = await getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        );
      } catch {
        // expected
      }

      expect(result).toBeUndefined();
    });

    // AC-27 / EC-6: Provider API error emits anthropic:error event
    it('emits anthropic:error event when provider API throws', async () => {
      const { APIError } = await import('@anthropic-ai/sdk');
      const apiError = new APIError(429, {}, 'Rate limit exceeded', {});
      mockCreate.mockRejectedValue(apiError);

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        )
      );

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.error).toContain('Rate limit exceeded');
    });
  });

  // --------------------------------------------------------
  // EVENT EMISSION
  // --------------------------------------------------------

  describe('event emission', () => {
    // AC-32: Successful call emits anthropic:generate with model, usage, duration
    it('emits anthropic:generate event with model, usage, and duration on success', async () => {
      mockCreate.mockResolvedValue(
        createMockGenerateResponse('{"name":"Alice","age":30}')
      );

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await getCallable(ext, 'generate').fn(
        { prompt: 'Generate', schema: PERSON_SCHEMA },
        ctx
      );

      const generateEvents = events.filter(
        (e) => e.event === 'anthropic:generate'
      );
      expect(generateEvents).toHaveLength(1);

      const event = generateEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(event.model).toBe('claude-3-5-sonnet-20241022');
      expect(event.usage).toEqual({ input: 50, output: 20 });
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    // AC-35: Failed call emits anthropic:error event
    it('emits anthropic:error event when generate fails', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('{broken'));

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        )
      );

      const errorEvents = events.filter((e) => e.event === 'anthropic:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:anthropic');
      expect(typeof event.error).toBe('string');
      expect(typeof event.duration).toBe('number');
    });

    it('does not emit anthropic:generate event on failure', async () => {
      mockCreate.mockResolvedValue(createMockGenerateResponse('not json'));

      const events = createEventCollector();
      const ext = createAnthropicExtension(BASE_CONFIG);
      const ctx = createCtxWithEvents(events);

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'Generate', schema: NAME_SCHEMA },
          ctx
        )
      );

      const generateEvents = events.filter(
        (e) => e.event === 'anthropic:generate'
      );
      expect(generateEvents).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // FUNCTION METADATA
  // --------------------------------------------------------

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);

      // generate now has 2 params: prompt (any) and schema (type)
      expect(getCallable(ext, 'generate').params).toEqual([
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        {
          name: 'schema',
          type: { kind: 'type' },
          defaultValue: undefined,
          annotations: {
            description: 'Type expression for structured output schema',
          },
        },
      ]);
    });

    it('has correct return type', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);
      const returnType = getCallable(ext, 'generate').returnType as {
        __rill_type: boolean;
        typeName: string;
        structure: { kind: string; fields: Record<string, unknown> };
      };

      expect(returnType.__rill_type).toBe(true);
      expect(returnType.typeName).toBe('dict');
      expect(returnType.structure.kind).toBe('dict');
      // Verify all expected fields are present (messages added in unified-prompting migration)
      const fields = returnType.structure.fields;
      expect(fields).toHaveProperty('data');
      expect(fields).toHaveProperty('raw');
      expect(fields).toHaveProperty('messages');
      expect(fields).toHaveProperty('model');
      expect(fields).toHaveProperty('usage');
      expect(fields).toHaveProperty('stop_reason');
      expect(fields).toHaveProperty('id');
    });

    it('has description string', () => {
      const ext = createAnthropicExtension(BASE_CONFIG);

      expect(
        typeof getCallable(ext, 'generate').annotations?.['description']
      ).toBe('string');
      expect(
        (getCallable(ext, 'generate').annotations!['description'] as string)
          .length
      ).toBeGreaterThan(0);
    });
  });
});
