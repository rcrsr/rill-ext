/**
 * Bing grounding module for Azure AI Foundry extension.
 *
 * ground() uses the AzureOpenAI client's responses API with a bing_grounding tool.
 * The bing_grounding tool is Azure-specific and requires:
 *   - type: "bing_grounding"
 *   - bing_grounding.search_configurations[].project_connection_id
 *
 * Auth scope: https://ai.azure.com/.default (shared via the AzureOpenAI client).
 *
 * Note: The bing_grounding tool type is Azure-specific and not present in the base
 * openai-node type definitions. Tool construction uses a type assertion.
 */

import { RuntimeError, emitExtensionEvent, type RillValue, type RuntimeContext } from '@rcrsr/rill';
import type { AzureOpenAI } from 'openai';
import type { ResponseOutputItem } from 'openai/resources/responses/responses.js';
import type {
  FoundryConfig,
  FoundryGroundingConfig,
} from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const PROVIDER = 'foundry';

// ============================================================
// TYPES
// ============================================================

/**
 * Azure-specific bing_grounding tool definition.
 * Not present in the base openai-node types; Azure adds this at runtime.
 */
interface BingGroundingTool {
  type: 'bing_grounding';
  bing_grounding: {
    search_configurations: Array<{
      project_connection_id: string;
    }>;
  };
}

// ============================================================
// GROUND FUNCTION
// ============================================================

/**
 * Ground a query via Bing using the Azure AI Foundry responses endpoint.
 *
 * Returns `{ answer: string, citations: list }`.
 * Validates `grounding` config on each call (EC-9 if missing).
 *
 * @param query - Search query string
 * @param config - Root Foundry config (grounding sub-config validated here)
 * @param client - Pre-built AzureOpenAI client (created at factory time)
 * @param ctx - Runtime context for event emission
 * @param disposed - Disposal flag; throws if true
 * @returns RillValue dict with `answer` (string) and `citations` (list)
 */
export async function callGround(
  query: string,
  config: FoundryConfig,
  client: AzureOpenAI,
  ctx: RuntimeContext,
  disposed: { value: boolean }
): Promise<RillValue> {
  if (disposed.value) {
    throw new RuntimeError('RILL-R004', `${PROVIDER}: extension disposed`);
  }

  // EC-9: Grounding must be configured
  if (!config.grounding) {
    throw new RuntimeError('RILL-R004', 'foundry: grounding connection not configured');
  }

  const groundingConfig: FoundryGroundingConfig = config.grounding;

  // Falls back to inference.model if grounding.model is unset
  const model = groundingConfig.model ?? config.inference?.model;
  if (!model) {
    throw new RuntimeError(
      'RILL-R004',
      `${PROVIDER}: grounding requires a model — set grounding.model or inference.model`
    );
  }

  const startTime = Date.now();

  try {
    const bingTool: BingGroundingTool = {
      type: 'bing_grounding',
      bing_grounding: {
        search_configurations: [
          {
            project_connection_id: groundingConfig.connectionId,
          },
        ],
      },
    };

    // Cast tools because bing_grounding is Azure-specific and not in base openai-node types.
    // The tools array is typed as Tool[] (non-undefined when present); cast via unknown.
    const response = await client.responses.create({
      model,
      input: query,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [bingTool] as any,
    });

    const answer = response.output_text ?? '';
    const citations = extractCitations(response.output);

    const duration = Date.now() - startTime;

    emitExtensionEvent(ctx, {
      event: 'foundry:ground',
      subsystem: `extension:${PROVIDER}`,
      citationCount: citations.length,
      duration,
    });

    return {
      answer: answer as RillValue,
      citations: citations as RillValue,
    } as RillValue;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    if (error instanceof RuntimeError) {
      emitExtensionEvent(ctx, {
        event: 'foundry:ground:error',
        subsystem: `extension:${PROVIDER}`,
        error: error.message,
        duration,
      });
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const rillError = new RuntimeError('RILL-R004', `${PROVIDER}: ${message}`);

    emitExtensionEvent(ctx, {
      event: 'foundry:ground:error',
      subsystem: `extension:${PROVIDER}`,
      error: rillError.message,
      duration,
    });

    throw rillError;
  }
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Extract URL citations from the responses API output array.
 *
 * Iterates output items looking for `message` type items, then inspects
 * `output_text` content blocks for `url_citation` annotations.
 *
 * @param output - Response output item array
 * @returns Array of citation dicts with url and title fields
 */
function extractCitations(output: ResponseOutputItem[]): Array<Record<string, RillValue>> {
  const citations: Array<Record<string, RillValue>> = [];

  for (const item of output) {
    if (item.type !== 'message') {
      continue;
    }

    for (const contentBlock of item.content) {
      if (contentBlock.type !== 'output_text') {
        continue;
      }

      for (const annotation of contentBlock.annotations) {
        if (annotation.type !== 'url_citation') {
          continue;
        }

        citations.push({
          url: annotation.url as RillValue,
          title: annotation.title as RillValue,
          startIndex: annotation.start_index as RillValue,
          endIndex: annotation.end_index as RillValue,
        });
      }
    }
  }

  return citations;
}
