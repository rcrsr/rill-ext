/**
 * Type definitions for SearXNG search extension.
 * Defines configuration and contract types for self-hosted SearXNG integration.
 */

import type { ApplicationCallable, ExtensionFactoryResult } from '@rcrsr/rill';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for SearXNG search extension.
 *
 * @example
 * ```typescript
 * const config: SearxngConfig = {
 *   baseUrl: 'https://searxng.example.com',
 * };
 * ```
 */
export interface SearxngConfig {
  /**
   * Base URL of the SearXNG instance.
   * Required. Must start with http:// or https://.
   */
  readonly baseUrl: string;

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
 * Contract type for SearXNG extension implementations.
 * Enforces exact function structure for compile-time verification.
 */
export type SearxngExtensionContract = {
  readonly search: ApplicationCallable;
  readonly config: ApplicationCallable;
};

/**
 * Re-export for satisfies check usage.
 */
export type { ExtensionFactoryResult };
