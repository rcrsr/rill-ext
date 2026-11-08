/**
 * Pinecone extension dispose tests
 * Validates mid-batch disposal and in-flight failure classification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  createVector,
  getStatus,
  isInvalid,
  RuntimeHaltSignal,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createPineconeExtension } from '../src/factory.js';

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

const { mockUpsert, mockDeleteOne, mockDescribeIndexStats, clientConfigs } =
  vi.hoisted(() => ({
    mockUpsert: vi.fn(),
    mockDeleteOne: vi.fn(),
    mockDescribeIndexStats: vi.fn(),
    clientConfigs: [] as Array<{
      fetchApi: (input: string, init?: RequestInit) => Promise<Response>;
    }>,
  }));

vi.mock('@pinecone-database/pinecone', () => {
  return {
    Pinecone: class MockPinecone {
      constructor(config: (typeof clientConfigs)[number]) {
        clientConfigs.push(config);
      }
      index = vi.fn(() => ({
        namespace: vi.fn(() => ({
          upsert: mockUpsert,
          deleteOne: mockDeleteOne,
        })),
        describeIndexStats: mockDescribeIndexStats,
      }));
    },
  };
});

describe('Fetch override', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clientConfigs.length = 0;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentInit(): RequestInit {
    return fetchMock.mock.calls[0]![1] as RequestInit;
  }

  it('injects a lifetime signal that aborts on dispose when the request has none', async () => {
    const ext = createPineconeExtension({ apiKey: 'k', index: 'i' });

    await clientConfigs[0]!.fetchApi('https://example.test/x');
    const signal = sentInit().signal!;
    expect(signal.aborted).toBe(false);
    await ext.dispose!();

    expect(signal.aborted).toBe(true);
  });

  it('aborts the merged signal when dispose runs and the caller signal is live', async () => {
    const ext = createPineconeExtension({ apiKey: 'k', index: 'i' });
    const caller = new AbortController();

    await clientConfigs[0]!.fetchApi('https://example.test/x', {
      signal: caller.signal,
    });
    const signal = sentInit().signal!;
    expect(signal.aborted).toBe(false);
    await ext.dispose!();

    expect(signal.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  });

  it('aborts the merged signal when the caller signal aborts first', async () => {
    createPineconeExtension({ apiKey: 'k', index: 'i' });
    const caller = new AbortController();

    await clientConfigs[0]!.fetchApi('https://example.test/x', {
      signal: caller.signal,
    });
    const signal = sentInit().signal!;
    caller.abort();

    expect(signal.aborted).toBe(true);
  });

  it('preserves the other init fields and the url', async () => {
    createPineconeExtension({ apiKey: 'k', index: 'i' });

    await clientConfigs[0]!.fetchApi('https://example.test/x', {
      method: 'POST',
      body: 'payload',
      headers: { 'x-test': '1' },
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/x');
    const init = sentInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect(init.headers).toEqual({ 'x-test': '1' });
  });
});

describe('In-flight dispose', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDeleteOne.mockReset();
    mockDescribeIndexStats.mockReset();
  });

  function makeExt(): ReturnType<typeof createPineconeExtension> {
    return createPineconeExtension({
      apiKey: 'test-api-key',
      index: 'test_index',
    });
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
    expect(status.message).toBe('pinecone: extension disposed');
  }

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
    mockDeleteOne.mockImplementation(async () => {
      if (mockDeleteOne.mock.calls.length === 2) {
        await ext.dispose!();
      }
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'delete_batch').fn({ ids: ['a', 'b', 'c', 'd'] }, ctx)
    );

    expectDisposedHalt(thrown);
    expect(mockDeleteOne).toHaveBeenCalledTimes(2);
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

  it('throws DISPOSED when an abort error wrapped in a cause chain follows dispose', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockDescribeIndexStats.mockImplementationOnce(async () => {
      await ext.dispose!();
      throw new Error('Request failed to reach Pinecone', {
        cause: new Error('fetch failed', { cause: abortError() }),
      });
    });

    const thrown = await catchThrown(() =>
      getCallable(ext, 'count').fn({}, ctx)
    );

    expectDisposedHalt(thrown);
  });

  it('keeps the mapped code when a non-abort error follows dispose', async () => {
    const ext = makeExt();
    const ctx = createRuntimeContext();
    mockDescribeIndexStats.mockImplementationOnce(async () => {
      await ext.dispose!();
      throw new Error('429 rate limit exceeded');
    });

    const result = await getCallable(ext, 'count').fn({}, ctx);

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('RATE_LIMIT');
  });
});
