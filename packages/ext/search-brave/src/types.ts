/**
 * Type definitions for Brave search extension.
 * Defines configuration and contract types for the Brave Search API integration.
 */

import type { ApplicationCallable, ExtensionFactoryResult } from '@rcrsr/rill';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Brave search extension.
 *
 * @example
 * ```typescript
 * const config: BraveConfig = {
 *   apiKey: process.env.BRAVE_API_KEY,
 * };
 * ```
 */
export interface BraveConfig {
  /**
   * Brave Search API key for authentication.
   * Sent as X-Subscription-Token header.
   */
  readonly apiKey: string;

  /**
   * Base URL override for the Brave Search API.
   * Default: https://api.search.brave.com
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
 * Contract type for Brave extension implementations.
 * Enforces exact function structure for compile-time verification.
 */
export type BraveExtensionContract = {
  readonly search: ApplicationCallable;
  readonly news: ApplicationCallable;
  readonly summarize: ApplicationCallable;
};

/**
 * Re-export for satisfies check usage.
 */
export type { ExtensionFactoryResult };
