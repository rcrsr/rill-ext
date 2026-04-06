/**
 * Azure AI Search REST client for Azure AI Foundry extension.
 *
 * search() POSTs to the Azure AI Search indexes REST API using native fetch().
 *
 * Auth (per spec D-2):
 *   - api-key auth: 'api-key' header (using search.apiKey if set, else main auth key)
 *   - entra auth: Bearer token with cognitiveservices.azure.com/.default scope
 *
 * Default query type: semantic
 * Default API version: 2025-09-01
 */

import { RuntimeError, emitExtensionEvent, type RillValue, type RuntimeContext } from '@rcrsr/rill';
import { buildRestAuthHeaders } from './client.js';
import { mapRestError, createTimeoutError } from './errors.js';
import type {
  FoundryAuth,
  FoundryConfig,
  FoundrySearchConfig,
} from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_SEARCH_API_VERSION = '2025-09-01';
const DEFAULT_QUERY_TYPE = 'semantic';
const DEFAULT_TOP = 10;
const DEFAULT_TIMEOUT = 30_000;
const PROVIDER = 'foundry';

// ============================================================
// SEARCH FUNCTION
// ============================================================

/**
 * Search Azure AI Search indexes.
 *
 * Returns a list of `{ id, score, content }` dicts.
 * Validates `search` config on each call (EC-10 if missing).
 *
 * Options dict fields:
 *   - `index` — overrides config.search.indexName
 *   - `queryType` — overrides config.search.queryType ('simple' | 'full' | 'semantic')
 *   - `top` — max number of results
 *   - `filter` — OData filter expression
 *
 * @param query - Search query string
 * @param options - Optional overrides (index, queryType, top, filter)
 * @param config - Root Foundry config (search sub-config validated here)
 * @param auth - Authentication config
 * @param ctx - Runtime context for event emission
 * @param disposed - Disposal flag; throws if true
 * @returns RillValue list of result dicts
 */
export async function callSearch(
  query: string,
  options: Record<string, RillValue>,
  config: FoundryConfig,
  auth: FoundryAuth,
  ctx: RuntimeContext,
  disposed: { value: boolean }
): Promise<RillValue> {
  if (disposed.value) {
    throw new RuntimeError('RILL-R004', `${PROVIDER}: extension disposed`);
  }

  // EC-10: Search must be configured
  if (!config.search) {
    throw new RuntimeError('RILL-R004', 'foundry: search not configured');
  }

  const searchConfig: FoundrySearchConfig = config.search;

  // Resolve effective options: caller options override config defaults
  const indexName =
    typeof options['index'] === 'string' ? options['index'] : searchConfig.indexName;
  const queryType =
    typeof options['queryType'] === 'string'
      ? options['queryType']
      : (searchConfig.queryType ?? DEFAULT_QUERY_TYPE);
  const top =
    typeof options['top'] === 'number' ? options['top'] : DEFAULT_TOP;
  const filter =
    typeof options['filter'] === 'string' ? options['filter'] : undefined;

  const apiVersion = searchConfig.apiVersion ?? DEFAULT_SEARCH_API_VERSION;
  const startTime = Date.now();

  try {
    const results = await runSearchRequest(
      query,
      indexName,
      queryType,
      top,
      filter,
      searchConfig,
      auth,
      apiVersion
    );

    const duration = Date.now() - startTime;

    emitExtensionEvent(ctx, {
      event: 'foundry:search',
      subsystem: `extension:${PROVIDER}`,
      index: indexName,
      resultCount: results.length,
      queryType,
      duration,
    });

    return results as RillValue;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    if (error instanceof RuntimeError) {
      emitExtensionEvent(ctx, {
        event: 'foundry:search:error',
        subsystem: `extension:${PROVIDER}`,
        index: indexName,
        error: error.message,
        duration,
      });
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const rillError = new RuntimeError('RILL-R004', `${PROVIDER}: ${message}`);

    emitExtensionEvent(ctx, {
      event: 'foundry:search:error',
      subsystem: `extension:${PROVIDER}`,
      index: indexName,
      error: rillError.message,
      duration,
    });

    throw rillError;
  }
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Execute the Azure AI Search REST request.
 *
 * @param query - Search query text
 * @param indexName - Target index name
 * @param queryType - Query type: 'simple' | 'full' | 'semantic'
 * @param top - Maximum number of results
 * @param filter - Optional OData filter expression
 * @param searchConfig - Search sub-config
 * @param auth - Authentication config
 * @param apiVersion - Search API version string
 * @returns Array of result dicts with id, score, content fields
 */
async function runSearchRequest(
  query: string,
  indexName: string,
  queryType: string,
  top: number,
  filter: string | undefined,
  searchConfig: FoundrySearchConfig,
  auth: FoundryAuth,
  apiVersion: string
): Promise<Array<Record<string, RillValue>>> {
  const url =
    `${searchConfig.endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search` +
    `?api-version=${apiVersion}`;

  // Build auth headers: use search-specific api-key if provided
  let authHeaders: Record<string, string>;
  if (searchConfig.apiKey !== undefined) {
    authHeaders = { 'api-key': searchConfig.apiKey };
  } else {
    authHeaders = await buildRestAuthHeaders(auth, 'search');
  }

  const requestBody: Record<string, unknown> = {
    search: query,
    queryType,
    top,
  };

  if (filter !== undefined) {
    requestBody['filter'] = filter;
  }

  // Attach semantic configuration name when using semantic query type
  if (queryType === 'semantic' && searchConfig.semanticConfig !== undefined) {
    requestBody['semanticConfiguration'] = searchConfig.semanticConfig;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw createTimeoutError();
    }
    throw error;
  }

  // EC-11: Search index not found
  if (response.status === 404) {
    throw new RuntimeError(
      'RILL-R004',
      `foundry: search index '${indexName}' not found`
    );
  }

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    throw mapRestError(response.status, responseBody);
  }

  const data = (await response.json()) as {
    value?: Array<{
      '@search.score'?: number;
      [key: string]: unknown;
    }>;
  };

  const items = data.value ?? [];

  return items.map((item) => {
    const score = item['@search.score'] ?? 0;

    // Extract the document's key field as 'id' — Azure Search uses a configurable key field.
    // Common field names are 'id', 'ID', or the first non-score field.
    const id = extractDocumentId(item);

    // Build a content dict from all non-metadata fields
    const content = buildContentDict(item);

    return {
      id: id as RillValue,
      score: score as RillValue,
      content: content as RillValue,
    };
  });
}

/**
 * Extract the document ID from an Azure AI Search result item.
 * Tries common key field names: 'id', 'ID', 'key'.
 * Falls back to the first non-metadata field (fields not starting with '@') with a truthy value.
 * Returns empty string if no suitable field is found.
 *
 * @param item - Raw search result item
 * @returns Document ID as string
 */
function extractDocumentId(item: Record<string, unknown>): string {
  for (const key of ['id', 'ID', 'key']) {
    const value = item[key];
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  for (const key of Object.keys(item)) {
    if (!key.startsWith('@')) {
      const value = item[key];
      const isScalar =
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean';
      if (isScalar && value) {
        return String(value);
      }
    }
  }
  return '';
}

/**
 * Build a content dict from a search result item, excluding Azure metadata fields.
 *
 * @param item - Raw search result item
 * @returns Dict of document fields (excluding Azure-prefixed metadata)
 */
function buildContentDict(item: Record<string, unknown>): Record<string, RillValue> {
  const content: Record<string, RillValue> = {};
  for (const [key, value] of Object.entries(item)) {
    // Skip Azure Search metadata fields (prefixed with @search.)
    if (key.startsWith('@search.')) {
      continue;
    }
    content[key] = value as RillValue;
  }
  return content;
}
