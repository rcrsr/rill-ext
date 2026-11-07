import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the shared kv contract suite to its source file. The suite is test
// code and ships in no package, so it is aliased rather than declared as a
// dependency.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-ext-kv-shared/contract-suite': path.join(
        repoRoot,
        'packages/shared/ext-kv/tests/contract-suite.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
