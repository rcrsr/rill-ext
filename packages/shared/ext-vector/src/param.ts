import { RuntimeError } from '@rcrsr/rill';
import type { RillParam } from '@rcrsr/rill';

function validateParamName(name: string): void {
  if (name === '') throw new RuntimeError('RILL-R001', 'param name must not be empty');
  if (/\s/.test(name)) throw new RuntimeError('RILL-R001', 'param name must be a valid identifier');
}

/**
 * Construct a RillParam for the vector type.
 * Use this in host function parameter lists where a vector argument is required.
 *
 * @param name - Parameter name
 * @returns RillParam with type 'vector'
 */
export function vectorParam(name: string): RillParam {
  validateParamName(name);
  return {
    name,
    type: { type: 'vector' },
    defaultValue: undefined,
    annotations: {},
  };
}
