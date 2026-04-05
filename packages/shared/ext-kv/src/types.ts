import type { RillValue } from '@rcrsr/rill';

/** Schema entry defining type and default for a key. */
export interface SchemaEntry {
  readonly type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  readonly default: RillValue;
  readonly description?: string | undefined;
}
