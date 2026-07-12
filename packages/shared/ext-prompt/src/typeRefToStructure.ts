import {
  RuntimeError,
  type FieldArg,
  type RillFieldDef,
  type TypeRef,
  type TypeStructure,
} from '@rcrsr/rill';

/**
 * Type names that are valid rill identifiers but have no useful text rendering
 * in a prompt context. They produce placeholder strings (e.g. `type(closure)`,
 * `vector(model, Nd)`) via formatValue and are rejected at grammar time so the
 * failure is declarative rather than latent garbage in the rendered prompt.
 */
const NON_RENDERABLE_TYPE_NAMES = new Set([
  'closure',
  'iterator',
  'stream',
  'vector',
  'type',
]);

/**
 * Converts a static rill TypeRef AST node to a TypeStructure.
 * Used by the prompt-md param grammar to accept full rill type expressions
 * (e.g. `list(dict(a: string, b: string))`) in frontmatter.
 *
 * Rejects:
 *   - Dynamic refs ($var): frontmatter has no runtime scope.
 *   - Union refs (A | B): not supported in v0 frontmatter.
 *   - Non-renderable types (closure, iterator, stream, vector, type):
 *     these produce placeholder strings, not prompt-useful text.
 *
 * Throws RuntimeError RILL-R001 on rejection.
 */
export function typeRefToStructure(ref: TypeRef): TypeStructure {
  if (ref.kind === 'dynamic') {
    throw new RuntimeError(
      'RILL-R001',
      `dynamic type refs ($${ref.varName}) are not allowed in prompt-md param grammar`
    );
  }
  if (ref.kind === 'union') {
    throw new RuntimeError(
      'RILL-R001',
      `union types (a | b) are not supported in prompt-md param grammar (v0)`
    );
  }
  // static
  const { typeName, args } = ref;

  if (NON_RENDERABLE_TYPE_NAMES.has(typeName)) {
    throw new RuntimeError(
      'RILL-R001',
      `"${typeName}" params are not supported in prompt-md — prompts render text, not ${typeName}-shaped values`
    );
  }

  if (!args || args.length === 0) {
    // bare type name
    return { kind: typeName } as TypeStructure;
  }

  // parameterized
  if (typeName === 'list') {
    // list(T): single positional arg
    if (args.length !== 1 || args[0]!.name !== undefined) {
      throw new RuntimeError(
        'RILL-R001',
        `list(...) takes exactly one positional type argument`
      );
    }
    return { kind: 'list', element: typeRefToStructure(args[0]!.value) };
  }

  if (typeName === 'dict') {
    // dict(T): single positional (valueType)
    // dict(a: T, b: T): all named (fields)
    const allNamed = args.every((a: FieldArg) => a.name !== undefined);
    const allPositional = args.every((a: FieldArg) => a.name === undefined);
    if (allPositional) {
      if (args.length !== 1) {
        throw new RuntimeError(
          'RILL-R001',
          `dict(T) takes exactly one positional type argument`
        );
      }
      return { kind: 'dict', valueType: typeRefToStructure(args[0]!.value) };
    }
    if (allNamed) {
      const fields: Record<string, RillFieldDef> = {};
      for (const arg of args) {
        fields[arg.name!] = { type: typeRefToStructure(arg.value) };
      }
      return { kind: 'dict', fields };
    }
    throw new RuntimeError(
      'RILL-R001',
      `dict(...) arguments must be all named (a: T, b: T) or one positional (T)`
    );
  }

  // Any other parameterized form — reject in v0. Extend as needs arise.
  throw new RuntimeError(
    'RILL-R001',
    `parameterized type "${typeName}(...)" is not supported in prompt-md param grammar (v0)`
  );
}
