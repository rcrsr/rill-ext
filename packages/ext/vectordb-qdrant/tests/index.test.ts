/**
 * Barrel export validation tests
 * Validates that all required exports are available from the package entry point
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { VERSION, createQdrantExtension } from '../src/index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

// ============================================================
// VERSION CONSTANT TESTS
// ============================================================

describe('VERSION constant', () => {
  it('VERSION matches package.json version (IC-1)', () => {
    expect(VERSION).toBe(_pkg.version);
  });
});

// ============================================================
// FACTORY EXPORT TESTS
// ============================================================

describe('createQdrantExtension factory export', () => {
  it('exports createQdrantExtension factory (IC-1)', () => {
    expect(createQdrantExtension).toBeDefined();
    expect(typeof createQdrantExtension).toBe('function');
  });

  it('factory creates extension from barrel export (IC-1)', () => {
    const ext = createQdrantExtension({
      url: 'http://localhost:6333',
      collection: 'test',
    });

    expect(ext).toBeDefined();
    // ExtensionFactoryResult has value dict with callables and optional dispose
    const value = ext.value as Record<string, unknown>;
    expect(value['upsert']).toBeDefined();
    expect(ext.dispose).toBeDefined();
  });
});
