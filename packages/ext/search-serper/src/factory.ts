/**
 * Extension factory for Serper search API integration.
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
import type { SerperConfig, SerperExtensionContract } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://google.serper.dev';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'serper';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Serper extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with search, news, images and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createSerperExtension({
 *   apiKey: process.env.SERPER_API_KEY,
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createSerperExtension(config: SerperConfig): ExtensionFactoryResult {
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
    'X-API-KEY': apiKey,
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
    const body: Record<string, unknown> = { q: query };

    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['page'] !== undefined) body['page'] = options['page'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];
    if (options['tbs'] !== undefined) body['tbs'] = options['tbs'];
    if (options['autocorrect'] !== undefined) body['autocorrect'] = options['autocorrect'];
    if (options['safe'] !== undefined) body['safe'] = options['safe'];
    if (options['location'] !== undefined) body['location'] = options['location'];

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
      searchParameters: unknown;
      organic: unknown[];
      answerBox?: unknown;
      knowledgeGraph?: unknown;
      peopleAlsoAsk?: unknown[];
      relatedSearches?: unknown[];
    };

    const result: Record<string, RillValue> = {
      search_parameters: data.searchParameters as RillValue,
      organic: data.organic as RillValue,
    };

    if (data.answerBox !== undefined) result['answer_box'] = data.answerBox as RillValue;
    if (data.knowledgeGraph !== undefined) result['knowledge_graph'] = data.knowledgeGraph as RillValue;
    if (data.peopleAlsoAsk !== undefined) result['people_also_ask'] = data.peopleAlsoAsk as RillValue;
    if (data.relatedSearches !== undefined) result['related_searches'] = data.relatedSearches as RillValue;

    return {
      result: result as RillValue,
      query,
      resultCount: data.organic.length,
    };
  });

  const news = wrap('news', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build request body
    const body: Record<string, unknown> = { q: query };

    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['tbs'] !== undefined) body['tbs'] = options['tbs'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/news`, {
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
      news: unknown[];
    };

    const result: Record<string, RillValue> = {
      news: data.news as RillValue,
    };

    return {
      result: result as RillValue,
      query,
      resultCount: data.news.length,
    };
  });

  const images = wrap('images', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build request body
    const body: Record<string, unknown> = { q: query };

    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/images`, {
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
      images: Array<{
        title: string;
        imageUrl: string;
        imageWidth: number;
        imageHeight: number;
        thumbnailUrl: string;
        source: string;
        link: string;
      }>;
    };

    const result: Record<string, RillValue> = {
      images: data.images as RillValue,
    };

    return {
      result: result as RillValue,
      query,
      resultCount: data.images.length,
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
    images: toCallable({
      fn: images as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
  } satisfies SerperExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
