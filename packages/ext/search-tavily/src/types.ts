/**
 * Type definitions for Tavily search extension.
 * Defines configuration and contract types for the Tavily API integration.
 */

import type { ApplicationCallable } from '@rcrsr/rill';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Tavily search extension.
 *
 * @example
 * ```typescript
 * const config: TavilyConfig = {
 *   apiKey: process.env.TAVILY_API_KEY,
 * };
 * ```
 */
export interface TavilyConfig {
  /**
   * Tavily API key for authentication.
   * Sent as Bearer token in Authorization header.
   */
  readonly apiKey: string;

  /**
   * Base URL override for the Tavily API.
   * Default: https://api.tavily.com
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
 * Contract type for Tavily extension implementations.
 * Enforces exact function structure for compile-time verification.
 */
export type TavilyExtensionContract = {
  readonly search: ApplicationCallable;
  readonly extract: ApplicationCallable;
};
