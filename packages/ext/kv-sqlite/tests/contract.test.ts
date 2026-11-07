import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import type { KvContractMount } from '@rcrsr/rill-ext-kv-shared';
import { describeKvContract } from '@rcrsr/rill-ext-kv-shared/contract-suite';
import { createSqliteKvExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_setup.js';

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'rill-kv-sqlite-contract-')
);
let counter = 0;

afterAll(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describeKvContract('kv-sqlite', {
  createExtension(mounts: Readonly<Record<string, KvContractMount>>) {
    const dir = path.join(rootDir, `ext-${counter++}`);
    fs.mkdirSync(dir, { recursive: true });
    return createSqliteKvExtension(
      {
        mounts: Object.fromEntries(
          Object.entries(mounts).map(([name, mount]) => [
            name,
            {
              ...mount,
              database: path.join(dir, `${name}.db`),
              table: `kv_${name}`,
            },
          ])
        ),
      },
      makeFactoryCtx()
    );
  },
});
