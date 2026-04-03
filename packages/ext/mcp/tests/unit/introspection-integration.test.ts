/**
 * Integration tests for introspection dicts in factory.
 *
 * Verifies that introspection dicts are properly generated and included
 * in the extension result alongside tool/resource/prompt functions.
 *
 * The three introspection dicts (tools, resources, prompts) are pre-built
 * at factory time and assigned directly to the extension value.
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue, isCallable } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { createIntrospectionDicts } from '../../src/introspection.js';

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
    it('generates tools, resources, prompts dicts', () => {
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
        greet: makeRillFn('Greeting'),
      };

      // Act
      const dicts = createIntrospectionDicts(toolFunctions, resourceFunctions, promptFunctions);

      // Assert - all three dicts are present
      expect(dicts.tools).toBeDefined();
      expect(dicts.resources).toBeDefined();
      expect(dicts.prompts).toBeDefined();
    });

    it('tools dict contains callable for all tool functions', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        tool1: makeRillFn('First'),
        tool2: makeRillFn('Second'),
        tool3: makeRillFn('Third'),
      };
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, RillValue>;

      // Assert - all tools returned as callables
      expect(Object.keys(result)).toHaveLength(3);
      expect(isCallable(result['tool1']!)).toBe(true);
      expect(isCallable(result['tool2']!)).toBe(true);
      expect(isCallable(result['tool3']!)).toBe(true);
    });

    it('resources dict contains callable for all resource functions', () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read resource'),
        resource_template1: makeRillFn('Template 1'),
        resource_template2: makeRillFn('Template 2'),
      };
      const dicts = createIntrospectionDicts({}, resourceFunctions, {});
      const result = dicts.resources as Record<string, RillValue>;

      // Assert - all resources returned as callables
      expect(Object.keys(result)).toHaveLength(3);
      expect(isCallable(result['read_resource']!)).toBe(true);
      expect(isCallable(result['resource_template1']!)).toBe(true);
      expect(isCallable(result['resource_template2']!)).toBe(true);
    });

    it('prompts dict contains callable for all prompt functions', () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        greet: makeRillFn('Greet'),
        summarize: makeRillFn('Summarize'),
      };
      const dicts = createIntrospectionDicts({}, {}, promptFunctions);
      const result = dicts.prompts as Record<string, RillValue>;

      // Assert - all prompts returned as callables
      expect(Object.keys(result)).toHaveLength(2);
      expect(isCallable(result['greet']!)).toBe(true);
      expect(isCallable(result['summarize']!)).toBe(true);
    });
  });

  describe('static data verification', () => {
    it('tools dict is the same reference on repeated access (static)', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        test: makeRillFn('Test tool'),
      };
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});

      // Assert - same reference (static data, built once)
      expect(dicts.tools).toBe(dicts.tools);
    });

    it('data captured at factory time, not mutation time', () => {
      // Arrange - create dicts with initial data
      const toolFunctions: Record<string, RillFunction> = {
        tool1: makeRillFn('First'),
      };
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});

      // Modify source after dict creation (should not affect result)
      (toolFunctions as Record<string, RillFunction>)['tool2'] = makeRillFn('Second');

      // Assert - still contains only original data (captured at creation)
      expect(Object.keys(dicts.tools)).toHaveLength(1);
      expect((dicts.tools as Record<string, unknown>)['tool1']).toBeDefined();
      expect((dicts.tools as Record<string, unknown>)['tool2']).toBeUndefined();
    });
  });

  describe('empty capability handling', () => {
    it('returns empty dicts for servers with no capabilities', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert - all empty dicts
      expect(Object.keys(dicts.tools)).toHaveLength(0);
      expect(Object.keys(dicts.resources)).toHaveLength(0);
      expect(Object.keys(dicts.prompts)).toHaveLength(0);
    });

    it('returns exactly three dict keys', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert - exactly three entries
      expect(Object.keys(dicts)).toEqual(['tools', 'resources', 'prompts']);
    });
  });
});
