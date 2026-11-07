/**
 * Boundary condition and error-path tests for the Gemini extension
 * unified prompting surface (spec §Acceptance Criteria / Boundary Conditions).
 *
 * Covers: AC-B2, AC-B3, AC-B4, AC-B8, AC-E8, AC-E9, AC-E13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  callable,
  isInvalid,
  getStatus,
  RuntimeHaltSignal,
  type ApplicationCallable,
  type RillValue,
  type RillStream,
} from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Drain a RillStream to completion and return the resolved dict. */
async function collectStream(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<Record<string, unknown>> {
  let current = stream as RillStream;
  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
  }
  return (await (
    stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
  ).__rill_stream_resolve()) as Record<string, unknown>;
}

/** Build an async generator that yields simple text chunks. */
async function* makeChunksIterable(
  chunks: string[]
): AsyncGenerator<{ text: string }> {
  for (const text of chunks) {
    yield { text };
  }
}

/**
 * Create a minimal callable tool value for tool_loop tests.
 * Attaches a description so executeToolLoop can build schema from it.
 */
function makeTool(
  fn: (args: Record<string, RillValue>) => RillValue | Promise<RillValue>,
  description = 'A test tool'
): RillValue {
  return { ...callable(fn), annotations: { description } };
}

// ============================================================
// MODULE-LEVEL MOCK (@google/genai)
// ============================================================

const mockGenerateContentStream = vi.fn();
const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
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
// BASE CONFIG
// ============================================================

const BASE_CONFIG: GeminiExtensionConfig = {
  api_key: 'test-key',
  model: 'gemini-2.0-flash',
};

// ============================================================
// BOUNDARY CONDITION TESTS
// ============================================================

describe('Gemini boundary conditions', () => {
  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    mockGenerateContent.mockReset();
    mockEmbedContent.mockReset();
    mockGenerateContentStream.mockResolvedValue(makeChunksIterable(['ok']));
  });

  // ──────────────────────────────────────────────────────────
  // AC-B2: Multiple consecutive user turns accepted
  // ──────────────────────────────────────────────────────────

  describe('AC-B2: multiple consecutive user turns', () => {
    it('accepts a message list with two consecutive user turns', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', content: 'first message' },
        { role: 'user', content: 'second message' },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      // Should not be invalid — multiple user turns are permitted
      expect(isInvalid(stream)).toBe(false);
      await collectStream(stream, ctx);

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            { role: 'user', parts: [{ text: 'first message' }] },
            { role: 'user', parts: [{ text: 'second message' }] },
          ],
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B3: User turn with image-only (no text) accepted
  // ──────────────────────────────────────────────────────────

  describe('AC-B3: image-only user turn', () => {
    it('accepts a user turn with only an image part and no text', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: {
                kind: 'base64',
                data: 'abc123',
                media_type: 'image/png',
              },
            },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      expect(isInvalid(stream)).toBe(false);
      await collectStream(stream, ctx);

      const request = mockGenerateContentStream.mock.calls[0]![0] as {
        contents: Array<{ role: string; parts: unknown[] }>;
      };
      expect(request.contents).toEqual([
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'image/png', data: 'abc123' } }],
        },
      ]);
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B4: Empty tools dict → INVALID_INPUT / empty_tools_dict
  // ──────────────────────────────────────────────────────────

  describe('AC-B4: tool_loop with empty tools dict', () => {
    it('throws RuntimeHaltSignal with INVALID_INPUT / empty_tools_dict', () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        getCallable(ext, 'tool_loop').fn({ prompt: 'hello', tools: {} }, ctx);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const halt = thrown as RuntimeHaltSignal;
      const status = getStatus(halt.value);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.raw['kind']).toBe('empty_tools_dict');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B8: 10 parallel message() calls share factory config without mutation
  // ──────────────────────────────────────────────────────────

  describe('AC-B8: parallel message() calls share config without mutation', () => {
    it('10 concurrent message() calls each send the configured model and their own prompt', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const calls = Array.from({ length: 10 }, (_, i) =>
        getCallable(ext, 'message').fn({ prompt: `hello ${i}` }, ctx)
      );

      const streams = await Promise.all(calls);
      await Promise.all(streams.map((s) => collectStream(s, ctx)));

      // Every request carries the factory model and its own prompt (config not mutated)
      const requests = mockGenerateContentStream.mock.calls.map(
        (c) =>
          c[0] as {
            model: string;
            contents: Array<{ parts: Array<{ text: string }> }>;
          }
      );
      expect(requests).toHaveLength(10);
      expect(requests.map((r) => r.model)).toEqual(
        Array.from({ length: 10 }, () => 'gemini-2.0-flash')
      );
      expect(requests.map((r) => r.contents[0]!.parts[0]!.text)).toEqual(
        Array.from({ length: 10 }, (_, i) => `hello ${i}`)
      );
    });
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('Gemini boundary error cases', () => {
  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    mockGenerateContent.mockReset();
    mockEmbedContent.mockReset();
    mockGenerateContentStream.mockResolvedValue(makeChunksIterable(['ok']));
  });

  // ──────────────────────────────────────────────────────────
  // AC-E8: Factory extra: {systemInstruction: '...'} → RILL-R001
  // ──────────────────────────────────────────────────────────

  describe('AC-E8: extra.systemInstruction Gemini-specific reserved key rejected', () => {
    it('throws RuntimeError RILL-R001 when extra contains systemInstruction key', () => {
      expect(() =>
        createGeminiExtension({
          ...BASE_CONFIG,
          extra: { systemInstruction: 'some instruction' },
        })
      ).toThrow(/reserved key/i);
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E9: tool_loop(prompt, tools, -1) → INVALID_INPUT
  // ──────────────────────────────────────────────────────────

  describe('AC-E9: negative per-call max_turns', () => {
    it('throws RuntimeHaltSignal with INVALID_INPUT / invalid_max_turns when max_turns is -1', () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const tools = { my_tool: makeTool(vi.fn().mockResolvedValue('result')) };

      let thrown: unknown;
      try {
        getCallable(ext, 'tool_loop').fn(
          { prompt: 'hello', tools, max_turns: -1 },
          ctx
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const halt = thrown as RuntimeHaltSignal;
      const status = getStatus(halt.value);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.raw['kind']).toBe('invalid_max_turns');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E13: message(123) → raw.kind=invalid_prompt_type
  // ──────────────────────────────────────────────────────────

  describe('AC-E13: non-string non-list prompt type', () => {
    it('returns INVALID_INPUT with raw.kind=invalid_prompt_type for numeric prompt', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'message').fn(
        { prompt: 123 as unknown as RillValue },
        ctx
      );

      expect(isInvalid(result)).toBe(true);
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.raw['kind']).toBe('invalid_prompt_type');
    });
  });
});
