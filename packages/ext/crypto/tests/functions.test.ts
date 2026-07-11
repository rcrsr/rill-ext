/**
 * Tests for crypto extension functions.
 *
 * Verifies hash, hmac, uuid, and random behavior including edge cases.
 */

import { describe, it, expect } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createCryptoExtension } from '../src/factory.js';
import type { CryptoExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

function mk(config: CryptoExtensionConfig = {}) {
  return createCryptoExtension(config, makeFactoryCtx());
}

describe('hash()', () => {
  it('hashes content with default algorithm (sha256)', async () => {
    const ext = mk({ defaultAlgorithm: 'sha256' });
    const result = await ext.value.hash.fn(
      { input: 'hello world' },
      makeRuntimeCtx()
    );

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(64);
  });

  it('hashes content with explicit algorithm', async () => {
    const ext = mk();
    const result = await ext.value.hash.fn(
      {
        input: 'hello world',
        algorithm: 'md5',
      },
      makeRuntimeCtx()
    );

    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(32);
  });

  it('produces consistent output for same input', async () => {
    const ext = mk();
    const r1 = await ext.value.hash.fn(
      { input: 'test', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    const r2 = await ext.value.hash.fn(
      { input: 'test', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(r1).toBe(r2);
  });

  it('produces different output for different input', async () => {
    const ext = mk();
    const r1 = await ext.value.hash.fn(
      { input: 'input1', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    const r2 = await ext.value.hash.fn(
      { input: 'input2', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(r1).not.toBe(r2);
  });

  it('supports sha512 algorithm', async () => {
    const ext = mk();
    const result = await ext.value.hash.fn(
      { input: 'test', algorithm: 'sha512' },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('returns invalid value for unsupported algorithm', async () => {
    const ext = mk();
    const result = await ext.value.hash.fn(
      { input: 'test', algorithm: 'invalid-algo' },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/unsupported algorithm/);
  });

  it('uses default algorithm when not specified', async () => {
    const ext = mk({ defaultAlgorithm: 'sha512' });
    const result = await ext.value.hash.fn({ input: 'test' }, makeRuntimeCtx());
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('hashes empty string', async () => {
    const ext = mk();
    const result = await ext.value.hash.fn(
      { input: '', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('handles unicode input', async () => {
    const ext = mk();
    const result = await ext.value.hash.fn(
      {
        input: 'Hello 世界 🌍',
        algorithm: 'sha256',
      },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hmac()', () => {
  it('generates HMAC signature', async () => {
    const ext = mk({
      hmacKey: 'secret-key',
      defaultAlgorithm: 'sha256',
    });
    const result = await ext.value.hmac.fn(
      { input: 'message to authenticate' },
      makeRuntimeCtx()
    );

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(64);
  });

  it('generates HMAC with explicit algorithm', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const result = await ext.value.hmac.fn(
      {
        input: 'message',
        algorithm: 'sha512',
      },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('produces consistent output for same input and key', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const r1 = await ext.value.hmac.fn(
      { input: 'message', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    const r2 = await ext.value.hmac.fn(
      { input: 'message', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(r1).toBe(r2);
  });

  it('produces different output for different messages', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const r1 = await ext.value.hmac.fn(
      { input: 'message1', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    const r2 = await ext.value.hmac.fn(
      { input: 'message2', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(r1).not.toBe(r2);
  });

  it('returns invalid value when hmacKey not configured', async () => {
    const ext = mk();
    const result = await ext.value.hmac.fn(
      { input: 'message' },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/hmacKey required/);
  });

  it('returns invalid value for unsupported algorithm', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const result = await ext.value.hmac.fn(
      { input: 'message', algorithm: 'invalid-algo' },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
  });

  it('uses default algorithm when not specified', async () => {
    const ext = mk({
      hmacKey: 'secret',
      defaultAlgorithm: 'sha512',
    });
    const result = await ext.value.hmac.fn(
      { input: 'message' },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('handles unicode input', async () => {
    const ext = mk({ hmacKey: 'key' });
    const result = await ext.value.hmac.fn(
      {
        input: 'Hello 世界 🌍',
        algorithm: 'sha256',
      },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('uuid()', () => {
  it('generates random UUID v4', async () => {
    const ext = mk();
    const result = await ext.value.uuid.fn({}, makeRuntimeCtx());

    expect(typeof result).toBe('string');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('generates unique UUIDs', async () => {
    const ext = mk();
    const r1 = await ext.value.uuid.fn({}, makeRuntimeCtx());
    const r2 = await ext.value.uuid.fn({}, makeRuntimeCtx());
    expect(r1).not.toBe(r2);
  });

  it('generates valid v4 format across multiple calls', async () => {
    const ext = mk();
    for (let i = 0; i < 10; i++) {
      const result = (await ext.value.uuid.fn({}, makeRuntimeCtx())) as string;
      const parts = result.split('-');
      expect(parts).toHaveLength(5);
      expect(parts[2]![0]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(parts[3]![0]);
    }
  });
});

describe('random()', () => {
  it('generates random bytes as hex string', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: 16 }, makeRuntimeCtx());

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(32);
  });

  it('returns correct length for byte count', async () => {
    const ext = mk();
    const r8 = (await ext.value.random.fn(
      { bytes: 8 },
      makeRuntimeCtx()
    )) as string;
    expect(r8).toHaveLength(16);
    const r32 = (await ext.value.random.fn(
      { bytes: 32 },
      makeRuntimeCtx()
    )) as string;
    expect(r32).toHaveLength(64);
    const r64 = (await ext.value.random.fn(
      { bytes: 64 },
      makeRuntimeCtx()
    )) as string;
    expect(r64).toHaveLength(128);
  });

  it('generates different values on each call', async () => {
    const ext = mk();
    const r1 = await ext.value.random.fn({ bytes: 16 }, makeRuntimeCtx());
    const r2 = await ext.value.random.fn({ bytes: 16 }, makeRuntimeCtx());
    expect(r1).not.toBe(r2);
  });

  it('handles small byte counts', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: 1 }, makeRuntimeCtx());
    expect(result).toMatch(/^[0-9a-f]{2}$/);
  });

  it('handles large byte counts', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: 256 }, makeRuntimeCtx());
    expect(result).toMatch(/^[0-9a-f]{512}$/);
  });

  it('returns empty string for zero bytes', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: 0 }, makeRuntimeCtx());
    expect(result).toBe('');
  });

  it('returns invalid value for negative bytes', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: -1 }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/bytes must be a non-negative integer/);
  });

  it('returns invalid value for non-integer bytes', async () => {
    const ext = mk();
    const result = await ext.value.random.fn({ bytes: 1.5 }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
  });

  it('returns invalid value when bytes exceeds 1MB limit', async () => {
    const ext = mk();
    const result = await ext.value.random.fn(
      { bytes: 1_048_577 },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/must not exceed 1048576/);
  });

  it('accepts exactly 1MB bytes', async () => {
    const ext = mk();
    const result = (await ext.value.random.fn(
      { bytes: 1_048_576 },
      makeRuntimeCtx()
    )) as string;
    expect(result).toHaveLength(2_097_152);
  });
});
