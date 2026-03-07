import { describe, it, expect } from 'vitest';

describe('Package Scaffold', () => {
  describe('package.json', () => {
    it('exports package metadata correctly', async () => {
      const pkg = await import('../package.json', { with: { type: 'json' } });
      expect(pkg.default.name).toBe('@rcrsr/rill-ext-pinecone');
      expect(pkg.default.type).toBe('module');
      expect(pkg.default.dependencies).toHaveProperty(
        '@pinecone-database/pinecone'
      );
      expect(pkg.default.peerDependencies).toHaveProperty('@rcrsr/rill');
      expect(pkg.default.devDependencies).toHaveProperty('@rcrsr/rill');
    });
  });

});
