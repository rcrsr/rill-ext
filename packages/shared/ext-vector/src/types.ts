/**
 * Base configuration interface for all vector database extensions.
 */
export interface VectorExtensionConfig {
  /**
   * Timeout in milliseconds for operations.
   * Default is determined by the SDK.
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
