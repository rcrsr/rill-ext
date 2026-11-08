/**
 * Chroma extension dispose tests
 * Validates abort wiring, mid-batch disposal, and in-flight failure classification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  createVector,
  getStatus,
  isInvalid,
  RuntimeHaltSignal,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createChromaExtension } from '../src/factory.js';

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

const {
  mockUpsert,
  mockDelete,
  mockCount,
  mockGetOrCreateCollection,
  clientArgs,
  MockChromaConnectionError,
} = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDelete: vi.fn(),
  mockCount: vi.fn(),
  mockGetOrCreateCollection: vi.fn(),
  clientArgs: [] as Array<{ fetchOptions?: { signal?: AbortSignal } }>,
  MockChromaConnectionError: class ChromaConnectionErrorStub extends Error {},
}));

vi.mock('chromadb', () => {
  return {
    ChromaConnectionError: MockChromaConnectionError,
    ChromaClient: class MockChromaClient {
      constructor(args: { fetchOptions?: { signal?: AbortSignal } }) {
        clientArgs.push(args);
      }
      getOrCreateCollection = mockGetOrCreateCollection;
    },
  };
});

function makeExt(): ReturnType<typeof createChromaExtension> {
  return createChromaExtension({ collection: 'test_collection' });
}

function makeItems(count: number): Array<Record<string, RillValue>> {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    vector: createVector(new Float32Array([0.1, 0.2, 0.3, 0.4]), 'test'),
    metadata: {},
  }));
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

async function catchThrown(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
}

function expectDisposedHalt(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
  const status = getStatus((thrown as RuntimeHaltSignal).value);
  expect(status.code.name).toBe('DISPOSED');
  expect(status.raw['kind']).toBe('extension_disposed');
  expect(status.message).toBe('chroma: extension disposed');
}

describe('Abort wiring', () => {
  beforeEach(() => {
    clientArgs.length = 0;
  });

  it('passes a live AbortSignal to the SDK as a fetch option', () => {
    makeExt();

    const signal = clientArgs[0]?.fetchOptions?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });

  it('aborts the SDK signal on dispose', async () => {
    const ext = makeExt();
    const signal = clientArgs[0]!.fetchOptions!.signal!;

    await ext.dispose!();

    expect(signal.aborted).toBe(true);
  });

  it('aborts the SDK signal once when dispose is called twice', async () => {
    const ext = makeExt();
    const signal = clientArgs[0]!.fetchOptions!.signal!;

    await ext.dispose!();
    await ext.dispose!();

    expect(signal.aborted).toBe(true);
  });
});

describe('In-flight dispose', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDelete.mockReset();
    mockCount.mockReset();
    mockGetOrCreateCollection.mockReset();
    mockGetOrCreateCollection.mockResolvedValue({
      upsert: mockUpsert,
      delete: mockDelete,
      count: mockCount,
    });
  });

  it('sends no further item and throws DISPOSED when upsert_batch is disposed mid-batch', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockUpsert.mockImplementation(async () => {
      if (mockUpsert.mock.calls.length === 3) {
        await ext.dispose!();
      }
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'upsert_batch').fn({ items: makeItems(10) }, ctx)
    );

    expectDisposedHalt(thrown);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });

  it('sends no further id and throws DISPOSED when delete_batch is disposed mid-batch', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockDelete.mockImplementation(async () => {
      if (mockDelete.mock.calls.length === 2) {
        await ext.dispose!();
      }
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'delete_batch').fn({ ids: ['a', 'b', 'c', 'd'] }, ctx)
    );

    expectDisposedHalt(thrown);
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it('throws DISPOSED when an abort-shaped error follows dispose in a batch item', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockUpsert.mockImplementation(async () => {
      await ext.dispose!();
      throw abortError();
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'upsert_batch').fn({ items: makeItems(3) }, ctx)
    );

    expectDisposedHalt(thrown);
  });

  it('throws DISPOSED when an abort-shaped error follows dispose in a single call', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockCount.mockImplementationOnce(async () => {
      await ext.dispose!();
      throw abortError();
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'count').fn({}, ctx)
    );

    expectDisposedHalt(thrown);
  });

  it('throws DISPOSED when a ChromaConnectionError follows dispose in a single call', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockCount.mockImplementationOnce(async () => {
      await ext.dispose!();
      throw new MockChromaConnectionError('Failed to connect to Chroma');
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'count').fn({}, ctx)
    );

    expectDisposedHalt(thrown);
  });

  it('throws DISPOSED when a ChromaConnectionError follows dispose in a batch item', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockUpsert.mockImplementation(async () => {
      await ext.dispose!();
      throw new MockChromaConnectionError('Failed to connect to Chroma');
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'upsert_batch').fn({ items: makeItems(3) }, ctx)
    );

    expectDisposedHalt(thrown);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('keeps the mapped code when a ChromaConnectionError occurs before dispose', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockCount.mockRejectedValueOnce(
      new MockChromaConnectionError('Failed to connect to Chroma')
    );

    const result = await getCallable(ext, 'count').fn({}, ctx);

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('UNAVAILABLE');
  });

  it('keeps the mapped code when a non-abort error follows dispose', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockCount.mockImplementationOnce(async () => {
      await ext.dispose!();
      throw new Error('429 rate limit exceeded');
    });

    const result = await getCallable(ext, 'count').fn({}, ctx);

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('RATE_LIMIT');
  });
});
