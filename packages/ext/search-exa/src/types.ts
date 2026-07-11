/**
 * Type definitions for Exa search extension.
 * Defines configuration and contract types for the Exa API integration.
 */

import type { ApplicationCallable } from '@rcrsr/rill';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Exa search extension.
 *
 * @example
 * ```typescript
 * const config: ExaConfig = {
 *   apiKey: process.env.EXA_API_KEY,
 * };
 * ```
 */
export interface ExaConfig {
  /**
   * Exa API key for authentication.
   * Sent as x-api-key header.
   */
  readonly apiKey: string;

  /**
   * Base URL override for the Exa API.
   * Default: https://api.exa.ai
   */
  readonly baseUrl?: string | undefined;

  /**
   * Request timeout in milliseconds.
   * Default: 30000
   */
  readonly timeout?: number | undefined;
}

// ============================================================
// CONTRACT
// ============================================================

/**
 * Contract type for Exa extension implementations.
 * Enforces exact function structure for compile-time verification.
 */
export type ExaExtensionContract = {
  readonly search: ApplicationCallable;
  readonly contents: ApplicationCallable;
  readonly find_similar: ApplicationCallable;
  readonly answer: ApplicationCallable;
};
