/**
 * Factory function for creating text extension.
 *
 * @module
 */

import {
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillParam,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { TextExtensionConfig } from './types.js';
import {
  htmlToText,
  htmlToMarkdown,
  extractContent,
  decodeEntities,
} from './functions/html.js';
import { decodeQuotedPrintable } from './functions/mime.js';
import { stripDiacritics } from './functions/unicode.js';
import {
  collapseWhitespace,
  dedent,
  trimLines,
} from './functions/whitespace.js';
import { extractUrls, extractEmails } from './functions/extract.js';
import { splitParagraphs, windowFn, truncate } from './functions/segment.js';

// ============================================================
// RETURN TYPE CONSTANTS
// ============================================================

const stringReturn = structureToTypeValue({ kind: 'string' });
const stringListReturn = structureToTypeValue({
  kind: 'list',
  element: { kind: 'string' },
});

const PROVIDER = 'text';

// ============================================================
// ELLIPSIS PARAM (no default — callers pass "" for none)
// ============================================================

const ellipsisParam: RillParam = {
  name: 'ellipsis',
  type: { kind: 'string' },
  defaultValue: undefined,
  annotations: {
    description:
      'Ellipsis string appended when text is truncated; pass "" for none',
  },
};

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates a text extension with HTML, Markdown, extraction, and
 * segmentation utilities.
 *
 * Returns 14 functions: html_to_text, html_to_markdown,
 * extract_content, decode_entities, decode_quoted_printable,
 * strip_diacritics, collapse_whitespace, dedent, trim_lines,
 * extract_urls, extract_emails, split_paragraphs, window, truncate.
 */
export function createTextExtension(
  config: TextExtensionConfig = {},
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // config has no fields; destructure to satisfy noUnusedLocals via void
  void config;

  // ----------------------------------------------------------
  // RillFunction definitions
  // ----------------------------------------------------------

  const fnDict: Record<string, RillFunction> = {
    html_to_text: {
      params: [
        p.str('html', 'HTML string to convert'),
        p.bool('include_links', 'Include link URLs inline', false),
        p.bool('word_wrap', 'Wrap output lines', true),
        p.num('word_wrap_width', 'Line wrap width in characters', 80),
      ],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const html = args['html'];
        if (typeof html !== 'string') {
          return runCtx.invalidate(new Error('html must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        const rawIncludeLinks = args['include_links'];
        const includeLinks =
          rawIncludeLinks === undefined ? false : rawIncludeLinks;
        if (typeof includeLinks !== 'boolean') {
          return runCtx.invalidate(
            new Error('include_links must be a boolean'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_option_type' },
            }
          );
        }
        const rawWordWrap = args['word_wrap'];
        const wordWrap = rawWordWrap === undefined ? true : rawWordWrap;
        if (typeof wordWrap !== 'boolean') {
          return runCtx.invalidate(new Error('word_wrap must be a boolean'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'invalid_option_type' },
          });
        }
        const rawWordWrapWidth = args['word_wrap_width'];
        const wordWrapWidth =
          rawWordWrapWidth === undefined ? 80 : rawWordWrapWidth;
        if (
          !Number.isInteger(wordWrapWidth) ||
          (wordWrapWidth as number) <= 0
        ) {
          return runCtx.invalidate(
            new Error('word_wrap_width must be a positive integer'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_word_wrap_width' },
            }
          );
        }
        return htmlToText(
          html,
          includeLinks,
          wordWrap,
          wordWrapWidth as number
        );
      },
      annotations: { description: 'Convert HTML to plain text' },
      returnType: stringReturn,
    },

    html_to_markdown: {
      params: [p.str('html', 'HTML string to convert')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const html = args['html'];
        if (typeof html !== 'string') {
          return runCtx.invalidate(new Error('html must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return htmlToMarkdown(html);
      },
      annotations: { description: 'Convert HTML to Markdown' },
      returnType: stringReturn,
    },

    extract_content: {
      params: [p.str('html', 'HTML document to extract main content from')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const html = args['html'];
        if (typeof html !== 'string') {
          return runCtx.invalidate(new Error('html must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return await extractContent(html);
      },
      annotations: {
        description: 'Extract main readable content from HTML using defuddle',
      },
      returnType: stringReturn,
    },

    decode_entities: {
      params: [p.str('text', 'Text containing HTML entities to decode')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return decodeEntities(text);
      },
      annotations: { description: 'Decode HTML entities in text' },
      returnType: stringReturn,
    },

    decode_quoted_printable: {
      params: [p.str('text', 'Quoted-printable encoded text to decode')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return decodeQuotedPrintable(text);
      },
      annotations: { description: 'Decode quoted-printable encoded text' },
      returnType: stringReturn,
    },

    strip_diacritics: {
      params: [p.str('text', 'Text from which to remove diacritics')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return stripDiacritics(text);
      },
      annotations: { description: 'Remove diacritical marks from text' },
      returnType: stringReturn,
    },

    collapse_whitespace: {
      params: [
        p.str('text', 'Text to collapse whitespace in'),
        p.bool('preserve_newlines', 'Keep newline characters', false),
      ],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        const rawPreserveNewlines = args['preserve_newlines'];
        const preserveNewlines =
          rawPreserveNewlines === undefined ? false : rawPreserveNewlines;
        if (typeof preserveNewlines !== 'boolean') {
          return runCtx.invalidate(
            new Error('preserve_newlines must be a boolean'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_option_type' },
            }
          );
        }
        return collapseWhitespace(text, preserveNewlines);
      },
      annotations: {
        description: 'Collapse runs of whitespace to a single space',
      },
      returnType: stringReturn,
    },

    dedent: {
      params: [p.str('text', 'Indented text to dedent')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return dedent(text);
      },
      annotations: {
        description: 'Remove common leading indentation from all lines',
      },
      returnType: stringReturn,
    },

    trim_lines: {
      params: [p.str('text', 'Text whose lines should be trimmed')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return trimLines(text);
      },
      annotations: {
        description: 'Trim whitespace from each line and return line list',
      },
      returnType: stringListReturn,
    },

    extract_urls: {
      params: [p.str('text', 'Text to extract URLs from')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return extractUrls(text);
      },
      annotations: { description: 'Extract all URLs from text' },
      returnType: stringListReturn,
    },

    extract_emails: {
      params: [p.str('text', 'Text to extract email addresses from')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return extractEmails(text);
      },
      annotations: { description: 'Extract all email addresses from text' },
      returnType: stringListReturn,
    },

    split_paragraphs: {
      params: [p.str('text', 'Text to split into paragraphs')],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        return splitParagraphs(text);
      },
      annotations: { description: 'Split text into paragraph segments' },
      returnType: stringListReturn,
    },

    window: {
      params: [
        p.str('text', 'Text to slide a window over'),
        p.num('size', 'Window size in characters'),
        p.num(
          'step',
          'Step size between windows; defaults to size when omitted'
        ),
      ],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        const size = args['size'] as number;
        if (!Number.isInteger(size) || size <= 0) {
          return runCtx.invalidate(
            new Error('size must be a positive integer'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_window_size' },
            }
          );
        }
        const rawStep = args['step'];
        const step = rawStep === undefined ? size : (rawStep as number);
        if (!Number.isInteger(step) || step <= 0) {
          return runCtx.invalidate(
            new Error('step must be a positive integer'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_window_step' },
            }
          );
        }
        return windowFn(text, size, step);
      },
      annotations: {
        description:
          'Slide a fixed-size window over text and return overlapping chunks',
      },
      returnType: stringListReturn,
    },

    truncate: {
      params: [
        p.str('text', 'Text to truncate'),
        p.num('max', 'Maximum length in characters'),
        p.bool('word_boundary', 'Truncate at word boundary', false),
        ellipsisParam,
      ],
      fn: async (args, ctx) => {
        const runCtx = ctx as RuntimeContext;
        const text = args['text'];
        if (typeof text !== 'string') {
          return runCtx.invalidate(new Error('text must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'non_string_input' },
          });
        }
        const max = args['max'] as number;
        if (!Number.isInteger(max) || max <= 0) {
          return runCtx.invalidate(
            new Error('max must be a positive integer'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_max' },
            }
          );
        }
        const rawWordBoundary = args['word_boundary'];
        const wordBoundary =
          rawWordBoundary === undefined ? false : rawWordBoundary;
        if (typeof wordBoundary !== 'boolean') {
          return runCtx.invalidate(
            new Error('word_boundary must be a boolean'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_option_type' },
            }
          );
        }
        const rawEllipsis = args['ellipsis'];
        const ellipsis = rawEllipsis === undefined ? '' : rawEllipsis;
        if (typeof ellipsis !== 'string') {
          return runCtx.invalidate(new Error('ellipsis must be a string'), {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'invalid_option_type' },
          });
        }
        return truncate(text, max, wordBoundary, ellipsis);
      },
      annotations: { description: 'Truncate text to a maximum length' },
      returnType: stringReturn,
    },
  };

  // ----------------------------------------------------------
  // Build callable dict
  // ----------------------------------------------------------

  const callableDict: Record<string, RillValue> = {};
  for (const [name, def] of Object.entries(fnDict)) {
    callableDict[name] = toCallable(def);
  }

  return {
    value: callableDict as unknown as RillValue,
    dispose: async (): Promise<void> => {},
  } satisfies ExtensionFactoryResult;
}
