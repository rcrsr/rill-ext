/**
 * Factory tests for the prompt-md extension.
 *
 * Covers config validation, parse-time errors, and resolution name
 * collision detection.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuntimeError } from '@rcrsr/rill';
import { createPromptMdExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_helpers.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rill-prompt-md-test-'));
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

const VALID_PROMPT = `---
description: A simple prompt
params:
  - "name: string"
output: string
---
Hello {name}!
`;

// ── Cleanup ──────────────────────────────────────────────────────────────────

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

// ── Config validation ────────────────────────────────────────────────────────

describe('EC-6: empty/whitespace basePath', () => {
  it('throws RILL-R001 for empty string basePath', async () => {
    await expect(
      createPromptMdExtension({ basePath: '' }, makeFactoryCtx())
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R001'
    );
  });

  it('throws RILL-R001 for whitespace-only basePath', async () => {
    await expect(
      createPromptMdExtension({ basePath: '   ' }, makeFactoryCtx())
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R001'
    );
  });
});

describe('EC-7: non-existing path and file-as-basePath', () => {
  it('throws RILL-R001 when basePath does not exist', async () => {
    await expect(
      createPromptMdExtension(
        { basePath: '/tmp/rill-nonexistent-12345678' },
        makeFactoryCtx()
      )
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R001'
    );
  });

  it('throws RILL-R001 when basePath is a file, not a directory', async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, 'file.txt');
    await fs.writeFile(filePath, 'content', 'utf-8');
    await expect(
      createPromptMdExtension({ basePath: filePath }, makeFactoryCtx())
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R001'
    );
  });
});

// ── Parse-time errors ────────────────────────────────────────────────────────

describe('AC-7 / EC-8: unclosed YAML quote', () => {
  it('throws RILL-R001 with path in context', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'broken.prompt.md',
      `---
description: "unclosed quote
params: []
output: string
---
body
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['cause']).toBeTruthy();
  });
});

describe('AC-8 / EC-13: undeclared template reference', () => {
  it('throws RILL-R001 with path, line, and missing name in context', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'undeclared.prompt.md',
      `---
description: Test prompt
params: []
output: string
---
Hello {undeclared}!
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['name']).toBe('undeclared');
    expect(typeof re.context?.['line']).toBe('number');
  });
});

describe('AC-9 / EC-15: resolution name collision', () => {
  it('throws RILL-R001 when two files resolve to the same dotted name', async () => {
    // a.b.prompt.md → resolution name 'a.b'
    // a/b.prompt.md  → resolution name 'a.b'
    // Both yield the same dotted name from different FS paths.
    const dir = await tempDir();
    await writePrompt(dir, 'a.b.prompt.md', VALID_PROMPT);
    await writePrompt(dir, 'a/b.prompt.md', VALID_PROMPT);

    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    // Context must contain both paths
    const paths = re.context?.['paths'] as string[] | undefined;
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toHaveLength(2);
  });
});

describe('AC-10 / EC-9: missing required fields', () => {
  it('throws RILL-R001 for missing description field', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'missing-desc.prompt.md',
      `---
params: []
output: string
---
body
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    expect(re.context?.['field']).toBe('description');
  });

  it('throws RILL-R001 for missing params field', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'missing-params.prompt.md',
      `---
description: Test
output: string
---
body
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    expect(re.context?.['field']).toBe('params');
  });
});

describe('output field is no longer parsed from frontmatter', () => {
  it.each([
    { value: 'dict', file: 'stale-output', key: 'stale_output' },
    { value: 'json', file: 'unknown-output', key: 'unknown_output' },
  ])(
    'ignores stale output: $value — body without @@ markers infers output: string',
    async ({ value, file, key }) => {
      const dir = await tempDir();
      await writePrompt(
        dir,
        `${file}.prompt.md`,
        `---
description: Test
params: []
output: ${value}
---
body
`
      );
      const ext = await createPromptMdExtension(
        { basePath: dir },
        makeFactoryCtx()
      );
      const dict = ext.value as Record<
        string,
        { annotations: Record<string, unknown> }
      >;
      expect(dict[key]!.annotations['^output']).toBe('string');
    }
  );
});

describe('AC-12 / EC-12: malformed params entry', () => {
  it('throws RILL-R001 with path and entry in context for "tone = neutral"', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'bad-param.prompt.md',
      `---
description: Test
params:
  - "tone = neutral"
output: string
---
body
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['entry']).toBe('tone = neutral');
  });
});

describe('output inference from body content', () => {
  it('body without @@ markers → output: string', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'plain.prompt.md',
      `---
description: Test
params: []
---
No role markers here.
`
    );
    const ext = await createPromptMdExtension(
      { basePath: dir },
      makeFactoryCtx()
    );
    const dict = ext.value as Record<
      string,
      { annotations: Record<string, unknown> }
    >;
    expect(dict['plain']!.annotations['^output']).toBe('string');
  });

  it('body with @@ markers → output: list', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'chat.prompt.md',
      `---
description: Test
params: []
---
@@ system
You are a helper.
@@ user
Hello.
`
    );
    const ext = await createPromptMdExtension(
      { basePath: dir },
      makeFactoryCtx()
    );
    const dict = ext.value as Record<
      string,
      { annotations: Record<string, unknown> }
    >;
    expect(dict['chat']!.annotations['^output']).toBe('list');
  });
});

describe('AC-13: single malformed file among valid ones surfaces error', () => {
  it('does not silently skip invalid file — throws RILL-R001', async () => {
    const dir = await tempDir();
    // One valid file
    await writePrompt(dir, 'valid.prompt.md', VALID_PROMPT);
    // One broken file (missing description)
    await writePrompt(
      dir,
      'broken.prompt.md',
      `---
params: []
---
body
`
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R001');
  });
});
