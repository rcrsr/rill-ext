/**
 * Tests for kv-file extension factory.
 *
 * Verifies factory config validation.
 */

import { describe, it, expect } from 'vitest';
import { createFileKvExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_setup.js';

describe('kv-file extension factory', () => {
  describe('factory creation', () => {
    it('throws when neither mounts nor store provided', () => {
      expect(() => createFileKvExtension({}, makeFactoryCtx())).toThrow(
        'KV file extension requires either "mounts" or "store" configuration'
      );
    });
  });
});
