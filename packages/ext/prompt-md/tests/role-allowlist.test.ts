/**
 * Role-allowlist tests for the prompt-md extension.
 *
 * Covers:
 *   AC-8   — @@ assistant marker parses to {role:'assistant', content:...}
 *   AC-E10 — @@ tool marker rejects with RILL-R001 naming 'tool' and line number
 *   AC-E11 — @@ model marker rejects with RILL-R001 naming 'model' and line number
 *   AC-E12 — @@ foo marker rejects with role-allowlist error
 *   AC-B9  — duplicate @@ user/@@ user markers produce 2 entries (splitter preserved)
 *   EC-23  — covered transitively by AC-E10/E11/E12
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

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rill-prompt-md-role-test-'));
}

async function writePrompt(dir: string, relPath: string, content: string): Promise<void> {
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
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }).catch(() => undefined),
    ),
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
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);
    const result = await dict['chat']!.fn({}, {} as never);

    expect(Array.isArray(result)).toBe(true);
    const messages = result as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);

    // Content may include a trailing newline depending on body formatting.
    expect(messages[0]!['role']).toBe('user');
    expect((messages[0]!['content'] as string).trim()).toBe('Hello!');
    expect(messages[1]!['role']).toBe('assistant');
    expect((messages[1]!['content'] as string).trim()).toBe('Hi there, how can I help?');
  });

  it('assistant entry has role string equal to "assistant"', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'reply.prompt.md',
      `---
description: Reply prompt
params: []
---
@@ system
Be helpful.
@@ user
Question?
@@ assistant
Answer.
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);
    const result = await dict['reply']!.fn({}, {} as never);

    const messages = result as Array<Record<string, unknown>>;
    const assistantEntry = messages.find((m) => m['role'] === 'assistant');
    expect(assistantEntry).toBeDefined();
    expect(assistantEntry!['role']).toBe('assistant');
    expect(typeof assistantEntry!['content']).toBe('string');
    // Content may include a trailing newline depending on body formatting.
    expect((assistantEntry!['content'] as string).trim()).toBe('Answer.');
  });
});

// ── AC-E10: @@ tool marker rejected ──────────────────────────────────────────

describe('AC-E10: @@ tool marker rejects with RILL-R001 naming role and line number', () => {
  it('throws RuntimeError with errorId RILL-R001 when body contains @@ tool', async () => {
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
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
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

  it('error message contains the role name "tool"', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'tool-role.prompt.md',
      `---
description: Tool role prompt
params: []
---
@@ tool
output
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['tool_role']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toContain('tool');
  });

  it('error message contains a line number when @@ tool is on line 1 of the body', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'tool-line.prompt.md',
      `---
description: Tool line prompt
params: []
---
@@ tool
output
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['tool_line']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    // The message contains a 1-based line number (e.g. "at line 1")
    expect((caught as RuntimeError).message).toMatch(/line \d+/);
  });
});

// ── AC-E11: @@ model marker rejected ─────────────────────────────────────────

describe('AC-E11: @@ model marker rejects with RILL-R001 naming role and line number', () => {
  it('throws RuntimeError with errorId RILL-R001 when body contains @@ model', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'bad-model.prompt.md',
      `---
description: Bad model role prompt
params: []
---
@@ model
some model name
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['bad_model']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
  });

  it('error message contains the role name "model"', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'model-role.prompt.md',
      `---
description: Model role prompt
params: []
---
@@ model
content
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['model_role']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toContain('model');
  });

  it('error message contains a line number for @@ model on line 3 of the body', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'model-line3.prompt.md',
      `---
description: Model on line 3
params: []
---
@@ user
preamble
@@ model
content
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['model_line3']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    // @@ model is the 3rd line of the body (line 3 in the interpolated string)
    expect(re.message).toContain('line 3');
  });
});

// ── AC-E12: @@ foo marker rejected ───────────────────────────────────────────

describe('AC-E12: @@ foo marker rejects with role-allowlist error', () => {
  it('throws RuntimeError with errorId RILL-R001 when body contains @@ foo', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'bad-foo.prompt.md',
      `---
description: Bad foo role prompt
params: []
---
@@ foo
some content
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['bad_foo']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
  });

  it('error message references the role allowlist (valid roles: system, user, assistant)', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'foo-allowlist.prompt.md',
      `---
description: Foo allowlist prompt
params: []
---
@@ foo
content
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['foo_allowlist']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    // EC-23: message includes valid roles list
    expect(re.message).toContain('Valid roles are: system, user, assistant.');
  });

  it('error message contains the offending role name "foo"', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'foo-name.prompt.md',
      `---
description: Foo name prompt
params: []
---
@@ foo
content
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);

    let caught: unknown;
    try {
      await dict['foo_name']!.fn({}, {} as never);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toContain('foo');
  });
});

// ── AC-B9: duplicate @@ user markers produce 2 entries ───────────────────────

describe('AC-B9: duplicate @@ user markers produce 2 separate entries', () => {
  it('two consecutive @@ user markers produce exactly 2 user entries', async () => {
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
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);
    const result = await dict['double_user']!.fn({}, {} as never);

    expect(Array.isArray(result)).toBe(true);
    const messages = result as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!['role']).toBe('user');
    expect(messages[1]!['role']).toBe('user');
  });

  it('each entry has distinct content', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'double-user-content.prompt.md',
      `---
description: Double user content prompt
params: []
---
@@ user
first message
@@ user
second message
`,
    );

    const ext = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const dict = asDict(ext.value);
    const result = await dict['double_user_content']!.fn({}, {} as never);

    const messages = result as Array<Record<string, unknown>>;
    // Content may include a trailing newline depending on body formatting.
    expect((messages[0]!['content'] as string).trim()).toBe('first message');
    expect((messages[1]!['content'] as string).trim()).toBe('second message');
  });
});
