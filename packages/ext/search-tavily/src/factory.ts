/**
 * Extension factory for Tavily search API integration.
 * Creates extension instance with config validation and HTTP lifecycle management.
 */

import {
  RuntimeError,
  toCallable,
  structureToTypeValue,
  type CallableFn,
  type ExtensionFactoryCtx,
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

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'tavily';

export function createTavilyExtension(
  config: TavilyConfig,
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {

  // Validate required config fields. Factory-time validation throws using the
  // built-in `RILL-R001` validation atom; the 'INVALID_INPUT' atom is
  // reserved for runtime invalid values surfaced through `ctx.invalidate`.
  try {
    assertRequired(config.apiKey, 'apiKey');
    if (config.baseUrl !== undefined) {
      validateBaseUrl(config.baseUrl);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new RuntimeError('RILL-R001', error.message);
    }
    throw error;
  }

  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const disposalState = createDisposalState();
  const inFlightState = createInFlightState();

  const wrap = createSearchFunctionWrapper(PROVIDER, disposalState, inFlightState);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const search = wrap('search', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    if (!query) {
      throw callCtx.invalidate(new Error(`${PROVIDER}: query is required`), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'empty_query', message: `${PROVIDER}: query is required` },
      });
    }

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

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(callCtx, PROVIDER, response.status, responseBody);
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

  const extract = wrap('extract', async (args, callCtx, signal) => {
    const urls = args['urls'] as unknown[];
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = { urls };
    if (options['extract_depth'] !== undefined) body['extract_depth'] = options['extract_depth'];
    if (options['format'] !== undefined) body['format'] = options['format'];
    if (options['chunks_per_source'] !== undefined) body['chunks_per_source'] = options['chunks_per_source'];
    if (options['query'] !== undefined) body['query'] = options['query'];

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/extract`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(callCtx, PROVIDER, response.status, responseBody);
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

  const disposeExtension = async (): Promise<void> => {
    abortAll(inFlightState);
    await dispose(disposalState);
  };

  const dictReturnType = structureToTypeValue({ kind: 'dict' });

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
