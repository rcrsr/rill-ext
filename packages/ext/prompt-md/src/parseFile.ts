/**
 * Per-file parser for *.prompt.md files.
 *
 * Reads a single prompt file, splits the frontmatter fence, parses YAML,
 * validates required fields, parses param grammar entries, validates output
 * type, checks template references against declared params, verifies role
 * markers for list output, and computes the content hash.
 *
 * All errors thrown are `RuntimeError('RILL-R001', ...)` with path context
 * attached. EC-8 through EC-14.
 */

import { readFile } from 'node:fs/promises';
import { parse as yamlParse, YAMLParseError } from 'yaml';
import { RuntimeError, type RillParam } from '@rcrsr/rill';
import {
  splitFrontmatter,
  parseParamGrammar,
  scanTemplateReferences,
  computeContentHash,
} from '@rcrsr/rill-ext-prompt-shared';

// ============================================================
// TYPES
// ============================================================

/** Supported output types accepted in v0 (dict is reserved and rejected). */
export type PromptOutput = 'string' | 'list';

/** Raw YAML frontmatter shape expected in a .prompt.md file. */
interface PromptFrontmatter {
  description?: unknown;
  params?: unknown;
  output?: unknown;
}

/** Fully parsed and validated prompt file. */
export interface ParsedPrompt {
  /** Resolution name: relativePath with `.prompt.md` stripped and `/` replaced with `.`. */
  name: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** Parsed and typed param list in declaration order. */
  params: RillParam[];
  /** Accepted output mode. */
  output: PromptOutput;
  /** Template body text (everything after the closing `---` fence). */
  body: string;
  /** 1-based line number of the first body line within the source file. */
  bodyLineOffset: number;
  /** SHA-256 hex digest of canonical(params) + output + body. */
  hash: string;
  /** Absolute path of the source file. */
  path: string;
}

// ============================================================
// RESOLUTION NAME
// ============================================================

/**
 * Derives a resolution name from a relative file path.
 *
 * Strips the `.prompt.md` suffix and replaces `/` (and `\` on Windows) with
 * `.`. Returns null when the resulting name contains a `..` segment.
 *
 * @example
 *   deriveResolutionName('agents/research.prompt.md') // => 'agents.research'
 */
function deriveResolutionName(relativePath: string): string | null {
  // Strip .prompt.md suffix
  const withoutSuffix = relativePath.replace(/\.prompt\.md$/, '');
  // Normalise path separators to `.`
  const name = withoutSuffix.replace(/[/\\]/g, '.');
  // Security: reject names containing `..` segments
  const segments = name.split('.');
  if (segments.includes('..')) {
    return null;
  }
  return name;
}

// ============================================================
// ROLE MARKER CHECK
// ============================================================

/** Matches lines of the form `@@ word` — mirrors roles.ts ROLE_MARKER_RE. */
const ROLE_MARKER_RE = /^@@\s+\w+\s*$/m;

// ============================================================
// PARSE FILE
// ============================================================

/**
 * Reads and fully parses a single `*.prompt.md` file.
 *
 * Implements EC-8 through EC-14 error paths. All errors thrown are
 * factory-time `RuntimeError('RILL-R001', ...)` with path context attached.
 *
 * @param absolutePath - Absolute filesystem path of the file.
 * @param relativePath - Path relative to the loader basePath.
 * @returns A fully validated `ParsedPrompt` ready for closure construction.
 */
export async function parseFile(
  absolutePath: string,
  relativePath: string,
): Promise<ParsedPrompt> {
  // ── Derive resolution name ──────────────────────────────────────────────
  const name = deriveResolutionName(relativePath);
  if (name === null) {
    throw new RuntimeError('RILL-R001', `resolution name derived from "${relativePath}" contains ".." segments`, undefined, {
      path: absolutePath,
    });
  }

  // ── Read source ─────────────────────────────────────────────────────────
  const source = await readFile(absolutePath, 'utf-8');

  // ── Split frontmatter fence (EC-8 path: RILL-R001) ─────────────────────
  let frontmatter: string;
  let body: string;
  let bodyLineOffset: number;
  try {
    const split = splitFrontmatter(source);
    frontmatter = split.frontmatter;
    body = split.body;
    bodyLineOffset = split.bodyLineOffset;
  } catch (err) {
    if (err instanceof RuntimeError && err.errorId === 'RILL-R001') {
      throw new RuntimeError('RILL-R001', err.message, undefined, { path: absolutePath, cause: err });
    }
    throw err;
  }

  // ── Parse YAML frontmatter (EC-8) ───────────────────────────────────────
  let raw: PromptFrontmatter;
  try {
    // yaml.parse throws YAMLParseError on malformed input.
    const parsed = yamlParse(frontmatter) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RuntimeError('RILL-R001', 'frontmatter must be a YAML mapping', undefined, {
        path: absolutePath,
        line: 2,
      });
    }
    raw = parsed as PromptFrontmatter;
  } catch (err) {
    if (err instanceof RuntimeError) {
      throw err;
    }
    if (err instanceof YAMLParseError) {
      // linePos[0].line is 1-based within the frontmatter string. Add 1 to
      // account for the opening `---` fence line so the reported line is
      // relative to the full source file.
      const fenceLine = 1;
      const yamlLine: number | undefined = err.linePos?.[0]?.line;
      const sourceLine = yamlLine !== undefined ? fenceLine + yamlLine : undefined;
      throw new RuntimeError(
        'RILL-R001',
        `YAML parse error: ${err.message}`,
        undefined,
        { path: absolutePath, ...(sourceLine !== undefined ? { line: sourceLine } : {}), cause: err },
      );
    }
    throw err;
  }

  // ── Validate required fields (EC-9) ────────────────────────────────────
  if (typeof raw['description'] !== 'string' || raw['description'].length === 0) {
    throw new RuntimeError('RILL-R001', `missing or empty required field "description"`, undefined, {
      path: absolutePath,
      field: 'description',
    });
  }
  if (!Array.isArray(raw['params'])) {
    throw new RuntimeError('RILL-R001', `missing or invalid required field "params" (must be a list)`, undefined, {
      path: absolutePath,
      field: 'params',
    });
  }
  if (raw['output'] === undefined || raw['output'] === null) {
    throw new RuntimeError('RILL-R001', `missing required field "output"`, undefined, {
      path: absolutePath,
      field: 'output',
    });
  }

  const description = raw['description'];
  const rawParamEntries = raw['params'] as unknown[];
  const rawOutput = raw['output'];

  // ── Validate output value (EC-10, EC-11) ───────────────────────────────
  if (rawOutput === 'dict') {
    // EC-10: dict is reserved in v0
    throw new RuntimeError('RILL-R001', `output type "dict" is reserved and not implemented in v0`, undefined, {
      path: absolutePath,
      field: 'output',
      value: 'dict',
    });
  }
  if (rawOutput !== 'string' && rawOutput !== 'list') {
    // EC-11: unrecognized output value
    throw new RuntimeError(
      'RILL-R001',
      `unrecognized output value "${String(rawOutput)}" — accepted values: string, list`,
      undefined,
      { path: absolutePath, field: 'output', value: String(rawOutput) },
    );
  }
  const output: PromptOutput = rawOutput;

  // ── Parse param grammar entries (EC-12) ────────────────────────────────
  const params: RillParam[] = [];
  for (const entry of rawParamEntries) {
    if (typeof entry !== 'string') {
      throw new RuntimeError('RILL-R001', `params entries must be strings, got: ${JSON.stringify(entry)}`, undefined, {
        path: absolutePath,
        entry: JSON.stringify(entry),
      });
    }
    try {
      params.push(parseParamGrammar(entry));
    } catch (err) {
      if (err instanceof RuntimeError && err.errorId === 'RILL-R001') {
        // EC-12
        throw new RuntimeError('RILL-R001', err.message, undefined, {
          path: absolutePath,
          entry,
          cause: err,
        });
      }
      throw err;
    }
  }

  // Build declared param name set for template reference validation.
  const declaredNames = new Set(params.map((p) => p.name));

  // ── Validate template references (EC-13) ───────────────────────────────
  const refs = scanTemplateReferences(body);
  for (const ref of refs) {
    if (!declaredNames.has(ref.name)) {
      // ref.line is 1-based within body; adjust to source file line.
      const sourceLine = bodyLineOffset + ref.line - 1;
      throw new RuntimeError(
        'RILL-R001',
        `template references "{${ref.name}}" which is not declared in params`,
        undefined,
        { path: absolutePath, line: sourceLine, name: ref.name },
      );
    }
  }

  // ── Validate role markers for list output (EC-14) ──────────────────────
  if (output === 'list' && !ROLE_MARKER_RE.test(body)) {
    throw new RuntimeError('RILL-R001', `output type "list" requires at least one @@ role marker in the body`, undefined, {
      path: absolutePath,
    });
  }

  // ── Compute content hash ────────────────────────────────────────────────
  // Canonical params string: raw param entries joined by newline.
  // This is stable as long as the file's params list order is stable —
  // see Implementation Notes [ASSUMPTION].
  const paramsCanonical = rawParamEntries
    .filter((e): e is string => typeof e === 'string')
    .join('\n');
  const hash = computeContentHash(paramsCanonical, output, body);

  return {
    name,
    description,
    params,
    output,
    body,
    bodyLineOffset,
    hash,
    path: absolutePath,
  };
}
