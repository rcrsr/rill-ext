/**
 * Extension factory for Exa search API integration.
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
import type { ExaConfig, ExaExtensionContract } from './types.js';

const DEFAULT_BASE_URL = 'https://api.exa.ai';
const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'exa';

export function createExaExtension(
  config: ExaConfig,
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

  const wrap = createSearchFunctionWrapper(
    PROVIDER,
    disposalState,
    inFlightState
  );

  const authHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
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
    if (options['type'] !== undefined) body['type'] = options['type'];
    if (options['num_results'] !== undefined)
      body['numResults'] = options['num_results'];
    if (options['include_text'] !== undefined)
      body['contents'] = { text: options['include_text'] };
    if (options['include_highlights'] !== undefined) {
      body['contents'] = {
        ...(body['contents'] as Record<string, unknown>),
        highlights: options['include_highlights'],
      };
    }
    if (options['include_summary'] !== undefined) {
      body['contents'] = {
        ...(body['contents'] as Record<string, unknown>),
        summary: options['include_summary'],
      };
    }
    if (options['category'] !== undefined)
      body['category'] = options['category'];
    if (options['include_domains'] !== undefined)
      body['includeDomains'] = options['include_domains'];
    if (options['exclude_domains'] !== undefined)
      body['excludeDomains'] = options['exclude_domains'];
    if (options['start_published_date'] !== undefined)
      body['startPublishedDate'] = options['start_published_date'];
    if (options['end_published_date'] !== undefined)
      body['endPublishedDate'] = options['end_published_date'];
    if (options['max_age_hours'] !== undefined)
      body['maxAgeHours'] = options['max_age_hours'];

    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeout),
    ]);
    const response = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(
        callCtx,
        PROVIDER,
        response.status,
        responseBody
      );
    }

    const data = (await response.json()) as {
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

  const contents = wrap('contents', async (args, callCtx, signal) => {
    const urls = args['urls'] as unknown[];
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = { urls };
    const textOption =
      options['include_text'] !== undefined ? options['include_text'] : true;
    body['contents'] = { text: textOption };

    if (options['include_highlights'] !== undefined) {
      body['contents'] = {
        ...(body['contents'] as Record<string, unknown>),
        highlights: options['include_highlights'],
      };
    }
    if (options['include_summary'] !== undefined) {
      body['contents'] = {
        ...(body['contents'] as Record<string, unknown>),
        summary: options['include_summary'],
      };
    }

    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeout),
    ]);
    const response = await fetch(`${baseUrl}/contents`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(
        callCtx,
        PROVIDER,
        response.status,
        responseBody
      );
    }

    const data = (await response.json()) as {
      results: unknown[];
      statuses?: unknown[];
    };

    const result: Record<string, RillValue> = {
      results: data.results as RillValue,
    };
    if (data.statuses !== undefined)
      result['statuses'] = data.statuses as RillValue;

    return {
      result: result as RillValue,
      query: String(Array.isArray(urls) ? urls[0] : urls),
      resultCount: data.results.length,
    };
  });

  const find_similar = wrap('find_similar', async (args, callCtx, signal) => {
    const url = args['url'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = { url };
    if (options['num_results'] !== undefined)
      body['numResults'] = options['num_results'];
    if (options['exclude_source_domain'] !== undefined)
      body['excludeSourceDomain'] = options['exclude_source_domain'];
    if (options['include_domains'] !== undefined)
      body['includeDomains'] = options['include_domains'];
    if (options['exclude_domains'] !== undefined)
      body['excludeDomains'] = options['exclude_domains'];
    if (options['include_text'] !== undefined)
      body['contents'] = { text: options['include_text'] };
    if (options['include_highlights'] !== undefined) {
      body['contents'] = {
        ...(body['contents'] as Record<string, unknown>),
        highlights: options['include_highlights'],
      };
    }

    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeout),
    ]);
    const response = await fetch(`${baseUrl}/findSimilar`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(
        callCtx,
        PROVIDER,
        response.status,
        responseBody
      );
    }

    const data = (await response.json()) as {
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

  const answer = wrap('answer', async (args, callCtx, signal) => {
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
    if (options['include_text'] !== undefined) {
      body['contents'] = { text: options['include_text'] };
    }
    if (options['num_results'] !== undefined)
      body['numResults'] = options['num_results'];

    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeout),
    ]);
    const response = await fetch(`${baseUrl}/answer`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      throw mapProviderSearchError(
        callCtx,
        PROVIDER,
        response.status,
        responseBody
      );
    }

    const data = (await response.json()) as {
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

  const disposeExtension = async (): Promise<void> => {
    abortAll(inFlightState);
    await dispose(disposalState);
  };

  // Rich return-type shapes per §EXT.8. Inner result objects (Exa's `results`,
  // `statuses`, `citations` elements) are vendor-shaped and forwarded without
  // reshaping; their elements are typed as `any`. `search` and `find_similar`
  // share an identical top-level shape. Optional fields are marked via
  // non-undefined `defaultValue` so introspection tooling treats
  // `field.defaultValue !== undefined` as "optional".
  const SEARCH_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      results: { type: { kind: 'list', element: { kind: 'any' } } },
      request_id: { type: { kind: 'string' }, defaultValue: '' }, // optional: present when API returns requestId
    },
  });
  const CONTENTS_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      results: { type: { kind: 'list', element: { kind: 'any' } } },
      statuses: {
        type: { kind: 'list', element: { kind: 'any' } },
        defaultValue: [],
      }, // optional: present when API returns statuses
    },
  });
  const ANSWER_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      answer: { type: { kind: 'string' } },
      citations: { type: { kind: 'list', element: { kind: 'any' } } },
    },
  });

  const callableDict = {
    search: toCallable({
      fn: search as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: SEARCH_RT,
    }),
    contents: toCallable({
      fn: contents as CallableFn,
      params: [
        {
          name: 'urls',
          type: { kind: 'tuple' as const },
          defaultValue: undefined,
          annotations: {},
        },
        p.dict('options', undefined, {}),
      ],
      returnType: CONTENTS_RT,
    }),
    find_similar: toCallable({
      fn: find_similar as CallableFn,
      params: [p.str('url'), p.dict('options', undefined, {})],
      returnType: SEARCH_RT,
    }),
    answer: toCallable({
      fn: answer as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: ANSWER_RT,
    }),
  } satisfies ExaExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
