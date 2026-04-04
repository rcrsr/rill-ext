/**
 * Extension factory for Exa search API integration.
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
import type { ExaConfig, ExaExtensionContract } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://api.exa.ai';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'exa';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Exa extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with search, contents, find_similar, answer and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createExaExtension({
 *   apiKey: process.env.EXA_API_KEY,
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createExaExtension(config: ExaConfig): ExtensionFactoryResult {
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
    'x-api-key': apiKey,
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

    if (options['type'] !== undefined) body['type'] = options['type'];
    if (options['num_results'] !== undefined) body['numResults'] = options['num_results'];
    if (options['include_text'] !== undefined) body['contents'] = { text: options['include_text'] };
    if (options['include_highlights'] !== undefined) {
      body['contents'] = { ...(body['contents'] as Record<string, unknown> ?? {}), highlights: options['include_highlights'] };
    }
    if (options['include_summary'] !== undefined) {
      body['contents'] = { ...(body['contents'] as Record<string, unknown> ?? {}), summary: options['include_summary'] };
    }
    if (options['category'] !== undefined) body['category'] = options['category'];
    if (options['include_domains'] !== undefined) body['includeDomains'] = options['include_domains'];
    if (options['exclude_domains'] !== undefined) body['excludeDomains'] = options['exclude_domains'];
    if (options['start_published_date'] !== undefined) body['startPublishedDate'] = options['start_published_date'];
    if (options['end_published_date'] !== undefined) body['endPublishedDate'] = options['end_published_date'];
    if (options['max_age_hours'] !== undefined) body['maxAgeHours'] = options['max_age_hours'];

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
      requestId?: string;
      results: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: data.results as RillValue,
    };
    if (data.requestId !== undefined) result['request_id'] = data.requestId;

    return {
      result: result as RillValue,
      query,
      resultCount: data.results.length,
    };
  });

  const contents = wrap('contents', async (args, _ctx, controller) => {
    const urls = args['urls'] as unknown[];
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // Build request body - include_text defaults to true for contents
    const body: Record<string, unknown> = { urls };
    const textOption = options['include_text'] !== undefined ? options['include_text'] : true;
    body['contents'] = { text: textOption };

    if (options['include_highlights'] !== undefined) {
      body['contents'] = { ...(body['contents'] as Record<string, unknown>), highlights: options['include_highlights'] };
    }
    if (options['include_summary'] !== undefined) {
      body['contents'] = { ...(body['contents'] as Record<string, unknown>), summary: options['include_summary'] };
    }

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/contents`, {
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
      statuses?: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: data.results as RillValue,
    };
    if (data.statuses !== undefined) result['statuses'] = data.statuses as RillValue;

    return {
      result: result as RillValue,
      query: String(Array.isArray(urls) ? urls[0] : urls),
      resultCount: data.results.length,
    };
  });

  const find_similar = wrap('find_similar', async (args, _ctx, controller) => {
    const url = args['url'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // Build request body
    const body: Record<string, unknown> = { url };

    if (options['num_results'] !== undefined) body['numResults'] = options['num_results'];
    if (options['exclude_source_domain'] !== undefined) body['excludeSourceDomain'] = options['exclude_source_domain'];
    if (options['include_domains'] !== undefined) body['includeDomains'] = options['include_domains'];
    if (options['exclude_domains'] !== undefined) body['excludeDomains'] = options['exclude_domains'];
    if (options['include_text'] !== undefined) body['contents'] = { text: options['include_text'] };
    if (options['include_highlights'] !== undefined) {
      body['contents'] = { ...(body['contents'] as Record<string, unknown> ?? {}), highlights: options['include_highlights'] };
    }

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/findSimilar`, {
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
      requestId?: string;
      results: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: data.results as RillValue,
    };
    if (data.requestId !== undefined) result['request_id'] = data.requestId;

    return {
      result: result as RillValue,
      query: url,
      resultCount: data.results.length,
    };
  });

  const answer = wrap('answer', async (args, _ctx, controller) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    // EC-17: Empty query raises RILL-R004
    if (!query) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: query is required`);
    }

    // Build request body
    const body: Record<string, unknown> = { query };

    if (options['include_text'] !== undefined) {
      body['contents'] = { text: options['include_text'] };
    }
    if (options['num_results'] !== undefined) body['numResults'] = options['num_results'];

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/answer`, {
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
      answer: string;
      citations: unknown[];
    };

    const result: Record<string, RillValue> = {
      answer: data.answer,
      citations: data.citations as RillValue,
    };

    return {
      result: result as RillValue,
      query,
      resultCount: data.citations.length,
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
    contents: toCallable({
      fn: contents as CallableFn,
      params: [
        { name: 'urls', type: { kind: 'tuple' as const }, defaultValue: undefined, annotations: {} },
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
    find_similar: toCallable({
      fn: find_similar as CallableFn,
      params: [p.str('url'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
    answer: toCallable({
      fn: answer as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
  } satisfies ExaExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
