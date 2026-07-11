/**
 * Factory config validation and disposal lifecycle tests.
 * Covers AC-1, AC-16, AC-17, AC-27, AC-30, AC-35,
 * EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-16.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';
import {
  expectRejectedHalt,
  expectThrowHalt,
  expectHalt,
} from './_halt-helpers.js';

// ============================================================
// MODULE MOCK
// ============================================================

// Mock openai at the module level so AzureOpenAI never makes network calls.
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
// HELPERS
// ============================================================

function validConfig(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    inference: {
      model: 'gpt-4o',
      apiVersion: '2025-01-01-preview',
    },
  };
}

async function importFactory() {
  const mod = await import('../src/factory.js');
  return mod.createFoundryExtension;
}

// ============================================================
// CONFIG VALIDATION
// ============================================================

describe('createFoundryExtension', () => {
  describe('configuration validation', () => {
    // EC-1 / AC-16: Missing endpoint
    it('throws when endpoint is missing (EC-1, AC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: '',
        auth: { type: 'api-key', key: 'test-key' },
      } as FoundryConfig;

      await expectRejectedHalt(createFoundryExtension(config), {
        message: 'foundry: endpoint is required',
      });
    });

    it('throws when endpoint is whitespace only (EC-1)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: '   ',
        auth: { type: 'api-key', key: 'test-key' },
      } as FoundryConfig;

      await expectRejectedHalt(createFoundryExtension(config), {
        message: 'foundry: endpoint is required',
      });
    });

    // EC-2 / AC-17: Missing auth
    it('throws when auth is missing entirely (EC-2, AC-17)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: undefined,
      } as unknown as FoundryConfig;

      await expectRejectedHalt(createFoundryExtension(config), {
        message: 'foundry: auth is required',
      });
    });

    // EC-3: Invalid auth.type
    it('throws when auth.type is invalid (EC-3)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'oauth' } as unknown as FoundryConfig['auth'],
      } as FoundryConfig;

      await expectRejectedHalt(createFoundryExtension(config), {
        message: "foundry: auth.type must be 'api-key' or 'entra'",
      });
    });

    it('throws for auth.type empty string (EC-3)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: '' } as unknown as FoundryConfig['auth'],
      } as FoundryConfig;

      await expectRejectedHalt(createFoundryExtension(config), {
        message: "foundry: auth.type must be 'api-key' or 'entra'",
      });
    });

    // Valid auth types accepted
    it('accepts api-key auth type', async () => {
      const createFoundryExtension = await importFactory();
      await expect(
        createFoundryExtension(validConfig())
      ).resolves.toBeDefined();
    });

    it('does not throw auth.type error for entra auth type', async () => {
      const createFoundryExtension = await importFactory();
      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'entra' },
        inference: {
          model: 'gpt-4o',
          apiVersion: '2025-01-01-preview',
        },
      };
      // entra may fail importing @azure/identity; verify auth.type error is NOT thrown
      let thrown: unknown;
      try {
        await createFoundryExtension(config);
      } catch (e) {
        thrown = e;
      }
      // If it threw, it must NOT be the auth.type error
      if (thrown !== undefined) {
        expect((thrown as Error).message).not.toBe(
          "foundry: auth.type must be 'api-key' or 'entra'"
        );
      }
    });
  });

  // ============================================================
  // FACTORY RETURN STRUCTURE (AC-1)
  // ============================================================

  describe('extension result structure', () => {
    // AC-1: Factory returns 9 host functions + dispose
    it('returns 10 host functions and dispose (AC-1)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());

      const value = ext.value as Record<string, unknown>;

      // LLM functions (5)
      expect(value['message']).toBeDefined();
      expect(value['embed']).toBeDefined();
      expect(value['embed_batch']).toBeDefined();
      expect(value['tool_loop']).toBeDefined();
      expect(value['generate']).toBeDefined();

      // Additional functions (4)
      expect(value['usage']).toBeDefined();
      expect(value['shield']).toBeDefined();
      expect(value['ground']).toBeDefined();
      expect(value['search']).toBeDefined();

      // dispose
      expect(ext.dispose).toBeDefined();
      expect(typeof ext.dispose).toBe('function');

      // Exactly 9 host functions
      const functionKeys = Object.keys(value);
      expect(functionKeys).toHaveLength(9);
    });
  });

  // ============================================================
  // INFERENCE VALIDATION AT CALL TIME (EC-4, EC-5, EC-6, AC-35)
  // ============================================================

  describe('inference config deferred validation', () => {
    // AC-35 / EC-4: message() called without inference configured
    it('message() halts when inference not configured (AC-35, EC-4)', async () => {
      const createFoundryExtension = await importFactory();
      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-key' },
        // no inference
      };

      const ext = await createFoundryExtension(config);
      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const messageFn = value['message']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(() => messageFn.fn({ prompt: 'hello' }, ctx), {
        code: 'UNAVAILABLE',
        message: 'foundry: inference not configured',
      });
    });

    // EC-5: Missing inference.model
    it('message() halts when inference.model is missing (EC-5)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-key' },
        inference: { model: '', apiVersion: '2025-01-01-preview' },
      } as FoundryConfig;

      const ext = await createFoundryExtension(config);
      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const messageFn = value['message']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(() => messageFn.fn({ prompt: 'hello' }, ctx), {
        code: 'INVALID_INPUT',
        message: 'foundry: model is required',
      });
    });

    // EC-6: Missing inference.apiVersion
    it('message() halts when inference.apiVersion is missing (EC-6)', async () => {
      const createFoundryExtension = await importFactory();
      const config = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-key' },
        inference: { model: 'gpt-4o', apiVersion: '' },
      } as FoundryConfig;

      const ext = await createFoundryExtension(config);
      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const messageFn = value['message']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(() => messageFn.fn({ prompt: 'hello' }, ctx), {
        code: 'INVALID_INPUT',
        message: 'foundry: inference.apiVersion is required',
      });
    });
  });

  // ============================================================
  // NAMESPACE SWAP COMPATIBILITY (AC-14)
  // ============================================================

  describe('LLM contract namespace swap compatibility (AC-14)', () => {
    const LLM_CONTRACT_KEYS = [
      'message',
      'embed',
      'embed_batch',
      'tool_loop',
      'generate',
    ] as const;

    // Expected param names per function — matches llm-openai exactly (NFR-FOUNDRY-2)
    const EXPECTED_PARAMS: Record<
      (typeof LLM_CONTRACT_KEYS)[number],
      string[]
    > = {
      message: ['prompt', 'options'],
      embed: ['text'],
      embed_batch: ['texts'],
      tool_loop: ['prompt', 'tools', 'options'],
      generate: ['prompt', 'schema', 'options'],
    };

    it('exports all 5 LLM contract function names (AC-14)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      const value = ext.value as Record<string, unknown>;

      for (const key of LLM_CONTRACT_KEYS) {
        expect(
          value[key],
          `expected LLM contract key '${key}' to exist`
        ).toBeDefined();
      }
    });

    it('each LLM function has fn and params properties (AC-14)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      const value = ext.value as Record<string, unknown>;

      for (const key of LLM_CONTRACT_KEYS) {
        const entry = value[key] as Record<string, unknown>;
        expect(typeof entry['fn'], `${key}.fn must be a function`).toBe(
          'function'
        );
        expect(
          Array.isArray(entry['params']),
          `${key}.params must be an array`
        ).toBe(true);
      }
    });

    it('param names match llm-openai contract positions (AC-14)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      const value = ext.value as Record<string, unknown>;

      for (const key of LLM_CONTRACT_KEYS) {
        const entry = value[key] as Record<string, unknown>;
        const params = entry['params'] as Array<{ name: string }>;
        const actualNames = params.map((p) => p.name);
        const expectedNames = EXPECTED_PARAMS[key];

        expect(actualNames, `${key} param names must match llm-openai`).toEqual(
          expectedNames
        );
      }
    });
  });

  // ============================================================
  // DISPOSAL LIFECYCLE (AC-27, AC-30, EC-16)
  // ============================================================

  describe('disposal lifecycle', () => {
    // AC-30: dispose() twice is no-op
    it('dispose() is idempotent — second call is no-op (AC-30)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());

      await expect(ext.dispose?.()).resolves.toBeUndefined();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
    });

    // AC-27 / EC-16: All functions halt after dispose
    it('message() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const messageFn = value['message']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(() => messageFn.fn({ prompt: 'hello' }, ctx), {
        code: 'DISPOSED',
        message: 'foundry: extension disposed',
      });
    });

    it('embed() halts after dispose (EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const embedFn = value['embed']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        embedFn.fn({ text: 'hello' }, ctx) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('usage() halts after dispose (EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const usageFn = value['usage']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(() => usageFn.fn({}, ctx), {
        code: 'DISPOSED',
        message: 'foundry: extension disposed',
      });
    });

    it('shield() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const shieldFn = value['shield']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        shieldFn.fn({ text: 'hello', documents: [] }, ctx) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('ground() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const groundFn = value['ground']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        groundFn.fn({ query: 'test query' }, ctx) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('search() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const searchFn = value['search']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        searchFn.fn(
          { query: 'test query', options: {} },
          ctx
        ) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('embed_batch() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const embedBatchFn = value['embed_batch']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        embedBatchFn.fn({ texts: ['hello', 'world'] }, ctx) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('tool_loop() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
      >;
      const toolLoopFn = value['tool_loop']!;
      const ctx = createRuntimeContext();

      expectThrowHalt(
        () => toolLoopFn.fn({ prompt: 'hello', tools: {}, options: {} }, ctx),
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });

    it('generate() halts after dispose (AC-27, EC-16)', async () => {
      const createFoundryExtension = await importFactory();
      const ext = await createFoundryExtension(validConfig());
      await ext.dispose?.();

      const value = ext.value as Record<
        string,
        {
          fn: (
            args: Record<string, unknown>,
            ctx: unknown
          ) => unknown | Promise<unknown>;
        }
      >;
      const generateFn = value['generate']!;
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        generateFn.fn(
          { prompt: 'hello', schema: undefined, options: {} },
          ctx
        ) as Promise<unknown>,
        {
          code: 'DISPOSED',
          message: 'foundry: extension disposed',
        }
      );
    });
  });
});
