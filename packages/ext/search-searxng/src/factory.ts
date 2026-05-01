/**
 * Extension factory for SearXNG self-hosted search integration.
 * Async factory: probes /config endpoint at creation time to validate JSON availability.
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
  createSearchFunctionWrapper,
} from '@rcrsr/rill-ext-search-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { SearxngConfig, SearxngExtensionContract } from './types.js';

const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'searxng';

const VALID_TIME_RANGES = new Set(['day', 'month', 'year']);

export async function createSearxngExtension(
  config: SearxngConfig,
  ctx: ExtensionFactoryCtx
): Promise<ExtensionFactoryResult> {

  try {
    assertRequired(config.baseUrl, 'baseUrl');
    validateBaseUrl(config.baseUrl);
  } catch (error) {
    if (error instanceof Error) {
      throw new RuntimeError('RILL-R001', error.message);
    }
    throw error;
  }

  const baseUrl = config.baseUrl;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  await probeConfig(baseUrl, timeout, ctx.signal);

  const disposalState = createDisposalState();
  const inFlightState = createInFlightState();

  const wrap = createSearchFunctionWrapper(PROVIDER, disposalState, inFlightState);

  const failConfig = (callCtx: RuntimeContext, message: string, raw: Record<string, unknown>): RillValue =>
    callCtx.invalidate(new Error(`${PROVIDER}: ${message}`), {
      code: 'INVALID_INPUT',
      provider: PROVIDER,
      raw: { ...raw, message: `${PROVIDER}: ${message}` },
    });

  const failHttp = (callCtx: RuntimeContext, message: string, raw: Record<string, unknown>): RillValue =>
    callCtx.invalidate(new Error(`${PROVIDER}: ${message}`), {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { ...raw, message: `${PROVIDER}: ${message}` },
    });

  const search = wrap('search', async (args, callCtx, signal) => {
    const query = args['query'] as string;
    const options = (args['options'] ?? {}) as Record<string, unknown>;

    if (!query) {
      throw failConfig(callCtx, 'query is required', { kind: 'empty_query' });
    }

    const params = new URLSearchParams({ format: 'json', q: query });
    if (options['categories'] !== undefined) params.set('categories', String(options['categories']));
    if (options['engines'] !== undefined) params.set('engines', String(options['engines']));
    if (options['language'] !== undefined) params.set('language', String(options['language']));
    if (options['pageno'] !== undefined) params.set('pageno', String(options['pageno']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));

    if (options['time_range'] !== undefined) {
      const timeRange = String(options['time_range']);
      if (!VALID_TIME_RANGES.has(timeRange)) {
        throw failConfig(callCtx, 'time_range must be one of: day, month, year', {
          kind: 'invalid_time_range',
          received: timeRange,
        });
      }
      params.set('time_range', timeRange);
    }

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/search?${params.toString()}`, {
        method: 'GET',
        signal: requestSignal,
      });
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        throw failHttp(callCtx, 'connection failed', { kind: 'connection_failed' });
      }
      throw err;
    }

    if (!response.ok) {
      throw failHttp(callCtx, `server error (${response.status})`, {
        kind: 'server_error',
        status: response.status,
      });
    }

    let data: {
      query: string;
      number_of_results: number;
      results: unknown[];
      suggestions?: unknown[];
      answers?: unknown[];
      infoboxes?: unknown[];
      corrections?: unknown[];
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw failHttp(callCtx, 'unexpected response format', { kind: 'unexpected_response_format' });
    }

    const result: Record<string, RillValue> = {
      query: data.query,
      number_of_results: data.number_of_results,
      results: data.results as RillValue,
    };
    if (data.suggestions !== undefined) result['suggestions'] = data.suggestions as RillValue;
    if (data.answers !== undefined) result['answers'] = data.answers as RillValue;
    if (data.infoboxes !== undefined) result['infoboxes'] = data.infoboxes as RillValue;
    if (data.corrections !== undefined) result['corrections'] = data.corrections as RillValue;

    return {
      result: result as RillValue,
      query,
      resultCount: data.results.length,
    };
  });

  const configFn = wrap('config', async (_args, callCtx, signal) => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/config`, {
        method: 'GET',
        signal: requestSignal,
      });
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        throw failHttp(callCtx, 'connection failed', { kind: 'connection_failed' });
      }
      throw err;
    }

    if (!response.ok) {
      throw failHttp(callCtx, 'connection failed', { kind: 'connection_failed', status: response.status });
    }

    let data: { categories: unknown; engines: unknown; plugins: unknown; locales: unknown };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw failHttp(callCtx, 'unexpected response format', { kind: 'unexpected_response_format' });
    }

    const result: Record<string, RillValue> = {
      categories: data.categories as RillValue,
      engines: data.engines as RillValue,
      plugins: data.plugins as RillValue,
      locales: data.locales as RillValue,
    };

    return {
      result: result as RillValue,
      query: 'config',
      resultCount: 0,
    };
  });

  const disposeExtension = async (): Promise<void> => {
    abortAll(inFlightState);
    await dispose(disposalState);
  };

  // Rich return-type shapes per §EXT.8. Inner result/suggestion/answer/etc.
  // entries are vendor-shaped pass-throughs; their elements are typed as
  // `any`. Top-level field sets are concrete since we own those keys.
  // Optional fields are marked via non-undefined `defaultValue` so introspection
  // tooling treats `field.defaultValue !== undefined` as "optional".
  const SEARCH_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      query:             { type: { kind: 'string' } },
      number_of_results: { type: { kind: 'number' } },
      results:           { type: { kind: 'list', element: { kind: 'any' } } },
      suggestions:       { type: { kind: 'list', element: { kind: 'any' } }, defaultValue: [] },  // optional
      answers:           { type: { kind: 'list', element: { kind: 'any' } }, defaultValue: [] },  // optional
      infoboxes:         { type: { kind: 'list', element: { kind: 'any' } }, defaultValue: [] },  // optional
      corrections:       { type: { kind: 'list', element: { kind: 'any' } }, defaultValue: [] },  // optional
    },
  });
  const CONFIG_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      categories: { type: { kind: 'any' } },
      engines:    { type: { kind: 'any' } },
      plugins:    { type: { kind: 'any' } },
      locales:    { type: { kind: 'any' } },
    },
  });

  const callableDict = {
    search: toCallable({
      fn: search as CallableFn,
      params: [p.str('query'), p.dict('options', undefined, {})],
      returnType: SEARCH_RT,
    }),
    config: toCallable({
      fn: configFn as CallableFn,
      params: [],
      returnType: CONFIG_RT,
    }),
  } satisfies SearxngExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}

/**
 * Probe the SearXNG /config endpoint to verify JSON format is available.
 * Throws RuntimeError(RILL-R001) if instance is unreachable or JSON is not enabled.
 *
 * @param baseUrl - SearXNG instance base URL
 * @param timeout - Request timeout in milliseconds
 * @param extSignal - Extension lifetime signal from `ExtensionFactoryCtx`
 */
async function probeConfig(
  baseUrl: string,
  timeout: number,
  extSignal: AbortSignal
): Promise<void> {
  let response: Response;

  try {
    const signal = AbortSignal.any([extSignal, AbortSignal.timeout(timeout)]);
    response = await fetch(`${baseUrl}/config`, {
      method: 'GET',
      signal,
    });
  } catch {
    throw new RuntimeError(
      'RILL-R001',
      `searxng: instance unreachable at ${baseUrl}`
    );
  }

  if (!response.ok) {
    throw new RuntimeError(
      'RILL-R001',
      `searxng: instance unreachable at ${baseUrl}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RuntimeError(
      'RILL-R001',
      `searxng: JSON format is not enabled on ${baseUrl}`
    );
  }

  const formats = (data as { formats?: unknown })?.formats;
  if (!Array.isArray(formats) || !formats.includes('json')) {
    throw new RuntimeError(
      'RILL-R001',
      `searxng: JSON format is not enabled on ${baseUrl}`
    );
  }
}
