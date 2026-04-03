/**
 * Unit tests for introspection dict generation.
 *
 * Tests cover:
 * - IR-6: tools dict contains callable closures keyed by tool name
 * - IR-7: resources dict contains callable closures keyed by resource name
 * - IR-8: prompts dict contains callable closures keyed by prompt name
 * - BC-1: Empty capability lists return empty dicts
 * - Callable metadata (description, params) attached to each callable
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue, isCallable } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { createIntrospectionDicts } from '../../src/introspection.js';
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

describe('createIntrospectionDicts', () => {
  describe('tools', () => {
    it('returns dict of callables keyed by tool name [IR-6]', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
        calculator: makeRillFn('Perform calculations'),
      };

      // Act
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['echo', 'calculator']);
      expect(isCallable(result['echo'] as RillValue)).toBe(true);
      expect(isCallable(result['calculator'] as RillValue)).toBe(true);
    });

    it('attaches description to each callable', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
      };

      // Act
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, unknown>;

      // Assert
      const echoCallable = result['echo'] as Record<string, unknown>;
      const annotations = echoCallable['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Echo tool');
    });

    it('defaults description to empty string when annotation is absent', () => {
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
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, unknown>;

      // Assert
      const toolCallable = result['no_desc'] as Record<string, unknown>;
      const annotations = toolCallable['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('');
    });

    it('attaches params to callable when tool has params', () => {
      // Arrange
      const toolParams = [p.str('input')];
      const toolFunctions: Record<string, RillFunction> = {
        parameterized: makeRillFn('Tool with params', toolParams),
      };

      // Act
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, unknown>;

      // Assert
      const toolCallable = result['parameterized'] as Record<string, unknown>;
      expect(toolCallable['params']).toEqual(toolParams);
    });

    it('does not set params key on callable when tool has no params', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        no_params: makeRillFn('No params tool'),
      };

      // Act
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});
      const result = dicts.tools as Record<string, unknown>;

      // Assert
      const toolCallable = result['no_params'] as Record<string, unknown>;
      // Typed zero-param callable: params is empty array (not undefined)
      expect(toolCallable['params']).toEqual([]);
    });

    it('returns empty dict for zero tools [BC-1]', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert
      expect(Object.keys(dicts.tools)).toHaveLength(0);
    });
  });

  describe('resources', () => {
    it('returns dict of callables keyed by resource function name [IR-7]', () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read a resource by URI'),
        resource_template1: makeRillFn('File resource template'),
      };

      // Act
      const dicts = createIntrospectionDicts({}, resourceFunctions, {});
      const result = dicts.resources as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['read_resource', 'resource_template1']);
      expect(isCallable(result['read_resource'] as RillValue)).toBe(true);
      expect(isCallable(result['resource_template1'] as RillValue)).toBe(true);
    });

    it('attaches description to each resource callable', () => {
      // Arrange
      const resourceFunctions: Record<string, RillFunction> = {
        read_resource: makeRillFn('Read a resource by URI'),
      };

      // Act
      const dicts = createIntrospectionDicts({}, resourceFunctions, {});
      const result = dicts.resources as Record<string, unknown>;

      // Assert
      const c = result['read_resource'] as Record<string, unknown>;
      const annotations = c['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Read a resource by URI');
    });

    it('returns empty dict for zero resource functions [BC-1]', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert
      expect(Object.keys(dicts.resources)).toHaveLength(0);
    });
  });

  describe('prompts', () => {
    it('returns dict of callables keyed by prompt function name [IR-8]', () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        greet: makeRillFn('Greeting prompt'),
        summarize: makeRillFn('Text summarization'),
      };

      // Act
      const dicts = createIntrospectionDicts({}, {}, promptFunctions);
      const result = dicts.prompts as Record<string, unknown>;

      // Assert
      expect(Object.keys(result)).toEqual(['greet', 'summarize']);
      expect(isCallable(result['greet'] as RillValue)).toBe(true);
      expect(isCallable(result['summarize'] as RillValue)).toBe(true);
    });

    it('attaches description to each prompt callable', () => {
      // Arrange
      const promptFunctions: Record<string, RillFunction> = {
        greet: makeRillFn('Greeting prompt'),
      };

      // Act
      const dicts = createIntrospectionDicts({}, {}, promptFunctions);
      const result = dicts.prompts as Record<string, unknown>;

      // Assert
      const c = result['greet'] as Record<string, unknown>;
      const annotations = c['annotations'] as Record<string, unknown>;
      expect(annotations['description']).toBe('Greeting prompt');
    });

    it('returns empty dict for zero prompt functions [BC-1]', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert
      expect(Object.keys(dicts.prompts)).toHaveLength(0);
    });
  });

  describe('static data (factory time)', () => {
    it('tools dict is the same reference across accesses (static)', () => {
      // Arrange
      const toolFunctions: Record<string, RillFunction> = {
        echo: makeRillFn('Echo tool'),
      };
      const dicts = createIntrospectionDicts(toolFunctions, {}, {});

      // Act & Assert - same reference (built once at factory time)
      expect(dicts.tools).toBe(dicts.tools);
    });
  });

  describe('BC-1: empty capability lists', () => {
    it('returns three empty dicts for servers with no capabilities', () => {
      // Arrange & Act
      const dicts = createIntrospectionDicts({}, {}, {});

      // Assert - exactly three keys, all empty
      expect(Object.keys(dicts)).toEqual(['tools', 'resources', 'prompts']);
      expect(Object.keys(dicts.tools)).toHaveLength(0);
      expect(Object.keys(dicts.resources)).toHaveLength(0);
      expect(Object.keys(dicts.prompts)).toHaveLength(0);
    });
  });
});
