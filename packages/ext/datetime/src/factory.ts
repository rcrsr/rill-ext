/**
 * Factory function for creating datetime extension.
 *
 * @module
 */

import {
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillParam,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { DatetimeExtensionConfig } from './types.js';

// ============================================================
// RETURN TYPE CONSTANTS
// ============================================================

const stringReturn = structureToTypeValue({ kind: 'string' });
const numberReturn = structureToTypeValue({ kind: 'number' });
const stringListReturn = structureToTypeValue({
  kind: 'list',
  element: { kind: 'string' },
});
const datetimeReturn = structureToTypeValue({ kind: 'datetime' } as {
  kind: string;
});

const PROVIDER = 'datetime';

// ============================================================
// ZONE VALIDATION
// ============================================================

const validZones = new Set<string>(Intl.supportedValuesOf('timeZone'));
// Intl.supportedValuesOf may omit UTC on some runtimes
validZones.add('UTC');

// ============================================================
// FORMAT TOKEN REGISTRY
// ============================================================

/**
 * Each entry: [token, regex pattern string for parsing, pad length]
 * Tokens ordered longest-first to avoid partial matches during scan.
 */
const TOKEN_REGISTRY: ReadonlyArray<{
  token: string;
  regex: string;
  group: string;
}> = [
  { token: 'YYYY', regex: '\\d{4}', group: 'YYYY' },
  { token: 'SSS', regex: '\\d{3}', group: 'SSS' },
  { token: 'MM', regex: '\\d{2}', group: 'MM' },
  { token: 'DD', regex: '\\d{2}', group: 'DD' },
  { token: 'HH', regex: '\\d{2}', group: 'HH' },
  { token: 'mm', regex: '\\d{2}', group: 'mm' },
  { token: 'ss', regex: '\\d{2}', group: 'ss' },
];

/**
 * Escape regex special characters in a literal string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply format tokens to a UTC Date, producing formatted output.
 */
function applyFormat(date: Date, pattern: string): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  const replacements: Record<string, string> = {
    YYYY: String(year).padStart(4, '0'),
    MM: String(month).padStart(2, '0'),
    DD: String(day).padStart(2, '0'),
    HH: String(hours).padStart(2, '0'),
    mm: String(minutes).padStart(2, '0'),
    ss: String(seconds).padStart(2, '0'),
    SSS: String(ms).padStart(3, '0'),
  };

  // Replace tokens longest-first to avoid partial replacement
  let result = pattern;
  for (const entry of TOKEN_REGISTRY) {
    result = result
      .split(entry.token)
      .join(replacements[entry.token] ?? entry.token);
  }
  return result;
}

// ============================================================
// TIMEZONE FORMATTING HELPERS
// ============================================================

/**
 * Get UTC offset in minutes for a zone at a given instant.
 * Uses Intl.DateTimeFormat to resolve DST-aware offset.
 */
function getOffsetMinutes(epochMs: number, zone: string): number {
  // Format both UTC and local parts; diff to compute offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(epochMs);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10) - 1;
  const day = parseInt(get('day'), 10);
  let hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const second = parseInt(get('second'), 10);

  // hour12: false can return 24 for midnight
  if (hour === 24) hour = 0;

  const localMs = Date.UTC(year, month, day, hour, minute, second);
  return Math.round((localMs - epochMs) / 60000);
}

/**
 * Format offset minutes as +HH:MM or -HH:MM string.
 */
function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60)
    .toString()
    .padStart(2, '0');
  const m = (abs % 60).toString().padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/**
 * Get local datetime components for a zone at a given epoch ms.
 */
function getLocalComponents(
  epochMs: number,
  zone: string
): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(epochMs);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '00';

  let hours = parseInt(get('hour'), 10);
  if (hours === 24) hours = 0;

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hours,
    minutes: parseInt(get('minute'), 10),
    seconds: parseInt(get('second'), 10),
  };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates the datetime extension with timezone and formatting functions.
 *
 * Returns 7 host functions: iso, date, time, offset, zones, format, parse.
 */
export function createDatetimeExtension(
  _config: DatetimeExtensionConfig = {},
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  let disposed = false;

  // ----------------------------------------------------------
  // Validation helpers (return invalid RillValue or null on success)
  // ----------------------------------------------------------

  function checkDisposed(runCtx: RuntimeContext): RillValue | null {
    if (disposed) {
      return runCtx.invalidate(new Error('datetime: operation cancelled'), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'disposed' },
      });
    }
    return null;
  }

  function validateZone(
    zone: string,
    runCtx: RuntimeContext
  ): RillValue | null {
    if (!validZones.has(zone)) {
      return runCtx.invalidate(new Error(`unknown timezone: "${zone}"`), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'invalid_timezone', zone },
      });
    }
    return null;
  }

  /**
   * Scan a pattern for unrecognized tokens.
   */
  function validatePattern(
    pattern: string,
    runCtx: RuntimeContext
  ): RillValue | null {
    let pos = 0;
    while (pos < pattern.length) {
      let tokenMatched = false;
      for (const entry of TOKEN_REGISTRY) {
        if (pattern.startsWith(entry.token, pos)) {
          pos += entry.token.length;
          tokenMatched = true;
          break;
        }
      }
      if (!tokenMatched) {
        const ch = pattern[pos] ?? '';
        if (/[A-Za-z]/.test(ch)) {
          let tokenEnd = pos + 1;
          while (
            tokenEnd < pattern.length &&
            /[A-Za-z]/.test(pattern[tokenEnd] ?? '')
          ) {
            tokenEnd++;
          }
          const unknownToken = pattern.slice(pos, tokenEnd);
          return runCtx.invalidate(
            new Error(`unknown format token: "${unknownToken}"`),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'unknown_format_token', token: unknownToken },
            }
          );
        }
        pos++;
      }
    }
    return null;
  }

  /**
   * Validate and extract a datetime argument (epoch ms number).
   */
  function extractDatetime(
    value: RillValue,
    runCtx: RuntimeContext
  ): { ok: true; value: number } | { ok: false; invalid: RillValue } {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      const got = typeof value === 'number' ? String(value) : typeof value;
      return {
        ok: false,
        invalid: runCtx.invalidate(new Error(`expected datetime, got ${got}`), {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'invalid_argument',
            expected: 'datetime',
            got: typeof value,
          },
        }),
      };
    }
    return { ok: true, value };
  }

  /**
   * Validate and extract a string argument.
   */
  function extractString(
    value: RillValue,
    runCtx: RuntimeContext
  ): { ok: true; value: string } | { ok: false; invalid: RillValue } {
    if (typeof value !== 'string') {
      return {
        ok: false,
        invalid: runCtx.invalidate(
          new Error(`expected string, got ${typeof value}`),
          {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: {
              kind: 'invalid_argument',
              expected: 'string',
              got: typeof value,
            },
          }
        ),
      };
    }
    return { ok: true, value };
  }

  /**
   * Build a regex from a format pattern and parse the input string.
   */
  function parseWithPattern(
    str: string,
    pattern: string,
    runCtx: RuntimeContext
  ): { ok: true; value: number } | { ok: false; invalid: RillValue } {
    let regexSource = '';
    let remaining = pattern;

    while (remaining.length > 0) {
      let tokenMatched = false;
      for (const entry of TOKEN_REGISTRY) {
        if (remaining.startsWith(entry.token)) {
          regexSource += `(?<${entry.group}>${entry.regex})`;
          remaining = remaining.slice(entry.token.length);
          tokenMatched = true;
          break;
        }
      }
      if (!tokenMatched) {
        regexSource += escapeRegex(remaining[0] ?? '');
        remaining = remaining.slice(1);
      }
    }

    const regex = new RegExp(`^${regexSource}$`);
    const match = regex.exec(str);

    if (!match || !match.groups) {
      return {
        ok: false,
        invalid: runCtx.invalidate(
          new Error(`cannot parse "${str}" with pattern "${pattern}"`),
          {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'parse_mismatch', str, pattern },
          }
        ),
      };
    }

    const g = match.groups;
    const year = parseInt(g['YYYY'] ?? '1970', 10);
    const month = parseInt(g['MM'] ?? '01', 10);
    const day = parseInt(g['DD'] ?? '01', 10);
    const hours = parseInt(g['HH'] ?? '00', 10);
    const minutes = parseInt(g['mm'] ?? '00', 10);
    const seconds = parseInt(g['ss'] ?? '00', 10);
    const ms = parseInt(g['SSS'] ?? '0', 10);

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth ||
      hours > 23 ||
      minutes > 59 ||
      seconds > 59 ||
      ms > 999
    ) {
      return {
        ok: false,
        invalid: runCtx.invalidate(
          new Error(`date component out of range in "${str}"`),
          {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: { kind: 'date_out_of_range', str, pattern },
          }
        ),
      };
    }

    return {
      ok: true,
      value: Date.UTC(year, month - 1, day, hours, minutes, seconds, ms),
    };
  }

  // ----------------------------------------------------------
  // tz::iso
  // ----------------------------------------------------------

  const iso: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const dt = extractDatetime(args['dt'] as RillValue, runCtx);
    if (!dt.ok) return dt.invalid;
    const zoneArg = extractString(args['zone'] as RillValue, runCtx);
    if (!zoneArg.ok) return zoneArg.invalid;
    const zInv = validateZone(zoneArg.value, runCtx);
    if (zInv) return zInv;

    const { year, month, day, hours, minutes, seconds } = getLocalComponents(
      dt.value,
      zoneArg.value
    );
    const offsetMin = getOffsetMinutes(dt.value, zoneArg.value);

    const pad2 = (n: number): string => String(n).padStart(2, '0');
    const datePart = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
    const timePart = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    return `${datePart}T${timePart}${formatOffset(offsetMin)}`;
  };

  // ----------------------------------------------------------
  // tz::date
  // ----------------------------------------------------------

  const date: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const dt = extractDatetime(args['dt'] as RillValue, runCtx);
    if (!dt.ok) return dt.invalid;
    const zoneArg = extractString(args['zone'] as RillValue, runCtx);
    if (!zoneArg.ok) return zoneArg.invalid;
    const zInv = validateZone(zoneArg.value, runCtx);
    if (zInv) return zInv;

    const { year, month, day } = getLocalComponents(dt.value, zoneArg.value);
    const pad2 = (n: number): string => String(n).padStart(2, '0');
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  };

  // ----------------------------------------------------------
  // tz::time
  // ----------------------------------------------------------

  const time: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const dt = extractDatetime(args['dt'] as RillValue, runCtx);
    if (!dt.ok) return dt.invalid;
    const zoneArg = extractString(args['zone'] as RillValue, runCtx);
    if (!zoneArg.ok) return zoneArg.invalid;
    const zInv = validateZone(zoneArg.value, runCtx);
    if (zInv) return zInv;

    const { hours, minutes, seconds } = getLocalComponents(
      dt.value,
      zoneArg.value
    );
    const pad2 = (n: number): string => String(n).padStart(2, '0');
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  };

  // ----------------------------------------------------------
  // tz::offset
  // ----------------------------------------------------------

  const offset: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const zoneArg = extractString(args['zone'] as RillValue, runCtx);
    if (!zoneArg.ok) return zoneArg.invalid;
    const zInv = validateZone(zoneArg.value, runCtx);
    if (zInv) return zInv;

    const dtArg = args['dt'];
    let epochMs: number;
    if (dtArg === undefined || dtArg === null) {
      epochMs = Date.now();
    } else {
      const dt = extractDatetime(dtArg, runCtx);
      if (!dt.ok) return dt.invalid;
      epochMs = dt.value;
    }

    const offsetMin = getOffsetMinutes(epochMs, zoneArg.value);
    return offsetMin / 60;
  };

  // ----------------------------------------------------------
  // tz::zones
  // ----------------------------------------------------------

  const zones: CallableFn = async (_args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    return Array.from(validZones) as unknown as RillValue;
  };

  // ----------------------------------------------------------
  // time::format
  // ----------------------------------------------------------

  const format: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const dt = extractDatetime(args['dt'] as RillValue, runCtx);
    if (!dt.ok) return dt.invalid;
    const patternArg = extractString(args['pattern'] as RillValue, runCtx);
    if (!patternArg.ok) return patternArg.invalid;
    const pInv = validatePattern(patternArg.value, runCtx);
    if (pInv) return pInv;

    const d = new Date(dt.value);
    return applyFormat(d, patternArg.value);
  };

  // ----------------------------------------------------------
  // time::parse
  // ----------------------------------------------------------

  const parse: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    const dInv = checkDisposed(runCtx);
    if (dInv) return dInv;
    const strArg = extractString(args['str'] as RillValue, runCtx);
    if (!strArg.ok) return strArg.invalid;
    const patternArg = extractString(args['pattern'] as RillValue, runCtx);
    if (!patternArg.ok) return patternArg.invalid;
    const pInv = validatePattern(patternArg.value, runCtx);
    if (pInv) return pInv;

    const result = parseWithPattern(strArg.value, patternArg.value, runCtx);
    if (!result.ok) return result.invalid;
    return result.value;
  };

  // ----------------------------------------------------------
  // Reusable datetime RillParam literal
  // (p.str() sets kind: 'string'; datetime needs kind: 'datetime')
  // ----------------------------------------------------------

  const dtParam: RillParam = {
    name: 'dt',
    type: { kind: 'datetime' } as { kind: string },
    defaultValue: undefined,
    annotations: { description: 'UTC datetime value' },
  };

  // Optional dt for tz::offset: callers may omit it.
  // When undefined, the function falls back to Date.now().
  const dtOptionalParam: RillParam = {
    name: 'dt',
    type: { kind: 'datetime' } as { kind: string },
    defaultValue: undefined,
    annotations: { description: 'Instant for offset lookup; defaults to now' },
  };

  // ----------------------------------------------------------
  // RillFunction definitions
  // ----------------------------------------------------------

  const fnDict: Record<string, RillFunction> = {
    iso: {
      params: [dtParam, p.str('zone', 'IANA timezone name')],
      fn: iso,
      annotations: {
        description:
          'Convert UTC datetime to offset ISO 8601 string in named zone',
      },
      returnType: stringReturn,
    },
    date: {
      params: [dtParam, p.str('zone', 'IANA timezone name')],
      fn: date,
      annotations: {
        description: 'Convert UTC datetime to YYYY-MM-DD string in named zone',
      },
      returnType: stringReturn,
    },
    time: {
      params: [dtParam, p.str('zone', 'IANA timezone name')],
      fn: time,
      annotations: {
        description: 'Convert UTC datetime to HH:mm:ss string in named zone',
      },
      returnType: stringReturn,
    },
    offset: {
      params: [p.str('zone', 'IANA timezone name'), dtOptionalParam],
      fn: offset,
      annotations: {
        description: 'Get UTC offset in decimal hours for named zone',
      },
      returnType: numberReturn,
    },
    zones: {
      params: [],
      fn: zones,
      annotations: { description: 'List all valid IANA timezone names' },
      returnType: stringListReturn,
    },
    format: {
      params: [
        dtParam,
        p.str(
          'pattern',
          'Format pattern using tokens: YYYY MM DD HH mm ss SSS'
        ),
      ],
      fn: format,
      annotations: { description: 'Format UTC datetime using pattern tokens' },
      returnType: stringReturn,
    },
    parse: {
      params: [
        p.str('str', 'Input date string'),
        p.str('pattern', 'Parse pattern using tokens: YYYY MM DD HH mm ss SSS'),
      ],
      fn: parse,
      annotations: {
        description: 'Parse string using pattern and return UTC datetime',
      },
      returnType: datetimeReturn,
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
    dispose: async (): Promise<void> => {
      disposed = true;
    },
  } satisfies ExtensionFactoryResult;
}
