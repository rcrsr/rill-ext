import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectHalt } from './_halt-helpers.js';
import {
  createRuntimeContext,
  RuntimeHaltSignal,
  getStatus,
  callable,
  type ApplicationCallable,
  type RillStream,
  type RillValue,
} from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        embedContent: mockEmbedContent,
      };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
    },
  };
});

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function makeAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError());
      return;
    }
    signal.addEventListener('abort', () => reject(makeAbortError()), {
      once: true,
    });
  });
}

function makeAbortableStream(params: {
  config: { abortSignal: AbortSignal };
}): AsyncGenerator<{ text: string }> {
  const signal = params.config.abortSignal;
  return (async function* () {
    await waitForAbort(signal);
    yield { text: 'unreachable' };
  })();
}

/** Drain a stream, then its resolve, returning the first error raised. */
async function drainForError(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<unknown> {
  let current = stream as RillStream;
  try {
    while (!current.done) {
      const nextFn = current.next as ApplicationCallable;
      current = (await nextFn.fn({}, ctx)) as RillStream;
    }
    await (
      stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
    ).__rill_stream_resolve();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

function expectDisposedHalt(error: unknown): void {
  expect(error).toBeInstanceOf(RuntimeHaltSignal);
  expectHalt(error, { code: 'DISPOSED', provider: 'gemini' });
  const status = getStatus((error as RuntimeHaltSignal).value);
  expect(status.raw['kind']).toBe('extension_disposed');
}

describe('in-flight calls cancelled by dispose()', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
    mockEmbedContent.mockReset();
  });

  describe('embed()', () => {
    it('throws DISPOSED halt when dispose aborts the request', async () => {
      mockEmbedContent.mockImplementation(
        (params: { config: { abortSignal: AbortSignal } }) =>
          waitForAbort(params.config.abortSignal)
      );
      const ext = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      });
      const ctx = createRuntimeContext();

      const pending = Promise.resolve(
        getCallable(ext, 'embed').fn({ text: 'hello' }, ctx)
      ).catch((error: unknown) => error);
      await ext.dispose!();

      expectDisposedHalt(await pending);
    });
  });

  describe('message()', () => {
    it('throws DISPOSED halt when dispose aborts the stream', async () => {
      mockGenerateContentStream.mockImplementation(makeAbortableStream);
      const ext = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      });
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'hello' },
        ctx
      );
      const pending = drainForError(stream, ctx);
      await ext.dispose!();

      expectDisposedHalt(await pending);
    });
  });

  describe('tool_loop()', () => {
    it('throws DISPOSED halt when dispose aborts the stream', async () => {
      mockGenerateContentStream.mockImplementation(makeAbortableStream);
      const ext = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      });
      const ctx = createRuntimeContext();
      const tools = { tool: callable(vi.fn()) };

      const stream = await getCallable(ext, 'tool_loop').fn(
        { prompt: 'hello', tools },
        ctx
      );
      const pending = drainForError(stream, ctx);
      await ext.dispose!();

      expectDisposedHalt(await pending);
    });
  });

  describe('tool_loop() with accumulated output', () => {
    it('throws DISPOSED instead of a partial result when dispose aborts after text deltas', async () => {
      mockGenerateContentStream.mockImplementation(
        (params: { config: { abortSignal: AbortSignal } }) =>
          (async function* () {
            yield { text: 'partial' };
            await waitForAbort(params.config.abortSignal);
          })()
      );
      const ext = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      });
      const ctx = createRuntimeContext();
      const tools = { tool: callable(vi.fn()) };

      const stream = await getCallable(ext, 'tool_loop').fn(
        { prompt: 'hello', tools },
        ctx
      );
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
      const resolved = (
        stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
      )
        .__rill_stream_resolve()
        .catch((error: unknown) => error);
      await ext.dispose!();

      expectDisposedHalt(await resolved);
    });
  });

  describe('error observed after dispose', () => {
    it('keeps the original atom when a non-abort error settles after dispose', async () => {
      let rejectRequest: (error: unknown) => void = () => {};
      mockEmbedContent.mockImplementation(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectRequest = reject;
          })
      );
      const ext = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      });
      const ctx = createRuntimeContext();

      const pending = Promise.resolve(
        getCallable(ext, 'embed').fn({ text: 'hello' }, ctx)
      ).catch((error: unknown) => error);
      await ext.dispose!();
      rejectRequest(new Error('rate limit exceeded (429)'));

      const thrown = await pending;
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expectHalt(thrown, { code: 'RATE_LIMIT', provider: 'gemini' });
    });
  });
});
