/**
 * Extension factory for Brave Search API integration.
 * Creates extension instance with config validation and HTTP lifecycle management.
 *
 * All requests use GET with query parameters. Auth uses X-Subscription-Token header
 * with Cache-Control: no-cache on every request.
 *
 * The summarize host function performs a 2-step flow:
 *   1. GET /res/v1/web/search?q={query}&summary=1 to obtain summarizer.key
 *   2. GET /res/v1/summarizer/search?key={encoded_key} to obtain the summary
 *
 * Note: The Brave Summarizer API is deprecated in favor of the Answers API.
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
import type { BraveConfig, BraveExtensionContract } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://api.search.brave.com';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'brave';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Brave extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with search, news, summarize and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createBraveExtension({
 *   apiKey: process.env.BRAVE_API_KEY,
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createBraveExtension(config: BraveConfig): ExtensionFactoryResult {
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

  // Build auth headers — Brave requires X-Subscription-Token and Cache-Control on all requests
  const authHeaders = {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
    'Cache-Control': 'no-cache',
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

    // Build URL with query parameters (GET request)
    const params = new URLSearchParams({ q: query });

    if (options['count'] !== undefined) params.set('count', String(options['count']));
    if (options['offset'] !== undefined) params.set('offset', String(options['offset']));
    if (options['country'] !== undefined) params.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) params.set('search_lang', String(options['search_lang']));
    if (options['freshness'] !== undefined) params.set('freshness', String(options['freshness']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));
    if (options['extra_snippets'] !== undefined) params.set('extra_snippets', String(options['extra_snippets']));
    if (options['goggles'] !== undefined) params.set('goggles', String(options['goggles']));

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/res/v1/web/search?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders,
      signal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(PROVIDER, response.status, responseBody);
    }

    const data = await response.json() as {
      query?: unknown;
      web?: unknown;
    };

    const result: Record<string, RillValue> = {};
    if (data.query !== undefined) result['query'] = data.query as RillValue;
    if (data.web !== undefined) result['web'] = data.web as RillValue;

    const webData = data.web as { results?: unknown[] } | undefined;
    const resultCount = webData?.results?.length ?? 0;

    return {
      result: result as RillValue,
      query,
      resultCount,
    };
  });

  const news = wrap('news', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build URL with query parameters (GET request)
    const params = new URLSearchParams({ q: query });

    if (options['count'] !== undefined) params.set('count', String(options['count']));
    if (options['offset'] !== undefined) params.set('offset', String(options['offset']));
    if (options['country'] !== undefined) params.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) params.set('search_lang', String(options['search_lang']));
    if (options['freshness'] !== undefined) params.set('freshness', String(options['freshness']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));
    if (options['extra_snippets'] !== undefined) params.set('extra_snippets', String(options['extra_snippets']));
    if (options['goggles'] !== undefined) params.set('goggles', String(options['goggles']));

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/res/v1/news/search?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders,
      signal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(PROVIDER, response.status, responseBody);
    }

    const data = await response.json() as {
      results?: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: (data.results ?? []) as RillValue,
    };

    return {
      result: result as RillValue,
      query,
      resultCount: data.results?.length ?? 0,
    };
  });

  const summarize = wrap('summarize', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build URL with query parameters for the first step
    const searchParams = new URLSearchParams({ q: query, summary: '1' });

    if (options['count'] !== undefined) searchParams.set('count', String(options['count']));
    if (options['country'] !== undefined) searchParams.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) searchParams.set('search_lang', String(options['search_lang']));
    if (options['safesearch'] !== undefined) searchParams.set('safesearch', String(options['safesearch']));

    // Step 1: GET /res/v1/web/search?q={query}&summary=1 to obtain summarizer.key
    const signal1 = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const searchResponse = await fetch(
      `${baseUrl}/res/v1/web/search?${searchParams.toString()}`,
      {
        method: 'GET',
        headers: authHeaders,
        signal: signal1,
      }
    );

    if (!searchResponse.ok) {
      const responseBody = await searchResponse.json().catch(() => null);
      throw mapProviderSearchError(PROVIDER, searchResponse.status, responseBody);
    }

    const searchData = await searchResponse.json() as {
      summarizer?: { key?: string };
    };

    // EC-19: No summarizer key in response
    const summarizerKey = searchData.summarizer?.key;
    if (!summarizerKey) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: summarizer key not found`);
    }

    // Step 2: GET /res/v1/summarizer/search?key={url_encoded_key} to obtain summary
    const summarizerParams = new URLSearchParams({ key: summarizerKey });

    const signal2 = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const summarizerResponse = await fetch(
      `${baseUrl}/res/v1/summarizer/search?${summarizerParams.toString()}`,
      {
        method: 'GET',
        headers: authHeaders,
        signal: signal2,
      }
    );

    // EC-18: Second request fails
    if (!summarizerResponse.ok) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: summarizer request failed`);
    }

    const summaryData = await summarizerResponse.json() as {
      summary?: unknown;
      title?: unknown;
      followups?: unknown;
      context?: unknown;
    };

    const result: Record<string, RillValue> = {
      summary: (summaryData.summary ?? null) as RillValue,
      title: (summaryData.title ?? null) as RillValue,
      followups: (summaryData.followups ?? []) as RillValue,
      context: (summaryData.context ?? []) as RillValue,
    };

    return {
      result: result as RillValue,
      query,
      resultCount: 1,
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
    news: toCallable({
      fn: news as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
    summarize: toCallable({
      fn: summarize as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
  } satisfies BraveExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
