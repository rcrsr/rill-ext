/**
 * Integration tests for introspection functions in factory.
 *
 * Verifies that introspection functions are properly generated and included
 * in the extension result alongside tool/resource/prompt functions.
 *
 * All three introspection functions (tools, resources, prompts) are zero-arg
 * RillFunctions that return dicts of callable closures built from the
 * filtered function records.
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue, isCallable } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { createIntrospectionFunctions } from '../../src/introspection.js';

// Helper to create a minimal RillFunction for testing
function makeRillFn(description: string): RillFunction {
  return {
    fn: async () => 'result',
    params: [],
    annotations: { description },
    returnType: structureToTypeValue({ kind: 'string' }),
  };
}

describe('introspection integration', () => {
  describe('factory integration', () => {
    it('generates tools, resources, prompts RillFunctions', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
        calc: makeRillFn('Calculator'),
      };
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read a resource'),
        resource_template1: makeRillFn('File template'),
      };
      const promptFunctions: Record<string, RillFunction> = {
        prompt_greet: makeRillFn('Greeting'),
      };

      // Act
      const functions = createIntrospectionFunctions(
        toolFunctions,
        resourceFunctions,
        promptFunctions
      );

      // Assert - all three are RillFunctions with fn and params
      expect(functions.tools).toBeDefined();
      expect(functions.resources).toBeDefined();
      expect(functions.prompts).toBeDefined();

      expect(typeof functions.tools.fn).toBe('function');
      expect(typeof functions.resources.fn).toBe('function');
      expect(typeof functions.prompts.fn).toBe('function');

      expect(functions.tools.params).toEqual([]);
      expect(functions.resources.params).toEqual([]);
      expect(functions.prompts.params).toEqual([]);
    });

    it('tools() dict contains callable for all tool functions', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        tool1: makeRillFn('First'),
        tool2: makeRillFn('Second'),
        tool3: makeRillFn('Third'),
      };
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});

      // Act
      const result = (await functions.tools.fn({})) as Record<string, RillValue>;

      // Assert - all tools returned as callables
      expect(Object.keys(result)).toHaveLength(3);
      expect(isCallable(result['tool1']!)).toBe(true);
      expect(isCallable(result['tool2']!)).toBe(true);
      expect(isCallable(result['tool3']!)).toBe(true);
    });

    it('resources() dict contains callable for all resource functions', async () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read resource'),
        resource_template1: makeRillFn('Template 1'),
        resource_template2: makeRillFn('Template 2'),
      };
      const functions = createIntrospectionFunctions({}, resourceFunctions, {});

      // Act
      const result = (await functions.resources.fn({})) as Record<string, RillValue>;

      // Assert - all resources returned as callables
      expect(Object.keys(result)).toHaveLength(3);
      expect(isCallable(result['read_resource']!)).toBe(true);
      expect(isCallable(result['resource_template1']!)).toBe(true);
      expect(isCallable(result['resource_template2']!)).toBe(true);
    });

    it('prompts() dict contains callable for all prompt functions', async () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        prompt_greet: makeRillFn('Greet'),
        prompt_summarize: makeRillFn('Summarize'),
      };
      const functions = createIntrospectionFunctions({}, {}, promptFunctions);

      // Act
      const result = (await functions.prompts.fn({})) as Record<string, RillValue>;

      // Assert - all prompts returned as callables
      expect(Object.keys(result)).toHaveLength(2);
      expect(isCallable(result['prompt_greet']!)).toBe(true);
      expect(isCallable(result['prompt_summarize']!)).toBe(true);
    });
  });

  describe('static data verification', () => {
    it('tools() returns same reference on multiple calls (static)', async () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        test: makeRillFn('Test tool'),
      };
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});

      // Act
      const result1 = await functions.tools.fn({});
      const result2 = await functions.tools.fn({});

      // Assert - same reference (static data)
      expect(result1).toBe(result2);
    });

    it('data captured at factory time, not query time', async () => {
      // Arrange - create functions with initial data
      const toolFunctions: Record<string, RillFunction> = {
        tool1: makeRillFn('First'),
      };
      const functions = createIntrospectionFunctions(toolFunctions, {}, {});

      // Modify source data after function creation (should not affect result)
      (toolFunctions as Record<string, RillFunction>)['tool2'] = makeRillFn('Second');

      // Act
      const result = (await functions.tools.fn({})) as Record<string, unknown>;

      // Assert - still returns original data (captured at creation)
      expect(Object.keys(result)).toHaveLength(1);
      expect(result['tool1']).toBeDefined();
      expect(result['tool2']).toBeUndefined();
    });
  });

  describe('empty capability handling', () => {
    it('returns empty dicts for servers with no capabilities', async () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert - all empty dicts
      const tools = (await functions.tools.fn({})) as Record<string, unknown>;
      const resources = (await functions.resources.fn({})) as Record<string, unknown>;
      const prompts = (await functions.prompts.fn({})) as Record<string, unknown>;

      expect(Object.keys(tools)).toHaveLength(0);
      expect(Object.keys(resources)).toHaveLength(0);
      expect(Object.keys(prompts)).toHaveLength(0);
    });

    it('generates exactly three introspection functions', () => {
      // Arrange & Act
      const functions = createIntrospectionFunctions({}, {}, {});

      // Assert - exactly three entries
      expect(Object.keys(functions)).toEqual(['tools', 'resources', 'prompts']);
    });
  });
});
