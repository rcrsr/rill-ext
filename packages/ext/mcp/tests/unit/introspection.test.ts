/**
 * Unit tests for introspection function generation.
 *
 * Tests cover:
 * - IR-6: tools() returns dict of callable closures
 * - IR-7: resources() returns dict of callable closures
 * - IR-8: prompts() returns dict of callable closures
 * - BC-1: Empty capability lists return empty dicts
 * - Callable metadata (description, params) attached to each callable
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue, isCallable } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { createIntrospectionFunctions } from '../../src/introspection.js';
import { p } from '@rcrsr/rill-ext-param-shared';

// Helper to create a minimal RillFunction for testing
function makeRillFn(description: string, params: ReturnType<typeof p.str>[] = []): RillFunction {
  return {
    fn: async () => 'result',
    params,
    annotations: { description },
    returnType: structureToTypeValue({ kind: 'string' }),
  };
}

describe('createIntrospectionFunctions', () => {
  describe('tools', () => {
    it('returns dict of callables keyed by tool name [IR-6]', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
        calculator: makeRillFn('Perform calculations'),
      };

      // Act
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['echo', 'calculator']);
      expect(isCallable(result['echo'] as RillValue)).toBe(true);
      expect(isCallable(result['calculator'] as RillValue)).toBe(true);
    });

    it('attaches description to each callable', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
      };

      // Act
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      const echoCallable = result['echo'] as Record<string, unknown>;
      const annotations = echoCallable['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Echo tool');
    });

    it('defaults description to empty string when annotation is absent', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        no_desc: {
          fn: async () => 'ok',
          params: [],
          annotations: {},
          returnType: structureToTypeValue({ kind: 'string' }),
        },
      };

      // Act
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      const toolCallable = result['no_desc'] as Record<string, unknown>;
      const annotations = toolCallable['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('');
    });

    it('attaches params to callable when tool has params', async () => {
      // Arrange
      const toolParams = [p.str('input')];
      const toolFunctions: Record<string, RillFunction> = {
        parameterized: makeRillFn('Tool with params', toolParams),
      };

      // Act
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      const toolCallable = result['parameterized'] as Record<string, unknown>;
      expect(toolCallable['params']).toEqual(toolParams);
    });

    it('does not set params key on callable when tool has no params', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        no_params: makeRillFn('No params tool'),
      };

      // Act
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      const toolCallable = result['no_params'] as Record<string, unknown>;
      // Typed zero-param callable: params is empty array (not undefined)
      expect(toolCallable['params']).toEqual([]);
    });

    it('returns empty dict for zero tools [BC-1]', async () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('has correct function metadata', () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert - tools is a RillFunction with params, annotations, returnType
      expect(functions.tools.params).toEqual([]);
      expect(functions.tools.annotations?.description).toBe(
        'Available MCP tools as callable closures'
      );
      expect(functions.tools.returnType).toEqual(structureToTypeValue({ kind: 'dict' }));
    });
  });

  describe('resources', () => {
    it('returns dict of callables keyed by resource function name [IR-7]', async () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read a resource by URI'),
        resource_template1: makeRillFn('File resource template'),
      };

      // Act
      const functions = createIntrospectionFunctions({}, resourceFunctions, {});
      const result = (await functions.resources.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['read_resource', 'resource_template1']);
      expect(isCallable(result['read_resource'] as RillValue)).toBe(true);
      expect(isCallable(result['resource_template1'] as RillValue)).toBe(true);
    });

    it('attaches description to each resource callable', async () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read a resource by URI'),
      };

      // Act
      const functions = createIntrospectionFunctions({}, resourceFunctions, {});
      const result = (await functions.resources.fn({})) as Record<string, unknown>;

      // Assert
      const c = result['read_resource'] as Record<string, unknown>;
      const annotations = c['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Read a resource by URI');
    });

    it('returns empty dict for zero resource functions [BC-1]', async () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});
      const result = (await functions.resources.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('has correct function metadata', () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert
      expect(functions.resources.params).toEqual([]);
      expect(functions.resources.annotations?.description).toBe(
        'Available MCP resources as callable closures'
      );
      expect(functions.resources.returnType).toEqual(structureToTypeValue({ kind: 'dict' }));
    });
  });

  describe('prompts', () => {
    it('returns dict of callables keyed by prompt function name [IR-8]', async () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        prompt_greet: makeRillFn('Greeting prompt'),
        prompt_summarize: makeRillFn('Text summarization'),
      };

      // Act
      const functions = createIntrospectionFunctions({}, {}, promptFunctions);
      const result = (await functions.prompts.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['prompt_greet', 'prompt_summarize']);
      expect(isCallable(result['prompt_greet'] as RillValue)).toBe(true);
      expect(isCallable(result['prompt_summarize'] as RillValue)).toBe(true);
    });

    it('attaches description to each prompt callable', async () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        prompt_greet: makeRillFn('Greeting prompt'),
      };

      // Act
      const functions = createIntrospectionFunctions({}, {}, promptFunctions);
      const result = (await functions.prompts.fn({})) as Record<string, unknown>;

      // Assert
      const c = result['prompt_greet'] as Record<string, unknown>;
      const annotations = c['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Greeting prompt');
    });

    it('returns empty dict for zero prompt functions [BC-1]', async () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});
      const result = (await functions.prompts.fn({})) as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('has correct function metadata', () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert
      expect(functions.prompts.params).toEqual([]);
      expect(functions.prompts.annotations?.description).toBe(
        'Available MCP prompts as callable closures'
      );
      expect(functions.prompts.returnType).toEqual(structureToTypeValue({ kind: 'dict' }));
    });
  });

  describe('static data (factory time)', () => {
    it('tools() returns same reference on multiple calls (static)', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
      };
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});

      // Act
      const result1 = await functions.tools.fn({});
      const result2 = await functions.tools.fn({});

      // Assert - same reference (static data)
      expect(result1).toBe(result2);
    });
  });

  describe('BC-1: empty capability lists', () => {
    it('returns only introspection functions with empty dicts', async () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert - exactly three functions
      expect(Object.keys(functions)).toEqual(['tools', 'resources', 'prompts']);

      const tools = (await functions.tools.fn({})) as Record<string, unknown>;
      const resources = (await functions.resources.fn({})) as Record<string, unknown>;
      const prompts = (await functions.prompts.fn({})) as Record<string, unknown>;

      expect(Object.keys(tools)).toHaveLength(0);
      expect(Object.keys(resources)).toHaveLength(0);
      expect(Object.keys(prompts)).toHaveLength(0);
    });
  });
});
