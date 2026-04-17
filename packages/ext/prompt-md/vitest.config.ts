import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Resolve LLM extension package names to their source files for integration
// tests. This avoids declaring cross-extension devDependencies (§EXT.2.1 /
// AC-20) while still importing via package names (not relative source paths).
const repoRoot = path.resolve(import.meta.dirname, '../../..');

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-ext-anthropic': path.join(repoRoot, 'packages/ext/llm-anthropic/src/index.ts'),
      '@rcrsr/rill-ext-openai': path.join(repoRoot, 'packages/ext/llm-openai/src/index.ts'),
      '@rcrsr/rill-ext-gemini': path.join(repoRoot, 'packages/ext/llm-gemini/src/index.ts'),
    },
  },
  test: {
    globals: false,
  },
});
