/**
 * Tests for crypto extension functions.
 *
 * Verifies hash, hmac, uuid, and random behavior including edge cases.
 */

import { describe, it, expect } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createCryptoExtension } from '../src/factory.js';
import type { CryptoExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx, fnOf } from './_setup.js';

function mk(config: CryptoExtensionConfig = {}) {
  return createCryptoExtension(config, makeFactoryCtx());
}

describe('hash()', () => {
  it('hashes content with sha256 when no default algorithm is configured', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hash').fn(
      { input: 'hello world' },
      makeRuntimeCtx()
    );

    expect(result).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
  });

  it('hashes content with explicit algorithm', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hash').fn(
      {
        input: 'hello world',
        algorithm: 'md5',
      },
      makeRuntimeCtx()
    );

    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(32);
  });

  it('supports sha512 algorithm', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hash').fn(
      { input: 'test', algorithm: 'sha512' },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('returns invalid value for unsupported algorithm', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hash').fn(
      { input: 'test', algorithm: 'invalid-algo' },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/unsupported algorithm/);
  });

  it('uses default algorithm when not specified', async () => {
    const ext = mk({ defaultAlgorithm: 'sha512' });
    const result = await fnOf(ext, 'hash').fn(
      { input: 'test' },
      makeRuntimeCtx()
    );
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it('hashes empty string', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hash').fn(
      { input: '', algorithm: 'sha256' },
      makeRuntimeCtx()
    );
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('hmac()', () => {
  it('generates HMAC-SHA256 signature when no default algorithm is configured', async () => {
    const ext = mk({ hmacKey: 'secret-key' });
    const result = await fnOf(ext, 'hmac').fn(
      { input: 'message to authenticate' },
      makeRuntimeCtx()
    );

    expect(result).toBe(
      '79774090145c3f263969df659b5706baa1d03045d3f55002cf17da54e788fc22'
    );
  });

  it('generates HMAC with explicit algorithm', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const result = await fnOf(ext, 'hmac').fn(
      {
        input: 'message',
        algorithm: 'sha512',
      },
      makeRuntimeCtx()
    );
    expect(result).toBe(
      '1bba587c730eedba31f53abb0b6ca589e09de4e894ee455e6140807399759adaafa069eec7c01647bb173dcb17f55d22af49a18071b748c5c2edd7f7a829c632'
    );
  });

  it('returns invalid value when hmacKey not configured', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'hmac').fn(
      { input: 'message' },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/hmacKey required/);
  });

  it('returns invalid value for unsupported algorithm', async () => {
    const ext = mk({ hmacKey: 'secret' });
    const result = await fnOf(ext, 'hmac').fn(
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
    const result = await fnOf(ext, 'hmac').fn(
      { input: 'message' },
      makeRuntimeCtx()
    );
    expect(result).toBe(
      '1bba587c730eedba31f53abb0b6ca589e09de4e894ee455e6140807399759adaafa069eec7c01647bb173dcb17f55d22af49a18071b748c5c2edd7f7a829c632'
    );
  });
});

describe('uuid()', () => {
  it('generates random UUID v4', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'uuid').fn({}, makeRuntimeCtx());

    expect(typeof result).toBe('string');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe('random()', () => {
  it.each([1, 8, 16, 32, 64, 256])(
    'generates %d random bytes as a hex string of twice the length',
    async (bytes) => {
      const ext = mk();
      const result = await fnOf(ext, 'random').fn({ bytes }, makeRuntimeCtx());

      expect(result).toMatch(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));
    }
  );

  it('returns empty string for zero bytes', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'random').fn({ bytes: 0 }, makeRuntimeCtx());
    expect(result).toBe('');
  });

  it('returns invalid value for negative bytes', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'random').fn(
      { bytes: -1 },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/bytes must be a non-negative integer/);
  });

  it('returns invalid value for non-integer bytes', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'random').fn(
      { bytes: 1.5 },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
  });

  it('returns invalid value when bytes exceeds 1MB limit', async () => {
    const ext = mk();
    const result = await fnOf(ext, 'random').fn(
      { bytes: 1_048_577 },
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/must not exceed 1048576/);
  });

  it('accepts exactly 1MB bytes', async () => {
    const ext = mk();
    const result = (await fnOf(ext, 'random').fn(
      { bytes: 1_048_576 },
      makeRuntimeCtx()
    )) as string;
    expect(result).toHaveLength(2_097_152);
  });
});
