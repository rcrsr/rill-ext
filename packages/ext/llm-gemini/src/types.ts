/**
 * Type definitions for Google extension.
 * Defines configuration, message types, and result structures.
 */

import type { LLMProviderConfig } from '@rcrsr/rill-ext-llm-shared';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Google extension.
 * Extends LLMProviderConfig from shared package with Vertex AI fields.
 * api_key is optional here because Vertex AI mode authenticates via
 * project/location instead of an API key.
 */
export interface GeminiExtensionConfig extends Omit<
  LLMProviderConfig,
  'api_key'
> {
  readonly api_key?: string;
  readonly vertexai?: boolean;
  readonly project?: string;
  readonly location?: string;
}
