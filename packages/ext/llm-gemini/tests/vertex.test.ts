/**
 * Vertex AI auth-mode tests for the Gemini extension factory.
 *
 * Covers the three mutually exclusive GoogleGenAI client construction
 * modes: Gemini Developer (default), Vertex Express (apiKey + vertexai),
 * and Vertex ADC (project/location, no apiKey).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// MODULE-LEVEL MOCK (@google/genai)
// ============================================================
//
// Unlike boundary.test.ts's MockGoogleGenAI (which discards constructor
// args), this mock CAPTURES the options object passed to the GoogleGenAI
// constructor so tests can assert on exact key presence/absence.

let capturedOptions: Record<string, unknown> | undefined;

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
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

beforeEach(() => {
  capturedOptions = undefined;
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
