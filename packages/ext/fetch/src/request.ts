/**
 * Fetch Request Module
 *
 * Handles URL building, retry logic, response parsing, and error handling.
 *
 * @module
 */

import {
  RuntimeError,
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
/**
 * Map an HTTP status code to a rill-core generic atom name.
 * 401 → AUTH, 403 → FORBIDDEN, 404 → NOT_FOUND, 408 → TIMEOUT,
 * 409/412 → CONFLICT, 429 → RATE_LIMIT, 402 → QUOTA_EXCEEDED,
 * 5xx → UNAVAILABLE, other 4xx → INVALID_INPUT.
 */
function atomForStatus(status: number): string {
  if (status === 401) return 'AUTH';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409 || status === 412) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 402) return 'QUOTA_EXCEEDED';
  if (status >= 500 && status <= 599) return 'UNAVAILABLE';
  if (status >= 400 && status <= 499) return 'INVALID_INPUT';
  return 'UNAVAILABLE';
}

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/** Response shape configuration */
export type ResponseShape = 'body' | 'full';

/** Location of argument in request */
export type ArgLocation = 'path' | 'query' | 'header' | 'body';

/** Argument definition for endpoint */
export interface EndpointArg {
  readonly name: string;
  readonly location: ArgLocation;
  readonly required?: boolean | undefined;
}

/** Internal endpoint configuration for request building */
export interface InternalEndpointConfig {
  readonly path: string;
  readonly method: string;
  readonly args?: EndpointArg[] | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly responseShape?: ResponseShape | undefined;
}

/** Internal fetch configuration */
export interface InternalFetchConfig {
  readonly baseUrl: string;
  readonly endpoints: Record<string, InternalEndpointConfig>;
  readonly headers?:
    | Record<string, string>
    | (() => Record<string, string>)
    | undefined;
  readonly timeout?: number | undefined;
  readonly retryLimit?: number | undefined;
  readonly retryDelay?: number | undefined;
  readonly maxConcurrent?: number | undefined;
}

/** Full response shape */
export interface FullResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Fetch request options (compatible with fetch API) */
export interface FetchOptions {
  readonly method: string;
  readonly headers: Record<string, string>;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
}

const PROVIDER = 'fetch';

// ============================================================
// CONCURRENCY SEMAPHORE
// ============================================================

/**
 * Simple semaphore for limiting concurrent requests.
 * Queues requests when limit is reached.
 */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

// ============================================================
// URL BUILDING
// ============================================================

function interpolatePathParams(
  pattern: string,
  pathArgs: Map<string, string>
): string {
  return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, paramName) => {
    const value = pathArgs.get(paramName as string);
    if (value === undefined) {
      throw new TypeError(`Missing path parameter: ${paramName as string}`);
    }
    return encodeURIComponent(value);
  });
}

function buildQueryString(queryArgs: Map<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of queryArgs) {
    params.append(key, value);
  }
  return params.toString();
}

function buildUrl(
  baseUrl: string,
  pathPattern: string,
  pathArgs: Map<string, string>,
  queryArgs: Map<string, string>
): string {
  const path = interpolatePathParams(pathPattern, pathArgs);
  const base = new URL(baseUrl);
  base.pathname =
    base.pathname.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  const queryString = buildQueryString(queryArgs);
  if (queryString) {
    base.search = queryString;
  }
  return base.toString();
}

// ============================================================
// HEADER HANDLING
// ============================================================

function flattenHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function resolveHeaders(
  headers: Record<string, string> | (() => Record<string, string>) | undefined
): Record<string, string> {
  if (!headers) return {};
  if (typeof headers === 'function') return headers();
  return headers;
}

function mergeHeaders(
  globalHeaders: Record<string, string>,
  endpointHeaders: Record<string, string> | undefined
): Record<string, string> {
  return { ...globalHeaders, ...(endpointHeaders ?? {}) };
}

// ============================================================
// RESPONSE PARSING
// ============================================================

/**
 * Parse response body as JSON.
 * Returns a sentinel symbol on parse failure so caller can route to ctx.invalidate.
 */
const PARSE_FAILED = Symbol('parse_failed');

async function parseJsonResponse(
  response: Response
): Promise<unknown | typeof PARSE_FAILED> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return PARSE_FAILED;
  }
}

async function buildFullResponse(
  response: Response
): Promise<FullResponse | typeof PARSE_FAILED> {
  const body = await parseJsonResponse(response);
  if (body === PARSE_FAILED) return PARSE_FAILED;
  return {
    status: response.status,
    headers: flattenHeaders(response.headers),
    body,
  };
}

// ============================================================
// RETRY LOGIC
// ============================================================

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

function calculateBackoff(baseDelay: number, attempt: number): number {
  return baseDelay * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// REQUEST EXECUTION
// ============================================================

/**
 * Execute HTTP request with retry logic.
 * Handles timeouts, network errors, and retries.
 *
 * On failure, returns an invalid `RillValue` via `ctx.invalidate`.
 */
export async function executeRequest(
  url: string,
  options: FetchOptions,
  config: InternalFetchConfig,
  namespace: string,
  responseShape: ResponseShape,
  ctx: RuntimeContext,
  semaphore?: Semaphore | undefined
): Promise<RillValue> {
  const retryLimit = config.retryLimit ?? 3;
  const retryDelay = config.retryDelay ?? 100;
  const timeoutMs = config.timeout ?? 30000;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retryLimit) {
    try {
      if (semaphore) {
        await semaphore.acquire();
      }

      try {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

        const signals: AbortSignal[] = [timeoutController.signal];
        if (options.signal) signals.push(options.signal);
        if (ctx.signal) signals.push(ctx.signal);
        const combinedSignal = AbortSignal.any(signals);

        try {
          const response = await fetch(url, {
            ...options,
            signal: combinedSignal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);

          clearTimeout(timeoutId);

          if (!response.ok) {
            const status = response.status;

            // 4xx errors (except 429) - no retry
            if (status >= 400 && status < 500 && status !== 429) {
              const body = await response.text();
              return ctx.invalidate(
                new Error(`${namespace}: HTTP ${status} — ${body}`),
                {
                  code: atomForStatus(status),
                  provider: PROVIDER,
                  raw: {
                    kind: 'http_error',
                    status,
                    body,
                    namespace,
                  },
                },
              );
            }

            // 5xx errors or 429 - retry
            if (shouldRetryStatus(status)) {
              if (attempt < retryLimit) {
                let delay = calculateBackoff(retryDelay, attempt);

                if (status === 429) {
                  const retryAfterMs = getRetryAfterMs(response);
                  if (retryAfterMs !== null) {
                    delay = retryAfterMs;
                  }
                }

                await sleep(delay);
                attempt++;
                continue;
              } else {
                return ctx.invalidate(
                  new Error(
                    `${namespace}: HTTP ${status} after ${retryLimit} retries`,
                  ),
                  {
                    code: atomForStatus(status),
                    provider: PROVIDER,
                    raw: {
                      kind: 'http_error_retries_exhausted',
                      status,
                      retries: retryLimit,
                      namespace,
                    },
                  },
                );
              }
            }
          }

          // Success - parse response
          if (responseShape === 'full') {
            const full = await buildFullResponse(response);
            if (full === PARSE_FAILED) {
              return ctx.invalidate(
                new Error(`${namespace}: invalid JSON response`),
                {
                  code: 'PROTOCOL',
                  provider: PROVIDER,
                  raw: { kind: 'invalid_json', namespace },
                },
              );
            }
            return full as unknown as RillValue;
          } else {
            const body = await parseJsonResponse(response);
            if (body === PARSE_FAILED) {
              return ctx.invalidate(
                new Error(`${namespace}: invalid JSON response`),
                {
                  code: 'PROTOCOL',
                  provider: PROVIDER,
                  raw: { kind: 'invalid_json', namespace },
                },
              );
            }
            return body as RillValue;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } finally {
        if (semaphore) {
          semaphore.release();
        }
      }
    } catch (error) {
      // Halt signal — propagate cooperative cancellation
      if (error instanceof RuntimeHaltSignal) throw error;

      // Timeout - no retry
      if (error instanceof Error && error.name === 'AbortError') {
        return ctx.invalidate(error, {
          code: 'TIMEOUT',
          provider: PROVIDER,
          raw: {
            kind: 'request_timeout',
            message: `${namespace}: request timeout (${timeoutMs}ms)`,
            timeoutMs,
            namespace,
          },
        });
      }

      // Already formatted error - rethrow immediately
      if (error instanceof RuntimeError) {
        throw error;
      }

      // Network error - retry logic
      if (error instanceof TypeError) {
        if (attempt < retryLimit) {
          const delay = calculateBackoff(retryDelay, attempt);
          await sleep(delay);
          attempt++;
          lastError = error;
          continue;
        } else {
          return ctx.invalidate(error, {
            code: 'UNAVAILABLE',
            provider: PROVIDER,
            raw: {
              kind: 'network_error',
              message: `${namespace}: network error — ${error.message}`,
              namespace,
            },
          });
        }
      }

      // Unknown error
      lastError = error as Error;
      break;
    }
  }

  return ctx.invalidate(lastError ?? new Error('unknown error'), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: {
      kind: 'network_error',
      message: `${namespace}: network error — ${lastError?.message ?? 'unknown error'}`,
      namespace,
    },
  });
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Create semaphore for concurrency control.
 */
export function createSemaphore(
  maxConcurrent: number | undefined
): Semaphore | undefined {
  if (maxConcurrent && maxConcurrent > 0) {
    return new Semaphore(maxConcurrent);
  }
  return undefined;
}

/**
 * Build request from endpoint config and arguments.
 */
export function buildRequest(
  config: InternalFetchConfig,
  endpointName: string,
  args: Record<string, unknown>
): { url: string; options: FetchOptions; responseShape: ResponseShape } {
  const endpoint = config.endpoints[endpointName];
  if (!endpoint) {
    throw new TypeError(`Unknown endpoint: ${endpointName}`);
  }

  const pathArgs = new Map<string, string>();
  const queryArgs = new Map<string, string>();
  const headerArgs: Record<string, string> = {};
  let bodyValue: unknown = null;

  for (const [argName, argValue] of Object.entries(args)) {
    const argDef = endpoint.args?.find((a) => a.name === argName);
    if (!argDef) continue;

    const stringValue =
      typeof argValue === 'string' ? argValue : String(argValue);

    switch (argDef.location) {
      case 'path':
        pathArgs.set(argName, stringValue);
        break;
      case 'query':
        queryArgs.set(argName, stringValue);
        break;
      case 'header':
        headerArgs[argName] = stringValue;
        break;
      case 'body':
        bodyValue = argValue;
        break;
    }
  }

  const url = buildUrl(config.baseUrl, endpoint.path, pathArgs, queryArgs);

  const globalHeaders = resolveHeaders(config.headers);
  const allHeaders = mergeHeaders(globalHeaders, endpoint.headers);
  const finalHeaders = { ...allHeaders, ...headerArgs };

  if (bodyValue !== null) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const options: FetchOptions = {
    method: endpoint.method,
    headers: finalHeaders,
    ...(bodyValue !== null
      ? { body: JSON.stringify(bodyValue) }
      : {}),
  };

  return {
    url,
    options,
    responseShape: endpoint.responseShape ?? 'body',
  };
}
