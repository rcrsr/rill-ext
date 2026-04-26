#!/usr/bin/env -S pnpm exec tsx
/**
 * Gmail Triage Example for @rcrsr/rill-ext-google-workspace
 *
 * Demonstrates a search → read → label workflow using Gmail callables.
 * The script searches the inbox, reads the first result, and applies a label.
 * Capabilities used: gmail.search (default-true), gmail.read (default-true),
 * gmail.label (default-true).
 *
 * Usage:
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/gmail-triage.ts
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/gmail-triage.ts -e 'gw::gmail_search("is:unread") -> log'
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/gmail-triage.ts script.rill
 *
 * Environment:
 *   GOOGLE_TOKEN    OAuth2 bearer token with gmail.readonly and gmail.labels scope (required)
 *   GMAIL_QUERY     Gmail search query (default: "in:inbox is:unread")
 *   GMAIL_LABEL     Label name to apply to the first result (default: "Processed")
 */

import { readFile } from 'node:fs/promises';
import { parse, execute, createRuntimeContext, extResolver } from '@rcrsr/rill';
import { createGoogleWorkspaceExtension } from '../src/index.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_QUERY = 'in:inbox is:unread';
const DEFAULT_LABEL = 'Processed';

// ============================================================
// DEMO SCRIPT
// ============================================================

function buildDemoScript(query: string, label: string): string {
  // Escape single quotes in the injected values.
  const safeQuery = query.replace(/'/g, "\\'");
  const safeLabel = label.replace(/'/g, "\\'");
  return `\
gw::gmail_search('${safeQuery}', { maxResults: 1 }) => $results
$results.messages -> log("Found messages: {$results.messages}")
$results.messages[0].id => $messageId
gw::gmail_read($messageId) => $msg
$msg.subject -> log("Subject: {$msg.subject}")
gw::gmail_label($messageId, '${safeLabel}') => $labeled
$labeled -> log("Label applied: {$labeled}")`;
}

// ============================================================
// HELPERS
// ============================================================

async function resolveScript(
  argv: string[],
  query: string,
  label: string
): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Gmail Triage Example for @rcrsr/rill-ext-google-workspace

Usage:
  gmail-triage.ts                  Run built-in demo script
  gmail-triage.ts --help           Show this help message
  gmail-triage.ts -e '<expr>'      Run inline expression
  gmail-triage.ts <file>           Run script from file

Environment:
  GOOGLE_TOKEN    Bearer token with gmail.readonly + gmail.labels scope (required)
  GMAIL_QUERY     Gmail search query (default: "${DEFAULT_QUERY}")
  GMAIL_LABEL     Label to apply (default: "${DEFAULT_LABEL}")
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

  return buildDemoScript(query, label);
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

  const query = process.env['GMAIL_QUERY'] ?? DEFAULT_QUERY;
  const label = process.env['GMAIL_LABEL'] ?? DEFAULT_LABEL;

  const source = await resolveScript(process.argv.slice(2), query, label);

  // gmail.search, gmail.read, and gmail.label are all default-true.
  // No explicit capability overrides are needed for this workflow.
  const ext = createGoogleWorkspaceExtension({
    auth: { type: 'bearer', token },
  });

  // Wire extension via extResolver: the config for scheme "gw" is the callable
  // dict (ext.value). When the script calls gw::gmail_search(...), extResolver
  // looks up "gmail_search" in the dict and returns the callable.
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
  console.error(`[gmail-triage] Running: ${preview.replace(/\n/g, ' ')}`);

  try {
    const ast = parse(source);
    const startTime = Date.now();
    const result = await execute(ast, ctx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[gmail-triage] Done in ${elapsed}s`);
    console.error(
      `[gmail-triage] Result: ${JSON.stringify(result.result, null, 2)}`
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
