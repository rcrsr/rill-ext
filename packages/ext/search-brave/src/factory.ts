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
 */

import {
  RuntimeError,
  toCallable,
  structureToTypeValue,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillValue,
  type RuntimeContext,
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

const DEFAULT_BASE_URL = 'https://api.search.brave.com';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'brave';

export function createBraveExtension(
  config: BraveConfig,
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {

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
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
    'Cache-Control': 'no-cache',
  };

  const requireQuery = (callCtx: RuntimeContext, query: string): void => {
    if (!query) {
      throw callCtx.invalidate(new Error(`${PROVIDER}: query is required`), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'empty_query', message: `${PROVIDER}: query is required` },
      });
    }
  };

  const search = wrap('search', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    requireQuery(callCtx, query);

    const params = new URLSearchParams({ q: query });
    if (options['count'] !== undefined) params.set('count', String(options['count']));
    if (options['offset'] !== undefined) params.set('offset', String(options['offset']));
    if (options['country'] !== undefined) params.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) params.set('search_lang', String(options['search_lang']));
    if (options['freshness'] !== undefined) params.set('freshness', String(options['freshness']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));
    if (options['extra_snippets'] !== undefined) params.set('extra_snippets', String(options['extra_snippets']));
    if (options['goggles'] !== undefined) params.set('goggles', String(options['goggles']));

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/res/v1/web/search?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders,
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(callCtx, PROVIDER, response.status, responseBody);
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

  const news = wrap('news', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    requireQuery(callCtx, query);

    const params = new URLSearchParams({ q: query });
    if (options['count'] !== undefined) params.set('count', String(options['count']));
    if (options['offset'] !== undefined) params.set('offset', String(options['offset']));
    if (options['country'] !== undefined) params.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) params.set('search_lang', String(options['search_lang']));
    if (options['freshness'] !== undefined) params.set('freshness', String(options['freshness']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));
    if (options['extra_snippets'] !== undefined) params.set('extra_snippets', String(options['extra_snippets']));
    if (options['goggles'] !== undefined) params.set('goggles', String(options['goggles']));

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/res/v1/news/search?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders,
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(callCtx, PROVIDER, response.status, responseBody);
    }

    const data = await response.json() as {
      results?: unknown[];
    };

    return {
      result: { results: (data.results ?? []) as RillValue } as RillValue,
      query,
      resultCount: data.results?.length ?? 0,
    };
  });

  const summarize = wrap('summarize', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    requireQuery(callCtx, query);

    const searchParams = new URLSearchParams({ q: query, summary: '1' });
    if (options['count'] !== undefined) searchParams.set('count', String(options['count']));
    if (options['country'] !== undefined) searchParams.set('country', String(options['country']));
    if (options['search_lang'] !== undefined) searchParams.set('search_lang', String(options['search_lang']));
    if (options['safesearch'] !== undefined) searchParams.set('safesearch', String(options['safesearch']));

    const signal1 = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
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
      throw mapProviderSearchError(callCtx, PROVIDER, searchResponse.status, responseBody);
    }

    const searchData = await searchResponse.json() as {
      summarizer?: { key?: string };
    };

    const summarizerKey = searchData.summarizer?.key;
    if (!summarizerKey) {
      throw callCtx.invalidate(new Error(`${PROVIDER}: summarizer key not found`), {
        code: 'UNAVAILABLE',
        provider: PROVIDER,
        raw: { kind: 'summarizer_key_missing', message: `${PROVIDER}: summarizer key not found` },
      });
    }

    const summarizerParams = new URLSearchParams({ key: summarizerKey });
    const signal2 = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const summarizerResponse = await fetch(
      `${baseUrl}/res/v1/summarizer/search?${summarizerParams.toString()}`,
      {
        method: 'GET',
        headers: authHeaders,
        signal: signal2,
      }
    );

    if (!summarizerResponse.ok) {
      throw callCtx.invalidate(new Error(`${PROVIDER}: summarizer request failed`), {
        code: 'UNAVAILABLE',
        provider: PROVIDER,
        raw: {
          kind: 'summarizer_request_failed',
          status: summarizerResponse.status,
          message: `${PROVIDER}: summarizer request failed`,
        },
      });
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
