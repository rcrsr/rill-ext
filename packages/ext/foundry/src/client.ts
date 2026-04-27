/**
 * AzureOpenAI client setup and auth header builders for Azure AI Foundry extension.
 *
 * Two auth scopes per spec decision D-2:
 *   - ai.azure.com/.default       — AzureOpenAI inference and Bing Grounding
 *   - cognitiveservices.azure.com/.default — Content Safety and AI Search REST calls
 */

import { RuntimeError } from '@rcrsr/rill';
import { AzureOpenAI } from 'openai';
import type { FoundryAuth, FoundryInferenceConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * OAuth2 scope for AzureOpenAI inference and Bing Grounding.
 */
export const SCOPE_AI = 'https://ai.azure.com/.default';

/**
 * OAuth2 scope for Content Safety and AI Search REST calls.
 */
export const SCOPE_COGNITIVE = 'https://cognitiveservices.azure.com/.default';

// ============================================================
// AZURE OPENAI CLIENT
// ============================================================

/**
 * Create an AzureOpenAI client from the extension's auth and inference config.
 *
 * - `api-key` auth: uses `apiKey` constructor option
 * - `entra` auth: builds an `azureADTokenProvider` callback using `getBearerTokenProvider`
 *   from `@azure/identity` with the `ai.azure.com/.default` scope (D-2)
 *
 * The client is created once at factory time and shared across all host functions.
 *
 * @param endpoint - Foundry resource endpoint URL (required, validated before this call)
 * @param auth - Authentication config (validated before this call)
 * @param inference - Optional inference config for apiVersion and timeout
 * @returns Configured AzureOpenAI client instance
 */
export async function createAzureOpenAIClient(
  endpoint: string,
  auth: FoundryAuth,
  inference?: FoundryInferenceConfig | undefined
): Promise<AzureOpenAI> {
  const apiVersion = inference?.apiVersion;
  const timeout = inference?.timeout ?? 30000;

  if (auth.type === 'api-key') {
    return new AzureOpenAI({
      endpoint,
      apiKey: auth.key,
      apiVersion,
      timeout,
    });
  }

  // Entra ID — lazy import to keep @azure/identity optional at runtime
  const { getBearerTokenProvider, DefaultAzureCredential } = await import('@azure/identity');
  const credential = auth.credential ?? new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(credential, SCOPE_AI);

  return new AzureOpenAI({
    endpoint,
    azureADTokenProvider,
    apiVersion,
    timeout,
  });
}

// ============================================================
// AUTH HEADER BUILDERS
// ============================================================

/**
 * Build auth headers for REST calls to Content Safety and AI Search.
 * These services use the cognitiveservices.azure.com scope (D-2).
 *
 * - `api-key` auth: returns `{ 'Ocp-Apim-Subscription-Key': key }` for Content Safety,
 *   `{ 'api-key': key }` for AI Search. Callers pass the correct service flag.
 * - `entra` auth: acquires a Bearer token via `cognitiveservices.azure.com/.default`.
 *
 * @param auth - Authentication config
 * @param service - Target service, determines header name for api-key auth
 * @returns Record of HTTP headers to merge into the request
 */
export async function buildRestAuthHeaders(
  auth: FoundryAuth,
  service: 'content-safety' | 'search'
): Promise<Record<string, string>> {
  if (auth.type === 'api-key') {
    if (service === 'content-safety') {
      return { 'Ocp-Apim-Subscription-Key': auth.key };
    }
    // AI Search
    return { 'api-key': auth.key };
  }

  // Entra ID — lazy import to keep @azure/identity optional at runtime
  const { DefaultAzureCredential } = await import('@azure/identity');
  const credential = auth.credential ?? new DefaultAzureCredential();
  const tokenResponse = await credential.getToken(SCOPE_COGNITIVE);
  if (!tokenResponse?.token) {
    throw new RuntimeError('RILL-R005', 'foundry: failed to acquire Entra token');
  }
  return { Authorization: `Bearer ${tokenResponse.token}` };
}
