/**
 * Unit tests for lifecycle event emission.
 *
 * Verifies that the MCP extension emits correct lifecycle events at proper times:
 * - mcp:connect: Emitted once on first tool/resource/prompt call
 * - mcp:tool_call: Emitted per tool invocation with tool name and params
 * - mcp:resource_read: Emitted per resource read with URI
 * - mcp:prompt_get: Emitted per prompt call with prompt name and params
 * - mcp:error: Emitted on errors (timeout, connection lost, auth, protocol)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { emitExtensionEvent, getStatus, RuntimeHaltSignal } from '@rcrsr/rill';
import type { RillFunction, RillValue, RuntimeContext } from '@rcrsr/rill';
import { generateToolFunctions, type McpTool } from '../../src/tools.js';
import { expectRejectsInvalid, makeRuntimeCtx } from '../_helpers.js';
import {
  createReadResourceFunction,
  generateResourceTemplateFunctions,
  generateStaticResourceFunctions,
  type McpResourceTemplate,
} from '../../src/resources.js';
import { generatePromptFunctions, type McpPrompt } from '../../src/prompts.js';

// Mock emitExtensionEvent to capture event emissions
vi.mock('@rcrsr/rill', async () => {
  const actual = await vi.importActual('@rcrsr/rill');
  return {
    ...actual,
    emitExtensionEvent: vi.fn(),
  };
});

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create runtime context for testing. The MCP error helpers depend on
 * `ctx.invalidate`, which only the real RuntimeContext provides.
 */
function createMockContext(): RuntimeContext {
  return makeRuntimeCtx();
}

/**
 * Reset all mocks before each test.
 */
beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// MCP:CONNECT EVENT TESTS
// ============================================================

describe('mcp:connect event', () => {
  it('emits on first tool call', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const lifecycleState = { connectEmitted: false };
    const functions = generateToolFunctions(
      tools,
      mockClient,
      30000,
      lifecycleState
    );

    const ctx = createMockContext();
    await functions['test_tool']!.fn({}, ctx);

    // Verify mcp:connect emitted
    expect(emitExtensionEvent).toHaveBeenCalledWith(ctx, {
      event: 'mcp:connect',
      subsystem: 'extension:mcp',
    });

    // Verify emitted before tool_call
    const calls = vi.mocked(emitExtensionEvent).mock.calls;
    const connectIndex = calls.findIndex(
      (call) => call[1]['event'] === 'mcp:connect'
    );
    const toolCallIndex = calls.findIndex(
      (call) => call[1]['event'] === 'mcp:tool_call'
    );
    expect(connectIndex).toBeLessThan(toolCallIndex);
  });

  it('emits only once on multiple tool calls', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const lifecycleState = { connectEmitted: false };
    const functions = generateToolFunctions(
      tools,
      mockClient,
      30000,
      lifecycleState
    );

    const ctx = createMockContext();

    // Call tool three times
    await functions['test_tool']!.fn({}, ctx);
    await functions['test_tool']!.fn({}, ctx);
    await functions['test_tool']!.fn({}, ctx);

    // Verify mcp:connect emitted only once
    const connectCalls = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:connect');
    expect(connectCalls).toHaveLength(1);

    // Verify tool_call emitted three times
    const toolCallCalls = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:tool_call');
    expect(toolCallCalls).toHaveLength(3);
  });

  it('emits on first resource read', async () => {
    const mockClient = {
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'test://resource',
            text: 'content',
          },
        ],
      }),
    } as unknown as Client;

    const lifecycleState = { connectEmitted: false };
    const func = createReadResourceFunction(mockClient, 30000, lifecycleState);

    const ctx = createMockContext();
    await func.fn({ uri: 'test://resource' }, ctx);

    // Verify mcp:connect emitted
    expect(emitExtensionEvent).toHaveBeenCalledWith(ctx, {
      event: 'mcp:connect',
      subsystem: 'extension:mcp',
    });
  });

  it('emits on first prompt call', async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'message' } },
        ],
      }),
    } as unknown as Client;

    const prompts: McpPrompt[] = [
      {
        name: 'test-prompt',
        description: 'Test prompt',
        arguments: [],
      },
    ];

    const lifecycleState = { connectEmitted: false };
    const functions = generatePromptFunctions(
      prompts,
      mockClient,
      30000,
      lifecycleState
    );

    const ctx = createMockContext();
    await functions['test_prompt']!.fn({}, ctx);

    // Verify mcp:connect emitted
    expect(emitExtensionEvent).toHaveBeenCalledWith(ctx, {
      event: 'mcp:connect',
      subsystem: 'extension:mcp',
    });
  });

  it('shares state across tools, resources, and prompts', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
      readResource: vi.fn().mockResolvedValue({
        contents: [{ uri: 'test://resource', text: 'content' }],
      }),
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'message' } },
        ],
      }),
    } as unknown as Client;

    const lifecycleState = { connectEmitted: false };

    const tools: McpTool[] = [
      {
        name: 'test-tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    const prompts: McpPrompt[] = [{ name: 'test-prompt', arguments: [] }];

    const toolFunctions = generateToolFunctions(
      tools,
      mockClient,
      30000,
      lifecycleState
    );
    const resourceFunction = createReadResourceFunction(
      mockClient,
      30000,
      lifecycleState
    );
    const promptFunctions = generatePromptFunctions(
      prompts,
      mockClient,
      30000,
      lifecycleState
    );

    const ctx = createMockContext();

    // First call to tool emits connect
    await toolFunctions['test_tool']!.fn({}, ctx);

    // Second call to resource does not emit connect
    vi.clearAllMocks();
    await resourceFunction.fn({ uri: 'test://resource' }, ctx);

    // Verify mcp:connect NOT emitted on second operation
    const connectCalls = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:connect');
    expect(connectCalls).toHaveLength(0);

    // Third call to prompt does not emit connect
    vi.clearAllMocks();
    await promptFunctions['test_prompt']!.fn({}, ctx);

    // Verify mcp:connect NOT emitted on third operation
    const connectCallsAfterPrompt = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:connect');
    expect(connectCallsAfterPrompt).toHaveLength(0);
  });
});

// ============================================================
// MCP:TOOL_CALL EVENT TESTS
// ============================================================

describe('mcp:tool_call event', () => {
  it('emits with correct tool name and params', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
            arg2: { type: 'number' },
          },
          required: ['arg1'],
        },
      },
    ];

    const functions = generateToolFunctions(tools, mockClient, 30000);
    const ctx = createMockContext();

    await functions['test_tool']!.fn({ arg1: 'value1', arg2: 42 }, ctx);

    // Verify mcp:tool_call emitted with correct structure
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:tool_call',
        subsystem: 'extension:mcp',
        tool: 'test-tool',
        params: { arg1: 'value1', arg2: 42 },
      })
    );
  });

  it('emits with empty params for no-argument tools', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'no-arg-tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const functions = generateToolFunctions(tools, mockClient, 30000);
    const ctx = createMockContext();

    await functions['no_arg_tool']!.fn({}, ctx);

    // Verify mcp:tool_call emitted with empty params
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:tool_call',
        subsystem: 'extension:mcp',
        tool: 'no-arg-tool',
        params: {},
      })
    );
  });

  it('emits on each tool invocation', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'tool1',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'tool2',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const functions = generateToolFunctions(tools, mockClient, 30000);
    const ctx = createMockContext();

    // Call different tools
    await functions['tool1']!.fn({}, ctx);
    await functions['tool2']!.fn({}, ctx);
    await functions['tool1']!.fn({}, ctx);

    // Verify three tool_call events
    const toolCallEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:tool_call');
    expect(toolCallEvents).toHaveLength(3);

    // Verify correct tool names
    expect(toolCallEvents[0]![1]).toMatchObject({ tool: 'tool1' });
    expect(toolCallEvents[1]![1]).toMatchObject({ tool: 'tool2' });
    expect(toolCallEvents[2]![1]).toMatchObject({ tool: 'tool1' });
  });
});

// ============================================================
// MCP:RESOURCE_READ EVENT TESTS
// ============================================================

describe('mcp:resource_read event', () => {
  it('emits with URI for static resource read', async () => {
    const mockClient = {
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'config://app',
            text: 'content',
          },
        ],
      }),
    } as unknown as Client;

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const ctx = createMockContext();

    await func.fn({ uri: 'config://app' }, ctx);

    // Verify mcp:resource_read emitted with URI
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:resource_read',
        subsystem: 'extension:mcp',
        uri: 'config://app',
      })
    );
  });

  it('emits with URI for template resource read', async () => {
    const mockClient = {
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'db://table/users',
            text: 'content',
          },
        ],
      }),
    } as unknown as Client;

    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}',
        name: 'read_table',
        description: 'Read table',
      },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000,
      { connectEmitted: false }
    );
    const ctx = createMockContext();

    await functions['resource_read_table']!.fn({ tableName: 'users' }, ctx);

    // Verify mcp:resource_read emitted with resolved URI
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:resource_read',
        subsystem: 'extension:mcp',
        uri: 'db://table/users',
      })
    );
  });

  it('emits on each resource read', async () => {
    const mockClient = {
      readResource: vi
        .fn()
        .mockResolvedValueOnce({
          contents: [{ uri: 'resource1', text: 'content1' }],
        })
        .mockResolvedValueOnce({
          contents: [{ uri: 'resource2', text: 'content2' }],
        }),
    } as unknown as Client;

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const ctx = createMockContext();

    await func.fn({ uri: 'resource1' }, ctx);
    await func.fn({ uri: 'resource2' }, ctx);

    // Verify two resource_read events
    const resourceReadEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:resource_read');
    expect(resourceReadEvents).toHaveLength(2);

    // Verify correct URIs
    expect(resourceReadEvents[0]![1]).toMatchObject({ uri: 'resource1' });
    expect(resourceReadEvents[1]![1]).toMatchObject({ uri: 'resource2' });
  });
});

// ============================================================
// MCP:PROMPT_GET EVENT TESTS
// ============================================================

describe('mcp:prompt_get event', () => {
  it('emits with prompt name and params', async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'message' } },
        ],
      }),
    } as unknown as Client;

    const prompts: McpPrompt[] = [
      {
        name: 'test-prompt',
        description: 'Test prompt',
        arguments: [
          { name: 'arg1', required: true },
          { name: 'arg2', required: false },
        ],
      },
    ];

    const functions = generatePromptFunctions(prompts, mockClient, 30000);
    const ctx = createMockContext();

    await functions['test_prompt']!.fn({ arg1: 'value1', arg2: 'value2' }, ctx);

    // Verify mcp:prompt_get emitted with correct structure
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:prompt_get',
        subsystem: 'extension:mcp',
        prompt: 'test-prompt',
        params: { arg1: 'value1', arg2: 'value2' },
      })
    );
  });

  it('emits with empty params for no-argument prompts', async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'message' } },
        ],
      }),
    } as unknown as Client;

    const prompts: McpPrompt[] = [
      {
        name: 'no-arg-prompt',
        arguments: [],
      },
    ];

    const functions = generatePromptFunctions(prompts, mockClient, 30000);
    const ctx = createMockContext();

    await functions['no_arg_prompt']!.fn({}, ctx);

    // Verify mcp:prompt_get emitted with empty params
    expect(emitExtensionEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: 'mcp:prompt_get',
        subsystem: 'extension:mcp',
        prompt: 'no-arg-prompt',
        params: {},
      })
    );
  });

  it('emits on each prompt invocation', async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'message' } },
        ],
      }),
    } as unknown as Client;

    const prompts: McpPrompt[] = [
      { name: 'prompt1', arguments: [] },
      { name: 'prompt2', arguments: [] },
    ];

    const functions = generatePromptFunctions(prompts, mockClient, 30000);
    const ctx = createMockContext();

    await functions['prompt1']!.fn({}, ctx);
    await functions['prompt2']!.fn({}, ctx);
    await functions['prompt1']!.fn({}, ctx);

    // Verify three prompt_get events
    const promptGetEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:prompt_get');
    expect(promptGetEvents).toHaveLength(3);

    // Verify correct prompt names
    expect(promptGetEvents[0]![1]).toMatchObject({ prompt: 'prompt1' });
    expect(promptGetEvents[1]![1]).toMatchObject({ prompt: 'prompt2' });
    expect(promptGetEvents[2]![1]).toMatchObject({ prompt: 'prompt1' });
  });
});

// ============================================================
// MCP:ERROR EVENT TESTS
// ============================================================

describe('mcp:error event', () => {
  it('emits on timeout error', async () => {
    const mockClient = {
      callTool: vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100000))
        ),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'slow-tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const functions = generateToolFunctions(tools, mockClient, 100);
    const ctx = createMockContext();

    await expect(functions['slow_tool']!.fn({}, ctx)).rejects.toThrow();

    // Verify mcp:error emitted
    const errorEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:error');
    expect(errorEvents).toHaveLength(1);

    // Verify error contains timeout information
    expect(errorEvents[0]![1]).toMatchObject({
      event: 'mcp:error',
      subsystem: 'extension:mcp',
      tool: 'slow-tool',
    });
    expect(errorEvents[0]![1]['error']).toContain('timeout');
  });

  it.each([
    { title: 'emits on connection lost error', message: 'connection closed' },
    { title: 'emits on authentication error', message: 'unauthorized' },
    { title: 'emits on protocol error', message: 'invalid response' },
  ])('$title', async ({ message }) => {
    const mockClient = {
      callTool: vi.fn().mockRejectedValue(new Error(message)),
    } as unknown as Client;

    const tools: McpTool[] = [
      {
        name: 'test-tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const functions = generateToolFunctions(tools, mockClient, 30000);
    const ctx = createMockContext();

    await expect(functions['test_tool']!.fn({}, ctx)).rejects.toThrow();

    // Verify mcp:error emitted
    const errorEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]![1]['error']).toContain(message);
  });

  it('emits on resource read errors', async () => {
    const mockClient = {
      readResource: vi.fn().mockRejectedValue(new Error('resource not found')),
    } as unknown as Client;

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const ctx = createMockContext();

    await expect(func.fn({ uri: 'missing://resource' }, ctx)).rejects.toThrow();

    // Verify mcp:error emitted
    const errorEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]![1]['error']).toContain('resource not found');
  });

  it('emits on prompt errors', async () => {
    const mockClient = {
      getPrompt: vi.fn().mockRejectedValue(new Error('prompt not found')),
    } as unknown as Client;

    const prompts: McpPrompt[] = [
      {
        name: 'test-prompt',
        arguments: [],
      },
    ];

    const functions = generatePromptFunctions(prompts, mockClient, 30000);
    const ctx = createMockContext();

    await expect(functions['test_prompt']!.fn({}, ctx)).rejects.toThrow();

    // Verify mcp:error emitted
    const errorEvents = vi
      .mocked(emitExtensionEvent)
      .mock.calls.filter((call) => call[1]['event'] === 'mcp:error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]![1]['error']).toContain('prompt not found');
  });
});

// ============================================================
// DISPOSED GUARD TESTS
// ============================================================

describe('disposed guard', () => {
  function createDisposedHarness(disposed = true): {
    client: {
      callTool: ReturnType<typeof vi.fn>;
      readResource: ReturnType<typeof vi.fn>;
      getPrompt: ReturnType<typeof vi.fn>;
    };
    lifecycleState: { connectEmitted: boolean; disposed: boolean };
    closures: Record<
      string,
      { fn: RillFunction['fn']; args: Record<string, unknown> }
    >;
  } {
    const client = {
      callTool: vi.fn(),
      readResource: vi.fn(),
      getPrompt: vi.fn(),
    };
    const lifecycleState = { connectEmitted: false, disposed };
    const sdkClient = client as unknown as Client;

    const tools = generateToolFunctions(
      [{ name: 'test-tool', inputSchema: { type: 'object', properties: {} } }],
      sdkClient,
      30000,
      lifecycleState
    );
    const statics = generateStaticResourceFunctions(
      [{ uri: 'config://app', name: 'app' }],
      sdkClient,
      30000,
      lifecycleState
    );
    const templates = generateResourceTemplateFunctions(
      [{ uriTemplate: 'db://table/{tableName}', name: 'read_table' }],
      sdkClient,
      30000,
      lifecycleState
    );
    const prompts = generatePromptFunctions(
      [{ name: 'test-prompt', arguments: [] }],
      sdkClient,
      30000,
      lifecycleState
    );
    const readResource = createReadResourceFunction(
      sdkClient,
      30000,
      lifecycleState
    );

    return {
      client,
      lifecycleState,
      closures: {
        tool: { fn: tools['test_tool']!.fn, args: {} },
        read_resource: { fn: readResource.fn, args: { uri: 'test://r' } },
        static_resource: { fn: statics['resource_app']!.fn, args: {} },
        resource_template: {
          fn: templates['resource_read_table']!.fn,
          args: { tableName: 'users' },
        },
        prompt: { fn: prompts['test_prompt']!.fn, args: {} },
      },
    };
  }

  const CLOSURE_NAMES = [
    'tool',
    'read_resource',
    'static_resource',
    'resource_template',
    'prompt',
  ] as const;

  describe.each(CLOSURE_NAMES)('%s closure', (name) => {
    it('rejects with DISPOSED and raw.kind extension_disposed', async () => {
      const { closures } = createDisposedHarness();
      const closure = closures[name]!;

      const call = Promise.resolve(
        closure.fn(closure.args as never, createMockContext())
      );
      await expect(call).rejects.toBeInstanceOf(RuntimeHaltSignal);
      const caught = await expectRejectsInvalid(call);

      const status = getStatus(caught);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
    });

    it('emits no events', async () => {
      const { closures } = createDisposedHarness();
      const closure = closures[name]!;

      await expectRejectsInvalid(
        closure.fn(closure.args as never, createMockContext())
      );

      expect(emitExtensionEvent).not.toHaveBeenCalled();
    });

    it('leaves the client untouched', async () => {
      const { client, closures } = createDisposedHarness();
      const closure = closures[name]!;

      await expectRejectsInvalid(
        closure.fn(closure.args as never, createMockContext())
      );

      expect(client.callTool).not.toHaveBeenCalled();
      expect(client.readResource).not.toHaveBeenCalled();
      expect(client.getPrompt).not.toHaveBeenCalled();
    });

    it('keeps connectEmitted false', async () => {
      const { lifecycleState, closures } = createDisposedHarness();
      const closure = closures[name]!;

      await expectRejectsInvalid(
        closure.fn(closure.args as never, createMockContext())
      );

      expect(lifecycleState.connectEmitted).toBe(false);
    });
  });

  it('reports DISPOSED for a template call with a non-string argument', async () => {
    const { closures } = createDisposedHarness();
    const closure = closures['resource_template']!;

    const caught = await expectRejectsInvalid(
      closure.fn({ tableName: 42 } as never, createMockContext())
    );

    expect(getStatus(caught).code.name).toBe('DISPOSED');
  });

  describe.each(CLOSURE_NAMES)('%s closure with a call in flight', (name) => {
    function runInFlight(disposeFirst: boolean): Promise<RillValue> {
      const harness = createDisposedHarness(false);
      let rejectCall: (reason: Error) => void = () => {};
      const pending = new Promise<never>((_, reject) => {
        rejectCall = reject;
      });
      harness.client.callTool.mockReturnValue(pending);
      harness.client.readResource.mockReturnValue(pending);
      harness.client.getPrompt.mockReturnValue(pending);
      const closure = harness.closures[name]!;

      const call = closure.fn(closure.args as never, createMockContext());
      if (disposeFirst) harness.lifecycleState.disposed = true;
      rejectCall(new Error('MCP error -32000: Connection closed'));

      return Promise.resolve(call);
    }

    it('resolves DISPOSED when dispose closes the connection', async () => {
      const status = getStatus(await runInFlight(true));

      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
      expect(emitExtensionEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'mcp:error' })
      );
    });

    it('reports connection_lost when the transport drops without dispose', async () => {
      const status = getStatus(await expectRejectsInvalid(runInFlight(false)));

      expect(status.code.name).toBe('UNAVAILABLE');
      expect(status.raw['kind']).toBe('connection_lost');
    });
  });
});
