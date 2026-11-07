import { randomUUID } from 'node:crypto';
import { afterAll, describe } from 'vitest';
import { Redis } from 'ioredis';
import type { KvContractMount } from '@rcrsr/rill-ext-kv-shared';
import { describeKvContract } from '@rcrsr/rill-ext-kv-shared/contract-suite';
import { createRedisKvExtension } from '../src/factory.js';
import {
  assertServiceAvailable,
  isRedisAvailable,
  makeFactoryCtx,
} from './_setup.js';

const REDIS_URL = 'redis://localhost:6379';

const redisAvailable = await isRedisAvailable(REDIS_URL);
assertServiceAvailable('Redis', redisAvailable);

const RUN_ID = `contract-${randomUUID()}`;
let created = 0;

describe.skipIf(!redisAvailable)('kv-redis contract', () => {
  afterAll(async () => {
    const client = new Redis(REDIS_URL);
    try {
      let cursor = '0';
      do {
        const [next, found] = await client.scan(
          cursor,
          'MATCH',
          `${RUN_ID}-*`,
          'COUNT',
          500
        );
        cursor = next;
        if (found.length > 0) await client.del(...found);
      } while (cursor !== '0');
    } finally {
      client.disconnect();
    }
  });

  describeKvContract('kv-redis', {
    createExtension(mounts: Readonly<Record<string, KvContractMount>>) {
      const run = `${RUN_ID}-${created++}`;
      return createRedisKvExtension(
        {
          url: REDIS_URL,
          mounts: Object.fromEntries(
            Object.entries(mounts).map(([name, mount]) => [
              name,
              { ...mount, prefix: `${run}:${name}:` },
            ])
          ),
        },
        makeFactoryCtx()
      );
    },
  });
});
