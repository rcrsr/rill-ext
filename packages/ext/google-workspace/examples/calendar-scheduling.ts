#!/usr/bin/env -S pnpm exec tsx
/**
 * Calendar Scheduling Example for @rcrsr/rill-ext-google-workspace
 *
 * Demonstrates a free/busy query followed by event creation.
 * calendar_free_busy is default-true; calendar_create_event is default-false
 * and must be opted in via capabilities.
 *
 * All timestamps must include a timezone offset (e.g. "Z" or "+02:00").
 * Naive ISO 8601 strings without a timezone are rejected with RILL-R004 (EC-13).
 *
 * Usage:
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/calendar-scheduling.ts
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/calendar-scheduling.ts -e '...'
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/calendar-scheduling.ts script.rill
 *
 * Environment:
 *   GOOGLE_TOKEN       OAuth2 bearer token with calendar scope (required)
 *   CAL_ATTENDEES      Comma-separated email list for free/busy check
 *                        (default: "alice@example.com,bob@example.com")
 *   CAL_START          ISO 8601 start time with timezone (default: tomorrow 09:00 UTC)
 *   CAL_END            ISO 8601 end time with timezone (default: tomorrow 10:00 UTC)
 *   CAL_TITLE          Event title (default: "Team Sync")
 */

import { readFile } from 'node:fs/promises';
import { parse, execute, createRuntimeContext, extResolver } from '@rcrsr/rill';
import { createGoogleWorkspaceExtension } from '../src/index.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_ATTENDEES = 'alice@example.com,bob@example.com';
const DEFAULT_TITLE = 'Team Sync';

// ============================================================
// HELPERS
// ============================================================

/** Return ISO 8601 UTC timestamps for tomorrow at 09:00 and 10:00. */
function tomorrowSlot(): { start: string; end: string } {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(now.getUTCDate() + 1);
  startDate.setUTCHours(9, 0, 0, 0);
  const start = startDate.toISOString(); // e.g. "2026-04-27T09:00:00.000Z"

  const endDate = new Date(startDate);
  endDate.setUTCHours(10, 0, 0, 0);
  const end = endDate.toISOString();

  return { start, end };
}

// ============================================================
// DEMO SCRIPT
// ============================================================

function buildDemoScript(
  attendees: string[],
  start: string,
  end: string,
  title: string
): string {
  // Build a rill list literal for the attendee array.
  const emailList = attendees.map((e) => `'${e}'`).join(', ');
  const safeTitle = title.replace(/'/g, "\\'");

  return `\
gw::calendar_free_busy([${emailList}], '${start}', '${end}') => $busy
$busy -> log("Free/busy result: {$busy}")
gw::calendar_create_event('${safeTitle}', '${start}', '${end}', {
  attendees: [${emailList}],
  sendUpdates: 'all'
}) => $eventId
$eventId -> log("Created event ID: {$eventId}")`;
}

async function resolveScript(
  argv: string[],
  attendees: string[],
  start: string,
  end: string,
  title: string
): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Calendar Scheduling Example for @rcrsr/rill-ext-google-workspace

Usage:
  calendar-scheduling.ts                  Run built-in demo script
  calendar-scheduling.ts --help           Show this help message
  calendar-scheduling.ts -e '<expr>'      Run inline expression
  calendar-scheduling.ts <file>           Run script from file

Environment:
  GOOGLE_TOKEN       Bearer token with calendar scope (required)
  CAL_ATTENDEES      Comma-separated emails (default: "${DEFAULT_ATTENDEES}")
  CAL_START          ISO 8601 start with timezone (default: tomorrow 09:00Z)
  CAL_END            ISO 8601 end with timezone (default: tomorrow 10:00Z)
  CAL_TITLE          Event title (default: "${DEFAULT_TITLE}")
`);
    process.exit(0);
  }

  const eIndex = argv.indexOf('-e');
  if (eIndex !== -1 && eIndex + 1 < argv.length) {
    return argv[eIndex + 1] as string;
  }

  if (argv.length > 0 && !argv[0]!.startsWith('-')) {
    const filePath = argv[0]!;
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to read file: ${message}`);
      process.exit(1);
    }
  }

  return buildDemoScript(attendees, start, end, title);
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  const token = process.env['GOOGLE_TOKEN'];
  if (!token) {
    console.error('Error: GOOGLE_TOKEN environment variable is required');
    process.exit(1);
  }

  const attendeesRaw = process.env['CAL_ATTENDEES'] ?? DEFAULT_ATTENDEES;
  const attendees = attendeesRaw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const { start: defaultStart, end: defaultEnd } = tomorrowSlot();
  const start = process.env['CAL_START'] ?? defaultStart;
  const end = process.env['CAL_END'] ?? defaultEnd;
  const title = process.env['CAL_TITLE'] ?? DEFAULT_TITLE;

  const source = await resolveScript(
    process.argv.slice(2),
    attendees,
    start,
    end,
    title
  );

  // calendar.freeBusy is default-true; calendar.create is default-false — opt in.
  const ext = createGoogleWorkspaceExtension({
    auth: { type: 'bearer', token },
    capabilities: {
      calendar: { create: true },
    },
  });

  console.error(`[calendar-scheduling] Attendees: ${attendees.join(', ')}`);
  console.error(`[calendar-scheduling] Slot: ${start} — ${end}`);

  // Wire extension via extResolver: the config for scheme "gw" is the callable
  // dict (ext.value). When the script calls gw::calendar_free_busy(...), extResolver
  // looks up "calendar_free_busy" in the dict and returns the callable.
  const ctx = createRuntimeContext({
    resolvers: { gw: extResolver },
    configurations: { resolvers: { gw: ext.value } },
    callbacks: {
      onLog: (msg) => console.log(msg),
      onLogEvent: (event) =>
        console.error(
          `[event] ${event.event} (${String(event['duration'])}ms)`
        ),
    },
  });

  const preview = source.length > 80 ? source.slice(0, 80) + '...' : source;
  console.error(
    `[calendar-scheduling] Running: ${preview.replace(/\n/g, ' ')}`
  );

  try {
    const ast = parse(source);
    const startTime = Date.now();
    const result = await execute(ast, ctx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[calendar-scheduling] Done in ${elapsed}s`);
    console.error(
      `[calendar-scheduling] Result: ${JSON.stringify(result.result, null, 2)}`
    );
  } finally {
    await ext.dispose?.();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Error: ${message}`);
  process.exit(1);
});
