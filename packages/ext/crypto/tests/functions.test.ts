/**
 * Tests for crypto extension functions.
 *
 * Verifies hash, hmac, uuid, and random behavior including edge cases.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createCryptoExtension } from '../src/factory.js';

describe('hash()', () => {
  it('hashes content with default algorithm (sha256)', async () => {
    const ext = createCryptoExtension({ defaultAlgorithm: 'sha256' });
    const result = await ext.value.hash.fn({ input: 'hello world' });

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(64);
  });

  it('hashes content with explicit algorithm', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.hash.fn({
      input: 'hello world',
      algorithm: 'md5',
    });

    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(32);
  });

  it('produces consistent output for same input', async () => {
    const ext = createCryptoExtension();
    const r1 = await ext.value.hash.fn({ input: 'test', algorithm: 'sha256' });
    const r2 = await ext.value.hash.fn({ input: 'test', algorithm: 'sha256' });
    expect(r1).toBe(r2);
  });

  it('produces different output for different input', async () => {
    const ext = createCryptoExtension();
    const r1 = await ext.value.hash.fn({ input: 'input1', algorithm: 'sha256' });
    const r2 = await ext.value.hash.fn({ input: 'input2', algorithm: 'sha256' });
    expect(r1).not.toBe(r2);
  });

  it('supports sha512 algorithm', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.hash.fn({ input: 'test', algorithm: 'sha512' });
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('throws for invalid algorithm', async () => {
    const ext = createCryptoExtension();
    await expect(
      ext.value.hash.fn({ input: 'test', algorithm: 'invalid-algo' }),
    ).rejects.toThrow(RuntimeError);
    await expect(
      ext.value.hash.fn({ input: 'test', algorithm: 'invalid-algo' }),
    ).rejects.toThrow('unsupported algorithm');
  });

  it('uses default algorithm when not specified', async () => {
    const ext = createCryptoExtension({ defaultAlgorithm: 'sha512' });
    const result = await ext.value.hash.fn({ input: 'test' });
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('hashes empty string', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.hash.fn({ input: '', algorithm: 'sha256' });
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('handles unicode input', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.hash.fn({
      input: 'Hello 世界 🌍',
      algorithm: 'sha256',
    });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hmac()', () => {
  it('generates HMAC signature', async () => {
    const ext = createCryptoExtension({
      hmacKey: 'secret-key',
      defaultAlgorithm: 'sha256',
    });
    const result = await ext.value.hmac.fn({ input: 'message to authenticate' });

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(64);
  });

  it('generates HMAC with explicit algorithm', async () => {
    const ext = createCryptoExtension({ hmacKey: 'secret' });
    const result = await ext.value.hmac.fn({
      input: 'message',
      algorithm: 'sha512',
    });
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('produces consistent output for same input and key', async () => {
    const ext = createCryptoExtension({ hmacKey: 'secret' });
    const r1 = await ext.value.hmac.fn({ input: 'message', algorithm: 'sha256' });
    const r2 = await ext.value.hmac.fn({ input: 'message', algorithm: 'sha256' });
    expect(r1).toBe(r2);
  });

  it('produces different output for different messages', async () => {
    const ext = createCryptoExtension({ hmacKey: 'secret' });
    const r1 = await ext.value.hmac.fn({ input: 'message1', algorithm: 'sha256' });
    const r2 = await ext.value.hmac.fn({ input: 'message2', algorithm: 'sha256' });
    expect(r1).not.toBe(r2);
  });

  it('throws when hmacKey not configured', async () => {
    const ext = createCryptoExtension();
    await expect(ext.value.hmac.fn({ input: 'message' })).rejects.toThrow(
      RuntimeError,
    );
    await expect(ext.value.hmac.fn({ input: 'message' })).rejects.toThrow(
      'hmacKey required for hmac()',
    );
  });

  it('throws for invalid algorithm', async () => {
    const ext = createCryptoExtension({ hmacKey: 'secret' });
    await expect(
      ext.value.hmac.fn({ input: 'message', algorithm: 'invalid-algo' }),
    ).rejects.toThrow(RuntimeError);
  });

  it('uses default algorithm when not specified', async () => {
    const ext = createCryptoExtension({
      hmacKey: 'secret',
      defaultAlgorithm: 'sha512',
    });
    const result = await ext.value.hmac.fn({ input: 'message' });
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('handles unicode input', async () => {
    const ext = createCryptoExtension({ hmacKey: 'key' });
    const result = await ext.value.hmac.fn({
      input: 'Hello 世界 🌍',
      algorithm: 'sha256',
    });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('uuid()', () => {
  it('generates random UUID v4', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.uuid.fn({});

    expect(typeof result).toBe('string');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique UUIDs', async () => {
    const ext = createCryptoExtension();
    const r1 = await ext.value.uuid.fn({});
    const r2 = await ext.value.uuid.fn({});
    expect(r1).not.toBe(r2);
  });

  it('generates valid v4 format across multiple calls', async () => {
    const ext = createCryptoExtension();
    for (let i = 0; i < 10; i++) {
      const result = await ext.value.uuid.fn({});
      const parts = result.split('-');
      expect(parts).toHaveLength(5);
      expect(parts[2]![0]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(parts[3]![0]);
    }
  });
});

describe('random()', () => {
  it('generates random bytes as hex string', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.random.fn({ bytes: 16 });

    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(32);
  });

  it('returns correct length for byte count', async () => {
    const ext = createCryptoExtension();
    const r8 = await ext.value.random.fn({ bytes: 8 });
    expect(r8).toHaveLength(16);
    const r32 = await ext.value.random.fn({ bytes: 32 });
    expect(r32).toHaveLength(64);
    const r64 = await ext.value.random.fn({ bytes: 64 });
    expect(r64).toHaveLength(128);
  });

  it('generates different values on each call', async () => {
    const ext = createCryptoExtension();
    const r1 = await ext.value.random.fn({ bytes: 16 });
    const r2 = await ext.value.random.fn({ bytes: 16 });
    expect(r1).not.toBe(r2);
  });

  it('handles small byte counts', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.random.fn({ bytes: 1 });
    expect(result).toMatch(/^[0-9a-f]{2}$/);
  });

  it('handles large byte counts', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.random.fn({ bytes: 256 });
    expect(result).toMatch(/^[0-9a-f]{512}$/);
  });

  it('returns empty string for zero bytes', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.random.fn({ bytes: 0 });
    expect(result).toBe('');
  });

  it('throws RuntimeError for negative bytes', async () => {
    const ext = createCryptoExtension();
    await expect(ext.value.random.fn({ bytes: -1 })).rejects.toThrow(RuntimeError);
    await expect(ext.value.random.fn({ bytes: -1 })).rejects.toThrow(
      'bytes must be a non-negative integer',
    );
  });

  it('throws RuntimeError for non-integer bytes', async () => {
    const ext = createCryptoExtension();
    await expect(ext.value.random.fn({ bytes: 1.5 })).rejects.toThrow(RuntimeError);
    await expect(ext.value.random.fn({ bytes: 1.5 })).rejects.toThrow(
      'bytes must be a non-negative integer',
    );
  });

  it('throws RuntimeError when bytes exceeds 1MB limit', async () => {
    const ext = createCryptoExtension();
    await expect(ext.value.random.fn({ bytes: 1_048_577 })).rejects.toThrow(RuntimeError);
    await expect(ext.value.random.fn({ bytes: 1_048_577 })).rejects.toThrow(
      'bytes must not exceed 1048576 (1MB)',
    );
  });

  it('accepts exactly 1MB bytes', async () => {
    const ext = createCryptoExtension();
    const result = await ext.value.random.fn({ bytes: 1_048_576 });
    expect(result).toHaveLength(2_097_152);
  });
});
