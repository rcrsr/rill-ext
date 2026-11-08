/**
 * tool_loop host function for the Foundry extension.
 */

import {
  RuntimeError,
  RuntimeHaltSignal,
  createRillStream,
  emitExtensionEvent,
  getStatus,
  structureToTypeValue,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import {
  executeToolLoop,
  normalizePrompt,
  buildResponseMessages,
  throwProviderHalt,
  type Message,
  type Role,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import type OpenAI from 'openai';
import { p } from '@rcrsr/rill-ext-param-shared';
import { detectFoundryError } from './errors.js';
import {
  extractLastMessageText,
  haltInvalid,
  messagesToOpenAI,
} from './message-helpers.js';
import type { FoundryScope } from './scope.js';

export function buildToolLoopFn(scope: FoundryScope): RillFunction {
  const {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    autoShield: autoShieldMiddleware,
    assertNotDisposed,
    assertInference,
    cancelledByDispose,
    classifyError,
    accumulateUsage,
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
      p.dict('options', undefined, undefined, {
        system: { type: { kind: 'string' }, defaultValue: '' },
        max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        max_errors: { type: { kind: 'number' }, defaultValue: 3 },
        max_turns: { type: { kind: 'number' }, defaultValue: 10 },
        messages: {
          type: {
            kind: 'list',
            element: {
              kind: 'dict',
              fields: {
                role: { type: { kind: 'string' } },
                content: { type: { kind: 'string' } },
              },
            },
          },
          defaultValue: [],
        },
      }),
    ],
    fn: (args, ctx): RillValue => {
      assertNotDisposed(ctx);
      assertInference(ctx);

      const rawPrompt = args['prompt'] as RillValue;
      const toolsDict = args['tools'] as RillValue;
      const options = (args['options'] ?? {}) as Record<string, unknown>;

      const normalizedResult2 = normalizePrompt(rawPrompt, ctx);
      if (!Array.isArray(normalizedResult2)) {
        throw new RuntimeHaltSignal(normalizedResult2, true);
      }
      const normalizedPrompt = normalizedResult2 as Message[];

      const system =
        typeof options['system'] === 'string'
          ? options['system']
          : factorySystem;
      const maxTokens =
        typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
          ? options['max_tokens']
          : factoryMaxTokens;
      const maxErrors =
        typeof options['max_errors'] === 'number' ? options['max_errors'] : 3;
      const maxTurns =
        typeof options['max_turns'] === 'number' ? options['max_turns'] : 10;

      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      if (system !== undefined) {
        messages.push({ role: 'system', content: system });
      }

      if ('messages' in options && Array.isArray(options['messages'])) {
        const prependedMessages = options['messages'] as unknown[];

        for (const msg of prependedMessages) {
          if (typeof msg !== 'object' || msg === null || !('role' in msg)) {
            throw haltInvalid(
              ctx,
              'INVALID_INPUT',
              'role_missing',
              "message missing required 'role' field"
            );
          }

          const role = msg['role'];
          if (role !== 'user' && role !== 'assistant') {
            throw haltInvalid(
              ctx,
              'INVALID_INPUT',
              'invalid_role',
              `invalid role '${role as string}'`
            );
          }

          if (!('content' in msg) || typeof msg['content'] !== 'string') {
            throw haltInvalid(
              ctx,
              'INVALID_INPUT',
              'content_missing',
              `${role as string} message requires 'content'`
            );
          }

          messages.push({
            role: role,
            content: msg['content'],
          });
        }
      }

      for (const msg of messagesToOpenAI(normalizedPrompt)) {
        messages.push(msg);
      }

      const callbacks: ToolLoopCallbacks = {
        buildTools: (
          toolDefs: Array<{
            name: string;
            description: string;
            input_schema: object;
          }>
        ): OpenAI.ChatCompletionTool[] => {
          return toolDefs.map((def) => ({
            type: 'function' as const,
            function: {
              name: def.name,
              description: def.description,
              parameters: def.input_schema as Record<string, unknown>,
            },
          }));
        },

        callAPI: async (
          msgs: unknown[],
          tools: unknown,
          signal?: AbortSignal
        ): Promise<unknown> => {
          const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: factoryModel!,
            max_completion_tokens: maxTokens,
            messages: msgs as OpenAI.ChatCompletionMessageParam[],
            tools: tools as OpenAI.ChatCompletionTool[],
            tool_choice: 'auto' as const,
          };

          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }

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

        callAPIStreaming: async (
          msgs: unknown[],
          tools: unknown,
          onTextDelta: (text: string) => void,
          signal?: AbortSignal
        ): Promise<unknown> => {
          const streamRunner = client.chat.completions.stream(
            {
              model: factoryModel!,
              max_completion_tokens: maxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
              stream_options: { include_usage: true },
              ...(factoryTemperature !== undefined
                ? { temperature: factoryTemperature }
                : {}),
            },
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

        extractToolCalls: (
          response: unknown
        ): Array<{ id: string; name: string; input: object }> | null => {
          if (
            typeof response !== 'object' ||
            response === null ||
            !('choices' in response)
          ) {
            return null;
          }

          const choices = (response as { choices: unknown[] }).choices;
          if (!Array.isArray(choices) || choices.length === 0) {
            return null;
          }

          const choice = choices[0];
          if (
            typeof choice !== 'object' ||
            choice === null ||
            !('message' in choice)
          ) {
            return null;
          }

          const message = choice.message;
          if (
            typeof message !== 'object' ||
            message === null ||
            !('tool_calls' in message)
          ) {
            return null;
          }

          const toolCalls = (message as { tool_calls: unknown[] | null })
            .tool_calls;
          if (!toolCalls || !Array.isArray(toolCalls)) {
            return null;
          }

          const functionToolCalls = toolCalls.filter(
            (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall =>
              typeof tc === 'object' &&
              tc !== null &&
              'type' in tc &&
              tc.type === 'function'
          );

          return functionToolCalls.map((tc) => {
            const functionCall =
              tc as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                function: { name: string; arguments: string };
              };
            const tcArgs = functionCall.function.arguments;
            let parsedArgs: object;
            try {
              const parsed: unknown = JSON.parse(tcArgs);
              parsedArgs =
                typeof parsed === 'object' && parsed !== null ? parsed : {};
            } catch {
              parsedArgs = {};
            }
            return {
              id: tc.id,
              name: functionCall.function.name,
              input: parsedArgs,
            };
          });
        },

        formatAssistantMessage: (response: unknown): unknown => {
          if (
            typeof response !== 'object' ||
            response === null ||
            !('choices' in response)
          ) {
            return null;
          }

          const choices = (response as { choices: unknown[] }).choices;
          if (!Array.isArray(choices) || choices.length === 0) {
            return null;
          }

          const choice = choices[0];
          if (
            typeof choice !== 'object' ||
            choice === null ||
            !('message' in choice)
          ) {
            return null;
          }

          const msg = choice.message;
          if (typeof msg !== 'object' || msg === null) {
            return null;
          }

          const m = msg as Record<string, unknown>;
          const clean: Record<string, unknown> = {
            role: m['role'],
            content: m['content'],
          };
          if (m['tool_calls'] !== undefined && m['tool_calls'] !== null) {
            clean['tool_calls'] = m['tool_calls'];
          }
          return clean;
        },

        formatToolResult: (
          toolResults: Array<{
            id: string;
            name: string;
            result: RillValue;
            error?: string;
          }>
        ): unknown => {
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

      // -------------------------------------------------------
      // Per-iteration auto-shield for tool_loop
      // Wraps callAPI and callAPIStreaming so the shield check
      // runs before every LLM API call, including iterations
      // carrying tool results.
      // -------------------------------------------------------
      if (autoShieldMiddleware) {
        const shield = autoShieldMiddleware;
        const origCallAPI = callbacks.callAPI;
        const origCallAPIStreaming = callbacks.callAPIStreaming;

        callbacks.callAPI = async (
          msgs: unknown[],
          tools: unknown,
          signal?: AbortSignal
        ): Promise<unknown> => {
          const promptText = extractLastMessageText(msgs);
          const shieldArgs: Record<string, RillValue> = {
            text: promptText,
          };
          await shield(
            shieldArgs,
            ctx,
            (): Promise<RillValue> =>
              Promise.resolve(null as unknown as RillValue),
            'tool_loop'
          );
          return origCallAPI(msgs, tools, signal);
        };

        if (origCallAPIStreaming) {
          callbacks.callAPIStreaming = async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const promptText = extractLastMessageText(msgs);
            const shieldArgs: Record<string, RillValue> = {
              text: promptText,
            };
            await shield(
              shieldArgs,
              ctx,
              (): Promise<RillValue> =>
                Promise.resolve(null as unknown as RillValue),
              'tool_loop'
            );
            return origCallAPIStreaming(msgs, tools, onTextDelta, signal);
          };
        }
      }

      const chunkBuffer: RillValue[] = [];

      const yieldChunk = (chunk: RillValue): void => {
        chunkBuffer.push(chunk);
      };

      const toolLoopAbortController = new AbortController();

      const loopPromise = executeToolLoop(
        messages,
        toolsDict,
        maxErrors,
        callbacks,
        (event: string, data: Record<string, unknown>) => {
          const eventMap: Record<string, string> = {
            tool_call: 'foundry:tool_call',
            tool_result: 'foundry:tool_result',
          };

          emitExtensionEvent(ctx, {
            event: eventMap[event] ?? event,
            subsystem: 'extension:foundry',
            ...data,
          });
        },
        maxTurns,
        ctx,
        yieldChunk,
        AbortSignal.any([
          scope.getAbortSignal(ctx),
          toolLoopAbortController.signal,
        ])
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
          const cancelled = cancelledByDispose(ctx, error);
          if (cancelled) throw cancelled;
          if (error instanceof RuntimeHaltSignal) throw error;
          throwProviderHalt(ctx, 'Foundry', error, detectFoundryError);
        }
      }

      const resolve = async (): Promise<RillValue> => {
        const startTime = Date.now();
        try {
          const loopResult = await loopPromise;

          const response =
            loopResult.response as OpenAI.Chat.Completions.ChatCompletion | null;
          const content = response?.choices[0]?.message?.content ?? '';
          const stopReason =
            loopResult.turns >= maxTurns
              ? 'max_turns'
              : (response?.choices[0]?.finish_reason ?? 'stop');

          const inputMessages: Message[] = (
            messages as unknown as Array<Record<string, unknown>>
          )
            .filter((m) => m['role'] === 'user' || m['role'] === 'assistant')
            .map((m) => ({
              role: m['role'] as Role,
              parts: [
                {
                  type: 'text' as const,
                  text: typeof m['content'] === 'string' ? m['content'] : '',
                },
              ],
            }));

          accumulateUsage(
            loopResult.totalTokens.input,
            loopResult.totalTokens.output
          );

          const result = {
            content,
            model: factoryModel ?? '',
            usage: {
              input: loopResult.totalTokens.input,
              output: loopResult.totalTokens.output,
            },
            stop_reason: stopReason,
            turns: loopResult.turns,
            messages: response
              ? buildResponseMessages(inputMessages, [
                  { type: 'text', text: content },
                ])
              : inputMessages,
          };

          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx, {
            event: 'foundry:tool_loop',
            subsystem: 'extension:foundry',
            model: factoryModel ?? '',
            iterations: loopResult.turns,
            totalTokens:
              loopResult.totalTokens.input + loopResult.totalTokens.output,
            duration,
          });

          return result as unknown as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal = classifyError(
            ctx,
            error
          );
          emitExtensionEvent(ctx, {
            event: 'foundry:error',
            subsystem: 'extension:foundry',
            error:
              rillError instanceof RuntimeHaltSignal
                ? getStatus(rillError.value).message
                : rillError.message,
            duration,
          });
          throw rillError;
        }
      };

      const retType = {
        kind: 'dict' as const,
        fields: {
          content: { type: { kind: 'string' as const } },
          model: { type: { kind: 'string' as const } },
          usage: {
            type: {
              kind: 'dict' as const,
              fields: {
                input: { type: { kind: 'number' as const } },
                output: { type: { kind: 'number' as const } },
              },
            },
          },
          stop_reason: { type: { kind: 'string' as const } },
          turns: { type: { kind: 'number' as const } },
          messages: {
            type: {
              kind: 'list' as const,
              element: { kind: 'dict' as const },
            },
          },
        },
      };

      return createRillStream({
        chunks: chunks(),
        resolve,
        dispose: () => {
          toolLoopAbortController.abort();
        },
        chunkType: { kind: 'dict' },
        retType,
      });
    },
    annotations: {
      description: 'Execute tool-use loop with Azure AI Foundry',
    },
    returnType: structureToTypeValue({
      kind: 'stream',
      chunk: { kind: 'dict' },
      ret: {
        kind: 'dict',
        fields: {
          content: { type: { kind: 'string' } },
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
          turns: { type: { kind: 'number' } },
          messages: { type: { kind: 'list', element: { kind: 'dict' } } },
        },
      },
    }),
  };
}
