/**
 * Content Safety REST client and auto-shield middleware for Azure AI Foundry extension.
 *
 * shield() calls the Azure AI Content Safety Prompt Shields REST API.
 * createAutoShieldMiddleware() wraps LLM host functions to run a shield check before each call.
 *
 * Auth (per spec D-2):
 *   - api-key: Ocp-Apim-Subscription-Key header
 *   - entra: Bearer token with cognitiveservices.azure.com/.default scope
 *
 * API version: 2024-09-01
 */

import { RuntimeError, emitExtensionEvent, type RillValue, type RuntimeContext } from '@rcrsr/rill';
import { buildRestAuthHeaders } from './client.js';
import { mapRestError, createTimeoutError } from './errors.js';
import type {
  FoundryAuth,
  FoundryContentSafetyConfig,
  FoundryConfig,
} from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const SHIELD_API_VERSION = '2024-09-01';
const DEFAULT_TIMEOUT = 30_000;
const PROVIDER = 'foundry';

// ============================================================
// TYPES
// ============================================================

/**
 * Parsed result from the Content Safety Prompt Shields API.
 */
interface ShieldResult {
  safe: boolean;
  attackType: string | null;
}

/**
 * Middleware that intercepts a host function call.
 * Takes the same (args, ctx) signature as a host function and returns the inner result.
 */
export type ShieldMiddleware = (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  inner: (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue>,
  triggeredBy: string
) => Promise<RillValue>;

// ============================================================
// SHIELD REST CLIENT
// ============================================================

/**
 * Call the Azure AI Content Safety Prompt Shields API.
 *
 * Returns `{ safe: boolean, analysis: dict }`.
 * Validates `contentSafety` config on each call (EC-7 if missing).
 *
 * @param text - User prompt text to evaluate
 * @param documents - Optional supporting documents to evaluate
 * @param config - Root Foundry config (contentSafety sub-config validated here)
 * @param auth - Authentication config
 * @param ctx - Runtime context for event emission
 * @param disposed - Disposal flag; throws if true
 * @returns RillValue dict with `safe` (boolean) and `analysis` (dict)
 */
export async function callShield(
  text: string,
  documents: string[],
  config: FoundryConfig,
  auth: FoundryAuth,
  ctx: RuntimeContext,
  disposed: { value: boolean }
): Promise<RillValue> {
  if (disposed.value) {
    throw new RuntimeError('RILL-R004', `${PROVIDER}: extension disposed`);
  }

  // EC-7: Content Safety must be configured
  if (!config.contentSafety) {
    throw new RuntimeError('RILL-R004', 'foundry: content safety not configured');
  }

  const safetyConfig: FoundryContentSafetyConfig = config.contentSafety;
  const startTime = Date.now();

  try {
    const result = await runShieldRequest(text, documents, safetyConfig, auth);
    const duration = Date.now() - startTime;

    emitExtensionEvent(ctx, {
      event: 'foundry:shield',
      subsystem: `extension:${PROVIDER}`,
      safe: result.safe,
      attackType: result.attackType,
      duration,
    });

    const analysis: Record<string, RillValue> = {
      attackType: result.attackType as RillValue,
    };

    return {
      safe: result.safe as RillValue,
      analysis: analysis as RillValue,
    } as RillValue;
  } catch (error: unknown) {
    if (error instanceof RuntimeError) {
      throw error;
    }
    // Rethrow unexpected errors as RuntimeError
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError('RILL-R004', `${PROVIDER}: ${message}`);
  }
}

// ============================================================
// AUTO-SHIELD MIDDLEWARE FACTORY
// ============================================================

/**
 * Create an auto-shield middleware function.
 *
 * When `contentSafety.autoShield` is true, wraps a host function call with a
 * shield check. If an attack is detected, raises halt `foundry: prompt attack detected`
 * and the model call does not execute.
 *
 * The middleware is a no-op when `autoShield` is false or `contentSafety` is unset.
 *
 * @param config - Root Foundry config
 * @param auth - Authentication config
 * @param disposed - Shared disposal flag reference
 * @returns Middleware function that intercepts host function calls
 */
export function createAutoShieldMiddleware(
  config: FoundryConfig,
  auth: FoundryAuth,
  disposed: { value: boolean }
): ShieldMiddleware {
  return async (args, ctx, inner, triggeredBy) => {
    // Only run when autoShield is enabled and contentSafety is configured
    if (!config.contentSafety?.autoShield || disposed.value) {
      return inner(args, ctx);
    }

    const safetyConfig: FoundryContentSafetyConfig = config.contentSafety;

    // Extract prompt text from args; shield the 'text' argument when present
    const promptText = extractPromptText(args);
    const startTime = Date.now();

    const result = await runShieldRequest(promptText, [], safetyConfig, auth);
    const duration = Date.now() - startTime;

    emitExtensionEvent(ctx, {
      event: 'foundry:shield:auto',
      subsystem: `extension:${PROVIDER}`,
      safe: result.safe,
      attackType: result.attackType,
      duration,
      triggeredBy,
    });

    // EC-8: Prompt attack detected
    if (!result.safe) {
      throw new RuntimeError('RILL-R004', 'foundry: prompt attack detected');
    }

    return inner(args, ctx);
  };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Execute the Content Safety Prompt Shields HTTP request.
 *
 * @param text - Prompt text to shield
 * @param documents - Supporting documents
 * @param safetyConfig - Content Safety sub-config
 * @param auth - Authentication config
 * @returns Parsed ShieldResult
 */
async function runShieldRequest(
  text: string,
  documents: string[],
  safetyConfig: FoundryContentSafetyConfig,
  auth: FoundryAuth
): Promise<ShieldResult> {
  const url =
    `${safetyConfig.endpoint}/contentsafety/text:shieldPrompt` +
    `?api-version=${SHIELD_API_VERSION}`;

  const authHeaders = await buildRestAuthHeaders(auth, 'content-safety');

  const body = JSON.stringify({
    userPrompt: text,
    documents: documents.length > 0 ? documents : undefined,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw createTimeoutError();
    }
    throw error;
  }

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    throw mapRestError(response.status, responseBody);
  }

  const data = (await response.json()) as {
    userPromptAnalysis?: {
      attackDetected?: boolean;
    };
    documentsAnalysis?: Array<{
      attackDetected?: boolean;
    }>;
  };

  // Determine if any attack was detected
  const userAttack = data.userPromptAnalysis?.attackDetected === true;
  const docAttack =
    data.documentsAnalysis?.some((d) => d.attackDetected === true) === true;

  const attackDetected = userAttack || docAttack;
  const attackType = attackDetected
    ? userAttack
      ? 'user_prompt'
      : 'document'
    : null;

  return {
    safe: !attackDetected,
    attackType,
  };
}

/**
 * Extract the primary prompt text from host function arguments.
 *
 * Checks arg shapes in order:
 * 1. `args['text']` — string (message, tool_loop)
 * 2. `args['prompt']` — string (generate)
 * 3. `args['messages']` — list of dicts; returns `content` from the last dict where `role === 'user'`
 * 4. Falls back to empty string
 *
 * @param args - Host function arguments dict
 * @returns Prompt text string
 */
function extractPromptText(args: Record<string, RillValue>): string {
  const text = args['text'];
  if (typeof text === 'string') {
    return text;
  }

  const prompt = args['prompt'];
  if (typeof prompt === 'string') {
    return prompt;
  }

  const messages = args['messages'];
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        typeof msg === 'object' &&
        msg !== null &&
        !Array.isArray(msg) &&
        (msg as Record<string, RillValue>)['role'] === 'user'
      ) {
        const content = (msg as Record<string, RillValue>)['content'];
        if (typeof content === 'string') {
          return content;
        }
      }
    }
  }

  return '';
}
