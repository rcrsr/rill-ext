import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  type RuntimeContext,
} from '@rcrsr/rill';
import { readHostCredential } from '../src/index.js';

const OPTIONS = { key: 'tok', provider: 'acme', label: 'acme auth' } as const;

function capture(ctx: RuntimeContext, key: string = OPTIONS.key): unknown {
  try {
    readHostCredential(ctx, { ...OPTIONS, key });
  } catch (e) {
    return e;
  }
  return undefined;
}

function thrownStatus(thrown: unknown): ReturnType<typeof getStatus> {
  expect(isInvalid(thrown as never)).toBe(true);
  return getStatus(thrown as never);
}

describe('readHostCredential', () => {
  describe('when the token is present', () => {
    it('returns the token string', () => {
      const ctx = createRuntimeContext({ hostContext: { tok: 'abc' } });
      expect(readHostCredential(ctx, OPTIONS)).toBe('abc');
    });
  });

  describe('when the token is absent', () => {
    it('throws #AUTH session_token_missing', () => {
      const status = thrownStatus(capture(createRuntimeContext()));
      expect(status.code.name).toBe('AUTH');
      expect(status.message).toBe("acme auth: session token 'tok' not found");
      expect(status.provider).toBe('acme');
      expect(status.raw).toEqual({
        kind: 'session_token_missing',
        message: "acme auth: session token 'tok' not found",
        token_var: 'tok',
      });
    });

    it('treats an own undefined value as absent', () => {
      const ctx = createRuntimeContext({ hostContext: { tok: undefined } });
      const status = thrownStatus(capture(ctx));
      expect((status.raw as { kind: string }).kind).toBe(
        'session_token_missing'
      );
    });

    it('treats an inherited key as absent', () => {
      const status = thrownStatus(capture(createRuntimeContext(), 'toString'));
      expect((status.raw as { kind: string }).kind).toBe(
        'session_token_missing'
      );
    });

    it('ignores a script variable of the same name', () => {
      const ctx = createRuntimeContext({ variables: { tok: 'script' } });
      const status = thrownStatus(capture(ctx));
      expect((status.raw as { kind: string }).kind).toBe(
        'session_token_missing'
      );
    });
  });

  describe('when the value is not a non-empty string', () => {
    it.each([
      ['a number', 42],
      ['an empty string', ''],
    ])('throws #AUTH invalid_session_token for %s', (_name, value) => {
      const ctx = createRuntimeContext({ hostContext: { tok: value } });
      const status = thrownStatus(capture(ctx));
      expect(status.code.name).toBe('AUTH');
      expect(status.message).toBe(
        "acme auth: session token 'tok' must be a non-empty string"
      );
      expect(status.raw).toEqual({
        kind: 'invalid_session_token',
        message: "acme auth: session token 'tok' must be a non-empty string",
        token_var: 'tok',
      });
    });

    it('omits the credential value from the error', () => {
      const ctx = createRuntimeContext({
        hostContext: { tok: { secret: 's3cr3t' } },
      });
      const status = thrownStatus(capture(ctx));
      expect(status.message).not.toContain('s3cr3t');
      expect(JSON.stringify(status.raw)).not.toContain('s3cr3t');
    });
  });

  describe('when a script references the key as a variable', () => {
    it('does not expose the host context token', async () => {
      const ctx = createRuntimeContext({ hostContext: { tok: 'h0st-t0ken' } });
      let output: unknown;
      try {
        const result = await execute(parse('$tok'), ctx);
        output = result.result;
      } catch (e) {
        output = e;
      }
      const text =
        typeof output === 'string' ? output : (JSON.stringify(output) ?? '');
      expect(text).not.toContain('h0st-t0ken');
    });
  });
});
