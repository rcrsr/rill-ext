/**
 * generate host function for the OpenAI extension (Chat Completions only).
 */

import type OpenAI from 'openai';
import {
  RuntimeError,
  RuntimeHaltSignal,
  emitExtensionEvent,
  getStatus,
  structureToTypeValue,
  type RillFunction,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import {
  mapProviderError,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  normalizePrompt,
  PARTS_LIST_STRUCTURE,
  type Message,
  type Part,
} from '@rcrsr/rill-ext-llm-shared';
import type { OpenAIScope } from './scope.js';
import {
  canonicalToCC,
  detectOpenAIError,
  extractJson,
  haltInvalid,
} from './wire-format.js';

export function buildGenerateFn(scope: OpenAIScope): RillFunction {
  const {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
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
        name: 'schema',
        type: { kind: 'type' },
        defaultValue: undefined,
        annotations: {
          description: 'Type expression for structured output schema',
        },
      },
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx);
      const startTime = Date.now();

      try {
        const rawPrompt = args['prompt'] as RillValue;
        const schemaArg = args['schema'] as
          | { __rill_type?: boolean; structure?: TypeStructure }
          | undefined;

        // Validate schema is a rill type expression with dict structure
        if (
          schemaArg?.__rill_type !== true ||
          schemaArg.structure === undefined
        ) {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'invalid_schema',
            'generate requires a type expression as schema'
          );
        }
        if (schemaArg.structure.kind !== 'dict') {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'invalid_schema_type',
            `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
          );
        }

        const jsonSchema = buildJsonSchemaFromStructuralType(
          schemaArg.structure
        );

        // Normalize prompt
        const normalizedRaw4 = normalizePrompt(rawPrompt, ctx);
        if (!Array.isArray(normalizedRaw4)) {
          throw new RuntimeHaltSignal(normalizedRaw4, true);
        }
        const normalized4 = normalizedRaw4 as Message[];

        const inputMessages: Message[] =
          factorySystem !== undefined && factorySystem !== ''
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
          signal: scope.getAbortSignal(ctx),
        });

        // Unexpected finish reason indicates provider-side stream or content filter
        const finishReason = response.choices[0]?.finish_reason;
        if (finishReason !== 'stop' && finishReason !== 'length') {
          throw haltInvalid(
            ctx,
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
            ctx,
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
        emitExtensionEvent(ctx, {
          event: 'openai:generate',
          subsystem: 'extension:openai',
          duration,
          model: response.model,
          usage: result.usage,
        });

        return result as RillValue;
      } catch (error: unknown) {
        // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
        haltIfCancelledByDispose(ctx, error, startTime);
        const duration = Date.now() - startTime;
        if (error instanceof RuntimeError) {
          emitExtensionEvent(ctx, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: error.message,
            duration,
          });
          throw error;
        }
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
}
