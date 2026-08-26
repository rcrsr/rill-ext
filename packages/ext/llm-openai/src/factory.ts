/**
 * Extension factory for OpenAI API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 *
 * Routing: o-series reasoning models (o1, o3, o-mini, o4, etc.) use the Responses API.
 * Standard models (gpt-*, text-*, etc.) use Chat Completions.
 * Routing is fixed at factory init.
 */

import OpenAI, { APIError } from 'openai';
import type {
  Response as OAIResponse,
  ResponseInputItem,
  EasyInputMessage,
  ResponseFunctionToolCall,
  ResponseOutputMessage,
  ResponseReasoningItem,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses.js';
import {
  RuntimeError,
  RuntimeHaltSignal,
  createRillStream,
  emitExtensionEvent,
  createVector,
  isVector,
  getStatus,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
  type TypeStructure,
} from '@rcrsr/rill';
import {
  type LlmExtensionContract,
  validateApiKey,
  validateModel,
  validateTemperature,
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  throwProviderHalt,
  executeToolLoop,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  normalizePrompt,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
  RESERVED_KEYS_COMMON,
  PARTS_LIST_STRUCTURE,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
  type Message,
  type Part,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

/**
 * Reserved keys for OpenAI — union of COMMON + Chat Completions + Responses API.
 * Using the superset so `extra` config remains portable across model upgrades.
 */
const RESERVED_KEYS_OPENAI: readonly string[] = [
  ...RESERVED_KEYS_COMMON,
  'tools',
  'tool_choice',
  'function_call',
  'functions',
  'input',
  'instructions',
  'previous_response_id',
  'reasoning',
];

/**
 * Regex that matches o-series reasoning model IDs.
 * Matches: o1, o1-mini, o3, o3-mini, o4-mini, o1-preview, etc.
 * Does NOT match: gpt-4o, gpt-4o-mini (these start with 'gpt').
 */
const O_SERIES_PATTERN = /^o\d/;

// ============================================================
// ERROR DETECTION
// ============================================================

/**
 * OpenAI-specific error detector for mapProviderError.
 * Extracts status code and message from APIError instances.
 */
const detectOpenAIError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof APIError) {
    return {
      status: error.status ?? undefined,
      message: error.message,
    };
  }
  return null;
};

/**
 * Build an invalid-RillValue halt signal carrying a generic atom.
 * Host scripts recover via `guard #<ATOM>`.
 */
function haltInvalid(
  ctx: RuntimeContext,
  code: string,
  rawKind: string,
  message: string
): RuntimeHaltSignal {
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code,
      provider: 'openai',
      raw: { kind: rawKind, message },
    }),
    true
  );
}

// ============================================================
// CANONICAL ↔ WIRE TRANSLATORS: Chat Completions
// ============================================================

/**
 * Convert canonical Message[] (parts-shaped) to OpenAI Chat Completions wire format.
 * system messages → { role: 'system', content: string }
 * user messages → { role: 'user', content: string } (tool_result parts become role:'tool' messages)
 * assistant messages → { role: 'assistant', content, tool_calls? }
 */
function canonicalToCC(
  messages: Message[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.parts
        .filter((pt) => pt.type === 'text')
        .map((pt) => (pt as { type: 'text'; text: string }).text)
        .join('');
      result.push({ role: 'system', content: text });
      continue;
    }

    if (msg.role === 'user') {
      // tool_result parts → role:'tool' messages (before user content)
      const toolResultParts = msg.parts.filter(
        (pt) => pt.type === 'tool_result'
      );
      for (const part of toolResultParts) {
        const tr = part as { type: 'tool_result'; id: string; parts: Part[] };
        const resultContent = tr.parts
          .filter((pt) => pt.type === 'text')
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('');
        result.push({
          role: 'tool',
          tool_call_id: tr.id,
          content: resultContent,
        });
      }

      const contentParts = msg.parts.filter((pt) => pt.type !== 'tool_result');
      if (contentParts.length > 0) {
        const textContent = contentParts
          .filter((pt) => pt.type === 'text')
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('');
        result.push({ role: 'user', content: textContent });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts = msg.parts.filter((pt) => pt.type === 'text');
      const toolUseParts = msg.parts.filter((pt) => pt.type === 'tool_use');

      const content =
        textParts
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('') || null;

      if (toolUseParts.length > 0) {
        const toolCalls = toolUseParts.map((pt) => {
          const tu = pt as {
            type: 'tool_use';
            id: string;
            name: string;
            input: Record<string, RillValue>;
          };
          return {
            id: tu.id,
            type: 'function' as const,
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          };
        });
        result.push({ role: 'assistant', content, tool_calls: toolCalls });
      } else {
        result.push({ role: 'assistant', content: content ?? '' });
      }
    }
  }

  return result;
}

/**
 * Convert OpenAI Chat Completions response choice to canonical assistant Message.
 */
function ccChoiceToCanonical(
  choice: OpenAI.Chat.Completions.ChatCompletion['choices'][0]
): Message {
  const parts: Part[] = [];
  const msg = choice.message;

  if (msg.content) {
    parts.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      // tool_calls items have a .function property on ChatCompletionMessageToolCall
      const fn = (
        tc as {
          type: string;
          id: string;
          function: { name: string; arguments: string };
        }
      ).function;
      const toolInput = (() => {
        try {
          return JSON.parse(fn.arguments) as Record<string, RillValue>;
        } catch {
          return {} as Record<string, RillValue>;
        }
      })();
      parts.push({
        type: 'tool_use',
        id: tc.id,
        name: fn.name,
        input: toolInput,
      });
    }
  }

  return { role: 'assistant', parts };
}

// ============================================================
// CANONICAL ↔ WIRE TRANSLATORS: Responses API
// ============================================================

/**
 * Convert canonical Message[] to Responses API input items and instructions.
 */
function canonicalToResponsesAPI(messages: Message[]): {
  input: ResponseInputItem[];
  instructions: string | undefined;
} {
  let instructions: string | undefined;
  const input: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.parts
        .filter((pt) => pt.type === 'text')
        .map((pt) => (pt as { type: 'text'; text: string }).text)
        .join('');
      instructions = text || undefined;
      continue;
    }

    if (msg.role === 'user') {
      // tool_result parts → function_call_output items (use call_id = part.id)
      const toolResultParts = msg.parts.filter(
        (pt) => pt.type === 'tool_result'
      );
      for (const part of toolResultParts) {
        const tr = part as { type: 'tool_result'; id: string; parts: Part[] };
        const resultContent = tr.parts
          .filter((pt) => pt.type === 'text')
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('');
        input.push({
          type: 'function_call_output',
          call_id: tr.id,
          output: resultContent,
        } as ResponseInputItem.FunctionCallOutput);
      }

      const contentParts = msg.parts.filter((pt) => pt.type === 'text');
      if (contentParts.length > 0) {
        const text = contentParts
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('');
        input.push({
          role: 'user',
          content: text,
        } as EasyInputMessage as ResponseInputItem);
      }
      continue;
    }

    if (msg.role === 'assistant') {
      // thinking parts → reasoning items (summary_text format)
      const thinkingParts = msg.parts.filter((pt) => pt.type === 'thinking');
      for (const part of thinkingParts) {
        const th = part as { type: 'thinking'; text: string };
        // Responses API ReasoningItem needs an id; use a synthetic one
        input.push({
          type: 'reasoning',
          id: `reasoning_${Date.now()}`,
          summary: [{ type: 'summary_text', text: th.text }],
        } as unknown as ResponseInputItem);
      }

      // tool_use parts → function_call items using call_id
      const toolUseParts = msg.parts.filter((pt) => pt.type === 'tool_use');
      for (const part of toolUseParts) {
        const tu = part as {
          type: 'tool_use';
          id: string;
          name: string;
          input: Record<string, RillValue>;
        };
        input.push({
          type: 'function_call',
          call_id: tu.id,
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        } as unknown as ResponseInputItem);
      }

      // text parts → assistant message
      const textParts = msg.parts.filter((pt) => pt.type === 'text');
      if (textParts.length > 0) {
        const text = textParts
          .map((pt) => (pt as { type: 'text'; text: string }).text)
          .join('');
        input.push({
          role: 'assistant',
          content: text,
        } as EasyInputMessage as ResponseInputItem);
      }
    }
  }

  return { input, instructions };
}

/**
 * Convert a Responses API response to canonical assistant Message.
 * Handles text output items, function_call items, and reasoning items.
 */
function responsesAPIToCanonical(response: OAIResponse): Message {
  const parts: Part[] = [];

  for (const item of response.output) {
    if (item.type === 'message') {
      const outputMsg = item as ResponseOutputMessage;
      for (const contentItem of outputMsg.content) {
        if (contentItem.type === 'output_text') {
          parts.push({ type: 'text', text: contentItem.text });
        }
      }
    } else if (item.type === 'function_call') {
      const fc = item as ResponseFunctionToolCall;
      const fcInput = (() => {
        try {
          return JSON.parse(fc.arguments) as Record<string, RillValue>;
        } catch {
          return {} as Record<string, RillValue>;
        }
      })();
      // Responses API uses call_id for tool threading (not id)
      parts.push({
        type: 'tool_use',
        id: fc.call_id,
        name: fc.name,
        input: fcInput,
      });
    } else if (item.type === 'reasoning') {
      const ri = item as ResponseReasoningItem;
      const summaryText = ri.summary
        .filter((s) => s.type === 'summary_text')
        .map((s) => (s as { type: 'summary_text'; text: string }).text)
        .join('');
      if (summaryText) {
        parts.push({ type: 'thinking', text: summaryText });
      }
    }
  }

  return { role: 'assistant', parts };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create OpenAI extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * Model routing:
 * - o-series (o1, o3, o4-mini, etc.) → Responses API
 * - Standard models (gpt-*, etc.) → Chat Completions
 * Routing is fixed for instance lifetime.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, embed, embed_batch, tool_loop, generate and dispose
 * @throws RuntimeError('RILL-R001', ...) for invalid configuration
 */
export function createOpenAIExtension(
  config: OpenAIExtensionConfig
): ExtensionFactoryResult {
  // Validate factory max_turns BEFORE client creation
  validateMaxTurns(config.max_turns);

  // Validate factory max_errors BEFORE client creation; reject 0/negative/non-integer
  validateMaxErrors(config.max_errors);

  // Validate extra keys BEFORE client creation
  validateExtraKeys(config.extra, RESERVED_KEYS_OPENAI);

  // Validate required fields
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Detect model class at factory init; routing fixed for instance lifetime
  const isOSeries = O_SERIES_PATTERN.test(config.model);

  // Instantiate SDK client at factory time
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    maxRetries: config.max_retries,
    timeout: config.timeout,
  });

  // Extract config values for closures
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;
  const factoryMaxTurns = config.max_turns;
  const factoryMaxErrors = config.max_errors;
  const factoryExtra = config.extra;

  // AbortController for cancelling pending requests
  let abortController: AbortController | undefined = new AbortController();

  const dispose = async (): Promise<void> => {
    try {
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to abort OpenAI requests: ${message}`);
    }
  };

  // After dispose() the abortController is cleared; reject further calls so
  // in-flight-free requests do not proceed on a disposed extension.
  function assertNotDisposed(ctx: RuntimeContext): void {
    if (!abortController) {
      throw haltInvalid(
        ctx,
        'DISPOSED',
        'extension_disposed',
        'openai: extension disposed'
      );
    }
  }

  // ============================================================
  // SHARED RETURN TYPE STRUCTURE
  // ============================================================

  const VERB_STREAM_RET_TYPE: TypeStructure = {
    kind: 'dict',
    fields: {
      messages: {
        type: {
          kind: 'list',
          element: {
            kind: 'dict',
            fields: {
              role: { type: { kind: 'string' } },
              parts: { type: PARTS_LIST_STRUCTURE },
            },
          },
        },
      },
      model: { type: { kind: 'string' } },
      usage: {
        type: {
          kind: 'dict',
          fields: {
            input: { type: { kind: 'number' } },
            output: { type: { kind: 'number' } },
          },
        },
      },
      stop_reason: { type: { kind: 'string' } },
      id: { type: { kind: 'string' } },
    },
  };

  // ============================================================
  // HOST FUNCTION: message (Chat Completions path)
  // ============================================================

  function makeMessageFnCC(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;

        // Normalize prompt (string or message list) → canonical Message[]
        const normalizedCC = normalizePrompt(rawPrompt, ctx as RuntimeContext);
        if (!Array.isArray(normalizedCC)) {
          throw new RuntimeHaltSignal(normalizedCC, true);
        }
        const normalized = normalizedCC as Message[];

        const inputMessages: Message[] = factorySystem
          ? [
              {
                role: 'system',
                parts: [{ type: 'text', text: factorySystem }],
              },
              ...normalized,
            ]
          : normalized;

        const apiMessages = canonicalToCC(inputMessages);

        const runner = client.chat.completions.stream(
          {
            model: factoryModel,
            max_completion_tokens: factoryMaxTokens,
            messages: apiMessages,
            stream_options: { include_usage: true },
            ...(factoryTemperature !== undefined
              ? { temperature: factoryTemperature }
              : {}),
            ...factoryExtra,
          } as OpenAI.ChatCompletionCreateParamsStreaming,
          { signal: abortController!.signal }
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            throwProviderHalt(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalChatCompletion();
            const assistantMsg = ccChoiceToCanonical(response.choices[0]!);
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: response.model,
              usage: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
              },
              stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
              id: response.id,
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:message',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            runner.abort();
          },
          chunkType: { kind: 'string' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: {
        description: 'Send message to OpenAI Chat Completions API',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // HOST FUNCTION: message (Responses API path)
  // ============================================================

  function makeMessageFnResponses(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;

        const normalizedRaw1 = normalizePrompt(
          rawPrompt,
          ctx as RuntimeContext
        );
        if (!Array.isArray(normalizedRaw1)) {
          throw new RuntimeHaltSignal(normalizedRaw1, true);
        }
        const normalized1 = normalizedRaw1 as Message[];

        const inputMessages: Message[] = factorySystem
          ? [
              {
                role: 'system',
                parts: [{ type: 'text', text: factorySystem }],
              },
              ...normalized1,
            ]
          : normalized1;

        const { input, instructions } = canonicalToResponsesAPI(inputMessages);

        const baseParams: Record<string, unknown> = {
          model: factoryModel,
          max_output_tokens: factoryMaxTokens,
          input,
          ...(instructions !== undefined ? { instructions } : {}),
          ...(factoryTemperature !== undefined
            ? { temperature: factoryTemperature }
            : {}),
          ...factoryExtra,
        };

        // One runner backs both the stream and the resolved result so a single
        // message() call costs one request (not two) and dispose can abort it.
        const runner = client.responses.stream(
          {
            ...baseParams,
            stream: true,
          } as ResponseCreateParamsStreaming,
          { signal: abortController!.signal }
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const event of runner) {
              const e = event as { type?: string; delta?: string };
              if (e.type === 'response.output_text.delta' && e.delta) {
                yield e.delta as RillValue;
              }
            }
          } catch (error: unknown) {
            throwProviderHalt(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalResponse();

            const assistantMsg = responsesAPIToCanonical(response);
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: response.model,
              usage: {
                input: response.usage?.input_tokens ?? 0,
                output: response.usage?.output_tokens ?? 0,
              },
              stop_reason: response.status ?? 'completed',
              id: response.id,
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:message',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            runner.abort();
          },
          chunkType: { kind: 'string' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: { description: 'Send message to OpenAI Responses API' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // SHARED: validate tool_loop boundary args
  // ============================================================

  function validateToolLoopArgs(
    toolsDict: RillValue,
    perCallMaxTurns: number,
    ctx: RuntimeContext
  ): void {
    // Negative per-call max_turns
    if (perCallMaxTurns < 0) {
      throw haltInvalid(
        ctx,
        'INVALID_INPUT',
        'invalid_max_turns',
        'max_turns must be >= 0'
      );
    }

    // Empty tools dict
    if (
      typeof toolsDict === 'object' &&
      toolsDict !== null &&
      !Array.isArray(toolsDict) &&
      Object.keys(toolsDict as Record<string, unknown>).length === 0
    ) {
      throw haltInvalid(
        ctx,
        'INVALID_INPUT',
        'empty_tools_dict',
        'tools dict cannot be empty'
      );
    }
  }

  // ============================================================
  // HOST FUNCTION: tool_loop (Chat Completions path)
  // ============================================================

  function makeToolLoopFnCC(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        {
          name: 'tools',
          type: { kind: 'dict', valueType: { kind: 'closure' } },
          defaultValue: undefined,
          annotations: {},
        },
        p.num('max_turns', undefined, 0),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;
        const toolsDict = args['tools'] as RillValue;
        const perCallMaxTurns = (args['max_turns'] ?? 0) as number;

        validateToolLoopArgs(toolsDict, perCallMaxTurns, ctx as RuntimeContext);

        const normalizedRaw2 = normalizePrompt(
          rawPrompt,
          ctx as RuntimeContext
        );
        if (!Array.isArray(normalizedRaw2)) {
          throw new RuntimeHaltSignal(normalizedRaw2, true);
        }
        const normalized2 = normalizedRaw2 as Message[];

        const inputMessages: Message[] = factorySystem
          ? [
              {
                role: 'system',
                parts: [{ type: 'text', text: factorySystem }],
              },
              ...normalized2,
            ]
          : normalized2;

        const ccMessages = canonicalToCC(inputMessages);
        const maxErrors = factoryMaxErrors ?? 3;

        const callbacks: ToolLoopCallbacks = {
          detectError: detectOpenAIError,

          buildTools: (toolDefs) => {
            return toolDefs.map((def) => ({
              type: 'function' as const,
              function: {
                name: def.name,
                description: def.description,
                parameters: def.input_schema as Record<string, unknown>,
              },
            }));
          },

          callAPI: async (msgs, tools, signal) => {
            const apiParams = {
              model: factoryModel,
              max_completion_tokens: factoryMaxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
              ...(factoryTemperature !== undefined
                ? { temperature: factoryTemperature }
                : {}),
              ...factoryExtra,
            } as OpenAI.ChatCompletionCreateParamsNonStreaming;

            const response = await client.chat.completions.create(apiParams, {
              signal,
            });
            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          callAPIStreaming: async (msgs, tools, onTextDelta, signal) => {
            const streamRunner = client.chat.completions.stream(
              {
                model: factoryModel,
                max_completion_tokens: factoryMaxTokens,
                messages: msgs as OpenAI.ChatCompletionMessageParam[],
                tools: tools as OpenAI.ChatCompletionTool[],
                tool_choice: 'auto' as const,
                stream_options: { include_usage: true },
                ...(factoryTemperature !== undefined
                  ? { temperature: factoryTemperature }
                  : {}),
                ...factoryExtra,
              } as OpenAI.ChatCompletionCreateParamsStreaming,
              { signal }
            );

            streamRunner.on('content', (delta: string) => {
              onTextDelta(delta);
            });

            const response = await streamRunner.finalChatCompletion();
            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          extractToolCalls: (response) => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('choices' in response)
            )
              return null;
            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) return null;

            const choice = choices[0];
            if (!choice || typeof choice !== 'object' || !('message' in choice))
              return null;

            const message = (choice as { message: unknown }).message;
            if (
              !message ||
              typeof message !== 'object' ||
              !('tool_calls' in message)
            )
              return null;

            const toolCalls = (message as { tool_calls: unknown[] | null })
              .tool_calls;
            if (!toolCalls || !Array.isArray(toolCalls)) return null;

            const functionToolCalls = toolCalls.filter(
              (
                tc
              ): tc is {
                id: string;
                type: string;
                function: { name: string; arguments: string };
              } =>
                typeof tc === 'object' &&
                tc !== null &&
                'type' in tc &&
                (tc as { type: string }).type === 'function' &&
                'function' in tc
            );

            return functionToolCalls.map((tc) => {
              let parsedArgs: object;
              try {
                parsedArgs = JSON.parse(tc.function.arguments) as object;
              } catch {
                parsedArgs = {};
              }
              return { id: tc.id, name: tc.function.name, input: parsedArgs };
            });
          },

          formatAssistantMessage: (response) => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('choices' in response)
            )
              return null;
            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) return null;

            const choice = choices[0];
            if (!choice || typeof choice !== 'object' || !('message' in choice))
              return null;

            const msg = (choice as { message: unknown }).message;
            if (!msg || typeof msg !== 'object') return null;

            const m = msg as Record<string, unknown>;
            const clean: Record<string, unknown> = {
              role: m['role'],
              content: m['content'],
            };
            if (m['tool_calls']) clean['tool_calls'] = m['tool_calls'];
            return clean;
          },

          formatToolResult: (toolResults) => {
            return toolResults.map((tr) => ({
              role: 'tool' as const,
              tool_call_id: tr.id,
              content: tr.error
                ? JSON.stringify({ error: tr.error, code: 'RILL-R001' })
                : typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result),
            }));
          },
        };

        const chunkBuffer: RillValue[] = [];
        const yieldChunk = (chunk: RillValue): void => {
          chunkBuffer.push(chunk);
        };
        const toolLoopAbortController = new AbortController();

        const loopPromise = executeToolLoop(
          ccMessages,
          toolsDict,
          maxErrors,
          callbacks,
          (event, data) => {
            const eventMap: Record<string, string> = {
              tool_call: 'openai:tool_call',
              tool_result: 'openai:tool_result',
            };
            emitExtensionEvent(ctx as RuntimeContext, {
              event: eventMap[event] ?? event,
              subsystem: 'extension:openai',
              ...data,
            });
          },
          perCallMaxTurns,
          ctx,
          yieldChunk,
          AbortSignal.any([
            abortController!.signal,
            toolLoopAbortController.signal,
          ]),
          factoryMaxTurns
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            await loopPromise;
            for (const chunk of chunkBuffer) {
              yield chunk;
            }
          } catch (error: unknown) {
            if (error instanceof RuntimeHaltSignal) throw error;
            throwProviderHalt(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await loopPromise;
            const response =
              loopResult.response as OpenAI.Chat.Completions.ChatCompletion | null;

            const assistantMsg = response
              ? ccChoiceToCanonical(response.choices[0]!)
              : { role: 'assistant' as const, parts: [] as Part[] };
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: factoryModel,
              usage: {
                input: loopResult.totalTokens.input,
                output: loopResult.totalTokens.output,
              },
              stop_reason: response?.choices[0]?.finish_reason ?? 'stop',
              id: response?.id ?? '',
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:tool_loop',
              subsystem: 'extension:openai',
              turns: loopResult.turns,
              total_duration: duration,
              usage: result.usage,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            toolLoopAbortController.abort();
          },
          chunkType: { kind: 'dict' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: {
        description: 'Execute tool-use loop with OpenAI Chat Completions API',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'dict' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // HOST FUNCTION: tool_loop (Responses API path)
  // ============================================================

  function makeToolLoopFnResponses(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        {
          name: 'tools',
          type: { kind: 'dict', valueType: { kind: 'closure' } },
          defaultValue: undefined,
          annotations: {},
        },
        p.num('max_turns', undefined, 0),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;
        const toolsDict = args['tools'] as RillValue;
        const perCallMaxTurns = (args['max_turns'] ?? 0) as number;

        validateToolLoopArgs(toolsDict, perCallMaxTurns, ctx as RuntimeContext);

        const normalizedRaw3 = normalizePrompt(
          rawPrompt,
          ctx as RuntimeContext
        );
        if (!Array.isArray(normalizedRaw3)) {
          throw new RuntimeHaltSignal(normalizedRaw3, true);
        }
        const normalized3 = normalizedRaw3 as Message[];

        const inputMessages: Message[] = factorySystem
          ? [
              {
                role: 'system',
                parts: [{ type: 'text', text: factorySystem }],
              },
              ...normalized3,
            ]
          : normalized3;

        const { input: initialInput, instructions } =
          canonicalToResponsesAPI(inputMessages);
        const maxErrors = factoryMaxErrors ?? 3;

        const callbacks: ToolLoopCallbacks = {
          detectError: detectOpenAIError,

          buildTools: (toolDefs) => {
            return toolDefs.map((def) => ({
              type: 'function' as const,
              name: def.name,
              description: def.description,
              parameters: def.input_schema as Record<string, unknown>,
            }));
          },

          callAPI: async (msgs, tools, signal) => {
            const apiParams: Record<string, unknown> = {
              model: factoryModel,
              max_output_tokens: factoryMaxTokens,
              input: msgs,
              tools,
              tool_choice: 'auto',
              ...(instructions !== undefined ? { instructions } : {}),
              ...(factoryTemperature !== undefined
                ? { temperature: factoryTemperature }
                : {}),
              ...factoryExtra,
            };

            const response = await client.responses.create(
              apiParams as ResponseCreateParamsNonStreaming,
              { signal }
            );

            return {
              ...response,
              usage: {
                input_tokens: response.usage?.input_tokens ?? 0,
                output_tokens: response.usage?.output_tokens ?? 0,
              },
            };
          },

          extractToolCalls: (response) => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('output' in response)
            )
              return null;
            const output = (response as { output: unknown[] }).output;
            if (!Array.isArray(output)) return null;

            const functionCalls = output.filter(
              (
                item
              ): item is {
                type: string;
                call_id: string;
                name: string;
                arguments: string;
              } =>
                typeof item === 'object' &&
                item !== null &&
                'type' in item &&
                (item as { type: string }).type === 'function_call' &&
                'call_id' in item
            );

            if (functionCalls.length === 0) return null;

            return functionCalls.map((fc) => {
              let input: object;
              try {
                input = JSON.parse(fc.arguments) as object;
              } catch {
                input = {};
              }
              return { id: fc.call_id, name: fc.name, input };
            });
          },

          formatAssistantMessage: (response) => {
            // Responses API: the output items themselves are appended to next turn input
            if (
              !response ||
              typeof response !== 'object' ||
              !('output' in response)
            )
              return null;
            const output = (response as { output: unknown[] }).output;
            if (!Array.isArray(output) || output.length === 0) return null;
            return output;
          },

          formatToolResult: (toolResults) => {
            return toolResults.map((tr) => ({
              type: 'function_call_output' as const,
              call_id: tr.id,
              output: tr.error
                ? JSON.stringify({ error: tr.error, code: 'RILL-R001' })
                : typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result),
            }));
          },
        };

        const chunkBuffer: RillValue[] = [];
        const yieldChunk = (chunk: RillValue): void => {
          chunkBuffer.push(chunk);
        };
        const toolLoopAbortController = new AbortController();

        const loopPromise = executeToolLoop(
          initialInput,
          toolsDict,
          maxErrors,
          callbacks,
          (event, data) => {
            const eventMap: Record<string, string> = {
              tool_call: 'openai:tool_call',
              tool_result: 'openai:tool_result',
            };
            emitExtensionEvent(ctx as RuntimeContext, {
              event: eventMap[event] ?? event,
              subsystem: 'extension:openai',
              ...data,
            });
          },
          perCallMaxTurns,
          ctx,
          yieldChunk,
          AbortSignal.any([
            abortController!.signal,
            toolLoopAbortController.signal,
          ]),
          factoryMaxTurns
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            await loopPromise;
            for (const chunk of chunkBuffer) {
              yield chunk;
            }
          } catch (error: unknown) {
            if (error instanceof RuntimeHaltSignal) throw error;
            throwProviderHalt(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await loopPromise;
            const response = loopResult.response as OAIResponse | null;

            const assistantMsg = response
              ? responsesAPIToCanonical(response)
              : { role: 'assistant' as const, parts: [] as Part[] };
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: factoryModel,
              usage: {
                input: loopResult.totalTokens.input,
                output: loopResult.totalTokens.output,
              },
              stop_reason: response?.status ?? 'completed',
              id: response?.id ?? '',
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:tool_loop',
              subsystem: 'extension:openai',
              turns: loopResult.turns,
              total_duration: duration,
              usage: result.usage,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx as RuntimeContext,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            toolLoopAbortController.abort();
          },
          chunkType: { kind: 'dict' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: {
        description: 'Execute tool-use loop with OpenAI Responses API',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'dict' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // HOST FUNCTION: generate (Chat Completions only — structured output)
  // ============================================================

  function extractJson(content: string, reasoning: string): string {
    const candidate = content.trim() !== '' ? content : reasoning;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* fall through */
    }
    const m = candidate.match(/\{[\s\S]*\}/);
    return m ? m[0] : candidate;
  }

  const generateFn: RillFunction = {
    params: [
      {
        name: 'prompt',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: { description: 'String or list of message dicts' },
      },
      {
        name: 'schema',
        type: { kind: 'type' } as { kind: string },
        defaultValue: undefined,
        annotations: {
          description: 'Type expression for structured output schema',
        },
      },
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx as RuntimeContext);
      const startTime = Date.now();

      try {
        const rawPrompt = args['prompt'] as RillValue;
        const schemaArg = args['schema'] as
          | { __rill_type?: boolean; structure?: TypeStructure }
          | undefined;

        // Validate schema is a rill type expression with dict structure
        if (!schemaArg || !schemaArg.__rill_type || !schemaArg.structure) {
          throw haltInvalid(
            ctx as RuntimeContext,
            'INVALID_INPUT',
            'invalid_schema',
            'generate requires a type expression as schema'
          );
        }
        if (schemaArg.structure.kind !== 'dict') {
          throw haltInvalid(
            ctx as RuntimeContext,
            'INVALID_INPUT',
            'invalid_schema_type',
            `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
          );
        }

        const jsonSchema = buildJsonSchemaFromStructuralType(
          schemaArg.structure
        );

        // Normalize prompt
        const normalizedRaw4 = normalizePrompt(
          rawPrompt,
          ctx as RuntimeContext
        );
        if (!Array.isArray(normalizedRaw4)) {
          throw new RuntimeHaltSignal(normalizedRaw4, true);
        }
        const normalized4 = normalizedRaw4 as Message[];

        const inputMessages: Message[] = factorySystem
          ? [
              {
                role: 'system',
                parts: [{ type: 'text', text: factorySystem }],
              },
              ...normalized4,
            ]
          : normalized4;

        const apiMessages = canonicalToCC(inputMessages);

        const apiParams = {
          model: factoryModel,
          max_completion_tokens: factoryMaxTokens,
          messages: apiMessages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'output',
              schema: jsonSchema as unknown as Record<string, unknown>,
              strict: true,
            },
          },
          ...(factoryTemperature !== undefined
            ? { temperature: factoryTemperature }
            : {}),
          ...factoryExtra,
        } as OpenAI.ChatCompletionCreateParamsNonStreaming;

        const response = await client.chat.completions.create(apiParams, {
          signal: abortController!.signal,
        });

        // Unexpected finish reason indicates provider-side stream or content filter
        const finishReason = response.choices[0]?.finish_reason;
        if (finishReason !== 'stop' && finishReason !== 'length') {
          throw haltInvalid(
            ctx as RuntimeContext,
            'PROTOCOL',
            'unexpected_response_format',
            `generate: unexpected finish_reason '${finishReason ?? 'unknown'}'`
          );
        }

        // Reasoning-mode models (Nemotron, DeepSeek-R1, Qwen3) may emit the
        // structured JSON in reasoning_content with content empty, or mix prose
        // and JSON in either field. extractJson picks the right candidate and
        // strips any thinking preamble, leaving only the JSON object.
        const generateMessage = response.choices[0]?.message;
        const raw = extractJson(
          generateMessage?.content ?? '',
          (generateMessage as { reasoning_content?: string } | undefined)
            ?.reasoning_content ?? ''
        );

        // Parse JSON — reject non-JSON response
        let data: unknown;
        try {
          data = JSON.parse(raw) as unknown;
        } catch (parseError: unknown) {
          const detail =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          throw haltInvalid(
            ctx as RuntimeContext,
            'PROTOCOL',
            'schema_validation_failed',
            `generate: failed to parse response JSON: ${detail}`
          );
        }

        // Build canonical messages transcript
        const assistantParts: Part[] = [{ type: 'text', text: raw }];
        const responseMessages = buildResponseMessages(
          inputMessages,
          assistantParts
        );

        const result = {
          data,
          raw,
          messages: responseMessages as unknown as RillValue,
          model: response.model,
          usage: {
            input: response.usage?.prompt_tokens ?? 0,
            output: response.usage?.completion_tokens ?? 0,
          },
          stop_reason: finishReason ?? 'stop',
          id: response.id,
        };

        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:generate',
          subsystem: 'extension:openai',
          duration,
          model: response.model,
          usage: result.usage,
        });

        return result as RillValue;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        if (error instanceof RuntimeError) {
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: error.message,
            duration,
          });
          throw error;
        }
        if (error instanceof RuntimeHaltSignal) {
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(error.value).message,
            duration,
          });
          throw error;
        }
        const invalid = mapProviderError(
          ctx as RuntimeContext,
          'OpenAI',
          error,
          detectOpenAIError
        );
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:error',
          subsystem: 'extension:openai',
          error: getStatus(invalid).message,
          duration,
        });
        throw new RuntimeHaltSignal(invalid, true);
      }
    },
    annotations: { description: 'Generate structured output from OpenAI API' },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        data: { type: { kind: 'any' } },
        raw: { type: { kind: 'string' } },
        messages: {
          type: {
            kind: 'list',
            element: {
              kind: 'dict',
              fields: {
                role: { type: { kind: 'string' } },
                parts: { type: PARTS_LIST_STRUCTURE },
              },
            },
          },
        },
        model: { type: { kind: 'string' } },
        usage: {
          type: {
            kind: 'dict',
            fields: {
              input: { type: { kind: 'number' } },
              output: { type: { kind: 'number' } },
            },
          },
        },
        stop_reason: { type: { kind: 'string' } },
        id: { type: { kind: 'string' } },
      },
    }),
  };

  // ============================================================
  // HOST FUNCTION: embed
  // ============================================================

  const embedFn: RillFunction = {
    params: [p.str('text')],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx as RuntimeContext);
      const startTime = Date.now();

      try {
        const text = args['text'] as string;

        validateEmbedText(text.trim());
        validateEmbedModel(factoryEmbedModel);

        const response = await client.embeddings.create(
          {
            model: factoryEmbedModel,
            input: text,
            encoding_format: 'float',
          },
          { signal: abortController!.signal }
        );

        const embeddingData = response.data[0]?.embedding;
        if (!embeddingData || embeddingData.length === 0) {
          throw haltInvalid(
            ctx as RuntimeContext,
            'PROTOCOL',
            'empty_embedding_response',
            'OpenAI: empty embedding returned'
          );
        }

        const float32Data = new Float32Array(embeddingData);
        const vector = createVector(float32Data, factoryEmbedModel);

        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:embed',
          subsystem: 'extension:openai',
          duration,
          model: factoryEmbedModel,
          dimensions: float32Data.length,
        });

        return vector as RillValue;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;

        if (error instanceof RuntimeHaltSignal) {
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(error.value).message,
            duration,
          });
          throw error;
        }

        const invalid = mapProviderError(
          ctx as RuntimeContext,
          'OpenAI',
          error,
          detectOpenAIError
        );
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:error',
          subsystem: 'extension:openai',
          error: getStatus(invalid).message,
          duration,
        });
        throw new RuntimeHaltSignal(invalid, true);
      }
    },
    annotations: { description: 'Generate embedding vector for text' },
    returnType: structureToTypeValue({ kind: 'vector' }),
  };

  // ============================================================
  // HOST FUNCTION: embed_batch
  // ============================================================

  const embedBatchFn: RillFunction = {
    params: [p.list('texts')],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx as RuntimeContext);
      const startTime = Date.now();

      try {
        const texts = args['texts'] as Array<RillValue>;

        if (texts.length === 0) {
          return [] as RillValue;
        }

        validateEmbedModel(factoryEmbedModel);

        const stringTexts = validateEmbedBatch(texts);

        const response = await client.embeddings.create(
          {
            model: factoryEmbedModel,
            input: stringTexts,
            encoding_format: 'float',
          },
          { signal: abortController!.signal }
        );

        const vectors: RillValue[] = [];
        for (const embeddingItem of response.data) {
          const embeddingData = embeddingItem.embedding;
          if (!embeddingData || embeddingData.length === 0) {
            throw haltInvalid(
              ctx as RuntimeContext,
              'PROTOCOL',
              'empty_embedding_response',
              'OpenAI: empty embedding returned'
            );
          }
          const float32Data = new Float32Array(embeddingData);
          vectors.push(
            createVector(float32Data, factoryEmbedModel) as RillValue
          );
        }

        const duration = Date.now() - startTime;
        const firstVector = vectors[0];
        const dimensions =
          firstVector && isVector(firstVector) ? firstVector.data.length : 0;
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:embed_batch',
          subsystem: 'extension:openai',
          duration,
          model: factoryEmbedModel,
          dimensions,
          count: vectors.length,
        });

        return vectors as RillValue;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;

        if (error instanceof RuntimeHaltSignal) {
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(error.value).message,
            duration,
          });
          throw error;
        }

        const invalid = mapProviderError(
          ctx as RuntimeContext,
          'OpenAI',
          error,
          detectOpenAIError
        );
        emitExtensionEvent(ctx as RuntimeContext, {
          event: 'openai:error',
          subsystem: 'extension:openai',
          error: getStatus(invalid).message,
          duration,
        });
        throw new RuntimeHaltSignal(invalid, true);
      }
    },
    annotations: {
      description: 'Generate embedding vectors for multiple texts',
    },
    returnType: structureToTypeValue({
      kind: 'list',
      element: { kind: 'vector' },
    }),
  };

  // ============================================================
  // ASSEMBLE RESULT
  // ============================================================

  // Select routing implementations based on model class (fixed at factory init)
  const messageFn = isOSeries ? makeMessageFnResponses() : makeMessageFnCC();
  const toolLoopFn = isOSeries ? makeToolLoopFnResponses() : makeToolLoopFnCC();

  const fnDict: {
    message: RillFunction;
    embed: RillFunction;
    embed_batch: RillFunction;
    tool_loop: RillFunction;
    generate: RillFunction;
  } = {
    message: messageFn,
    embed: embedFn,
    embed_batch: embedBatchFn,
    tool_loop: toolLoopFn,
    generate: generateFn,
  };

  const callableDict = {
    message: toCallable(fnDict.message),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(fnDict.generate),
  } satisfies LlmExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
