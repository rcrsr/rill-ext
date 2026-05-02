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
// PROMPT TYPES
// ============================================================
export type {
  Role,
  Message,
  Part,
  MessageInput,
  ImageSource,
} from './prompt.js';

// ============================================================
// PROMPT FUNCTIONS AND CONSTANTS
// ============================================================
export {
  MESSAGES_RETURN_TYPE,
  MESSAGES_LIST_STRUCTURE,
  MESSAGE_DICT_STRUCTURE,
  PARTS_LIST_STRUCTURE,
  normalizePrompt,
  assertBoundaryRoles,
  assertNoTrailingAssistant,
  assertPartTypes,
  expandContentSugar,
} from './prompt.js';

// ============================================================
// EXTRA CONFIG VALIDATION
// ============================================================
export {
  RESERVED_KEYS_COMMON,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
} from './extra.js';

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
