/**
 * Vertex AI auth-mode tests for the Gemini extension factory.
 *
 * Covers the three mutually exclusive GoogleGenAI client construction
 * modes: Gemini Developer (default), Vertex Express (apiKey + vertexai),
 * and Vertex ADC (project/location, no apiKey).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeError,
  isInvalid,
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

// ============================================================
// MODULE-LEVEL MOCK (@google/genai)
// ============================================================
//
// Unlike boundary.test.ts's MockGoogleGenAI (which discards constructor
// args), this mock CAPTURES the options object passed to the GoogleGenAI
// constructor so tests can assert on exact key presence/absence.

const mockGenerateContentStream = vi.fn();
const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();

let capturedOptions: Record<string, unknown> | undefined;

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        embedContent: mockEmbedContent,
      };
      constructor(options: Record<string, unknown>) {
        capturedOptions = options;
      }
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
// SETUP
// ============================================================

async function* makeChunksIterable(
  chunks: string[]
): AsyncGenerator<{ text: string }> {
  for (const text of chunks) {
    yield { text };
  }
}

/** Drain a RillStream to completion so the underlying async generator runs. */
async function collectStream(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<void> {
  let current = stream as RillStream;
  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
  }
}

beforeEach(() => {
  capturedOptions = undefined;
  mockGenerateContentStream.mockReset();
  mockGenerateContent.mockReset();
  mockEmbedContent.mockReset();
  mockGenerateContentStream.mockResolvedValue(makeChunksIterable(['ok']));
  mockGenerateContent.mockResolvedValue({
    text: 'generated text',
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
  });
});

// ============================================================
// GROUP 1: Default (Gemini Developer) mode — no vertexai
// ============================================================

describe('Vertex mode 1: Gemini Developer (default)', () => {
  it('constructs GoogleGenAI with only { apiKey } and no vertexai/project/location keys', () => {
    const config: GeminiExtensionConfig = {
      api_key: 'test-key',
      model: 'gemini-2.0-flash',
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({ apiKey: 'test-key' });
    expect(capturedOptions).not.toHaveProperty('vertexai');
    expect(capturedOptions).not.toHaveProperty('project');
    expect(capturedOptions).not.toHaveProperty('location');
  });

  it('forwards base_url, timeout, and max_retries via httpOptions', () => {
    const config: GeminiExtensionConfig = {
      api_key: 'test-key',
      model: 'gemini-2.0-flash',
      base_url: 'https://custom.example.com',
      timeout: 5000,
      max_retries: 2,
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      apiKey: 'test-key',
      httpOptions: {
        baseUrl: 'https://custom.example.com',
        timeout: 5000,
        retryOptions: { attempts: 3 },
      },
    });
  });

  it('omits httpOptions entirely when base_url/timeout/max_retries are unset', () => {
    const config: GeminiExtensionConfig = {
      api_key: 'test-key',
      model: 'gemini-2.0-flash',
    };

    createGeminiExtension(config);

    expect(capturedOptions).not.toHaveProperty('httpOptions');
  });
});

// ============================================================
// GROUP 2: Default mode api_key validation
// ============================================================

describe('Vertex mode 1: api_key validation', () => {
  it('throws "api_key is required" when api_key is missing and vertexai is not set', () => {
    const config = {
      model: 'gemini-2.0-flash',
    } as GeminiExtensionConfig;

    expect(() => createGeminiExtension(config)).toThrow('api_key is required');
  });

  it('throws "api_key cannot be empty" when api_key is an empty string', () => {
    const config: GeminiExtensionConfig = {
      api_key: '',
      model: 'gemini-2.0-flash',
    };

    expect(() => createGeminiExtension(config)).toThrow(
      'api_key cannot be empty'
    );
  });
});

// ============================================================
// GROUP 3: Vertex Express (vertexai: true + api_key)
// ============================================================

describe('Vertex mode 2: Vertex Express', () => {
  it('constructs GoogleGenAI with { vertexai: true, apiKey } and does NOT forward project/location', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      api_key: 'vertex-express-key',
      model: 'gemini-2.0-flash',
      project: 'ignored-project',
      location: 'ignored-location',
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      vertexai: true,
      apiKey: 'vertex-express-key',
    });
    expect(capturedOptions).not.toHaveProperty('project');
    expect(capturedOptions).not.toHaveProperty('location');
  });

  it('constructs GoogleGenAI with { vertexai: true, apiKey } when project/location are absent', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      api_key: 'vertex-express-key',
      model: 'gemini-2.0-flash',
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      vertexai: true,
      apiKey: 'vertex-express-key',
    });
  });

  it('forwards base_url, timeout, and max_retries via httpOptions', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      api_key: 'vertex-express-key',
      model: 'gemini-2.0-flash',
      base_url: 'https://custom.example.com',
      timeout: 5000,
      max_retries: 4,
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      vertexai: true,
      apiKey: 'vertex-express-key',
      httpOptions: {
        baseUrl: 'https://custom.example.com',
        timeout: 5000,
        retryOptions: { attempts: 5 },
      },
    });
  });

  it('surfaces the api_key error before an invalid model error', () => {
    const config = {
      vertexai: true,
      api_key: '',
      model: '',
    } as GeminiExtensionConfig;

    expect(() => createGeminiExtension(config)).toThrow(
      'api_key cannot be empty'
    );
  });
});

// ============================================================
// GROUP 4: Vertex ADC (vertexai: true, project, location, no api_key)
// ============================================================

describe('Vertex mode 3: Vertex ADC', () => {
  it('constructs GoogleGenAI with { vertexai: true, project, location } and no apiKey key', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
      model: 'gemini-2.0-flash',
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
    });
    expect(capturedOptions).not.toHaveProperty('apiKey');
  });

  it('forwards base_url, timeout, and max_retries via httpOptions', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
      model: 'gemini-2.0-flash',
      base_url: 'https://custom.example.com',
      timeout: 5000,
      max_retries: 0,
    };

    createGeminiExtension(config);

    expect(capturedOptions).toEqual({
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
      httpOptions: {
        baseUrl: 'https://custom.example.com',
        timeout: 5000,
        retryOptions: { attempts: 1 },
      },
    });
  });

  it('does not invoke validateApiKey path for Vertex ADC (no api_key error thrown)', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
      model: 'gemini-2.0-flash',
    };

    // Validation for api_key would throw 'api_key is required'/'api_key cannot
    // be empty' if invoked; Vertex ADC must not hit that path at all.
    expect(() => createGeminiExtension(config)).not.toThrow();
  });
});

// ============================================================
// GROUP 5: Vertex ADC missing project
// ============================================================

describe('Vertex mode 3: Vertex ADC missing project', () => {
  it('throws RuntimeError RILL-R001 with "project is required for Vertex AI"', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      location: 'us-central1',
      model: 'gemini-2.0-flash',
    };

    let thrown: unknown;
    try {
      createGeminiExtension(config);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RuntimeError);
    const err = thrown as RuntimeError;
    expect(err.errorId).toBe('RILL-R001');
    expect(err.message).toBe('project is required for Vertex AI');
  });
});

// ============================================================
// GROUP 6: Vertex ADC missing location
// ============================================================

describe('Vertex mode 3: Vertex ADC missing location', () => {
  it('throws RuntimeError RILL-R001 with "location is required for Vertex AI"', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      project: 'my-project',
      model: 'gemini-2.0-flash',
    };

    let thrown: unknown;
    try {
      createGeminiExtension(config);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RuntimeError);
    const err = thrown as RuntimeError;
    expect(err.errorId).toBe('RILL-R001');
    expect(err.message).toBe('location is required for Vertex AI');
  });
});

// ============================================================
// GROUP 7: Vertex Express empty api_key
// ============================================================

describe('Vertex mode 2: Vertex Express empty api_key', () => {
  it('throws "api_key cannot be empty" when api_key is an empty string', () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      api_key: '',
      model: 'gemini-2.0-flash',
    };

    expect(() => createGeminiExtension(config)).toThrow(
      'api_key cannot be empty'
    );
  });
});

// ============================================================
// GROUP 8: Functional smoke tests per Vertex mode
// ============================================================

describe('Vertex functional smoke tests', () => {
  it('Vertex Express: generate() resolves through the mocked generateContent client', async () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      api_key: 'vertex-express-key',
      model: 'gemini-2.0-flash',
    };

    const ext = createGeminiExtension(config);
    const ctx = createRuntimeContext();

    mockGenerateContent.mockResolvedValueOnce({
      text: '{"answer":"ok"}',
      candidates: [{ finishReason: 'stop' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      responseId: 'resp-1',
    });

    const schemaArg = {
      __rill_type: true,
      structure: {
        kind: 'dict',
        fields: { answer: { type: { kind: 'string' } } },
      },
    };

    const result = await getCallable(ext, 'generate').fn(
      { prompt: 'hello', schema: schemaArg },
      ctx
    );

    expect(isInvalid(result)).toBe(false);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect((result as Record<string, unknown>)['data']).toEqual({
      answer: 'ok',
    });
  });

  it('Vertex ADC: message() resolves through the mocked generateContentStream client', async () => {
    const config: GeminiExtensionConfig = {
      vertexai: true,
      project: 'my-project',
      location: 'us-central1',
      model: 'gemini-2.0-flash',
    };

    const ext = createGeminiExtension(config);
    const ctx = createRuntimeContext();

    const stream = await getCallable(ext, 'message').fn(
      { prompt: 'hello' },
      ctx
    );

    expect(isInvalid(stream)).toBe(false);
    await collectStream(stream, ctx);
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
  });
});
