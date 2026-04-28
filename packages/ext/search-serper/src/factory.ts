/**
 * Extension factory for Serper search API integration.
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
import type { SerperConfig, SerperExtensionContract } from './types.js';

const DEFAULT_BASE_URL = 'https://google.serper.dev';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'serper';

export function createSerperExtension(
  config: SerperConfig,
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
    'Content-Type': 'application/json',
    'X-API-KEY': apiKey,
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

    const body: Record<string, unknown> = { q: query };
    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['page'] !== undefined) body['page'] = options['page'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];
    if (options['tbs'] !== undefined) body['tbs'] = options['tbs'];
    if (options['autocorrect'] !== undefined) body['autocorrect'] = options['autocorrect'];
    if (options['safe'] !== undefined) body['safe'] = options['safe'];
    if (options['location'] !== undefined) body['location'] = options['location'];

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

  const news = wrap('news', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    requireQuery(callCtx, query);

    const body: Record<string, unknown> = { q: query };
    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['tbs'] !== undefined) body['tbs'] = options['tbs'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/news`, {
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
      news: unknown[];
    };

    return {
      result: { news: data.news as RillValue } as RillValue,
      query,
      resultCount: data.news.length,
    };
  });

  const images = wrap('images', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    requireQuery(callCtx, query);

    const body: Record<string, unknown> = { q: query };
    if (options['num'] !== undefined) body['num'] = options['num'];
    if (options['gl'] !== undefined) body['gl'] = options['gl'];
    if (options['hl'] !== undefined) body['hl'] = options['hl'];

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/images`, {
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

    return {
      result: { images: data.images as RillValue } as RillValue,
      query,
      resultCount: data.images.length,
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
