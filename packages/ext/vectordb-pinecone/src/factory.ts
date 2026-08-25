/**
 * Extension factory for Pinecone vector database integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import { Pinecone } from '@pinecone-database/pinecone';
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
  withEventEmission,
  createDisposalState,
  checkDisposed,
  dispose as sharedDispose,
  assertRequired,
  vectorParam,
  type DisposalState,
} from '@rcrsr/rill-ext-vector-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { PineconeConfig } from './types.js';

const PROVIDER = 'pinecone';

/**
 * Create Pinecone extension instance.
 *
 * @param config - Extension configuration
 * @param ctx - ExtensionFactoryCtx (rill 0.19); `ctx.signal` triggers
 *   full disposal because the Pinecone SDK does not accept per-call signals.
 */
export function createPineconeExtension(
  config: PineconeConfig,
  ctx?: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Factory-time validation (RILL-R001 via assertRequired)
  assertRequired(config.apiKey, 'apiKey');
  assertRequired(config.index, 'index');

  const client = new Pinecone({ apiKey: config.apiKey });

  const factoryIndex = config.index;
  const factoryNamespace: string = config.namespace ?? '';
  const disposalState: DisposalState = createDisposalState(PROVIDER);

  const dispose = async (): Promise<void> => {
    await sharedDispose(disposalState);
  };

  if (ctx?.signal !== undefined) {
    ctx.signal.addEventListener(
      'abort',
      () => {
        void dispose();
      },
      { once: true }
    );
  }

  const convertMetadata = (
    input: Record<string, unknown>
  ): Record<string, string | number | boolean> => {
    const result: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        result[key] = value;
      } else {
        result[key] = String(value);
      }
    }
    return result;
  };

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
        const metadataArg = (args['metadata'] ?? {}) as Record<string, unknown>;
        const metadata = convertMetadata(metadataArg);

        return withEventEmission(ctx, PROVIDER, 'upsert', { id }, async () => {
          const index = client.index({ name: factoryIndex });
          await index.namespace(factoryNamespace).upsert({
            records: [{ id, values: Array.from(vector.data), metadata }],
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

        const startTime = Date.now();
        try {
          const items = args['items'] as Array<Record<string, RillValue>>;
          let succeeded = 0;
          const index = client.index({ name: factoryIndex });

          for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (!item || typeof item !== 'object') {
              const result = {
                succeeded,
                failed: `index ${i}`,
                error: 'invalid item structure',
              };
              emitExtensionEvent(ctx, {
                event: 'pinecone:upsert_batch',
                subsystem: 'extension:pinecone',
                duration: Date.now() - startTime,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }

            const id = item['id'] as string;
            const vector = item['vector'] as RillVector;
            const metadataArg = (item['metadata'] ?? {}) as Record<
              string,
              unknown
            >;
            const metadata = convertMetadata(metadataArg);

            try {
              await index.namespace(factoryNamespace).upsert({
                records: [{ id, values: Array.from(vector.data), metadata }],
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
                event: 'pinecone:upsert_batch',
                subsystem: 'extension:pinecone',
                duration: Date.now() - startTime,
                count: items.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          emitExtensionEvent(ctx, {
            event: 'pinecone:upsert_batch',
            subsystem: 'extension:pinecone',
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

        const startTime = Date.now();
        try {
          const index = client.index({ name: factoryIndex });

          const searchRequest: {
            vector: number[];
            topK: number;
            includeMetadata?: boolean;
            filter?: Record<string, unknown>;
          } = {
            vector: Array.from(vector.data),
            topK: k,
            includeMetadata: true,
          };
          if (Object.keys(filter).length > 0) {
            searchRequest.filter = filter;
          }
          const response = await index
            .namespace(factoryNamespace)
            .query(searchRequest);

          const results: RillValue = (response.matches ?? []).map((hit) => {
            const metadata: Record<string, RillValue> = {};
            if (hit.metadata) {
              for (const [key, value] of Object.entries(hit.metadata)) {
                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ) {
                  metadata[key] = value;
                } else {
                  metadata[key] = String(value);
                }
              }
            }
            return { id: hit.id, score: hit.score ?? 0, metadata };
          });

          let filtered: unknown = results;
          if (scoreThreshold !== undefined && Array.isArray(results)) {
            filtered = (results as Record<string, unknown>[]).filter(
              (r) => ((r['score'] as number) ?? 0) >= scoreThreshold
            );
          }

          emitExtensionEvent(ctx, {
            event: 'pinecone:search',
            subsystem: 'extension:pinecone',
            duration: Date.now() - startTime,
            result_count: Array.isArray(filtered) ? filtered.length : 0,
            k,
          });
          return filtered as RillValue;
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

        const id = args['id'] as string;

        return withEventEmission(ctx, PROVIDER, 'get', { id }, async () => {
          const index = client.index({ name: factoryIndex });
          const response = await index
            .namespace(factoryNamespace)
            .fetch({ ids: [id] });

          if (!response.records || response.records[id] === undefined) {
            // Throw so withEventEmission catches and maps via mapVectorError,
            // whose "id not found" clause yields #NOT_FOUND.
            throw new Error('pinecone: id not found');
          }

          const record = response.records[id];
          const vectorData = record.values;

          if (!vectorData || !Array.isArray(vectorData)) {
            throw new Error('pinecone: invalid vector format');
          }

          const vector = createVector(
            new Float32Array(vectorData),
            factoryIndex
          );
          return {
            id,
            vector,
            metadata: record.metadata ?? {},
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
          const index = client.index({ name: factoryIndex });
          await index.namespace(factoryNamespace || '').deleteOne({ id });
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

        const startTime = Date.now();
        try {
          const ids = args['ids'] as Array<string>;
          let succeeded = 0;
          const index = client.index({ name: factoryIndex });

          for (let i = 0; i < ids.length; i++) {
            const id = ids[i]!;
            try {
              await index.namespace(factoryNamespace).deleteOne({ id });
              succeeded++;
            } catch (error: unknown) {
              const invalid = mapVectorError(ctx, PROVIDER, error);
              const result = {
                succeeded,
                failed: id,
                error: getStatus(invalid).message,
              };
              emitExtensionEvent(ctx, {
                event: 'pinecone:delete_batch',
                subsystem: 'extension:pinecone',
                duration: Date.now() - startTime,
                count: ids.length,
                succeeded,
              });
              return result as RillValue;
            }
          }

          emitExtensionEvent(ctx, {
            event: 'pinecone:delete_batch',
            subsystem: 'extension:pinecone',
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

        return withEventEmission(ctx, PROVIDER, 'count', {}, async () => {
          const index = client.index({ name: factoryIndex });
          const stats = await index.describeIndexStats();
          const count = stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;
          return count as RillValue;
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

        if (!dimensions || typeof dimensions !== 'number' || dimensions <= 0) {
          return ctx.invalidate(
            new Error('pinecone: dimensions must be a positive integer'),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: {
                kind: 'invalid_dimensions',
                message: 'pinecone: dimensions must be a positive integer',
              },
            }
          );
        }

        return withEventEmission(
          ctx,
          PROVIDER,
          'create_collection',
          { name },
          async () => {
            let pineconeMetric: 'cosine' | 'euclidean' | 'dotproduct';
            if (distance === 'cosine') pineconeMetric = 'cosine';
            else if (distance === 'euclidean') pineconeMetric = 'euclidean';
            else pineconeMetric = 'dotproduct';

            await client.createIndex({
              name,
              dimension: dimensions,
              metric: pineconeMetric,
              spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
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
            await client.deleteIndex(name);
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
            const response = await client.listIndexes();
            const names =
              response.indexes?.map((index) => index.name ?? '') ?? [];
            return names as RillValue;
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
          { name: factoryIndex },
          async () => {
            const index = client.index({ name: factoryIndex });
            const stats = await index.describeIndexStats();
            const indexInfo = await client.describeIndex(factoryIndex);

            const dimensions = stats.dimension ?? 0;
            const count =
              stats.namespaces?.[factoryNamespace]?.recordCount ?? 0;

            let distance: 'cosine' | 'euclidean' | 'dot' = 'cosine';
            const metric = indexInfo.metric;
            if (metric === 'cosine') distance = 'cosine';
            else if (metric === 'euclidean') distance = 'euclidean';
            else if (metric === 'dotproduct') distance = 'dot';

            return {
              name: factoryIndex,
              count,
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

  function emitError(
    ctx: RuntimeContext,
    error: unknown,
    startTime: number
  ): RillValue {
    const invalid = mapVectorError(ctx, PROVIDER, error);
    emitExtensionEvent(ctx, {
      event: 'pinecone:error',
      subsystem: 'extension:pinecone',
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
    dispose,
  } satisfies ExtensionFactoryResult;
}
