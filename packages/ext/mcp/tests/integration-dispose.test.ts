/**
 * Integration tests for dispose and connection lifecycle.
 *
 * Coverage:
 * - BC-5: Dispose during active call - kills process, pending call rejects with #DISPOSED
 * - BC-5: Idempotent dispose - second call is no-op
 * - BC-5: Calls after dispose halt with #DISPOSED
 *
 * These integration tests use real MCP client/transport (mocked at SDK level)
 * to verify disposal behavior in realistic scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getStatus, type RillValue } from '@rcrsr/rill';
import { createMcpExtension } from '../src/factory.js';
import {
  makeFactoryCtx,
  makeRuntimeCtx,
  getCallable,
  expectRejectsHalt,
} from './_helpers.js';
import type { McpExtensionConfig } from '../src/types.js';

function expectDisposedStatus(value: RillValue): void {
  const status = getStatus(value);
  expect(status.code.name).toBe('DISPOSED');
  expect(status.provider).toBe('mcp');
  expect((status.raw as Record<string, unknown>)['kind']).toBe(
    'extension_disposed'
  );
}

describe('Integration: Dispose and Connection Lifecycle', () => {
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

  describe('BC-5: Dispose during active tool call', () => {
    it('kills connection and pending call throws DISPOSED', async () => {
      // Mock a tool that simulates a long-running operation
      let toolCallController: {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      };
      const pendingToolCall = new Promise((resolve, reject) => {
        toolCallController = { resolve, reject };
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(async () => {
        // Simulate client.close() causing pending operations to fail
        toolCallController.reject(
          new McpError(ErrorCode.ConnectionClosed, 'Connection closed')
        );
        return undefined;
      });
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'long_operation',
            description: 'Simulates long-running operation',
            inputSchema: {
              type: 'object',
              properties: {},
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

      // Mock callTool to return the pending promise
      vi.spyOn(Client.prototype, 'callTool').mockReturnValue(
        pendingToolCall as unknown as ReturnType<Client['callTool']>
      );

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;

      // Start a long-running tool call
      const toolCallPromise = getCallable(tools, 'long_operation').fn(
        {},
        makeRuntimeCtx()
      );

      // Immediately dispose while the tool call is pending
      await extension.dispose?.();

      // The pending tool call throws the disposal, not the transport error
      const pendingError = await expectRejectsHalt(toolCallPromise);
      expect(getStatus(pendingError).code.name).toBe('DISPOSED');
      expect(getStatus(pendingError).raw['kind']).toBe('extension_disposed');
    });

    it('handles disposal with multiple pending calls', async () => {
      // Track multiple pending operations
      const pendingCalls: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }> = [];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(async () => {
        // Reject all pending calls when connection closes
        for (const call of pendingCalls) {
          call.reject(
            new McpError(ErrorCode.ConnectionClosed, 'Connection closed')
          );
        }
        return undefined;
      });
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'tool_one',
            description: 'First tool',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'tool_two',
            description: 'Second tool',
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

      // Mock callTool to create pending promises
      vi.spyOn(Client.prototype, 'callTool').mockImplementation(() => {
        return new Promise((resolve, reject) => {
          pendingCalls.push({ resolve, reject });
        }) as unknown as ReturnType<Client['callTool']>;
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;

      // Start multiple tool calls
      const call1 = getCallable(tools, 'tool_one').fn({}, makeRuntimeCtx());
      const call2 = getCallable(tools, 'tool_two').fn({}, makeRuntimeCtx());

      // Verify both calls are pending
      expect(pendingCalls).toHaveLength(2);

      // Dispose while both calls are pending
      await extension.dispose?.();

      // Both pending calls report the disposal
      for (const call of [call1, call2]) {
        const error = await expectRejectsHalt(call);
        expect(getStatus(error).code.name).toBe('DISPOSED');
      }
    });
  });

  describe('BC-5: Idempotent dispose', () => {
    it('second dispose call is no-op', async () => {
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockConnect = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
      vi.spyOn(Client.prototype, 'close').mockImplementation(mockClose);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
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

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());

      // First dispose
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Second dispose - should be no-op
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Third dispose - should be no-op
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('handles errors during first dispose without affecting idempotency', async () => {
      let disposeAttempts = 0;
      const mockClose = vi.fn().mockImplementation(async () => {
        disposeAttempts++;
        if (disposeAttempts === 1) {
          throw new Error('disposal failed');
        }
        return undefined;
      });

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockImplementation(mockClose);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
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

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());

      // First dispose throws error (swallowed)
      await expect(extension.dispose?.()).resolves.toBeUndefined();
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Second dispose should still be no-op (idempotency maintained)
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('BC-5: Calls after dispose halt with #DISPOSED', () => {
    it('halts tool calls after dispose with #DISPOSED', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
              type: 'object',
              properties: {
                param: { type: 'string' },
              },
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

      // Mock callTool to fail after disposal
      const mockCallTool = vi
        .spyOn(Client.prototype, 'callTool')
        .mockResolvedValue({
          content: [{ type: 'text', text: 'success' }],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;

      // Tool call before dispose works
      const resultBefore = await getCallable(tools, 'test_tool').fn(
        { param1: 'value' },
        makeRuntimeCtx()
      );
      expect(resultBefore).toBe('success');
      expect(mockCallTool).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Tool call after dispose halts without touching the client
      const caught = await expectRejectsHalt(
        getCallable(tools, 'test_tool').fn(
          { param1: 'value' },
          makeRuntimeCtx()
        )
      );
      expectDisposedStatus(caught);
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('halts resource reads after dispose with #DISPOSED', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          {
            uri: 'test://resource',
            name: 'Test Resource',
            mimeType: 'text/plain',
          },
        ],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [{ uriTemplate: 'test://item/{id}', name: 'item' }],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const mockReadResource = vi
        .spyOn(Client.prototype, 'readResource')
        .mockResolvedValue({
          contents: [{ uri: 'test://resource', text: 'content' }],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const resources = fns['resources'] as Record<string, unknown>;

      // Resource read before dispose works
      const resultBefore = await getCallable(resources, 'read_resource').fn(
        { uri: 'test://resource' },
        makeRuntimeCtx()
      );
      expect(resultBefore).toBe('content');
      expect(mockReadResource).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Every resource path halts without touching the client
      const readCaught = await expectRejectsHalt(
        getCallable(resources, 'read_resource').fn(
          { uri: 'test://resource' },
          makeRuntimeCtx()
        )
      );
      expectDisposedStatus(readCaught);

      const staticCaught = await expectRejectsHalt(
        getCallable(resources, 'resource_test_resource').fn(
          {},
          makeRuntimeCtx()
        )
      );
      expectDisposedStatus(staticCaught);

      const templateCaught = await expectRejectsHalt(
        getCallable(resources, 'resource_item').fn(
          { id: 'x' },
          makeRuntimeCtx()
        )
      );
      expectDisposedStatus(templateCaught);

      expect(mockReadResource).toHaveBeenCalledTimes(1);
    });

    it('halts prompt calls after dispose with #DISPOSED', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [
          {
            name: 'test',
            description: 'Test prompt',
            arguments: [],
          },
        ],
      });

      const mockGetPrompt = vi
        .spyOn(Client.prototype, 'getPrompt')
        .mockResolvedValue({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'prompt text' },
            },
          ],
        });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const prompts = fns['prompts'] as Record<string, unknown>;

      // Prompt call before dispose works
      const resultBefore = await getCallable(prompts, 'test').fn(
        {},
        makeRuntimeCtx()
      );
      // Prompt returns list of dicts with role and content
      expect(resultBefore).toEqual([{ role: 'user', content: 'prompt text' }]);
      expect(mockGetPrompt).toHaveBeenCalledTimes(1);

      // Dispose the extension
      await extension.dispose?.();

      // Prompt call after dispose halts without touching the client
      const caught = await expectRejectsHalt(
        getCallable(prompts, 'test').fn({}, makeRuntimeCtx())
      );
      expectDisposedStatus(caught);
      expect(mockGetPrompt).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration: Real connection lifecycle', () => {
    it('completes full lifecycle: connect -> use -> dispose', async () => {
      const mockConnect = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockCallTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
      });

      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
      vi.spyOn(Client.prototype, 'close').mockImplementation(mockClose);
      vi.spyOn(Client.prototype, 'callTool').mockImplementation(mockCallTool);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'my_tool',
            description: 'Test',
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

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
        },
      };

      // Connect
      const extension = await createMcpExtension(config, makeFactoryCtx());
      const fns = extension.value as Record<string, unknown>;
      const tools = fns['tools'] as Record<string, unknown>;
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Use
      const result = await getCallable(tools, 'my_tool').fn(
        {},
        makeRuntimeCtx()
      );
      expect(result).toBe('result');
      expect(mockCallTool).toHaveBeenCalledTimes(1);

      // Dispose
      await extension.dispose?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
