/**
 * Extension factory for ChromaDB vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { ChromaClient, type Where, type CollectionMetadata } from 'chromadb';
import {
  emitExtensionEvent,
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
  createDisposalState,
  checkDisposed,
  dispose,
  assertRequired,
  vectorParam,
  type DisposalState,
} from '@rcrsr/rill-ext-vector-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { ChromaConfig } from './types.js';

const PROVIDER = 'chroma';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create ChromaDB extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @param ctx - ExtensionFactoryCtx (rill 0.19); `ctx.signal` triggers
 *   full disposal because the ChromaDB SDK does not accept per-call signals.
 * @returns ExtensionResult with 11 vector database functions and dispose
 *
 * @example
 * ```typescript
 * const ext = createChromaExtension({
 *   url: 'http://localhost:8000',
 *   collection: 'my_vectors',
 * });
 * await ext.dispose();
 * ```
 */
export function createChromaExtension(
  config: ChromaConfig,
  ctx?: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Validate required fields (factory-time → RILL-R001 via assertRequired)
  assertRequired(config.collection, 'collection');

  // Instantiate SDK client at factory time
  const clientConfig: { path?: string } = {};
  if (config.url !== undefined) {
    clientConfig.path = config.url;
  }
  const client = new ChromaClient(clientConfig);

  const factoryCollection = config.collection;
  const disposalState: DisposalState = createDisposalState(PROVIDER);

  const disposeExtension = async (): Promise<void> => {
    await dispose(disposalState, async () => {
      // ChromaDB SDK does not expose a close() method.
    });
  };

  // Wire ctx.signal abort → full disposal (SDK has no per-call signal)
  if (ctx?.signal !== undefined) {
    ctx.signal.addEventListener(
      'abort',
      () => {
        void disposeExtension();
      },
      { once: true }
    );
  }

  // Build function dict — satisfies verifies contract shape at compile time
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

        const startTime = Date.now();
        try {
          const id = args['id'] as string;
          const vector = args['vector'] as RillVector;
          const metadata = (args['metadata'] ?? {}) as Record<string, unknown>;

          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });
          await collection.upsert({
            ids: [id],
            embeddings: [Array.from(vector.data)],
            metadatas: [metadata as Record<string, string | number | boolean>],
          });

          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx, {
            event: 'chroma:upsert',
            subsystem: 'extension:chroma',
            duration,
            id,
          });
          return { id, success: true } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const items = args['items'] as Array<Record<string, RillValue>>;
          let succeeded = 0;

          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (!item || typeof item !== 'object') {
              const result = {
                succeeded,
                failed: `index ${i}`,
                error: 'invalid item structure',
              };
              emitExtensionEvent(ctx, {
                event: 'chroma:upsert_batch',
                subsystem: 'extension:chroma',
                duration: Date.now() - startTime,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }

            const id = item['id'] as string;
            const vector = item['vector'] as RillVector;
            const metadata = (item['metadata'] ?? {}) as Record<
              string,
              unknown
            >;

            try {
              await collection.upsert({
                ids: [id],
                embeddings: [Array.from(vector.data)],
                metadatas: [
                  metadata as Record<string, string | number | boolean>,
                ],
              });
              succeeded++;
            } catch (error: unknown) {
              const invalid = mapVectorError(ctx, PROVIDER, error);
              const result = {
                succeeded,
                failed: id,
                error: getStatus(invalid).message,
              };
              emitExtensionEvent(ctx, {
                event: 'chroma:upsert_batch',
                subsystem: 'extension:chroma',
                duration: Date.now() - startTime,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          emitExtensionEvent(ctx, {
            event: 'chroma:upsert_batch',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            count: items.length,
            succeeded,
          });
          return { succeeded } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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
          }
        ),
      ],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const startTime = Date.now();
        try {
          const vector = args['vector'] as RillVector;
          const options = (args['options'] ?? {}) as Record<string, unknown>;
          const k = typeof options['k'] === 'number' ? options['k'] : 10;
          const filter = (options['filter'] ?? {}) as Record<string, unknown>;

          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          const queryRequest: {
            queryEmbeddings: number[][];
            nResults: number;
            where?: Where;
          } = {
            queryEmbeddings: [Array.from(vector.data)],
            nResults: k,
          };
          if (Object.keys(filter).length > 0) {
            queryRequest.where = filter as Where;
          }
          const response = await collection.query(queryRequest);

          const results = response.ids[0]!.map((id, idx) => ({
            id: String(id),
            score: response.distances?.[0]?.[idx] ?? 0,
            metadata: response.metadatas?.[0]?.[idx] ?? {},
          }));

          emitExtensionEvent(ctx, {
            event: 'chroma:search',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            result_count: results.length,
            k,
          });
          return results as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const id = args['id'] as string;
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });
          const response = await collection.get({ ids: [id] });

          // ID not found → invalid value with #NOT_FOUND
          if (response.ids.length === 0) {
            const err = new Error('chroma: id not found');
            return ctx.invalidate(err, {
              code: 'NOT_FOUND',
              provider: PROVIDER,
              raw: {
                kind: 'id_not_found',
                id,
                message: 'chroma: id not found',
              },
            });
          }

          const embedding = response.embeddings?.[0];
          const metadata = response.metadatas?.[0];

          if (!embedding || !Array.isArray(embedding)) {
            const err = new Error('chroma: invalid vector format');
            return ctx.invalidate(err, {
              code: 'PROTOCOL',
              provider: PROVIDER,
              raw: {
                kind: 'invalid_vector_format',
                message: 'chroma: invalid vector format',
              },
            });
          }

          const vector = createVector(
            new Float32Array(embedding),
            factoryCollection
          );
          const result = {
            id: String(response.ids[0]),
            vector,
            metadata: metadata ?? {},
          };

          emitExtensionEvent(ctx, {
            event: 'chroma:get',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            id,
          });
          return result as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const id = args['id'] as string;
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });
          await collection.delete({ ids: [id] });

          emitExtensionEvent(ctx, {
            event: 'chroma:delete',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            id,
          });
          return { id, deleted: true } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const ids = args['ids'] as Array<string>;
          let succeeded = 0;

          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });

          for (let i = 0; i < ids.length; i++) {
            const id = ids[i]!;
            try {
              await collection.delete({ ids: [id] });
              succeeded++;
            } catch (error: unknown) {
              const invalid = mapVectorError(ctx, PROVIDER, error);
              const result = {
                succeeded,
                failed: id,
                error: getStatus(invalid).message,
              };
              emitExtensionEvent(ctx, {
                event: 'chroma:delete_batch',
                subsystem: 'extension:chroma',
                duration: Date.now() - startTime,
                count: ids.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          emitExtensionEvent(ctx, {
            event: 'chroma:delete_batch',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            count: ids.length,
            succeeded,
          });
          return { succeeded } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });
          const count = await collection.count();
          emitExtensionEvent(ctx, {
            event: 'chroma:count',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            count,
          });
          return count as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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
            metadata: { type: { kind: 'dict' }, defaultValue: {} },
          }
        ),
      ],
      fn: async (args, ctxLike): Promise<RillValue> => {
        const ctx = ctxLike as RuntimeContext;
        const disposed = checkDisposed(ctx, disposalState, PROVIDER);
        if (disposed !== null) return disposed;

        const startTime = Date.now();
        try {
          const name = args['name'] as string;
          const options = (args['options'] ?? {}) as Record<string, unknown>;
          const metadata = (options['metadata'] ?? {}) as Record<
            string,
            unknown
          >;

          await client.createCollection({
            name,
            metadata: metadata as CollectionMetadata,
          });

          emitExtensionEvent(ctx, {
            event: 'chroma:create_collection',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            name,
          });
          return { name, created: true } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const name = args['name'] as string;
          await client.deleteCollection({ name });
          emitExtensionEvent(ctx, {
            event: 'chroma:delete_collection',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            name,
          });
          return { name, deleted: true } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const names = (await client.listCollections()).map((c) => c.name);
          emitExtensionEvent(ctx, {
            event: 'chroma:list_collections',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            count: names.length,
          });
          return names as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
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

        const startTime = Date.now();
        try {
          const collection = await client.getOrCreateCollection({
            name: factoryCollection,
          });
          const count = await collection.count();
          emitExtensionEvent(ctx, {
            event: 'chroma:describe',
            subsystem: 'extension:chroma',
            duration: Date.now() - startTime,
            name: factoryCollection,
          });
          return { name: factoryCollection, count } as RillValue;
        } catch (error: unknown) {
          return emitError(ctx, error, startTime);
        }
      },
      annotations: { description: 'Describe configured collection' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          count: { type: { kind: 'number' } },
        },
      }),
    },
  };

  // Shared error path: map, emit, return invalid value (never throw).
  function emitError(
    ctx: RuntimeContext,
    error: unknown,
    startTime: number
  ): RillValue {
    const invalid = mapVectorError(ctx, PROVIDER, error);
    emitExtensionEvent(ctx, {
      event: 'chroma:error',
      subsystem: 'extension:chroma',
      error: getStatus(invalid).message,
      duration: Date.now() - startTime,
    });
    return invalid;
  }

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
