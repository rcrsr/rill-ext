/**
 * Factory function for creating crypto extension.
 *
 * @module
 */

import crypto from 'node:crypto';
import {
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillParam,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { CryptoExtensionConfig } from './types.js';

const stringReturn = structureToTypeValue({ kind: 'string' });
const PROVIDER = 'crypto';

/**
 * Creates a crypto extension with hashing and random generation.
 *
 * Returns 4 functions: hash, hmac, uuid, random.
 */
export function createCryptoExtension(
  config: CryptoExtensionConfig = {},
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  const defaultAlgorithm = config.defaultAlgorithm ?? 'sha256';
  const hmacKey = config.hmacKey;

  const supportedAlgorithms = new Set(crypto.getHashes());

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  function checkAlgorithm(
    algorithm: string,
    runCtx: RuntimeContext
  ): RillValue | null {
    if (!supportedAlgorithms.has(algorithm)) {
      return runCtx.invalidate(
        new Error(`unsupported algorithm: ${algorithm}`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'unsupported_algorithm',
            algorithm,
            supported: Array.from(supportedAlgorithms),
          },
        }
      );
    }
    return null;
  }

  // ----------------------------------------------------------
  // Functions
  // ----------------------------------------------------------

  const hash: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;
    const invalid = checkAlgorithm(algorithm, runCtx);
    if (invalid !== null) return invalid;
    const h = crypto.createHash(algorithm);
    h.update(input);
    return h.digest('hex');
  };

  const hmac: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (!hmacKey) {
      return runCtx.invalidate(
        new Error('hmacKey required for hmac() — set in config'),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'missing_hmac_key' },
        }
      );
    }
    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;
    const invalid = checkAlgorithm(algorithm, runCtx);
    if (invalid !== null) return invalid;
    const h = crypto.createHmac(algorithm, hmacKey);
    h.update(input);
    return h.digest('hex');
  };

  const uuid: CallableFn = async () => {
    return crypto.randomUUID();
  };

  const MAX_RANDOM_BYTES = 1_048_576;

  const random: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const bytes = args['bytes'] as number;
    if (!Number.isInteger(bytes) || bytes < 0) {
      return runCtx.invalidate(
        new Error('bytes must be a non-negative integer'),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'invalid_bytes', bytes },
        }
      );
    }
    if (bytes > MAX_RANDOM_BYTES) {
      return runCtx.invalidate(
        new Error(`bytes must not exceed ${MAX_RANDOM_BYTES} (1MB)`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'bytes_too_large', bytes, max: MAX_RANDOM_BYTES },
        }
      );
    }
    return crypto.randomBytes(bytes).toString('hex');
  };

  // ----------------------------------------------------------
  // Param with default value (p.str lacks defaultValue support)
  // ----------------------------------------------------------

  const algorithmParam: RillParam = {
    name: 'algorithm',
    type: { kind: 'string' },
    defaultValue: defaultAlgorithm,
    annotations: { description: 'Hash algorithm' },
  };

  // ----------------------------------------------------------
  // RillFunction definitions
  // ----------------------------------------------------------

  const fnDict: Record<string, RillFunction> = {
    hash: {
      params: [p.str('input', 'Content to hash'), algorithmParam],
      fn: hash,
      annotations: { description: 'Hash content, returns hex output' },
      returnType: stringReturn,
    },
    hmac: {
      params: [p.str('input', 'Content to authenticate'), algorithmParam],
      fn: hmac,
      annotations: {
        description: 'Generate HMAC signature, returns hex output',
      },
      returnType: stringReturn,
    },
    uuid: {
      params: [],
      fn: uuid,
      annotations: { description: 'Generate random UUID v4' },
      returnType: stringReturn,
    },
    random: {
      params: [p.num('bytes', 'Number of bytes')],
      fn: random,
      annotations: { description: 'Generate random bytes as hex string' },
      returnType: stringReturn,
    },
  };

  // ----------------------------------------------------------
  // Build callable dict
  // ----------------------------------------------------------

  const callableDict: Record<string, RillValue> = {};
  for (const [name, def] of Object.entries(fnDict)) {
    callableDict[name] = toCallable(def);
  }

  return {
    value: callableDict as unknown as RillValue,
    dispose: async (): Promise<void> => {},
  } satisfies ExtensionFactoryResult;
}
