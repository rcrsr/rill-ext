/**
 * Integration tests with mock MCP server (stdio transport).
 *
 * Tests end-to-end functionality:
 * - Connect to stdio server, discover capabilities, call tools [AC-1]
 * - Tool result type conversion [AC-8]
 * - Resource read end-to-end
 * - Prompt get end-to-end
 * - Multi-server composition [AC-2]
 *
 * Uses a real MCP server process (mock-mcp-server.mjs) to test actual
 * stdio transport, capability discovery, and function generation.
 *
 * History: MCP SDK versions 1.23.0-1.26.0 shipped a zod-compat bug where
 * v3Schema.safeParseAsync was called on Zod v3 schemas built from JSON Schema
 * that lack the method, which blocked tool/resource/prompt execution over the
 * real transport. That bug is fixed in the SDK version this package depends on,
 * so the end-to-end call tests are enabled.
 *
 * Host functions are namespaced under the extension value: tools live under
 * `value.tools`, resources under `value.resources`, prompts under
 * `value.prompts`; each entry is a callable exposing `.fn(args, ctx)`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMcpExtension } from '../../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from '../_helpers.js';

// Runtime context for calling host functions in tests.
const mockContext = makeRuntimeCtx();

/** A namespaced host function entry exposing a callable `.fn`. */
interface HostFn {
  fn: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
}

/** Resolve a callable host function from a namespaced capability dict. */
function hostFn(dict: unknown, name: string): HostFn {
  return (dict as Record<string, HostFn>)[name]!;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to mock server script
const MOCK_SERVER_PATH = join(__dirname, 'mock-mcp-server.mjs');

// Track extensions for cleanup
const activeExtensions: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  // Clean up all active extensions
  for (const ext of activeExtensions) {
    await ext.dispose();
  }
  activeExtensions.length = 0;
});

/** Helper to get the value dict from an ExtensionFactoryResult */
function fns(
  ext: Awaited<ReturnType<typeof createMcpExtension>>
): Record<string, unknown> {
  return ext.value as Record<string, unknown>;
}

describe('Integration: stdio mock server', () => {
  describe('AC-1: Connect stdio transport, call tool [AC-1]', () => {
    it('connects to stdio server and discovers capabilities', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Verify introspection dicts exist
      expect(v.tools).toBeDefined();
      expect(typeof v.tools).toBe('object');
      expect(v.resources).toBeDefined();
      expect(typeof v.resources).toBe('object');
      expect(v.prompts).toBeDefined();
      expect(typeof v.prompts).toBe('object');

      // tools is already a callable dict keyed by tool name
      const toolsDict = v.tools as Record<string, unknown>;
      expect(typeof toolsDict).toBe('object');
      expect(Object.keys(toolsDict).length).toBeGreaterThan(0);

      // Verify expected tools exist as keys
      expect(toolsDict['get_status']).toBeDefined();
      expect(toolsDict['echo']).toBeDefined();
      expect(toolsDict['add']).toBeDefined();
      expect(toolsDict['get_image']).toBeDefined();
    }, 15000);

    it('calls tool and receives response', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Call echo tool
      const result = await hostFn(v.tools, 'echo').fn(
        { message: 'Hello, MCP!' },
        mockContext
      );

      // Verify result
      expect(result).toBe('Hello, MCP!');
    }, 15000);

    it('calls tool with parameters', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Call add tool with parameters
      const result = await hostFn(v.tools, 'add').fn(
        { a: 5, b: 7 },
        mockContext
      );

      // Verify result: the tool returns the numeric text "12", which AC-8
      // parses as the JSON number 12.
      expect(result).toBe(12);
    }, 15000);
  });

  describe('AC-8: Result type conversion', () => {
    it('converts JSON text content to dict', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Call get_status which returns JSON text
      const result = await hostFn(v.tools, 'get_status').fn({}, mockContext);

      // AC-8: JSON text {"status": "ok"} → dict [status: "ok"]
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect(Array.isArray(result)).toBe(false);
      expect((result as Record<string, unknown>).status).toBe('ok');
      expect((result as Record<string, unknown>).uptime).toBe(42);
    }, 15000);

    it('returns plain text as string', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Call echo which returns plain text
      const result = await hostFn(v.tools, 'echo').fn(
        { message: 'success' },
        mockContext
      );

      // AC-8: Plain text "success" → string "success"
      expect(typeof result).toBe('string');
      expect(result).toBe('success');
    }, 15000);

    it('converts image content to dict with type/data/mime', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Call get_image which returns base64 image
      const result = await hostFn(v.tools, 'get_image').fn({}, mockContext);

      // AC-8: Image → dict [type: "image", data: base64, mime: "image/png"]
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect((result as Record<string, unknown>).type).toBe('image');
      expect(typeof (result as Record<string, unknown>).data).toBe('string');
      expect((result as Record<string, unknown>).mime).toBe('image/png');
    }, 15000);
  });

  describe('Resource read end-to-end', () => {
    it('lists available resources', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // resources is a dict of callable closures keyed by function name
      const resourcesDict = v.resources as Record<string, unknown>;

      expect(typeof resourcesDict).toBe('object');
      expect(resourcesDict).not.toBe(null);
      expect(Array.isArray(resourcesDict)).toBe(false);
      // read_resource is always present as a callable
      expect(resourcesDict['read_resource']).toBeDefined();
    }, 15000);

    it('reads static resource', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Read test-doc resource
      const result = await hostFn(v.resources, 'read_resource').fn(
        { uri: 'file:///test/doc.txt' },
        mockContext
      );

      // A single text content block is returned as the plain text string.
      expect(typeof result).toBe('string');
      expect(result).toBe('This is a test document');
    }, 15000);

    it('reads resource template with variables', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Read user profile resource with ID
      const result = await hostFn(v.resources, 'resource_user_profile').fn(
        { id: '123' },
        mockContext
      );

      // Verify result contains user data
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);

      // Result should be the parsed JSON (due to AC-8)
      expect((result as Record<string, unknown>).id).toBe('123');
      expect((result as Record<string, unknown>).name).toBe('User 123');
      expect((result as Record<string, unknown>).email).toBe(
        'user123@example.com'
      );
    }, 15000);
  });

  describe('Prompt get end-to-end', () => {
    it('lists available prompts', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // prompts is a dict of callable closures keyed by sanitized function name
      const promptsDict = v.prompts as Record<string, unknown>;

      expect(typeof promptsDict).toBe('object');
      expect(promptsDict).not.toBe(null);
      expect(Array.isArray(promptsDict)).toBe(false);
      expect(Object.keys(promptsDict).length).toBeGreaterThan(0);

      // Verify expected prompts exist as keys (sanitized: greeting → greeting)
      expect(promptsDict['greeting']).toBeDefined();
      expect(promptsDict['code_review']).toBeDefined();
    }, 15000);

    it('gets prompt without arguments', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Get greeting prompt
      const result = await hostFn(v.prompts, 'greeting').fn({}, mockContext);

      // Prompt returns a list of message dicts with role and content
      expect(Array.isArray(result)).toBe(true);

      const messages = result as unknown[];
      expect(messages.length).toBeGreaterThan(0);

      const firstMessage = messages[0] as Record<string, unknown>;
      expect(firstMessage.role).toBe('user');
    }, 15000);

    it('gets prompt with arguments', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext);
      const v = fns(ext);

      // Get code_review prompt with arguments
      const result = await hostFn(v.prompts, 'code_review').fn(
        {
          language: 'TypeScript',
          code: 'function hello() { return "world"; }',
        },
        mockContext
      );

      // Prompt returns a list of message dicts with role and content
      expect(Array.isArray(result)).toBe(true);

      const messages = result as unknown[];
      expect(messages.length).toBeGreaterThan(0);

      const firstMessage = messages[0] as Record<string, unknown>;
      expect(firstMessage.role).toBe('user');
      const content = firstMessage.content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain('TypeScript');
      expect(content as string).toContain('function hello()');
    }, 15000);
  });

  describe('AC-2: Multi-server composition', () => {
    it('combines functions from multiple servers', async () => {
      // Create two extension instances to the same server
      // (In real usage, these would be different servers)
      const ext1 = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext1);

      const ext2 = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      activeExtensions.push(ext2);

      const v1 = fns(ext1);
      const v2 = fns(ext2);

      // Call tools from different extensions
      const result1 = await hostFn(v1.tools, 'echo').fn(
        { message: 'from server 1' },
        mockContext
      );
      const result2 = await hostFn(v2.tools, 'get_status').fn({}, mockContext);

      expect(result1).toBe('from server 1');
      expect(typeof result2).toBe('object');
      expect((result2 as Record<string, unknown>).status).toBe('ok');

      // Verify both extensions work independently
      const add1 = await hostFn(v1.tools, 'add').fn(
        { a: 1, b: 2 },
        mockContext
      );
      const add2 = await hostFn(v2.tools, 'add').fn(
        { a: 10, b: 20 },
        mockContext
      );

      expect(add1).toBe(3);
      expect(add2).toBe(30);
    }, 20000);
  });

  describe('Connection lifecycle', () => {
    it('disposes extension cleanly', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );
      const v = fns(ext);

      // Verify extension works
      const result = await hostFn(v.tools, 'echo').fn(
        { message: 'test' },
        mockContext
      );
      expect(result).toBe('test');

      // Dispose extension
      await ext.dispose();

      // After dispose, calling functions should fail
      // (The exact error depends on transport state)
      await expect(
        hostFn(v.tools, 'echo').fn({ message: 'test' }, mockContext)
      ).rejects.toThrow();
    }, 15000);

    it('handles multiple dispose calls (idempotent)', async () => {
      const ext = await createMcpExtension(
        {
          transport: {
            type: 'stdio',
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          timeout: 10000,
        },
        makeFactoryCtx()
      );

      // First dispose
      await ext.dispose();

      // Second dispose should not throw
      await expect(ext.dispose()).resolves.not.toThrow();
    }, 15000);
  });
});
