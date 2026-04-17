/**
 * Template interpolation and reference scanning for rill prompt bodies.
 *
 * Covers IR-4 (interpolate), IR-7 (scanTemplateReferences), AC-15.
 *
 * Escape rules:
 *   {{  →  literal {
 *   }}  →  literal }
 *   {{name}}  →  literal {name}  (no substitution)
 *   {name}  →  values[name] (unescaped reference)
 *
 * Missing-value handling: values[name] ?? '' (option a/c).
 * The spec guarantees references are pre-validated before interpolate() is
 * called, so a missing key never occurs in production. Emitting '' on a
 * missing key is the safest choice — it never throws and avoids leaking
 * template syntax into output.
 */

// ============================================================
// INTERPOLATE
// ============================================================

/**
 * Substitutes `{name}` placeholders in `body` with the matching entry from
 * `values`. Escape sequences `{{` and `}}` emit literal `{` and `}`.
 * The doubled form `{{name}}` emits literal `{name}` without substitution.
 *
 * Never throws. Missing keys resolve to empty string.
 */
export function interpolate(body: string, values: Record<string, string>): string {
  const parts: string[] = [];
  let i = 0;
  const len = body.length;

  while (i < len) {
    // {{ → emit literal {
    if (body[i] === '{' && body[i + 1] === '{') {
      parts.push('{');
      i += 2;
      continue;
    }

    // }} → emit literal }
    if (body[i] === '}' && body[i + 1] === '}') {
      parts.push('}');
      i += 2;
      continue;
    }

    // {name} — unescaped reference
    if (body[i] === '{') {
      const closeIdx = body.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const name = body.slice(i + 1, closeIdx);
        parts.push(values[name] ?? '');
        i = closeIdx + 1;
        continue;
      }
    }

    // Ordinary character
    parts.push(body[i] as string);
    i += 1;
  }

  return parts.join('');
}

// ============================================================
// SCAN TEMPLATE REFERENCES
// ============================================================

/** A single unescaped `{name}` reference found in a template body. */
export interface TemplateReference {
  name: string;
  /** 1-based line number of the opening `{`. */
  line: number;
}

/**
 * Scans `body` and returns every unescaped `{name}` reference with its
 * 1-based line number. Escaped forms (`{{name}}`) are not reported.
 */
export function scanTemplateReferences(body: string): Array<TemplateReference> {
  const refs: Array<TemplateReference> = [];
  let i = 0;
  const len = body.length;
  let line = 1;

  while (i < len) {
    const ch = body[i] as string;

    // Track newlines
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // {{ → skip both chars (emit logic: literal {, no reference recorded)
    if (ch === '{' && body[i + 1] === '{') {
      i += 2;
      continue;
    }

    // }} → skip both chars
    if (ch === '}' && body[i + 1] === '}') {
      i += 2;
      continue;
    }

    // {name} — unescaped reference
    if (ch === '{') {
      const closeIdx = body.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const name = body.slice(i + 1, closeIdx);
        refs.push({ name, line });
        i = closeIdx + 1;
        continue;
      }
    }

    i += 1;
  }

  return refs;
}
