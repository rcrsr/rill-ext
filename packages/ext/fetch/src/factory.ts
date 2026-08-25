/**
 * Factory function for creating fetch extension.
 *
 * @module
 */

import {
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type {
  FetchExtensionConfig,
  EndpointConfig,
  EndpointParam,
} from './types.js';
import {
  buildRequest,
  executeRequest,
  createSemaphore,
  type InternalFetchConfig,
  type InternalEndpointConfig,
  type EndpointArg,
  type Semaphore,
} from './request.js';

// ============================================================
// PARAMETER MAPPING
// ============================================================

/**
 * Convert EndpointParam to EndpointArg for request module.
 *
 * @param param - Parameter definition with type information
 * @returns Argument definition for request builder
 */
function mapParamToArg(param: EndpointParam): EndpointArg {
  return {
    name: param.name,
    location: param.location,
    required: param.required ?? true,
  };
}

/**
 * Convert EndpointConfig to InternalEndpointConfig for request module.
 *
 * @param config - Public endpoint configuration
 * @param globalResponseShape - Global default response shape from factory config
 * @returns Request-compatible endpoint configuration
 */
function mapEndpointConfig(
  config: EndpointConfig,
  globalResponseShape: 'body' | 'full'
): InternalEndpointConfig {
  return {
    method: config.method,
    path: config.path,
    args: config.params?.map(mapParamToArg),
    headers: config.headers,
    responseShape: config.responseShape ?? globalResponseShape,
  };
}

// ============================================================
// ARGUMENT PROCESSING
// ============================================================

type ProcessedArguments =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; invalid: RillValue };

/**
 * Process named arguments dict, applying defaults and required checks.
 *
 * A missing required parameter is a runtime call error, so it yields an invalid
 * RillValue (`#INVALID_INPUT`) via `ctx.invalidate` — not a factory-time throw.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param args - Named argument map from runtime
 * @param params - Parameter definitions
 * @param functionName - Function name for error messages
 */
function processArguments(
  ctx: RuntimeContext,
  args: Record<string, RillValue>,
  params: readonly EndpointParam[],
  functionName: string
): ProcessedArguments {
  const result: Record<string, unknown> = {};

  for (const param of params) {
    const value = args[param.name];

    if (value === undefined) {
      if (param.defaultValue !== undefined) {
        result[param.name] = param.defaultValue;
      } else if (param.required !== false) {
        return {
          ok: false,
          invalid: ctx.invalidate(
            new Error(`parameter "${param.name}" is required`),
            {
              code: 'INVALID_INPUT',
              provider: 'fetch',
              raw: {
                kind: 'missing_parameter',
                functionName,
                paramName: param.name,
              },
            }
          ),
        };
      }
    } else {
      result[param.name] = value;
    }
  }

  return { ok: true, args: result };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create fetch extension with generated endpoint functions.
 *
 * Each endpoint in config becomes a host function. Scripts call endpoints
 * with named args. All URLs are constructed from config — scripts cannot
 * specify arbitrary URLs.
 *
 * @param config - Fetch configuration with endpoints
 * @returns ExtensionFactoryResult with endpoint functions and introspection
 *
 * @example
 * ```typescript
 * const api = createFetchExtension({
 *   baseUrl: 'https://api.example.com',
 *   endpoints: {
 *     getUser: {
 *       method: 'GET',
 *       path: '/users/:id',
 *       params: [{ name: 'id', type: 'string', location: 'path' }],
 *     },
 *   },
 * });
 * ```
 */
export function createFetchExtension(
  config: FetchExtensionConfig,
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Failures emit rill-core generic atoms (#TIMEOUT, #UNAVAILABLE, #AUTH,
  // #FORBIDDEN, #RATE_LIMIT, #PROTOCOL, etc.) directly via ctx.invalidate.
  // No per-extension atom registration required.

  const timeout = config.timeout ?? 30000;
  const retries = config.retries ?? 0;
  const retryDelay = config.retryDelay ?? 1000;
  const defaultResponseShape = config.responseShape ?? 'body';

  const semaphore: Semaphore | undefined = createSemaphore(
    config.maxConcurrent
  );
  const activeControllers = new Set<AbortController>();

  const internalConfig: InternalFetchConfig = {
    baseUrl: config.baseUrl,
    headers: config.headers,
    timeout,
    retryLimit: retries,
    retryDelay,
    maxConcurrent: config.maxConcurrent,
    endpoints: Object.fromEntries(
      Object.entries(config.endpoints).map(([name, endpointConfig]) => [
        name,
        mapEndpointConfig(endpointConfig, defaultResponseShape),
      ])
    ),
  };

  // ============================================================
  // ENDPOINT FUNCTIONS
  // ============================================================

  const functions: Record<string, RillFunction> = {};

  for (const [endpointName, endpointConfig] of Object.entries(
    config.endpoints
  )) {
    const params = endpointConfig.params ?? [];

    const endpointFn: CallableFn = async (args, runCtxLike) => {
      const runCtx = runCtxLike as RuntimeContext;
      const processed = processArguments(
        runCtx,
        args as Record<string, RillValue>,
        params,
        endpointName
      );
      if (!processed.ok) return processed.invalid;
      const processedArgs = processed.args;

      const { url, options, responseShape } = buildRequest(
        internalConfig,
        endpointName,
        processedArgs
      );

      const controller = new AbortController();
      activeControllers.add(controller);

      try {
        const result = await executeRequest(
          url,
          { ...options, signal: controller.signal },
          internalConfig,
          endpointName,
          responseShape,
          runCtx,
          semaphore
        );

        return result;
      } finally {
        activeControllers.delete(controller);
      }
    };

    const rillParams = params.map((param) => {
      const rillType =
        param.type !== 'dict'
          ? { kind: param.type as 'string' | 'number' | 'bool' }
          : { kind: 'dict' as const };

      return {
        name: param.name,
        type: rillType,
        defaultValue: param.defaultValue as RillValue | undefined,
        annotations: {} as Record<string, RillValue>,
      };
    });

    // Rich return-type shapes per §EXT.8. With `responseShape: 'full'`, the
    // host fn returns `dict(status: number, headers: dict(string: string), body: any)`.
    // With `responseShape: 'body'`, the body shape is determined by the
    // user-configured endpoint and stays `any` per §EXT.8.3 case 3.
    const returnTypeValue =
      (endpointConfig.responseShape ?? defaultResponseShape) === 'full'
        ? structureToTypeValue({
            kind: 'dict',
            fields: {
              status: { type: { kind: 'number' } },
              headers: {
                type: { kind: 'dict', valueType: { kind: 'string' } },
              },
              body: { type: { kind: 'any' } },
            },
          })
        : structureToTypeValue({ kind: 'any' });

    const hostFunctionDef: RillFunction = {
      params: rillParams,
      fn: endpointFn,
      ...(endpointConfig.description !== undefined
        ? { annotations: { description: endpointConfig.description } }
        : {}),
      returnType: returnTypeValue,
    };

    functions[endpointName] = hostFunctionDef;
  }

  // ============================================================
  // INTROSPECTION FUNCTION
  // ============================================================

  const endpointsFn = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];

    for (const [name, endpointConfig] of Object.entries(config.endpoints)) {
      result.push({
        name,
        method: endpointConfig.method,
        path: endpointConfig.path,
        description: endpointConfig.description ?? '',
      });
    }

    return result;
  };

  functions['endpoints'] = {
    params: [],
    fn: endpointsFn,
    annotations: { description: 'List configured endpoints' },
    returnType: structureToTypeValue({
      kind: 'list',
      element: {
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          method: { type: { kind: 'string' } },
          path: { type: { kind: 'string' } },
          description: { type: { kind: 'string' } },
        },
      },
    }),
  };

  // ============================================================
  // DISPOSAL
  // ============================================================

  const dispose = (): void => {
    for (const controller of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
  };

  // ============================================================
  // BUILD CALLABLE DICT
  // ============================================================

  const callableDict: Record<string, RillValue> = {};
  for (const [name, def] of Object.entries(functions)) {
    callableDict[name] = toCallable(def);
  }

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
