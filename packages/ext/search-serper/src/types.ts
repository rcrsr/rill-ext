/**
 * Type definitions for Serper search extension.
 * Defines configuration and contract types for the Serper API integration.
 */

import type { ApplicationCallable } from '@rcrsr/rill';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Serper search extension.
 *
 * @example
 * ```typescript
 * const config: SerperConfig = {
 *   apiKey: process.env.SERPER_API_KEY,
 * };
 * ```
 */
export interface SerperConfig {
  /**
   * Serper API key for authentication.
   * Sent as X-API-KEY header.
   */
  readonly apiKey: string;

  /**
   * Base URL override for the Serper API.
   * Default: https://google.serper.dev
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
 * Contract type for Serper extension implementations.
 * Enforces exact function structure for compile-time verification.
 */
export type SerperExtensionContract = {
  readonly search: ApplicationCallable;
  readonly news: ApplicationCallable;
  readonly images: ApplicationCallable;
};
