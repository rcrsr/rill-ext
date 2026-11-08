/**
 * generate host function for the Foundry extension.
 */

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
  buildJsonSchemaFromStructuralType,
  normalizePrompt,
  type Message,
} from '@rcrsr/rill-ext-llm-shared';
import type OpenAI from 'openai';
import { p } from '@rcrsr/rill-ext-param-shared';
import { haltInvalid, messagesToOpenAI } from './message-helpers.js';
import type { FoundryScope } from './scope.js';

export function buildGenerateFn(scope: FoundryScope): RillFunction {
  const {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    assertNotDisposed,
    assertInference,
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
        name: 'schema',
        type: { kind: 'type' },
        defaultValue: undefined,
        annotations: {
          description: 'Type expression for structured output schema',
        },
      },
      p.dict(
        'options',
        undefined,
        {},
        {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
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
        }
      ),
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      const startTime = Date.now();

      assertNotDisposed(ctx);
      assertInference(ctx);

      try {
        const rawPrompt = args['prompt'] as RillValue;
        const schemaArg = args['schema'] as
          | { __rill_type?: boolean; structure?: TypeStructure }
          | undefined;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        if (
          schemaArg?.__rill_type !== true ||
          schemaArg.structure === undefined
        ) {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'schema_missing',
            'generate requires a type expression as schema'
          );
        }
        if (schemaArg.structure.kind !== 'dict') {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'invalid_schema',
            `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
          );
        }

        const normalizedResult3 = normalizePrompt(rawPrompt, ctx);
        if (!Array.isArray(normalizedResult3)) {
          throw new RuntimeHaltSignal(normalizedResult3, true);
        }
        const normalizedPrompt = normalizedResult3 as Message[];

        const jsonSchema = buildJsonSchemaFromStructuralType(
          schemaArg.structure
        );

        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        const inputMessages: Message[] =
          system !== undefined && system !== ''
            ? [
                { role: 'system', parts: [{ type: 'text', text: system }] },
                ...normalizedPrompt,
              ]
            : normalizedPrompt;

        const apiMessages = messagesToOpenAI(inputMessages);

        const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model: factoryModel!,
          max_completion_tokens: maxTokens,
          messages: apiMessages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'output',
              schema: jsonSchema as unknown as Record<string, unknown>,
              strict: true,
            },
          },
        };

        if (factoryTemperature !== undefined) {
          apiParams.temperature = factoryTemperature;
        }

        const response = await client.chat.completions.create(apiParams, {
          signal: scope.getAbortSignal(ctx),
        });

        const raw = response.choices[0]?.message?.content ?? '';

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
            'json_parse_failed',
            `generate: failed to parse response JSON: ${detail}`
          );
        }

        const inputTokens = response.usage?.prompt_tokens ?? 0;
        const outputTokens = response.usage?.completion_tokens ?? 0;
        accumulateUsage(inputTokens, outputTokens);

        const result = {
          data,
          raw,
          model: response.model,
          usage: { input: inputTokens, output: outputTokens },
          stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
          id: response.id,
        };

        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx, {
          event: 'foundry:generate',
          subsystem: 'extension:foundry',
          duration,
          model: response.model,
          inputTokens,
          outputTokens,
        });

        return result as RillValue;
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
    },
    annotations: {
      description: 'Generate structured output from Azure AI Foundry',
    },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        data: { type: { kind: 'any' } },
        raw: { type: { kind: 'string' } },
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
