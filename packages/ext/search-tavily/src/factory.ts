/**
 * Extension factory for Tavily search API integration.
 * Creates extension instance with config validation and HTTP lifecycle management.
 */

import {
  RuntimeError,
  toCallable,
  structureToTypeValue,
  type CallableFn,
  type ExtensionFactoryResult,
  type RillValue,
} from '@rcrsr/rill';
import {
  assertRequired,
  validateBaseUrl,
  createDisposalState,
  createInFlightState,
  abortAll,
  dispose,
  mapProviderSearchError,
  createSearchFunctionWrapper,
} from '@rcrsr/rill-ext-search-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { TavilyConfig, TavilyExtensionContract } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'tavily';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Tavily extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with search, extract and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createTavilyExtension({
 *   apiKey: process.env.TAVILY_API_KEY,
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createTavilyExtension(config: TavilyConfig): ExtensionFactoryResult {
  // Validate required config fields
  try {
    assertRequired(config.apiKey, 'apiKey');
    if (config.baseUrl !== undefined) {
      validateBaseUrl(config.baseUrl);
    }
  } catch (error) {
    if (error instanceof RuntimeError) {
      throw new RuntimeError('RILL-R004', error.message);
    }
    if (error instanceof Error) {
      throw new RuntimeError('RILL-R004', error.message);
    }
    throw error;
  }

  // Extract config values at factory time
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Create disposal and in-flight state
  const disposalState = createDisposalState();
  const inFlightState = createInFlightState();

  // Create function wrapper
  const wrap = createSearchFunctionWrapper(PROVIDER, disposalState, inFlightState);

  // Build auth headers
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  // ============================================================
  // HOST FUNCTIONS
  // ============================================================

  const search = wrap('search', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build request body
    const body: Record<string, unknown> = { query };

    if (options['search_depth'] !== undefined) body['search_depth'] = options['search_depth'];
    if (options['max_results'] !== undefined) body['max_results'] = options['max_results'];
    if (options['topic'] !== undefined) body['topic'] = options['topic'];
    if (options['time_range'] !== undefined) body['time_range'] = options['time_range'];
    if (options['include_answer'] !== undefined) body['include_answer'] = options['include_answer'];
    if (options['include_raw_content'] !== undefined) body['include_raw_content'] = options['include_raw_content'];
    if (options['include_images'] !== undefined) body['include_images'] = options['include_images'];
    if (options['include_domains'] !== undefined) body['include_domains'] = options['include_domains'];
    if (options['exclude_domains'] !== undefined) body['exclude_domains'] = options['exclude_domains'];
    if (options['country'] !== undefined) body['country'] = options['country'];

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(PROVIDER, response.status, responseBody);
    }

    const data = await response.json() as {
      query: string;
      results: unknown[];
      answer?: string;
      images?: unknown[];
      response_time: number;
    };

    const result: Record<string, RillValue> = {
      query: data.query,
      results: data.results as RillValue,
      response_time: data.response_time,
    };

    if (data.answer !== undefined) result['answer'] = data.answer;
    if (data.images !== undefined) result['images'] = data.images as RillValue;

    return {
      result: result as RillValue,
      query,
      resultCount: data.results.length,
    };
  });

  const extract = wrap('extract', async (args, _ctx, controller) => {
    const urls = args['urls'] as unknown[];
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // Build request body
    const body: Record<string, unknown> = { urls };

    if (options['extract_depth'] !== undefined) body['extract_depth'] = options['extract_depth'];
    if (options['format'] !== undefined) body['format'] = options['format'];
    if (options['chunks_per_source'] !== undefined) body['chunks_per_source'] = options['chunks_per_source'];
    if (options['query'] !== undefined) body['query'] = options['query'];

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/extract`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(PROVIDER, response.status, responseBody);
    }

    const data = await response.json() as {
      results: unknown[];
      failed_results: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: data.results as RillValue,
      failed_results: data.failed_results as RillValue,
    };

    return {
      result: result as RillValue,
      query: String(Array.isArray(urls) ? urls[0] : urls),
      resultCount: data.results.length,
    };
  });

  // ============================================================
  // DISPOSE
  // ============================================================

  const disposeExtension = async (): Promise<void> => {
    abortAll(inFlightState);
    await dispose(disposalState);
  };

  // Return type shared across all host functions
  const dictReturnType = structureToTypeValue({ kind: 'dict' });

  // Build callable dict
  const callableDict = {
    search: toCallable({
      fn: search as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
    extract: toCallable({
      fn: extract as CallableFn,
      params: [
        { name: 'urls', type: { kind: 'tuple' as const }, defaultValue: undefined, annotations: {} },
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
  } satisfies TavilyExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
