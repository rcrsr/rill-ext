/**
 * Unit tests for resource function generation.
 *
 * Tests resource read and template functions per IR-3, IR-4, AC-9.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { anyTypeValue } from '@rcrsr/rill';
import {
  extractTemplateVariables,
  createReadResourceFunction,
  generateResourceTemplateFunctions,
  generateStaticResourceFunctions,
  type McpResourceTemplate,
  type McpResourceResult,
  type McpResource,
} from '../../src/resources.js';
import { makeRuntimeCtx, expectRejectsInvalid } from '../_helpers.js';

// ============================================================
// TEMPLATE VARIABLE EXTRACTION TESTS
// ============================================================

describe('extractTemplateVariables', () => {
  it('extracts single variable from template', () => {
    const variables = extractTemplateVariables('db://table/{tableName}');
    expect(variables).toEqual(['tableName']);
  });

  it('extracts multiple variables from template', () => {
    const variables = extractTemplateVariables(
      'db://table/{tableName}/row/{rowId}'
    );
    expect(variables).toEqual(['tableName', 'rowId']);
  });

  it('extracts variables with path structure', () => {
    const variables = extractTemplateVariables('file:///{path}');
    expect(variables).toEqual(['path']);
  });

  it('returns empty array for static URI', () => {
    const variables = extractTemplateVariables('static://resource');
    expect(variables).toEqual([]);
  });

  it('ignores operators in template variables', () => {
    // RFC 6570 operators like {+var}, {#var}, {.var}, {/var}, {;var}, {?var}, {&var}
    const variables = extractTemplateVariables('api://{+path}/{#fragment}');
    expect(variables).toEqual([]);
  });

  it('handles whitespace in variable names', () => {
    const variables = extractTemplateVariables(
      'db://{ tableName }/row/{ rowId }'
    );
    expect(variables).toEqual(['tableName', 'rowId']);
  });

  it('handles multiple occurrences of same variable', () => {
    const variables = extractTemplateVariables('api://{version}/v{version}');
    expect(variables).toEqual(['version', 'version']);
  });
});

// ============================================================
// READ RESOURCE FUNCTION TESTS
// ============================================================

describe('createReadResourceFunction', () => {
  let mockClient: Client;

  beforeEach(() => {
    mockClient = {
      readResource: vi.fn(),
    } as unknown as Client;
  });

  it('generates function with correct parameter signature (IR-3)', () => {
    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    expect(func.params).toEqual([
      {
        name: 'uri',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: { description: 'Resource URI to read' },
      },
    ]);
    expect(func.annotations?.description).toBe('Read an MCP resource by URI');
    expect(func.returnType).toEqual(anyTypeValue);
  });

  it('calls MCP readResource with provided URI', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'config://app',
          text: 'config data',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    await func.fn({ uri: 'config://app' }, makeRuntimeCtx());

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'config://app',
    });
  });

  it('returns string for single text content', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'config://app',
          text: 'config data',
          mimeType: 'text/plain',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn({ uri: 'config://app' }, makeRuntimeCtx());

    // Task 3.2: Text content returns string
    expect(result).toBe('config data');
  });

  it('returns dict with type/data/mime for single blob content', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'image://logo',
          blob: 'base64data',
          mimeType: 'image/png',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn({ uri: 'image://logo' }, makeRuntimeCtx());

    // Task 3.2: Blob content returns dict with type/data/mime
    expect(result).toEqual({
      type: 'image',
      data: 'base64data',
      mime: 'image/png',
    });
  });

  it('returns empty string for empty contents (BC-6)', async () => {
    const mockResult: McpResourceResult = {
      contents: [],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn({ uri: 'empty://resource' }, makeRuntimeCtx());

    // BC-6: Empty content returns empty string
    expect(result).toBe('');
  });

  it('concatenates multiple text contents with newlines', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        { uri: 'resource://1', text: 'first' },
        { uri: 'resource://2', text: 'second' },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn({ uri: 'resource://multi' }, makeRuntimeCtx());

    // Task 3.2: Multiple text contents concatenated with newlines
    expect(result).toBe('first\nsecond');
  });

  it('throws error for non-string URI parameter', async () => {
    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 123 }, makeRuntimeCtx()), 'mcp: expected string uri, got number');
  });

  it('handles timeout during read operation', async () => {
    // Mock readResource to never resolve
    vi.mocked(mockClient.readResource).mockImplementation(
      () => new Promise(() => {})
    );

    const func = createReadResourceFunction(mockClient, 100, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 'slow://resource' }, makeRuntimeCtx()), 'mcp tool "read_resource": timeout after 100ms');
  });

  it('handles connection lost error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('connection closed')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 'config://app' }, makeRuntimeCtx()), 'mcp: connection lost');
  });

  it('handles authentication failed error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('unauthorized')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 'config://app' }, makeRuntimeCtx()), 'mcp: authentication failed');
  });

  it('handles protocol error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('protocol error: invalid response')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 'config://app' }, makeRuntimeCtx()), 'mcp: protocol error');
  });

  it('handles generic read error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('resource not found')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expectRejectsInvalid(func.fn({ uri: 'config://app' }, makeRuntimeCtx()), 'mcp tool "read_resource": resource not found');
  });
});

// ============================================================
// RESOURCE TEMPLATE FUNCTION TESTS
// ============================================================

describe('generateResourceTemplateFunctions', () => {
  let mockClient: Client;

  beforeEach(() => {
    mockClient = {
      readResource: vi.fn(),
    } as unknown as Client;
  });

  it('generates function for single-variable template (AC-9)', async () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}',
        name: 'table',
        description: 'Access database table',
      },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_table');
    const func = functions.resource_table!;

    expect(func.params).toEqual([
      {
        name: 'tableName',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: { description: 'URI template variable: tableName' },
      },
    ]);
    expect(func.annotations?.description).toBe('Access database table');
    expect(func.returnType).toEqual(anyTypeValue);
  });

  it('generates function for multi-variable template (IR-4)', () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}/row/{rowId}',
        name: 'database_row',
        description: 'Access specific row',
      },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_database_row');
    const func = functions.resource_database_row!;

    expect(func.params).toEqual([
      {
        name: 'tableName',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: { description: 'URI template variable: tableName' },
      },
      {
        name: 'rowId',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: { description: 'URI template variable: rowId' },
      },
    ]);
  });

  it('expands URI template with arguments and reads resource (AC-9)', async () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}/row/{rowId}',
        name: 'database_row',
      },
    ];

    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'db://table/users/row/123',
          text: '{"id": 123, "name": "Alice"}',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_database_row!;
    await func.fn({ tableName: 'users', rowId: '123' }, makeRuntimeCtx());

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'db://table/users/row/123',
    });
  });

  it('applies name sanitization to template names', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'getUserProfile' },
      { uriTemplate: 'api://{id}', name: 'get-user-data' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_get_user_profile');
    expect(functions).toHaveProperty('resource_get_user_data');
  });

  it('handles collision detection in template names', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'getUser' },
      { uriTemplate: 'api://{id}', name: 'get_user' },
      { uriTemplate: 'api://{id}', name: 'get-user' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_get_user');
    expect(functions).toHaveProperty('resource_get_user_2');
    expect(functions).toHaveProperty('resource_get_user_3');
  });

  it('generates functions for multiple templates', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://table/{tableName}', name: 'table' },
      { uriTemplate: 'file:///{path}', name: 'file' },
      { uriTemplate: 'api://v{version}/users/{userId}', name: 'user' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(Object.keys(functions)).toEqual([
      'resource_table',
      'resource_file',
      'resource_user',
    ]);
  });

  it('throws error for non-string template parameter', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://table/{tableName}', name: 'table' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_table!;

    await expectRejectsInvalid(func.fn({ tableName: 123 }, makeRuntimeCtx()), 'mcp: expected string for parameter tableName, got number');
  });

  it('handles timeout during template expansion', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'slow://{id}', name: 'slow_resource' },
    ];

    vi.mocked(mockClient.readResource).mockImplementation(
      () => new Promise(() => {})
    );

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      100
    );
    const func = functions.resource_slow_resource!;

    await expectRejectsInvalid(func.fn({ id: 'test' }, makeRuntimeCtx()), 'mcp tool "slow_resource": timeout after 100ms');
  });

  it('handles connection lost during template read', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://{table}', name: 'table' },
    ];

    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('disconnected')
    );

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_table!;

    await expectRejectsInvalid(func.fn({ table: 'users' }, makeRuntimeCtx()), 'mcp: connection lost');
  });

  it('returns empty object for templates array', () => {
    const functions = generateResourceTemplateFunctions([], mockClient, 30000);
    expect(functions).toEqual({});
  });

  it('converts non-string arguments to strings for URI expansion', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://item/{id}', name: 'item' },
    ];

    const mockResult: McpResourceResult = {
      contents: [{ uri: 'api://item/42', text: 'item data' }],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_item!;

    // This should throw because we validate string types
    await expectRejectsInvalid(func.fn({ id: 42 }, makeRuntimeCtx()), 'mcp: expected string for parameter id, got number');
  });

  it('handles templates without description field', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'item' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_item!;
    expect(func.annotations).toBeUndefined();
  });
});

// ============================================================
// STATIC RESOURCE FUNCTION TESTS
// ============================================================

describe('generateStaticResourceFunctions', () => {
  let mockClient: Client;

  beforeEach(() => {
    mockClient = {
      readResource: vi.fn(),
    } as unknown as Client;
  });

  it('generates zero-param callable per resource', () => {
    const resources: McpResource[] = [
      { uri: 'config://app', name: 'app_config', description: 'App config' },
      { uri: 'config://db', name: 'db_config', description: 'DB config' },
    ];

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);

    expect(Object.keys(functions)).toHaveLength(2);
    expect(functions).toHaveProperty('resource_app_config');
    expect(functions).toHaveProperty('resource_db_config');
    expect(functions['resource_app_config']!.params).toEqual([]);
    expect(functions['resource_db_config']!.params).toEqual([]);
  });

  it('pre-binds URI and calls readResource with correct URI', async () => {
    const resources: McpResource[] = [
      { uri: 'config://app', name: 'app_config', description: 'App config' },
    ];

    const mockResult: McpResourceResult = {
      contents: [{ uri: 'config://app', text: 'value=1' }],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);
    const func = functions['resource_app_config']!;

    await func.fn({}, makeRuntimeCtx());

    expect(mockClient.readResource).toHaveBeenCalledWith({ uri: 'config://app' });
  });

  it('uses resource description as annotation', () => {
    const resources: McpResource[] = [
      { uri: 'data://source', name: 'source', description: 'My data source' },
    ];

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);
    const func = functions['resource_source']!;

    expect(func.annotations?.description).toBe('My data source');
  });

  it('falls back to default description when none provided', () => {
    const resources: McpResource[] = [
      { uri: 'data://raw', name: 'raw_data' },
    ];

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);
    const func = functions['resource_raw_data']!;

    expect(func.annotations?.description).toMatch(/^Read resource:/);
  });

  it('appends mimeType to description', () => {
    const resources: McpResource[] = [
      {
        uri: 'config://settings',
        name: 'settings',
        description: 'Config',
        mimeType: 'application/json',
      },
    ];

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);
    const func = functions['resource_settings']!;

    expect(func.annotations?.description).toContain('application/json');
  });

  it('returns empty record for empty resources array', () => {
    const functions = generateStaticResourceFunctions([], mockClient, 30000);
    expect(functions).toEqual({});
  });

  it('applies name sanitization', () => {
    const resources: McpResource[] = [
      { uri: 'data://x', name: 'my-resource' },
    ];

    const functions = generateStaticResourceFunctions(resources, mockClient, 30000);

    expect(functions).toHaveProperty('resource_my_resource');
  });
});
