/**
 * Unit tests for dispose() functionality.
 *
 * Coverage:
 * - BC-5: dispose() is idempotent (subsequent calls no-op)
 * - IR-1: ExtensionResult returned with dispose handler
 * - IR-2: Tool functions callable from ExtensionResult
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpExtension } from '../../src/factory.js';
import {
  makeFactoryCtx,
  makeRuntimeCtx,
  getCallable,
  expectRejectsInvalid,
} from '../_helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createRuntimeContext,
  execute,
  getStatus,
  parse,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { McpExtensionConfig } from '../../src/types.js';

describe('dispose() functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
      resources: {},
      prompts: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BC-5: dispose() idempotent', () => {
    it('rejects pending call and later calls with DISPOSED after dispose (BC-5)', async () => {
      let rejectToolCall: (reason: Error) => void = () => {};
      const toolCallPromise = new Promise<CallToolResult>((_, reject) => {
        rejectToolCall = reject;
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      const mockClose = vi
        .spyOn(Client.prototype, 'close')
        .mockImplementation(() => {
          // The real SDK rejects pending requests when the transport closes
          rejectToolCall(new Error('MCP error -32000: Connection closed'));
          return Promise.resolve();
        });
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'long_running_tool',
            description: 'Simulates long-running operation',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });
      const mockCallTool = vi
        .spyOn(Client.prototype, 'callTool')
        .mockImplementation(() => toolCallPromise);

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config, makeFactoryCtx());
      const fns = result.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;
      const tool = getCallable(tools, 'long_running_tool');

      let settled = false;
      const pendingCall = Promise.resolve(tool.fn({}, makeRuntimeCtx()));
      const settledTracker = pendingCall
        .then(() => {
          settled = true;
        })
        .catch(() => {
          settled = true;
        });

      // The call stays pending until dispose closes the connection
      await Promise.resolve();
      expect(settled).toBe(false);

      await result.dispose?.();

      expect(mockClose).toHaveBeenCalledTimes(1);

      const pendingError = await pendingCall;
      await settledTracker;
      expect(settled).toBe(true);
      const pendingStatus = getStatus(pendingError);
      expect(pendingStatus.code.name).toBe('DISPOSED');
      expect((pendingStatus.raw as { kind?: unknown }).kind).toBe(
        'extension_disposed'
      );

      const latePromise = Promise.resolve(tool.fn({}, makeRuntimeCtx()));
      await expect(latePromise).rejects.toBeInstanceOf(RuntimeHaltSignal);
      const lateError = await expectRejectsInvalid(latePromise);
      const lateStatus = getStatus(lateError);
      expect(lateStatus.code.name).toBe('DISPOSED');
      expect((lateStatus.raw as { kind?: unknown }).kind).toBe(
        'extension_disposed'
      );

      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });
  });

  describe('IR-1 & IR-2: ExtensionResult with tool functions', () => {
    it('returns ExtensionResult with callable tool functions', async () => {
      // Mock connection with one tool
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string' },
              },
              required: ['param1'],
            },
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });
      vi.spyOn(Client.prototype, 'callTool').mockResolvedValue({
        content: [{ type: 'text', text: 'success' }],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const result = await createMcpExtension(config, makeFactoryCtx());
      const fns = result.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;

      // IR-1: Result has dispose function
      expect(result.dispose).toBeDefined();
      expect(typeof result.dispose).toBe('function');

      // IR-1: Result has tool function in tools dict
      expect(tools['test_tool']).toBeDefined();
      expect(typeof tools['test_tool']).toBe('object');
      const testTool = getCallable(tools, 'test_tool');
      expect(testTool.fn).toBeDefined();
      expect(typeof testTool.fn).toBe('function');

      // IR-2: Tool function is callable
      const toolResult = await testTool.fn({ param1: 'value1' }, {
        _lifecycle: { connectEmitted: false },
      } as unknown as RuntimeContext);
      expect(toolResult).toBe('success');

      // Cleanup
      await result.dispose?.();
    });
  });
});

describe('mcp extension - runtime dispatch after dispose', () => {
  beforeEach(() => {
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
    vi.spyOn(Client.prototype, 'close').mockResolvedValue();
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
    });
    vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [
        {
          name: 'ping',
          description: 'Ping tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = await createMcpExtension(
      { transport: { type: 'stdio', command: 'echo', args: ['test'] } },
      makeFactoryCtx()
    );
    const tools = (ext.value as Record<string, unknown>)['tools'] as Record<
      string,
      unknown
    >;
    const ctx = createRuntimeContext({
      functions: { ping: getCallable(tools, 'ping') },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('ping()'), ctx).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const ctx = await mountDisposed();

    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { ping() }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
