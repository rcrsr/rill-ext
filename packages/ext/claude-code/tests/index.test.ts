import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import { execute, createRuntimeContext } from '@rcrsr/rill';

// Mock process module to avoid node-pty dependency
vi.mock('../src/process.js', () => ({
  spawnClaudeCli: vi.fn(),
}));

import { VERSION } from '../src/index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('claude-code package', () => {
  describe('package structure', () => {
    it('exports VERSION matching package.json', () => {
      expect(VERSION).toBe(_pkg.version);
    });

    it('can import from @rcrsr/rill', () => {
      const ctx = createRuntimeContext();
      expect(ctx).toBeDefined();
      expect(typeof execute).toBe('function');
    });
  });
});
