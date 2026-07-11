/**
 * Extension factory for Qdrant vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  createVector,
  getStatus,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
  type RillVector,
} from '@rcrsr/rill';
import {
  type VectorExtensionContract,
  mapVectorError,
  withEventEmission,
  createDisposalState,
  checkDisposed,
  dispose,
  assertRequired,
  vectorParam,
} from '@rcrsr/rill-ext-vector-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { QdrantConfig } from './types.js';

const PROVIDER = 'qdrant';

/**
 * Create Qdrant extension instance.
 *
 * @param config - Extension configuration
 * @param ctx - ExtensionFactoryCtx (rill 0.19); `ctx.signal` triggers
 *   full disposal because the Qdrant SDK does not accept per-call signals.
 */
export function createQdrantExtension(
  config: QdrantConfig,
  ctx?: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Factory-time validation (RILL-R001 via assertRequired)
  assertRequired(config.url, 'url');
  assertRequired(config.collection, 'collection');

  // `checkCompatibility: false` suppresses the QdrantClient's auto-issued
  // GET to obtain the server version on construction. The check is best-effort
  // (the SDK proceeds either way), and the unawaited rejection it produces
  // when the server is unreachable can leak past vitest's worker teardown,
  // surfacing as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog"
  // was pending` and failing release CI even when every test passes. Real
  // version mismatches still surface at the first API call.
  const clientConfig: {
    url: string;
    apiKey?: string;
    timeout?: number;
    checkCompatibility: boolean;
  } = {
    url: config.url,
    checkCompatibility: false,
  };
  if (config.apiKey !== undefined) clientConfig.apiKey = config.apiKey;
  if (config.timeout !== undefined) clientConfig.timeout = config.timeout;

  const client = new QdrantClient(clientConfig);
  const factoryCollection = config.collection;
  const disposalState = createDisposalState(PROVIDER);

  const disposeExtension = async (): Promise<void> => {
    await dispose(disposalState, async () => {
      // Qdrant SDK does not expose a close() method.
    });
  };

  if (ctx?.signal !== undefined) {
    ctx.signal.addEventListener(
      'abort',
      () => {
        void disposeExtension();
      },
      { once: true }
    );
  }

  const fnDict: {
    upsert: RillFunction;
    upsert_batch: RillFunction;
    search: RillFunction;
    get: RillFunction;
    delete: RillFunction;
    delete_batch: RillFunction;
    count: RillFunction;
    create_collection: RillFunction;
    delete_collection: RillFunction;
    list_collections: RillFunction;
    describe: RillFunction;
  } = {
    upsert: {
      params: [
        p.str('id'),
        vectorParam('vector'),
        p.dict('metadata', undefined, {}),
      ],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const id = args['id'] as string;
        const vector = args['vector'] as RillVector;
        const metadata = (args['metadata'] ?? {}) as Record<string, unknown>;

        return withEventEmission(ctx, PROVIDER, 'upsert', { id }, async () => {
          await client.upsert(factoryCollection, {
            wait: true,
            points: [
              { id, vector: Array.from(vector.data), payload: metadata },
            ],
          });
          return { id, success: true } as RillValue;
        });
      },
      annotations: {
        description: 'Insert or update single vector with metadata',
      },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          id: { type: { kind: 'string' } },
          success: { type: { kind: 'bool' } },
        },
      }),
    },

    upsert_batch: {
      params: [p.list('items')],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const items = args['items'] as Array<Record<string, RillValue>>;

        return withEventEmission(
          ctx,
          PROVIDER,
          'upsert_batch',
          { count: items.length, succeeded: 0 },
          async () => {
            let succeeded = 0;

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (!item || typeof item !== 'object') {
                return {
                  succeeded,
                  failed: `index ${i}`,
                  error: 'invalid item structure',
                } as RillValue;
              }

              const id = item['id'] as string;
              const vector = item['vector'] as RillVector;
              const metadata = (item['metadata'] ?? {}) as Record<
                string,
                unknown
              >;

              try {
                await client.upsert(factoryCollection, {
                  wait: true,
                  points: [
                    { id, vector: Array.from(vector.data), payload: metadata },
                  ],
                });
                succeeded++;
              } catch (error: unknown) {
                const invalid = mapVectorError(ctx, PROVIDER, error);
                return {
                  succeeded,
                  failed: id,
                  error: getStatus(invalid).message,
                } as RillValue;
              }
            }

            return { succeeded } as RillValue;
          }
        );
      },
      annotations: { description: 'Batch insert/update vectors' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          succeeded: { type: { kind: 'number' } },
          failed: { type: { kind: 'string' } },
          error: { type: { kind: 'string' } },
        },
      }),
    },

    search: {
      params: [
        vectorParam('vector'),
        p.dict(
          'options',
          undefined,
          {},
          {
            k: { type: { kind: 'number' }, defaultValue: 10 },
            filter: { type: { kind: 'dict' }, defaultValue: {} },
            score_threshold: { type: { kind: 'number' }, defaultValue: 0 },
          }
        ),
      ],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const vector = args['vector'] as RillVector;
        const options = (args['options'] ?? {}) as Record<string, unknown>;
        const k = typeof options['k'] === 'number' ? options['k'] : 10;
        const filter = (options['filter'] ?? {}) as Record<string, unknown>;
        const scoreThreshold =
          typeof options['score_threshold'] === 'number'
            ? options['score_threshold']
            : undefined;

        const eventMetadata = { k, result_count: 0 };

        return withEventEmission(
          ctx,
          PROVIDER,
          'search',
          eventMetadata,
          async () => {
            const searchRequest: {
              vector: number[];
              limit: number;
              with_payload: boolean;
              filter?: Record<string, unknown>;
              score_threshold?: number;
            } = {
              vector: Array.from(vector.data),
              limit: k,
              with_payload: true,
            };

            if (Object.keys(filter).length > 0) searchRequest.filter = filter;
            if (scoreThreshold !== undefined) {
              searchRequest.score_threshold = scoreThreshold;
            }

            const response = await client.search(
              factoryCollection,
              searchRequest
            );
            const results = response.map((hit) => ({
              id: String(hit.id),
              score: hit.score,
              metadata: hit.payload ?? {},
            }));
            eventMetadata.result_count = results.length;
            return results as RillValue;
          }
        );
      },
      annotations: { description: 'Search k nearest neighbors' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            id: { type: { kind: 'string' } },
            score: { type: { kind: 'number' } },
            metadata: { type: { kind: 'dict' } },
          },
        },
      }),
    },

    get: {
      params: [p.str('id')],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const id = args['id'] as string;

        return withEventEmission(ctx, PROVIDER, 'get', { id }, async () => {
          const response = await client.retrieve(factoryCollection, {
            ids: [id],
            with_payload: true,
            with_vector: true,
          });

          if (response.length === 0) {
            // Throw so withEventEmission catches and maps via mapVectorError
            // ("id not found" → NOT_FOUND via collection/index keyword path).
            throw new Error('qdrant: id not found');
          }

          const point = response[0]!;
          const vectorData = point.vector;

          let vectorArray: number[];
          if (
            Array.isArray(vectorData) &&
            vectorData.length > 0 &&
            typeof vectorData[0] === 'number'
          ) {
            vectorArray = vectorData as number[];
          } else {
            throw new Error('qdrant: invalid vector format');
          }

          const vector = createVector(
            new Float32Array(vectorArray),
            factoryCollection
          );
          return {
            id: String(point.id),
            vector,
            metadata: point.payload ?? {},
          } as RillValue;
        });
      },
      annotations: { description: 'Fetch vector by ID' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          id: { type: { kind: 'string' } },
          vector: { type: { kind: 'vector' } },
          metadata: { type: { kind: 'dict' } },
        },
      }),
    },

    delete: {
      params: [p.str('id')],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const id = args['id'] as string;
        return withEventEmission(ctx, PROVIDER, 'delete', { id }, async () => {
          await client.delete(factoryCollection, {
            wait: true,
            points: [id as string | number],
          });
          return { id, deleted: true } as RillValue;
        });
      },
      annotations: { description: 'Delete vector by ID' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          id: { type: { kind: 'string' } },
          deleted: { type: { kind: 'bool' } },
        },
      }),
    },

    delete_batch: {
      params: [p.list('ids')],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const ids = args['ids'] as Array<string>;

        return withEventEmission(
          ctx,
          PROVIDER,
          'delete_batch',
          { count: ids.length, succeeded: 0 },
          async () => {
            let succeeded = 0;
            for (let i = 0; i < ids.length; i++) {
              const id = ids[i];
              try {
                await client.delete(factoryCollection, {
                  wait: true,
                  points: [id as string | number],
                });
                succeeded++;
              } catch (error: unknown) {
                const invalid = mapVectorError(ctx, PROVIDER, error);
                return {
                  succeeded,
                  failed: id,
                  error: getStatus(invalid).message,
                } as RillValue;
              }
            }
            return { succeeded } as RillValue;
          }
        );
      },
      annotations: { description: 'Batch delete vectors' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          succeeded: { type: { kind: 'number' } },
          failed: { type: { kind: 'string' } },
          error: { type: { kind: 'string' } },
        },
      }),
    },

    count: {
      params: [],
      fn: async (_args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        return withEventEmission(ctx, PROVIDER, 'count', {}, async () => {
          const response = await client.getCollection(factoryCollection);
          return (response.points_count ?? 0) as RillValue;
        });
      },
      annotations: { description: 'Return total vector count in collection' },
      returnType: structureToTypeValue({ kind: 'number' }),
    },

    create_collection: {
      params: [
        p.str('name'),
        p.dict(
          'options',
          undefined,
          {},
          {
            dimensions: { type: { kind: 'number' } },
            distance: { type: { kind: 'string' }, defaultValue: 'cosine' },
          }
        ),
      ],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const name = args['name'] as string;
        const options = (args['options'] ?? {}) as Record<string, unknown>;
        const dimensions = options['dimensions'] as number;
        const distance =
          (options['distance'] as 'cosine' | 'euclidean' | 'dot') ?? 'cosine';

        return withEventEmission(
          ctx,
          PROVIDER,
          'create_collection',
          { name },
          async () => {
            let qdrantDistance: 'Cosine' | 'Euclid' | 'Dot';
            if (distance === 'cosine') qdrantDistance = 'Cosine';
            else if (distance === 'euclidean') qdrantDistance = 'Euclid';
            else qdrantDistance = 'Dot';

            await client.createCollection(name, {
              vectors: { size: dimensions, distance: qdrantDistance },
            });
            return { name, created: true } as RillValue;
          }
        );
      },
      annotations: { description: 'Create new vector collection' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          created: { type: { kind: 'bool' } },
        },
      }),
    },

    delete_collection: {
      params: [p.str('name')],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const name = args['name'] as string;
        return withEventEmission(
          ctx,
          PROVIDER,
          'delete_collection',
          { name },
          async () => {
            await client.deleteCollection(name);
            return { name, deleted: true } as RillValue;
          }
        );
      },
      annotations: { description: 'Delete vector collection' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          deleted: { type: { kind: 'bool' } },
        },
      }),
    },

    list_collections: {
      params: [],
      fn: async (_args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        return withEventEmission(
          ctx,
          PROVIDER,
          'list_collections',
          {},
          async () => {
            const response = await client.getCollections();
            return response.collections.map((col) => col.name) as RillValue;
          }
        );
      },
      annotations: { description: 'List all collection names' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'string' },
      }),
    },

    describe: {
      params: [],
      fn: async (_args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        return withEventEmission(
          ctx,
          PROVIDER,
          'describe',
          { name: factoryCollection },
          async () => {
            const response = await client.getCollection(factoryCollection);
            const vectorConfig = response.config?.params?.vectors;
            let dimensions = 0;
            let distance: 'cosine' | 'euclidean' | 'dot' = 'cosine';

            if (
              vectorConfig &&
              typeof vectorConfig === 'object' &&
              'size' in vectorConfig
            ) {
              dimensions = (vectorConfig as { size: number }).size;
              const dist = (vectorConfig as { distance: string }).distance;
              if (dist === 'Cosine') distance = 'cosine';
              else if (dist === 'Euclid') distance = 'euclidean';
              else if (dist === 'Dot') distance = 'dot';
            }

            return {
              name: factoryCollection,
              count: response.points_count ?? 0,
              dimensions,
              distance,
            } as RillValue;
          }
        );
      },
      annotations: { description: 'Describe configured collection' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          count: { type: { kind: 'number' } },
          dimensions: { type: { kind: 'number' } },
          distance: { type: { kind: 'string' } },
        },
      }),
    },
  };

  const callableDict = {
    upsert: toCallable(fnDict.upsert),
    upsert_batch: toCallable(fnDict.upsert_batch),
    search: toCallable(fnDict.search),
    get: toCallable(fnDict.get),
    delete: toCallable(fnDict.delete),
    delete_batch: toCallable(fnDict.delete_batch),
    count: toCallable(fnDict.count),
    create_collection: toCallable(fnDict.create_collection),
    delete_collection: toCallable(fnDict.delete_collection),
    list_collections: toCallable(fnDict.list_collections),
    describe: toCallable(fnDict.describe),
  } satisfies VectorExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
