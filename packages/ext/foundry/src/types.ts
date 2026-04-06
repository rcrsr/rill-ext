/**
 * Type definitions for Azure AI Foundry extension.
 * Defines configuration types for auth, inference, content safety, grounding, and search.
 */

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * API key authentication for Azure resources.
 */
export interface FoundryApiKeyAuth {
  readonly type: 'api-key';
  /**
   * Azure resource API key.
   */
  readonly key: string;
}

/**
 * Microsoft Entra ID (Azure AD) authentication.
 * Defaults to DefaultAzureCredential when credential is omitted.
 *
 * The credential field accepts any @azure/identity TokenCredential implementation.
 * Using a local structural type avoids a hard dependency on @azure/identity
 * in the bundled type declarations while remaining fully compatible at runtime.
 */
export interface FoundryEntraAuth {
  readonly type: 'entra';
  /**
   * Optional credential. Accepts any @azure/identity TokenCredential.
   * Defaults to DefaultAzureCredential when omitted.
   */
  readonly credential?: { getToken(scopes: string | string[], options?: Record<string, unknown>): Promise<{ token: string; expiresOnTimestamp: number } | null> } | undefined;
}

/**
 * Discriminated union of supported authentication modes.
 */
export type FoundryAuth = FoundryApiKeyAuth | FoundryEntraAuth;

// ============================================================
// SUB-CONFIGURATIONS
// ============================================================

/**
 * LLM inference settings for Azure OpenAI deployments.
 */
export interface FoundryInferenceConfig {
  /**
   * Deployment name for chat/completions. Required.
   */
  readonly model: string;
  /**
   * Azure OpenAI API version. Required (no SDK default).
   */
  readonly apiVersion: string;
  /**
   * Request timeout in milliseconds. Defaults to 30000.
   */
  readonly timeout?: number | undefined;
  /**
   * Maximum completion tokens. Defaults to 4096.
   */
  readonly maxTokens?: number | undefined;
  /**
   * Default system message prepended to every request.
   */
  readonly system?: string | undefined;
  /**
   * Sampling temperature (0.0-2.0). Uses SDK default when omitted.
   */
  readonly temperature?: number | undefined;
  /**
   * Deployment name for embedding operations.
   */
  readonly embedModel?: string | undefined;
}

/**
 * Azure AI Content Safety settings.
 */
export interface FoundryContentSafetyConfig {
  /**
   * Content Safety resource endpoint. Required.
   */
  readonly endpoint: string;
  /**
   * Enable automatic shielding on LLM calls. Defaults to false.
   */
  readonly autoShield?: boolean | undefined;
}

/**
 * Bing grounding settings for Azure AI Foundry.
 */
export interface FoundryGroundingConfig {
  /**
   * Bing connection resource ID. Required.
   */
  readonly connectionId: string;
  /**
   * Deployment name for grounding responses. Falls back to inference.model when unset.
   */
  readonly model?: string | undefined;
}

/**
 * Azure AI Search settings.
 */
export interface FoundrySearchConfig {
  /**
   * AI Search service endpoint. Required.
   */
  readonly endpoint: string;
  /**
   * Default index name. Required.
   */
  readonly indexName: string;
  /**
   * Search service API key. Falls back to main auth when omitted.
   */
  readonly apiKey?: string | undefined;
  /**
   * AI Search API version. Defaults to '2025-09-01'.
   */
  readonly apiVersion?: string | undefined;
  /**
   * Semantic ranking configuration name.
   */
  readonly semanticConfig?: string | undefined;
  /**
   * Default query type. Defaults to 'semantic'.
   */
  readonly queryType?: string | undefined;
}

// ============================================================
// ROOT CONFIG
// ============================================================

/**
 * Configuration for the Azure AI Foundry extension.
 */
export interface FoundryConfig {
  /**
   * Foundry resource endpoint URL. Required.
   */
  readonly endpoint: string;
  /**
   * Authentication configuration. Required.
   */
  readonly auth: FoundryAuth;
  /**
   * LLM inference settings.
   */
  readonly inference?: FoundryInferenceConfig | undefined;
  /**
   * Content Safety settings. Validated at first shield call.
   */
  readonly contentSafety?: FoundryContentSafetyConfig | undefined;
  /**
   * Bing grounding settings. Validated at first ground call.
   */
  readonly grounding?: FoundryGroundingConfig | undefined;
  /**
   * Azure AI Search settings. Validated at first search call.
   */
  readonly search?: FoundrySearchConfig | undefined;
}
