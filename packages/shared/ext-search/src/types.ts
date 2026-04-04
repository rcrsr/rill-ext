/**
 * Base configuration interface for all search extensions.
 */
export interface SearchExtensionConfig {
  /**
   * Base URL for the search service endpoint.
   * Absent when the extension uses a default or SDK-configured URL.
   */
  readonly baseUrl?: string | undefined;

  /**
   * Timeout in milliseconds for operations.
   * Default is determined by the fetch implementation.
   */
  readonly timeout?: number | undefined;
}

/**
 * Mutable state object tracking disposal lifecycle.
 */
export interface DisposalState {
  /**
   * Whether the resource has been disposed.
   * Default: false
   */
  isDisposed: boolean;
}

/**
 * Mutable state object tracking in-flight fetch requests.
 * Used by dispose() to cancel pending requests.
 */
export interface InFlightState {
  /**
   * Set of AbortControllers for all in-flight requests.
   */
  controllers: Set<AbortController>;
}
