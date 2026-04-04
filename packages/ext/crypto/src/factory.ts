/**
 * Factory function for creating crypto extension.
 *
 * @module
 */

import crypto from 'node:crypto';
import {
  RuntimeError,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillParam,
  type RillValue,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { CryptoExtensionConfig } from './types.js';

const stringReturn = structureToTypeValue({ kind: 'string' });

/**
 * Creates a crypto extension with hashing and random generation.
 *
 * Returns 4 functions: hash, hmac, uuid, random.
 */
export function createCryptoExtension(
  config: CryptoExtensionConfig = {},
): ExtensionFactoryResult {
  const defaultAlgorithm = config.defaultAlgorithm ?? 'sha256';
  const hmacKey = config.hmacKey;

  const supportedAlgorithms = new Set(crypto.getHashes());

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  function validateAlgorithm(algorithm: string): void {
    if (!supportedAlgorithms.has(algorithm)) {
      throw new RuntimeError(
        'RILL-R004',
        `unsupported algorithm: ${algorithm}`,
        undefined,
        { algorithm, supported: Array.from(supportedAlgorithms) },
      );
    }
  }

  // ----------------------------------------------------------
  // Functions
  // ----------------------------------------------------------

  const hash = async (args: Record<string, RillValue>): Promise<string> => {
    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;
    validateAlgorithm(algorithm);
    const h = crypto.createHash(algorithm);
    h.update(input);
    return h.digest('hex');
  };

  const hmac = async (args: Record<string, RillValue>): Promise<string> => {
    if (!hmacKey) {
      throw new RuntimeError(
        'RILL-R004',
        'hmacKey required for hmac() — set in config',
        undefined,
        {},
      );
    }
    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;
    validateAlgorithm(algorithm);
    const h = crypto.createHmac(algorithm, hmacKey);
    h.update(input);
    return h.digest('hex');
  };

  const uuid = async (): Promise<string> => {
    return crypto.randomUUID();
  };

  const random = async (args: Record<string, RillValue>): Promise<string> => {
    const bytes = args['bytes'] as number;
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
      annotations: { description: 'Generate HMAC signature, returns hex output' },
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
