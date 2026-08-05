/**
 * Per-file parser for *.prompt.md files.
 *
 * Reads a single prompt file, splits the frontmatter fence, parses YAML,
 * validates required fields, parses param grammar entries, checks template
 * references against declared params, infers the output mode from the
 * presence of `@@` role markers in the body, and computes the content hash.
 *
 * All errors thrown are `RuntimeError('RILL-R001', ...)` with path context
 * attached.
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

/** Output mode inferred from body content. `list` when `@@ role` markers are present, `string` otherwise. */
type PromptOutput = 'string' | 'list';

/** Raw YAML frontmatter shape expected in a .prompt.md file. */
interface PromptFrontmatter {
  description?: unknown;
  params?: unknown;
}

/** Fully parsed and validated prompt file. */
export interface ParsedPrompt {
  /** Resolution name: relativePath with `.prompt.md` stripped, `/` replaced with `.`, and `-` replaced with `_`. */
  name: string;
  /** Human-readable description from frontmatter. */
  description: string;
  /** Parsed and typed param list in declaration order. */
  params: RillParam[];
  /** Inferred output mode: `list` when body contains `@@ role` markers, `string` otherwise. */
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
 * Strips the `.prompt.md` suffix, replaces `/` (and `\` on Windows) with `.`,
 * and replaces hyphens (`-`) with underscores (`_`) so the name is invocable
 * from rill scripts. The returned name may still contain `.` segments for
 * nested paths; the rill runtime maps `.` to `_` when resolving callable keys
 * within a namespace.
 *
 * Path-traversal guard lives in `traversePromptFiles`, which rejects any
 * relative path with a `..` segment before it ever reaches this function.
 *
 * @example
 *   deriveResolutionName('agents/research.prompt.md')      // => 'agents.research'
 *   deriveResolutionName('summarize-email.prompt.md')      // => 'summarize_email'
 */
function deriveResolutionName(relativePath: string): string {
  // Strip .prompt.md suffix
  const withoutSuffix = relativePath.replace(/\.prompt\.md$/, '');
  // Normalise path separators to `.`
  const withDots = withoutSuffix.replace(/[/\\]/g, '.');
  // Convert hyphens to underscores so the name is invocable from rill scripts
  return withDots.replace(/-/g, '_');
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
 * Implements the error paths. All errors thrown are
 * factory-time `RuntimeError('RILL-R001', ...)` with path context attached.
 *
 * @param absolutePath - Absolute filesystem path of the file.
 * @param relativePath - Path relative to the loader basePath.
 * @returns A fully validated `ParsedPrompt` ready for closure construction.
 */
export async function parseFile(
  absolutePath: string,
  relativePath: string
): Promise<ParsedPrompt> {
  // ── Derive resolution name ──────────────────────────────────────────────
  const name = deriveResolutionName(relativePath);

  // ── Read source ─────────────────────────────────────────────────────────
  const source = await readFile(absolutePath, 'utf-8');

  // ── Split frontmatter fence (RILL-R001) ───────────────────────────────
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
      throw new RuntimeError('RILL-R001', err.message, undefined, {
        path: absolutePath,
        cause: err,
      });
    }
    throw err;
  }

  // ── Parse YAML frontmatter ───────────────────────────────────────
  let raw: PromptFrontmatter;
  try {
    // yaml.parse throws YAMLParseError on malformed input.
    const parsed = yamlParse(frontmatter) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RuntimeError(
        'RILL-R001',
        'frontmatter must be a YAML mapping',
        undefined,
        {
          path: absolutePath,
          line: 2,
        }
      );
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
      const sourceLine =
        yamlLine !== undefined ? fenceLine + yamlLine : undefined;
      throw new RuntimeError(
        'RILL-R001',
        `YAML parse error: ${err.message}`,
        undefined,
        {
          path: absolutePath,
          ...(sourceLine !== undefined ? { line: sourceLine } : {}),
          cause: err,
        }
      );
    }
    throw err;
  }

  // ── Validate required fields ────────────────────────────────────
  if (
    typeof raw['description'] !== 'string' ||
    raw['description'].length === 0
  ) {
    throw new RuntimeError(
      'RILL-R001',
      `missing or empty required field "description"`,
      undefined,
      {
        path: absolutePath,
        field: 'description',
      }
    );
  }
  if (!Array.isArray(raw['params'])) {
    throw new RuntimeError(
      'RILL-R001',
      `missing or invalid required field "params" (must be a list)`,
      undefined,
      {
        path: absolutePath,
        field: 'params',
      }
    );
  }

  const description = raw['description'];
  const rawParamEntries = raw['params'] as unknown[];

  // ── Parse param grammar entries ────────────────────────────────
  const params: RillParam[] = [];
  for (const entry of rawParamEntries) {
    if (typeof entry !== 'string') {
      throw new RuntimeError(
        'RILL-R001',
        `params entries must be strings, got: ${JSON.stringify(entry)}`,
        undefined,
        {
          path: absolutePath,
          entry: JSON.stringify(entry),
        }
      );
    }
    try {
      params.push(parseParamGrammar(entry));
    } catch (err) {
      if (err instanceof RuntimeError && err.errorId === 'RILL-R001') {
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

  // ── Validate template references ───────────────────────────────
  const refs = scanTemplateReferences(body);
  for (const ref of refs) {
    if (!declaredNames.has(ref.name)) {
      // ref.line is 1-based within body; adjust to source file line.
      const sourceLine = bodyLineOffset + ref.line - 1;
      throw new RuntimeError(
        'RILL-R001',
        `template references "{${ref.name}}" which is not declared in params`,
        undefined,
        { path: absolutePath, line: sourceLine, name: ref.name }
      );
    }
  }

  // ── Infer output mode from body ────────────────────────────────────────
  // `list` when at least one `@@ role` marker is present, `string` otherwise.
  // The output mode is no longer declared in frontmatter — it derives entirely
  // from body content so the file can never disagree with itself.
  const output: PromptOutput = ROLE_MARKER_RE.test(body) ? 'list' : 'string';

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
