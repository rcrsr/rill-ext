/**
 * Validation functions for LLM extension parameters
 *
 * Provides type-safe validation with assertion functions and error handling.
 */

import { RuntimeError, type RillValue } from '@rcrsr/rill';

// ============================================================
// CONSTANTS
// ============================================================

/** Minimum valid temperature value */
export const MIN_TEMPERATURE = 0.0;

/** Maximum valid temperature value */
export const MAX_TEMPERATURE = 2.0;

// ============================================================
// API KEY VALIDATION
// ============================================================

/**
 * Validates that API key is defined and non-empty.
 * Throws if validation fails.
 *
 * @param key - API key to validate
 * @throws RuntimeError if key is undefined or empty
 */
export function validateApiKey(key: string | undefined): asserts key is string {
  // key is undefined → RuntimeError: "api_key is required"
  if (key === undefined) {
    throw new RuntimeError('RILL-R001', 'api_key is required');
  }

  // key is empty string → RuntimeError: "api_key cannot be empty"
  if (key === '') {
    throw new RuntimeError('RILL-R001', 'api_key cannot be empty');
  }
}

// ============================================================
// MODEL VALIDATION
// ============================================================

/**
 * Validates that model name is defined and non-empty.
 * Throws if validation fails.
 *
 * @param model - Model name to validate
 * @throws RuntimeError if model is undefined or empty
 */
export function validateModel(
  model: string | undefined
): asserts model is string {
  // model is undefined or empty → RuntimeError: "model is required"
  if (!model) {
    throw new RuntimeError('RILL-R001', 'model is required');
  }
}

// ============================================================
// TEMPERATURE VALIDATION
// ============================================================

/**
 * Validates that temperature is within valid range [0, 2].
 * Throws if validation fails.
 *
 * @param temperature - Temperature value to validate
 * @throws RuntimeError if temperature is out of range
 */
export function validateTemperature(temperature: number | undefined): void {
  // Allow undefined (optional parameter)
  if (temperature === undefined) {
    return;
  }

  // temperature out of range → RuntimeError: "temperature must be between 0 and 2"
  if (temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
    throw new RuntimeError('RILL-R001', 'temperature must be between 0 and 2');
  }
}

// ============================================================
// MESSAGES VALIDATION
// ============================================================

/**
 * Validates a parts-shaped messages array for LLM chat completion.
 * Accepts both canonical parts form `{role, parts:[...]}` and content-sugar
 * form `{role, content: string}` (either `parts` or `content` key present).
 *
 * @deprecated Phase 2 extension factories replace inline calls to this
 * function with `normalizePrompt()` from `./prompt.js`, which provides
 * richer validation and ctx-aware error emission. This function is retained
 * for compile-time compatibility until that migration completes.
 *
 * @param messages - Array of message objects to validate
 * @throws RuntimeError if messages are invalid
 */
export function validateMessages(
  messages: Array<Record<string, unknown>>
): void {
  // Messages array empty → RuntimeError: "messages list cannot be empty"
  if (messages.length === 0) {
    throw new RuntimeError('RILL-R001', 'messages list cannot be empty');
  }

  // Validate each message
  for (const message of messages) {
    // Message lacks `role` → RuntimeError: "message missing required 'role' field"
    if (!('role' in message) || !message['role']) {
      throw new RuntimeError(
        'RILL-R001',
        "message missing required 'role' field"
      );
    }

    // Message requires either `parts` (canonical) or `content` (sugar).
    const hasParts =
      'parts' in message &&
      message['parts'] !== undefined &&
      message['parts'] !== null;
    const hasContent =
      'content' in message &&
      message['content'] !== undefined &&
      message['content'] !== null;

    if (!hasParts && !hasContent) {
      const role = String(message['role']);
      throw new RuntimeError(
        'RILL-R001',
        `${role} message requires 'parts' or 'content'`
      );
    }
  }
}

// ============================================================
// EMBED TEXT VALIDATION
// ============================================================

/**
 * Validates text for embedding operation.
 * Throws RuntimeError if validation fails.
 *
 * @param text - Text string to validate
 * @throws RuntimeError if text is empty
 */
export function validateEmbedText(text: string): void {
  // Embed text empty → RuntimeError: "embed text cannot be empty"
  if (text === '') {
    throw new RuntimeError('RILL-R001', 'embed text cannot be empty');
  }
}

// ============================================================
// EMBED BATCH VALIDATION
// ============================================================

/**
 * Validates and converts RillValue array to string array for batch embedding.
 * Throws RuntimeError if validation fails.
 *
 * @param texts - Array of RillValue items to validate
 * @returns Array of validated strings
 * @throws RuntimeError if batch contains non-strings or empty strings
 */
export function validateEmbedBatch(texts: RillValue[]): string[] {
  const validated: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];

    // Batch contains non-string → RuntimeError: "embed_batch requires list of strings"
    if (typeof item !== 'string') {
      throw new RuntimeError(
        'RILL-R001',
        'embed_batch requires list of strings'
      );
    }

    // Batch contains empty or whitespace-only string → RuntimeError: "embed text cannot be empty at index {i}"
    if (item.trim() === '') {
      throw new RuntimeError(
        'RILL-R001',
        `embed text cannot be empty at index ${i}`
      );
    }

    validated.push(item);
  }

  return validated;
}

// ============================================================
// EMBED MODEL VALIDATION
// ============================================================

/**
 * Validates that embed model is configured and non-empty.
 * Throws RuntimeError if validation fails.
 *
 * @param model - Embed model name to validate
 * @throws RuntimeError if model is not configured
 */
export function validateEmbedModel(
  model: string | undefined
): asserts model is string {
  // Embed model falsy → RuntimeError: "embed_model not configured"
  if (!model) {
    throw new RuntimeError('RILL-R001', 'embed_model not configured');
  }
}
