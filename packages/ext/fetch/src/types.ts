/**
 * Type definitions for the fetch extension.
 *
 * @module
 */

// ============================================================
// PUBLIC CONFIG TYPES
// ============================================================

/** Parameter definition for an endpoint */
export interface EndpointParam {
  readonly name: string;
  readonly type: 'string' | 'number' | 'bool' | 'dict';
  readonly required?: boolean | undefined;
  readonly location: 'path' | 'query' | 'body' | 'header';
  readonly defaultValue?: string | number | boolean | undefined;
}

/** Endpoint configuration with parameter declarations */
export interface EndpointConfig {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly params?: EndpointParam[] | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly responseShape?: 'body' | 'full' | undefined;
  readonly description?: string | undefined;
}

/** Fetch extension configuration */
export interface FetchExtensionConfig {
  readonly baseUrl: string;
  readonly headers?:
    | Record<string, string>
    | (() => Record<string, string>)
    | undefined;
  readonly timeout?: number | undefined;
  readonly retries?: number | undefined;
  readonly retryDelay?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly responseShape?: 'body' | 'full' | undefined;
  readonly endpoints: Record<string, EndpointConfig>;
}
