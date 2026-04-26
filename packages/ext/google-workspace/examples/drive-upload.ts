#!/usr/bin/env -S pnpm exec tsx
/**
 * Drive Upload Example for @rcrsr/rill-ext-google-workspace
 *
 * Demonstrates file upload with capability gating and maxUploadBytes enforcement.
 * drive.upload is default-false and must be opted in via capabilities.
 * A maxUploadBytes limit is configured to demonstrate the EC-9 guard.
 *
 * The content argument to drive_upload must be a base64-encoded string.
 * The example uploads a small plain-text file.
 *
 * Usage:
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/drive-upload.ts
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/drive-upload.ts -e 'gw::drive_list("root") -> log'
 *   GOOGLE_TOKEN=ya29.xxx pnpm exec tsx examples/drive-upload.ts script.rill
 *
 * Environment:
 *   GOOGLE_TOKEN        OAuth2 bearer token with drive.file scope (required)
 *   DRIVE_FOLDER_ID     Target folder ID in Google Drive (default: empty — uploads to root)
 *   DRIVE_MAX_BYTES     Maximum upload size in bytes (default: 1048576 = 1 MiB)
 */

import { readFile } from 'node:fs/promises';
import { parse, execute, createRuntimeContext, extResolver } from '@rcrsr/rill';
import { createGoogleWorkspaceExtension } from '../src/index.js';

// ============================================================
// CONSTANTS
// ============================================================

// 1 MiB — a practical limit for demonstrating the EC-9 guard.
const DEFAULT_MAX_BYTES = 1_048_576;

// Small plain-text payload encoded as base64.
// Content: "Hello from rill drive-upload example!\n"
const SAMPLE_CONTENT_B64 = Buffer.from(
  'Hello from rill drive-upload example!\n',
  'utf-8'
).toString('base64');

const SAMPLE_FILENAME = 'rill-example.txt';

// ============================================================
// DEMO SCRIPT
// ============================================================

function buildDemoScript(folderId: string): string {
  const folderArg = folderId ? `'${folderId}'` : "''";
  return `\
gw::drive_upload(
  '${SAMPLE_CONTENT_B64}',
  '${SAMPLE_FILENAME}',
  ${folderArg},
  { mimeType: 'text/plain' }
) => $file
$file.name -> log("Uploaded: {$file.name}")
$file.id -> log("File ID: {$file.id}")
$file.size -> log("Size: {$file.size} bytes")`;
}

// ============================================================
// HELPERS
// ============================================================

async function resolveScript(
  argv: string[],
  folderId: string
): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Drive Upload Example for @rcrsr/rill-ext-google-workspace

Usage:
  drive-upload.ts                  Run built-in demo script
  drive-upload.ts --help           Show this help message
  drive-upload.ts -e '<expr>'      Run inline expression
  drive-upload.ts <file>           Run script from file

Environment:
  GOOGLE_TOKEN        Bearer token with drive.file scope (required)
  DRIVE_FOLDER_ID     Target folder ID (default: empty = root)
  DRIVE_MAX_BYTES     Max upload size in bytes (default: ${DEFAULT_MAX_BYTES})
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

  return buildDemoScript(folderId);
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

  const folderId = process.env['DRIVE_FOLDER_ID'] ?? '';
  const maxBytesRaw = process.env['DRIVE_MAX_BYTES'];
  const maxUploadBytes =
    maxBytesRaw !== undefined ? parseInt(maxBytesRaw, 10) : DEFAULT_MAX_BYTES;

  const source = await resolveScript(process.argv.slice(2), folderId);

  // drive.upload is default-false — opt in explicitly to demonstrate AC-4.
  // drive.maxUploadBytes demonstrates the EC-9 size guard.
  const ext = createGoogleWorkspaceExtension({
    auth: { type: 'bearer', token },
    capabilities: {
      drive: { upload: true },
    },
    drive: {
      maxUploadBytes,
    },
  });

  console.error(`[drive-upload] Max upload bytes: ${maxUploadBytes}`);

  // Wire extension via extResolver: the config for scheme "gw" is the callable
  // dict (ext.value). When the script calls gw::drive_upload(...), extResolver
  // looks up "drive_upload" in the dict and returns the callable.
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
  console.error(`[drive-upload] Running: ${preview.replace(/\n/g, ' ')}`);

  try {
    const ast = parse(source);
    const startTime = Date.now();
    const result = await execute(ast, ctx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[drive-upload] Done in ${elapsed}s`);
    console.error(
      `[drive-upload] Result: ${JSON.stringify(result.result, null, 2)}`
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
