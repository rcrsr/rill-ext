/**
 * Factory tests for the prompt-md extension.
 *
 * Covers config validation (EC-6, EC-7), parse-time errors (EC-8 through
 * EC-14), collision detection (EC-15), and the package.json dependency graph
 * check (AC-20).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RuntimeError } from '@rcrsr/rill';
import { createPromptMdExtension } from '../src/factory.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rill-prompt-md-test-'));
}

async function writePrompt(dir: string, relPath: string, content: string): Promise<void> {
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

// ── Config validation ────────────────────────────────────────────────────────

describe('EC-6: empty/whitespace basePath', () => {
  it('throws RILL-R004 for empty string basePath', async () => {
    await expect(createPromptMdExtension({ basePath: '' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R004',
    );
  });

  it('throws RILL-R004 for whitespace-only basePath', async () => {
    await expect(createPromptMdExtension({ basePath: '   ' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RuntimeError && err.errorId === 'RILL-R004',
    );
  });
});

describe('EC-7: non-existing path and file-as-basePath', () => {
  it('throws RILL-R004 when basePath does not exist', async () => {
    await expect(
      createPromptMdExtension({ basePath: '/tmp/rill-nonexistent-12345678' }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof RuntimeError && err.errorId === 'RILL-R004',
    );
  });

  it('throws RILL-R004 when basePath is a file, not a directory', async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, 'file.txt');
    await fs.writeFile(filePath, 'content', 'utf-8');
    await expect(createPromptMdExtension({ basePath: filePath })).rejects.toSatisfy(
      (err: unknown) => err instanceof RuntimeError && err.errorId === 'RILL-R004',
    );
  });
});

// ── Parse-time errors ────────────────────────────────────────────────────────

describe('AC-7 / EC-8: unclosed YAML quote', () => {
  it('throws RILL-R004 with path in context', async () => {
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
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['cause']).toBeTruthy();
  });
});

describe('AC-8 / EC-13: undeclared template reference', () => {
  it('throws RILL-R004 with path, line, and missing name in context', async () => {
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
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['name']).toBe('undeclared');
    expect(typeof re.context?.['line']).toBe('number');
  });
});

describe('AC-9 / EC-15: resolution name collision', () => {
  it('throws RILL-R004 when two files resolve to the same dotted name', async () => {
    // a.b.prompt.md → resolution name 'a.b'
    // a/b.prompt.md  → resolution name 'a.b'
    // Both yield the same dotted name from different FS paths.
    const dir = await tempDir();
    await writePrompt(dir, 'a.b.prompt.md', VALID_PROMPT);
    await writePrompt(dir, 'a/b.prompt.md', VALID_PROMPT);

    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    // Context must contain both paths
    const paths = re.context?.['paths'] as string[] | undefined;
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toHaveLength(2);
  });
});

describe('AC-10 / EC-9: missing required fields', () => {
  it('throws RILL-R004 for missing output field', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'missing-output.prompt.md',
      `---
description: Test
params: []
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['field']).toBe('output');
  });

  it('throws RILL-R004 for missing description field', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'missing-desc.prompt.md',
      `---
params: []
output: string
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['field']).toBe('description');
  });

  it('throws RILL-R004 for missing params field', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'missing-params.prompt.md',
      `---
description: Test
output: string
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['field']).toBe('params');
  });
});

describe('AC-11 / EC-10: output: dict reserved', () => {
  it('throws RILL-R004 with field and value in context', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'dict-output.prompt.md',
      `---
description: Test
params: []
output: dict
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['field']).toBe('output');
    expect(re.context?.['value']).toBe('dict');
  });
});

describe('EC-11: unrecognized output value', () => {
  it('throws RILL-R004 for output: json', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'unknown-output.prompt.md',
      `---
description: Test
params: []
output: json
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['value']).toBe('json');
  });
});

describe('AC-12 / EC-12: malformed params entry', () => {
  it('throws RILL-R004 with path and entry in context for "tone = neutral"', async () => {
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
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
    expect(re.context?.['path']).toBeTruthy();
    expect(re.context?.['entry']).toBe('tone = neutral');
  });
});

describe('EC-14: output:list with no @@ marker', () => {
  it('throws RILL-R004 when output is list but body has no role markers', async () => {
    const dir = await tempDir();
    await writePrompt(
      dir,
      'list-no-marker.prompt.md',
      `---
description: Test
params: []
output: list
---
No role markers here.
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
  });
});

describe('AC-13: single malformed file among valid ones surfaces error', () => {
  it('does not silently skip invalid file — throws RILL-R004', async () => {
    const dir = await tempDir();
    // One valid file
    await writePrompt(dir, 'valid.prompt.md', VALID_PROMPT);
    // One broken file (missing output)
    await writePrompt(
      dir,
      'broken.prompt.md',
      `---
description: Broken prompt
params: []
---
body
`,
    );
    let caught: unknown;
    try {
      await createPromptMdExtension({ basePath: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const re = caught as RuntimeError;
    expect(re.errorId).toBe('RILL-R004');
  });
});

// ── AC-20: dependency graph check ────────────────────────────────────────────

describe('AC-20: package.json has no cross-extension dependencies', () => {
  it('does not reference any packages/ext/* sibling in dependencies', async () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];

    // No dependency should point at packages/ext/* siblings.
    // The convention is that packages/ext/* packages are named @rcrsr/rill-ext-*
    // but do NOT include the shared packages (@rcrsr/rill-ext-*-shared).
    // Shared packages are allowed; other extension packages are not.
    const extSiblings = allDeps.filter(
      (dep) =>
        dep.startsWith('@rcrsr/rill-ext-') &&
        !dep.endsWith('-shared') &&
        dep !== '@rcrsr/rill-ext-prompt-md',
    );

    expect(extSiblings).toHaveLength(0);
  });
});
