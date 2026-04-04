/**
 * Type definitions for crypto extension.
 *
 * @module
 */

/** Crypto extension configuration. */
export interface CryptoExtensionConfig {
  /** Default hash algorithm (default: 'sha256') */
  readonly defaultAlgorithm?: string | undefined;
  /** HMAC key (required only if hmac() used) */
  readonly hmacKey?: string | undefined;
}
