/**
 * Wire-format tests for Gemini message() host function (NFR-UNIFY-2).
 *
 * Asserts the translation layer between canonical rill message shapes
 * and the Gemini SDK wire format. Every test spies on the SDK call and
 * verifies the exact Content / Part objects sent to the provider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
  type RillValue,
  type RillStream,
} from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Consume a RillStream to completion and return the resolved dict. */
async function collectStream(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>,
): Promise<{ chunks: string[]; resolved: Record<string, unknown> }> {
  const chunks: string[] = [];
  let current = stream as RillStream;

  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }

  const resolved = await (
    stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
  ).__rill_stream_resolve();
  return { chunks, resolved: resolved as Record<string, unknown> };
}

/** Build an async generator that yields simple text chunks. */
async function* makeChunksIterable(
  chunks: string[],
): AsyncGenerator<{ text: string }> {
  for (const text of chunks) {
    yield { text };
  }
}

// ============================================================
// MODULE-LEVEL MOCK (@google/genai)
// ============================================================

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
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
// WIRE-FORMAT TESTS
// ============================================================

describe('Gemini wire-format translation', () => {
  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    mockGenerateContent.mockReset();
    mockEmbedContent.mockReset();
    mockGenerateContentStream.mockResolvedValue(makeChunksIterable(['ok']));
  });

  // ──────────────────────────────────────────────────────────
  // Role rename: assistant → model
  // ──────────────────────────────────────────────────────────

  describe('assistant↔model role rename', () => {
    it('sends role:model on the wire for a canonical assistant turn (NFR-UNIFY-2)', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string; parts: unknown[] }>;

      // Canonical assistant turn must appear as 'model' on the wire
      expect(contents[1]!.role).toBe('model');
    });

    it('keeps user role unchanged on the wire', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string }>;

      expect(contents[0]!.role).toBe('user');
      expect(contents[2]!.role).toBe('user');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-3: system turn → systemInstruction parameter
  // ──────────────────────────────────────────────────────────

  describe('AC-3: system turn → systemInstruction', () => {
    it('lifts system turn to top-level systemInstruction and excludes it from contents', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'system', parts: [{ type: 'text', text: 'You are helpful.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const config = call['config'] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string }>;

      // System message promoted to systemInstruction
      expect(config['systemInstruction']).toBe('You are helpful.');

      // System message NOT in contents array
      const systemInContents = contents.some((c) => c.role === 'system');
      expect(systemInContents).toBe(false);

      // Only the user turn is in contents
      expect(contents.length).toBe(1);
      expect(contents[0]!.role).toBe('user');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-2: content sugar → canonical parts
  // ──────────────────────────────────────────────────────────

  describe('AC-2: content sugar normalizes to parts shape', () => {
    it('converts {role, content: string} to {role, parts:[{text}]} in SDK request', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      // Sugar form: content string instead of parts array
      const prompt = [{ role: 'user', content: 'hi' }];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>;

      expect(contents).toHaveLength(1);
      expect(contents[0]!.role).toBe('user');
      expect(contents[0]!.parts).toHaveLength(1);
      expect(contents[0]!.parts[0]).toEqual({ text: 'hi' });
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-11: image parts → Gemini inlineData / fileData
  // ──────────────────────────────────────────────────────────

  describe('AC-11: image part translation', () => {
    it('base64 image → inlineData Part with mimeType and data', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: { kind: 'base64', data: 'abc123', media_type: 'image/png' },
            },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      const part = contents[0]!.parts[0]!;

      expect(part['inlineData']).toEqual({ mimeType: 'image/png', data: 'abc123' });
    });

    it('url image → fileData Part with fileUri and mimeType', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: {
                kind: 'url',
                data: 'https://x.com/x.png',
                media_type: 'image/png',
              },
            },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      const part = contents[0]!.parts[0]!;

      expect(part['fileData']).toEqual({
        fileUri: 'https://x.com/x.png',
        mimeType: 'image/png',
      });
    });
  });

  // ──────────────────────────────────────────────────────────
  // Tool use part → functionCall
  // ──────────────────────────────────────────────────────────

  describe('tool_use part → functionCall Part', () => {
    it('canonical tool_use → Gemini functionCall with name and args', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'assistant',
          parts: [
            { type: 'tool_use', id: 'tu_1', name: 'fn', input: { x: 1 } },
          ],
        },
        {
          role: 'user',
          parts: [
            { type: 'tool_result', id: 'tu_1', parts: [{ type: 'text', text: 'result' }] },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const call = mockGenerateContentStream.mock.calls[0]![0] as Record<string, unknown>;
      const contents = call['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>;

      // First content item (from assistant turn) should have a functionCall Part
      const assistantContent = contents.find((c) => c.role === 'model');
      expect(assistantContent).toBeDefined();

      const functionCallPart = assistantContent!.parts.find(
        (p) => 'functionCall' in p,
      );
      expect(functionCallPart).toBeDefined();
      expect(functionCallPart!['functionCall']).toEqual({ name: 'fn', args: { x: 1 } });
    });
  });

  // ──────────────────────────────────────────────────────────
  // Per-Part single-field exclusivity
  // ──────────────────────────────────────────────────────────

  describe('per-Part single-field exclusivity', () => {
    /** Returns all Parts from all Content objects in a generateContentStream call. */
    function extractAllParts(callArg: unknown): Array<Record<string, unknown>> {
      const arg = callArg as Record<string, unknown>;
      const contents = arg['contents'] as Array<{ parts: Array<Record<string, unknown>> }>;
      return contents.flatMap((c) => c.parts);
    }

    it('text Part carries only the text field', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn({ prompt: 'hello' }, ctx);
      await collectStream(stream, ctx);

      const parts = extractAllParts(mockGenerateContentStream.mock.calls[0]![0]);
      for (const part of parts) {
        const keys = Object.keys(part);
        if ('text' in part) {
          // A text Part must not also carry inlineData, fileData, functionCall, or functionResponse
          expect(keys).not.toContain('inlineData');
          expect(keys).not.toContain('fileData');
          expect(keys).not.toContain('functionCall');
          expect(keys).not.toContain('functionResponse');
        }
      }
    });

    it('inlineData Part carries only the inlineData field', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: { kind: 'base64', data: 'b64data', media_type: 'image/jpeg' },
            },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const parts = extractAllParts(mockGenerateContentStream.mock.calls[0]![0]);
      for (const part of parts) {
        if ('inlineData' in part) {
          const keys = Object.keys(part);
          expect(keys).not.toContain('text');
          expect(keys).not.toContain('fileData');
          expect(keys).not.toContain('functionCall');
          expect(keys).not.toContain('functionResponse');
        }
      }
    });

    it('functionCall Part carries only the functionCall field', async () => {
      const ext = createGeminiExtension(BASE_CONFIG);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'assistant',
          parts: [
            { type: 'tool_use', id: 'tu_2', name: 'my_fn', input: { a: 'b' } },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              type: 'tool_result',
              id: 'tu_2',
              parts: [{ type: 'text', text: 'res' }],
            },
          ],
        },
      ];

      const stream = await getCallable(ext, 'message').fn({ prompt }, ctx);
      await collectStream(stream, ctx);

      const parts = extractAllParts(mockGenerateContentStream.mock.calls[0]![0]);
      for (const part of parts) {
        if ('functionCall' in part) {
          const keys = Object.keys(part);
          expect(keys).not.toContain('text');
          expect(keys).not.toContain('inlineData');
          expect(keys).not.toContain('fileData');
          expect(keys).not.toContain('functionResponse');
        }
        if ('functionResponse' in part) {
          const keys = Object.keys(part);
          expect(keys).not.toContain('text');
          expect(keys).not.toContain('inlineData');
          expect(keys).not.toContain('fileData');
          expect(keys).not.toContain('functionCall');
        }
      }
    });
  });
});
