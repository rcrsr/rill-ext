/**
 * Error mapping utilities tests for the MCP extension (rill 0.19+).
 *
 * Factory-time helpers throw `RuntimeError(RILL-R001)`. Runtime helpers
 * accept a `RuntimeContext` and return invalid `RillValue`s carrying generic
 * atoms via `ctx.invalidate`.
 */

import { describe, it, expect } from 'vitest';
import {
  RuntimeError,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { makeRuntimeCtx } from './_helpers.js';
import {
  factoryError,
  processExitError,
  connectionRefusedError,
  authRequiredError,
  failTool,
  failNotFound,
  failProtocol,
  failTimeout,
  failConnectionLost,
  failAuth,
  failInput,
  failUnavailable,
  mapMcpError,
} from '../src/errors.js';

describe('Factory-time helpers (RILL-R001)', () => {
  it('factoryError builds RuntimeError(RILL-R001) with mcp: prefix', () => {
    const err = factoryError('invalid configuration');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R001');
    expect(err.message).toContain('mcp: invalid configuration');
  });

  it('processExitError formats process exit message', () => {
    const err = processExitError(127);
    expect(err.message).toContain('server process exited with code 127');
    expect(err.context?.['exitCode']).toBe(127);
  });

  it('connectionRefusedError includes URL', () => {
    const err = connectionRefusedError('http://localhost:8080');
    expect(err.message).toContain(
      'connection refused at http://localhost:8080'
    );
  });

  it('authRequiredError mentions OAuth', () => {
    const err = authRequiredError();
    expect(err.message).toContain('authentication');
  });
});

describe('Runtime helpers emit invalid RillValues', () => {
  function expectAtom(value: RillValue, atom: string, needle: string): void {
    expect(isInvalid(value)).toBe(true);
    const status = getStatus(value);
    expect(status.code.name).toBe(atom);
    expect(status.message).toContain(needle);
  }

  it('failTool maps to #UNAVAILABLE with tool_error kind', () => {
    const ctx = makeRuntimeCtx();
    const value = failTool(ctx, 'read_file', 'file not found');
    expectAtom(value, 'UNAVAILABLE', 'mcp tool "read_file": file not found');
    const status = getStatus(value);
    expect(status.provider).toBe('mcp');
    expect(status.raw).toMatchObject({
      kind: 'tool_error',
      toolName: 'read_file',
      errorText: 'file not found',
    });
  });

  it('failNotFound maps to #NOT_FOUND', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(
      failNotFound(ctx, 'missing_tool', 'no such tool'),
      'NOT_FOUND',
      'missing_tool'
    );
  });

  it('failProtocol maps to #PROTOCOL', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(
      failProtocol(ctx, 'invalid message format'),
      'PROTOCOL',
      'invalid message format'
    );
  });

  it('failTimeout maps to #TIMEOUT and includes timeoutMs', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(failTimeout(ctx, 'read_file', 30000), 'TIMEOUT', '30000ms');
  });

  it('failConnectionLost maps to #UNAVAILABLE', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(failConnectionLost(ctx), 'UNAVAILABLE', 'connection lost');
  });

  it('failAuth maps to #AUTH', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(failAuth(ctx), 'AUTH', 'authentication failed');
  });

  it('failInput maps to #INVALID_INPUT', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(
      failInput(ctx, 'bad parameter'),
      'INVALID_INPUT',
      'bad parameter'
    );
  });

  it('failUnavailable maps to #UNAVAILABLE', () => {
    const ctx = makeRuntimeCtx();
    expectAtom(
      failUnavailable(ctx, 'server unreachable'),
      'UNAVAILABLE',
      'server unreachable'
    );
  });
});

describe('mapMcpError detector', () => {
  it('passes through existing invalid RillValues', () => {
    const ctx = makeRuntimeCtx();
    const original = failTimeout(ctx, 'tool', 1000);
    const mapped = mapMcpError(ctx, original, 'tool');
    expect(mapped).toBe(original);
  });

  it.each([
    { message: 'connection closed unexpectedly' },
    { message: 'connection lost' },
    { message: 'disconnected from server' },
  ])('detects connection-lost message "$message"', ({ message }) => {
    const ctx = makeRuntimeCtx();
    const status = getStatus(mapMcpError(ctx, new Error(message), 'tool'));
    expect(status.code.name).toBe('UNAVAILABLE');
    expect(status.message).toContain('mcp: connection lost');
    expect(status.raw).toMatchObject({ kind: 'connection_lost' });
  });

  it.each([
    { message: 'unauthorized' },
    { message: 'authentication failed' },
    { message: 'invalid token' },
  ])('detects auth message "$message"', ({ message }) => {
    const ctx = makeRuntimeCtx();
    const status = getStatus(mapMcpError(ctx, new Error(message), 'tool'));
    expect(status.code.name).toBe('AUTH');
    expect(status.message).toContain(
      'mcp: authentication failed -- token may be expired'
    );
    expect(status.raw).toMatchObject({ kind: 'auth_failed' });
  });

  it.each([
    { message: 'malformed JSON-RPC response' },
    { message: 'protocol error: invalid json' },
    { message: 'invalid response format' },
    { message: 'parse failed' },
  ])('detects protocol message "$message"', ({ message }) => {
    const ctx = makeRuntimeCtx();
    const status = getStatus(mapMcpError(ctx, new Error(message), 'tool'));
    expect(status.code.name).toBe('PROTOCOL');
    expect(status.message).toContain('mcp: protocol error');
    expect(status.raw).toMatchObject({
      kind: 'protocol_error',
      detail: message,
    });
  });

  it('falls back to #UNAVAILABLE tool_error for unknown errors', () => {
    const ctx = makeRuntimeCtx();
    const status = getStatus(
      mapMcpError(ctx, new Error('some other failure'), 'my_tool')
    );
    expect(status.code.name).toBe('UNAVAILABLE');
    expect(status.message).toContain('my_tool');
    expect(status.raw).toMatchObject({
      kind: 'tool_error',
      toolName: 'my_tool',
      errorText: 'some other failure',
    });
  });

  it('handles non-Error throwables', () => {
    const ctx = makeRuntimeCtx();
    const mapped = mapMcpError(ctx, 'plain string', 'my_tool');
    expect(getStatus(mapped).code.name).toBe('UNAVAILABLE');
  });
});
