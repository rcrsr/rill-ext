/**
 * Extension factory for SearXNG self-hosted search integration.
 * Async factory: probes /config endpoint at creation time to validate JSON availability.
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
  createSearchFunctionWrapper,
} from '@rcrsr/rill-ext-search-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { SearxngConfig, SearxngExtensionContract } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_TIMEOUT = 30000;
const PROVIDER = 'searxng';

/**
 * Allowed values for time_range parameter (AC-39: "week" is not valid).
 */
const VALID_TIME_RANGES = new Set(['day', 'month', 'year']);

// ============================================================
// FACTORY
// ============================================================

/**
 * Create SearXNG extension instance.
 * Probes the /config endpoint to verify JSON format availability.
 *
 * @param config - Extension configuration
 * @returns Promise resolving to ExtensionFactoryResult with search, config and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration or unreachable instance
 *
 * @example
 * ```typescript
 * const ext = await createSearxngExtension({
 *   baseUrl: 'https://searxng.example.com',
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export async function createSearxngExtension(
  config: SearxngConfig
): Promise<ExtensionFactoryResult> {
  // Validate required config fields
  try {
    assertRequired(config.baseUrl, 'baseUrl');
    validateBaseUrl(config.baseUrl);
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
  const baseUrl = config.baseUrl;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Probe /config endpoint to verify JSON format availability (IR-7, EC-15, EC-16)
  await probeConfig(baseUrl, timeout);

  // Create disposal and in-flight state
  const disposalState = createDisposalState();
  const inFlightState = createInFlightState();

  // Create function wrapper
  const wrap = createSearchFunctionWrapper(PROVIDER, disposalState, inFlightState);

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

    // Build query parameters
    const params = new URLSearchParams({ format: 'json', q: query });

    if (options['categories'] !== undefined) params.set('categories', String(options['categories']));
    if (options['engines'] !== undefined) params.set('engines', String(options['engines']));
    if (options['language'] !== undefined) params.set('language', String(options['language']));
    if (options['pageno'] !== undefined) params.set('pageno', String(options['pageno']));
    if (options['safesearch'] !== undefined) params.set('safesearch', String(options['safesearch']));

    // AC-39: time_range only accepts day, month, year (not week)
    if (options['time_range'] !== undefined) {
      const timeRange = String(options['time_range']);
      if (!VALID_TIME_RANGES.has(timeRange)) {
        throw new RuntimeError(
          'RILL-R004',
          `${PROVIDER}: time_range must be one of: day, month, year`
        );
      }
      params.set('time_range', timeRange);
    }

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
      method: 'GET',
      signal,
    }).catch((err: unknown) => {
      if (err instanceof TypeError) {
        throw new RuntimeError('RILL-R004', `${PROVIDER}: connection failed`);
      }
      throw err;
    });

    if (!response.ok) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: server error (${response.status})`);
    }

    const data = await response.json().catch(() => {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: unexpected response format`);
    }) as {
      query: string;
      number_of_results: number;
      results: unknown[];
      suggestions?: unknown[];
      answers?: unknown[];
      infoboxes?: unknown[];
      corrections?: unknown[];
    };

    const result: Record<string, RillValue> = {
      query: data.query,
      number_of_results: data.number_of_results,
      results: data.results as RillValue,
    };

    // AC-40: number_of_results: 0 is valid
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

  const configFn = wrap('config', async (_args, _ctx, controller) => {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(`${baseUrl}/config`, {
      method: 'GET',
      signal,
    }).catch((err: unknown) => {
      if (err instanceof TypeError) {
        throw new RuntimeError('RILL-R004', `${PROVIDER}: connection failed`);
      }
      throw err;
    });

    if (!response.ok) {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: connection failed`);
    }

    const data = await response.json().catch(() => {
      throw new RuntimeError('RILL-R004', `${PROVIDER}: unexpected response format`);
    }) as {
      categories: unknown;
      engines: unknown;
      plugins: unknown;
      locales: unknown;
    };

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
    config: toCallable({
      fn: configFn as CallableFn,
      params: [],
      returnType: dictReturnType,
    }),
  } satisfies SearxngExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Probe the SearXNG /config endpoint to verify JSON format is available.
 * Throws RILL-R004 if instance is unreachable or JSON is not enabled.
 *
 * @param baseUrl - SearXNG instance base URL
 * @param timeout - Request timeout in milliseconds
 * @throws RuntimeError (RILL-R004) for EC-15 and EC-16
 */
async function probeConfig(baseUrl: string, timeout: number): Promise<void> {
  let response: Response;

  try {
    const signal = AbortSignal.timeout(timeout);
    response = await fetch(`${baseUrl}/config`, {
      method: 'GET',
      signal,
    });
  } catch (_err: unknown) {
    // EC-16: Instance unreachable
    throw new RuntimeError(
      'RILL-R004',
      `searxng: instance unreachable at ${baseUrl}`
    );
  }

  if (!response.ok) {
    throw new RuntimeError(
      'RILL-R004',
      `searxng: instance unreachable at ${baseUrl}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (_err: unknown) {
    // EC-15: Non-JSON or no formats field
    throw new RuntimeError(
      'RILL-R004',
      `searxng: JSON format is not enabled on ${baseUrl}`
    );
  }

  // EC-15: Verify JSON is listed in formats
  const formats = (data as { formats?: unknown })?.formats;
  if (!Array.isArray(formats) || !formats.includes('json')) {
    throw new RuntimeError(
      'RILL-R004',
      `searxng: JSON format is not enabled on ${baseUrl}`
    );
  }
}
