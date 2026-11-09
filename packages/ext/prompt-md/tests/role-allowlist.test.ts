/**
 * Role-allowlist tests for the prompt-md extension.
 *
 * Covers:
 *   AC-8   — @@ assistant marker parses to {role:'assistant', content:...}
 *   AC-E10 — @@ tool marker rejects with RILL-R001 (message details covered in
 *            the shared splitRoleMessages tests)
 *   AC-B9  — duplicate @@ user/@@ user markers produce 2 entries (splitter preserved)
 *
 * Invalid role markers pass parseFile (body has @@ markers → output inferred as
 * 'list') and fail at call time in buildClosure when splitRoleMessages runs.
 * The RuntimeError is re-thrown unchanged by the catch in buildClosure.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuntimeError, type ApplicationCallable } from '@rcrsr/rill';
import { createPromptMdExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_helpers.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rill-prompt-md-role-test-'));
}

async function writePrompt(
  dir: string,
  relPath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(dir, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

function asDict(value: unknown): Record<string, ApplicationCallable> {
  return value as Record<string, ApplicationCallable>;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) =>
        fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      )
  );
});

async function tempDir(): Promise<string> {
  const dir = await makeTempDir();
  tempDirs.push(dir);
  return dir;
}

// ── AC-8: @@ assistant marker ────────────────────────────────────────────────

describe('AC-8: @@ assistant marker parses to assistant role entry', () => {
  it('returns a list with user and assistant entries in declaration order', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'chat.prompt.md',
      `---
description: Chat prompt
params: []
---
@@ user
Hello!
@@ assistant
Hi there, how can I help?
`
    );

    const ext = await createPromptMdExtension(
      { basePath: dir },
      makeFactoryCtx()
    );
    const dict = asDict(ext.value);
    const result = await dict['chat']!.fn({}, {} as never);

    expect(Array.isArray(result)).toBe(true);
    const messages = result as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);

    // Content may include a trailing newline depending on body formatting.
    expect(messages[0]!['role']).toBe('user');
    expect((messages[0]!['content'] as string).trim()).toBe('Hello!');
    expect(messages[1]!['role']).toBe('assistant');
    expect((messages[1]!['content'] as string).trim()).toBe(
      'Hi there, how can I help?'
    );
  });
});

// ── Role-allowlist rejection propagates from splitRoleMessages ─────────────────

describe('invalid @@ role markers reject at call time', () => {
  it('throws RuntimeError with errorId RILL-R001 when body contains an invalid @@ tool role', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'bad-tool.prompt.md',
      `---
description: Bad role prompt
params: []
---
@@ tool
some tool output
`
    );

    const ext = await createPromptMdExtension(
      { basePath: dir },
      makeFactoryCtx()
    );
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['bad_tool']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
  });
});

// ── AC-B9: duplicate @@ user markers produce 2 entries ───────────────────────

describe('AC-B9: duplicate @@ user markers produce 2 separate entries', () => {
  it('produces exactly 2 user entries with distinct content for two consecutive @@ user markers', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'double-user.prompt.md',
      `---
description: Double user prompt
params: []
---
@@ user
first message
@@ user
second message
`
    );

    const ext = await createPromptMdExtension(
      { basePath: dir },
      makeFactoryCtx()
    );
    const dict = asDict(ext.value);
    const result = await dict['double_user']!.fn({}, {} as never);

    expect(Array.isArray(result)).toBe(true);
    const messages = result as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!['role']).toBe('user');
    expect(messages[1]!['role']).toBe('user');
    // Content may include a trailing newline depending on body formatting.
    expect((messages[0]!['content'] as string).trim()).toBe('first message');
    expect((messages[1]!['content'] as string).trim()).toBe('second message');
  });
});
