/**
 * tool_loop host functions for the OpenAI extension (Chat Completions and
 * Responses API variants).
 */

import OpenAI from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  Response as OAIResponse,
} from 'openai/resources/responses/responses.js';
import {
  RuntimeHaltSignal,
  createRillStream,
  emitExtensionEvent,
  getStatus,
  structureToTypeValue,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import {
  mapProviderError,
  throwProviderHalt,
  executeToolLoop,
  buildResponseMessages,
  normalizePrompt,
  type ToolLoopCallbacks,
  type Message,
  type Part,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { OpenAIScope } from './scope.js';
import {
  VERB_STREAM_RET_TYPE,
  canonicalToCC,
  canonicalToResponsesAPI,
  ccChoiceToCanonical,
  detectOpenAIError,
  responsesAPIToCanonical,
  validateToolLoopArgs,
} from './wire-format.js';

// ============================================================
// HOST FUNCTION: tool_loop (Chat Completions path)
// ============================================================

export function buildToolLoopFnCC(scope: OpenAIScope): RillFunction {
  const {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    maxTurns: factoryMaxTurns,
    maxErrors: factoryMaxErrors,
    extra: factoryExtra,
    assertNotDisposed,
    haltIfCancelledByDispose,
  } = scope;
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
      assertNotDisposed(ctx);
      const rawPrompt = args['prompt'] as RillValue;
      const toolsDict = args['tools'] as RillValue;
      const perCallMaxTurns = (args['max_turns'] ?? 0) as number;

      validateToolLoopArgs(toolsDict, perCallMaxTurns, ctx);

      const normalizedRaw2 = normalizePrompt(rawPrompt, ctx);
      if (!Array.isArray(normalizedRaw2)) {
        throw new RuntimeHaltSignal(normalizedRaw2, true);
      }
      const normalized2 = normalizedRaw2 as Message[];

      const inputMessages: Message[] =
        factorySystem !== undefined && factorySystem !== ''
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
              parameters: def.input_schema,
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
            typeof response !== 'object' ||
            response === null ||
            !('choices' in response)
          )
            return null;
          const choices = (response as { choices: unknown[] }).choices;
          if (!Array.isArray(choices) || choices.length === 0) return null;

          const choice = choices[0];
          if (
            typeof choice !== 'object' ||
            choice === null ||
            !('message' in choice)
          )
            return null;

          const message = choice.message;
          if (
            typeof message !== 'object' ||
            message === null ||
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
            typeof response !== 'object' ||
            response === null ||
            !('choices' in response)
          )
            return null;
          const choices = (response as { choices: unknown[] }).choices;
          if (!Array.isArray(choices) || choices.length === 0) return null;

          const choice = choices[0];
          if (
            typeof choice !== 'object' ||
            choice === null ||
            !('message' in choice)
          )
            return null;

          const msg = choice.message;
          if (typeof msg !== 'object' || msg === null) return null;

          const m = msg as Record<string, unknown>;
          const clean: Record<string, unknown> = {
            role: m['role'],
            content: m['content'],
          };
          if (m['tool_calls'] !== undefined && m['tool_calls'] !== null)
            clean['tool_calls'] = m['tool_calls'];
          return clean;
        },

        formatToolResult: (toolResults) => {
          return toolResults.map((tr) => ({
            role: 'tool' as const,
            tool_call_id: tr.id,
            content:
              tr.error !== undefined && tr.error !== ''
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
          emitExtensionEvent(ctx, {
            event: eventMap[event] ?? event,
            subsystem: 'extension:openai',
            ...data,
          });
        },
        perCallMaxTurns,
        ctx,
        yieldChunk,
        AbortSignal.any([
          scope.getAbortSignal(ctx),
          toolLoopAbortController.signal,
        ]),
        factoryMaxTurns
      );
      // Mark the rejection handled: dispose() aborts the loop and it can
      // reject before any consumer awaits it. Consumers still see it.
      void loopPromise.catch(() => {});

      async function* chunks(): AsyncGenerator<RillValue> {
        try {
          await loopPromise;
          for (const chunk of chunkBuffer) {
            yield chunk;
          }
        } catch (error: unknown) {
          // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
          haltIfCancelledByDispose(ctx, error);
          if (error instanceof RuntimeHaltSignal) throw error;
          throwProviderHalt(ctx, 'OpenAI', error, detectOpenAIError);
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
          emitExtensionEvent(ctx, {
            event: 'openai:tool_loop',
            subsystem: 'extension:openai',
            turns: loopResult.turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result;
        } catch (error: unknown) {
          // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
          haltIfCancelledByDispose(ctx, error, startTime);
          const duration = Date.now() - startTime;
          if (error instanceof RuntimeHaltSignal) {
            emitExtensionEvent(ctx, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(error.value).message,
              duration,
            });
            throw error;
          }
          const invalid = mapProviderError(
            ctx,
            'OpenAI',
            error,
            detectOpenAIError
          );
          emitExtensionEvent(ctx, {
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

export function buildToolLoopFnResponses(scope: OpenAIScope): RillFunction {
  const {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    maxTurns: factoryMaxTurns,
    maxErrors: factoryMaxErrors,
    extra: factoryExtra,
    assertNotDisposed,
    haltIfCancelledByDispose,
  } = scope;
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
      assertNotDisposed(ctx);
      const rawPrompt = args['prompt'] as RillValue;
      const toolsDict = args['tools'] as RillValue;
      const perCallMaxTurns = (args['max_turns'] ?? 0) as number;

      validateToolLoopArgs(toolsDict, perCallMaxTurns, ctx);

      const normalizedRaw3 = normalizePrompt(rawPrompt, ctx);
      if (!Array.isArray(normalizedRaw3)) {
        throw new RuntimeHaltSignal(normalizedRaw3, true);
      }
      const normalized3 = normalizedRaw3 as Message[];

      const inputMessages: Message[] =
        factorySystem !== undefined && factorySystem !== ''
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
            typeof response !== 'object' ||
            response === null ||
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
            typeof response !== 'object' ||
            response === null ||
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
            output:
              tr.error !== undefined && tr.error !== ''
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
          emitExtensionEvent(ctx, {
            event: eventMap[event] ?? event,
            subsystem: 'extension:openai',
            ...data,
          });
        },
        perCallMaxTurns,
        ctx,
        yieldChunk,
        AbortSignal.any([
          scope.getAbortSignal(ctx),
          toolLoopAbortController.signal,
        ]),
        factoryMaxTurns
      );
      // Mark the rejection handled: dispose() aborts the loop and it can
      // reject before any consumer awaits it. Consumers still see it.
      void loopPromise.catch(() => {});

      async function* chunks(): AsyncGenerator<RillValue> {
        try {
          await loopPromise;
          for (const chunk of chunkBuffer) {
            yield chunk;
          }
        } catch (error: unknown) {
          // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
          haltIfCancelledByDispose(ctx, error);
          if (error instanceof RuntimeHaltSignal) throw error;
          throwProviderHalt(ctx, 'OpenAI', error, detectOpenAIError);
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
          emitExtensionEvent(ctx, {
            event: 'openai:tool_loop',
            subsystem: 'extension:openai',
            turns: loopResult.turns,
            total_duration: duration,
            usage: result.usage,
          });

          return result;
        } catch (error: unknown) {
          // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
          haltIfCancelledByDispose(ctx, error, startTime);
          const duration = Date.now() - startTime;
          if (error instanceof RuntimeHaltSignal) {
            emitExtensionEvent(ctx, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(error.value).message,
              duration,
            });
            throw error;
          }
          const invalid = mapProviderError(
            ctx,
            'OpenAI',
            error,
            detectOpenAIError
          );
          emitExtensionEvent(ctx, {
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
