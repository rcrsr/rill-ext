/**
 * Shared LLM Extension Package
 *
 * Provides common types, validation, error handling, and tool orchestration
 * for all LLM provider extensions (OpenAI, Anthropic, Google Gemini).
 */

// ============================================================
// CONTRACTS
// ============================================================
export type { LlmExtensionContract } from './contracts.js';

// ============================================================
// TYPES
// ============================================================
export type {
  LLMExtensionConfig,
  LLMProviderConfig,
  ProviderErrorDetector,
  ToolLoopCallbacks,
  ToolLoopChunk,
  ToolLoopResult,
} from './types.js';

// ============================================================
// VALIDATION
// ============================================================
export {
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  validateApiKey,
  validateModel,
  validateTemperature,
  validateMessages,
  validateEmbedText,
  validateEmbedBatch,
  validateEmbedModel,
} from './validation.js';

// ============================================================
// ERROR MAPPING
// ============================================================
export { mapProviderError, throwProviderHalt } from './errors.js';

// ============================================================
// TOOL ORCHESTRATION
// ============================================================
export { executeToolLoop, buildResponseMessages } from './tool-loop.js';

// ============================================================
// SCHEMA BUILDING
// ============================================================
export {
  buildJsonSchemaFromStructuralType,
  mapRillType,
} from './schema.js';
export type { JsonSchemaObject, JsonSchemaProperty } from './schema.js';
