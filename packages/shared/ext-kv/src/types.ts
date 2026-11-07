import type { ExtensionFactoryResult, RillValue } from '@rcrsr/rill';

/** Schema entry defining type and default for a key. */
export interface SchemaEntry {
  readonly type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  readonly default: RillValue;
  readonly description?: string | undefined;
}

/** Mount definition a backend-neutral contract suite hands to a harness. */
export interface KvContractMount {
  readonly mode: 'read' | 'write' | 'read-write';
  readonly schema?: Record<string, SchemaEntry> | undefined;
  readonly maxEntries?: number | undefined;
  readonly maxValueSize?: number | undefined;
}

/**
 * Backend adapter for the shared contract suite. Each createExtension call
 * must return an extension over fresh, isolated storage.
 */
export interface KvContractHarness {
  createExtension(
    mounts: Readonly<Record<string, KvContractMount>>
  ): ExtensionFactoryResult;
}
