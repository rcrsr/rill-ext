import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  noExternal: ['@rcrsr/rill-ext-prompt-shared', '@rcrsr/rill-ext-param-shared', 'yaml'],
  banner: {
    js: "import { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);",
  },
});
