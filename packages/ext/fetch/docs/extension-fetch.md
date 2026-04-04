# extension-fetch

The fetch extension provides HTTP endpoint functions for rill scripts. Each endpoint in the configuration becomes a typed host function. Scripts cannot construct arbitrary URLs — all requests go through pre-defined endpoints.

## Configuration

```typescript
{
  baseUrl: string;                                          // Required. Base URL for all endpoints.
  headers?: Record<string, string> | (() => Record<string, string>); // Optional global headers.
  timeout?: number;                                         // Request timeout in ms. Default: 30000.
  retries?: number;                                         // Retry count for 5xx/429. Default: 0.
  retryDelay?: number;                                      // Base retry delay in ms. Default: 1000.
  maxConcurrent?: number;                                   // Max concurrent requests. Default: unlimited.
  responseShape?: 'body' | 'full';                          // Default response shape. Default: 'body'.
  endpoints: Record<string, EndpointConfig>;                // Required. Endpoint definitions.
}
```

### EndpointConfig

```typescript
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;                    // Path with :param placeholders.
  params?: EndpointParam[];        // Parameter definitions.
  headers?: Record<string, string>; // Endpoint-specific headers.
  responseShape?: 'body' | 'full'; // Override global responseShape.
  description?: string;            // Used in endpoints() introspection.
}
```

### EndpointParam

```typescript
{
  name: string;
  type: 'string' | 'number' | 'bool' | 'dict';
  location: 'path' | 'query' | 'body' | 'header';
  required?: boolean;        // Default: true.
  defaultValue?: string | number | boolean;
}
```

## Host Functions

### Dynamic endpoint functions

One function per configured endpoint. Parameters match the endpoint's `params` array.

### endpoints()

Returns a list of all configured endpoints.

```typescript
[{ name: string, method: string, path: string, description: string }]
```

## Response Shapes

`responseShape: 'body'` — returns the parsed JSON body directly.

`responseShape: 'full'` — returns `{ status: number, headers: Record<string, string>, body: unknown }`.

## Retry Logic

Retries on HTTP 429, 502, 503, and 504. Uses exponential backoff starting at `retryDelay` ms. Respects `Retry-After` header for 429 responses. HTTP 4xx errors (except 429) fail immediately without retry.

## Error Codes

| Code | Condition |
|------|-----------|
| RILL-R001 | Missing required parameter |
| RILL-R022 | HTTP 4xx client error |
| RILL-R023 | HTTP 5xx after max retries |
| RILL-R024 | Request timeout |
| RILL-R025 | Network error |
| RILL-R026 | Invalid JSON response |
