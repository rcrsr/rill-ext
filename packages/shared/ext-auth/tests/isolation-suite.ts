/**
 * Credential-isolation suite for extensions that read a session token from
 * the host context. Each extension supplies a harness; the suite probes one
 * host function through a stubbed fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChildContext,
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type ExtensionFactoryResult,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { CredentialIsolationHarness } from '../src/types.js';

const TOKEN_KEY = 'session_token';

/** Registers the shared credential-isolation cases for one extension. */
export function describeCredentialIsolation(
  extensionName: string,
  harness: CredentialIsolationHarness
): void {
  describe(`${extensionName} credential isolation`, () => {
    const originalFetch = globalThis.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    let instance: ExtensionFactoryResult | undefined;

    function ensureInstance(): ExtensionFactoryResult {
      instance ??= harness.createExtension(TOKEN_KEY);
      return instance;
    }

    function callProbe(ctx: RuntimeContext): Promise<RillValue> {
      const callable = (
        ensureInstance().value as Record<string, ApplicationCallable>
      )[harness.call.name];
      if (callable === undefined) {
        return Promise.reject(
          new Error(`extension has no function '${harness.call.name}'`)
        );
      }
      return Promise.resolve().then(() =>
        callable.fn({ ...harness.call.args }, ctx)
      );
    }

    function authHeaders(): (string | null)[] {
      return fetchMock.mock.calls.map((call) =>
        new Headers((call[1] as RequestInit).headers).get('authorization')
      );
    }

    function expectInvalidAuth(result: RillValue, kind: string): void {
      expect(isInvalid(result)).toBe(true);
      const status = getStatus(result);
      expect(status.code.name).toBe('AUTH');
      expect((status.raw as { kind: string }).kind).toBe(kind);
    }

    beforeEach(() => {
      fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(harness.okBody), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await instance?.dispose?.();
      instance = undefined;
    });

    it('sends each call its own host token across sequential calls', async () => {
      for (const token of ['A', 'B', 'A']) {
        const result = await callProbe(
          createRuntimeContext({ hostContext: { [TOKEN_KEY]: token } })
        );
        expect(isInvalid(result)).toBe(false);
      }

      expect(authHeaders()).toEqual(['Bearer A', 'Bearer B', 'Bearer A']);
    });

    it('keeps concurrent calls on separate tokens', async () => {
      const results = await Promise.all(
        ['A', 'B'].map((token) =>
          callProbe(
            createRuntimeContext({ hostContext: { [TOKEN_KEY]: token } })
          )
        )
      );

      expect(results.map((r) => isInvalid(r))).toEqual([false, false]);
      expect(new Set(authHeaders())).toEqual(new Set(['Bearer A', 'Bearer B']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a script variable when the host context has no token', async () => {
      const result = await callProbe(
        createRuntimeContext({ variables: { [TOKEN_KEY]: 'script-token' } })
      );

      expectInvalidAuth(result, 'session_token_missing');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prefers the host context token over a script variable', async () => {
      await callProbe(
        createRuntimeContext({
          variables: { [TOKEN_KEY]: 'script-token' },
          hostContext: { [TOKEN_KEY]: 'host-token' },
        })
      );

      expect(authHeaders()).toEqual(['Bearer host-token']);
    });

    it('reads the token from the parent context in a child context', async () => {
      const parent = createRuntimeContext({
        hostContext: { [TOKEN_KEY]: 'parent-token' },
      });
      const child = createChildContext(parent);

      const result = await callProbe(child);

      expect(isInvalid(result)).toBe(false);
      expect(authHeaders()).toEqual(['Bearer parent-token']);
    });

    it('rejects a non-string token without leaking its value', async () => {
      const result = await callProbe(
        createRuntimeContext({
          hostContext: { [TOKEN_KEY]: { secret: 's3cr3t' } },
        })
      );

      expectInvalidAuth(result, 'invalid_session_token');
      const status = getStatus(result);
      expect(status.message).not.toContain('s3cr3t');
      expect(JSON.stringify(status.raw)).not.toContain('s3cr3t');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}
