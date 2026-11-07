import { describe, it, expect } from 'vitest';
import type { TokenCounts, ClaudeCodeResult } from '../src/types.js';

describe('types module', () => {
  describe('TokenCounts structure', () => {
    it('enforces readonly properties at compile time', () => {
      const counts: TokenCounts = {
        prompt: 100,
        cache_write_5m: 50,
        cache_write_1h: 25,
        cache_read: 75,
        output: 200,
      };

      // TypeScript compilation enforces readonly (compile-time check only)
      // @ts-expect-error - readonly property cannot be assigned
      counts.prompt = 999;

      // Test passes if TypeScript compilation succeeds (readonly enforced)
      expect(counts).toBeDefined();
    });
  });

  describe('ClaudeCodeResult structure', () => {
    it('enforces readonly properties at compile time', () => {
      const result: ClaudeCodeResult = {
        result: 'Text',
        tokens: {
          prompt: 100,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 50,
        },
        cost: 0.01,
        exit_code: 0,
        duration: 1000,
      };

      // TypeScript compilation enforces readonly (compile-time check only)
      // @ts-expect-error - readonly property cannot be assigned
      result.cost = 0.99;

      // Test passes if TypeScript compilation succeeds (readonly enforced)
      expect(result).toBeDefined();
    });
  });
});
