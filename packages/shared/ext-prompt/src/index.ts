// ============================================================
// CONTRACT TYPE AND ANNOTATION KEYS
// ============================================================
export type { PromptExtensionContract } from './contracts.js';
export {
  ANNOTATION_KEY_ID,
  ANNOTATION_KEY_HASH,
  ANNOTATION_KEY_INPUT,
  ANNOTATION_KEY_OUTPUT,
  ANNOTATION_KEY_DESCRIPTION,
} from './contracts.js';

// ============================================================
// FRONTMATTER SPLITTING
// ============================================================
export type { FrontmatterSplit } from './frontmatter.js';
export { splitFrontmatter } from './frontmatter.js';

// ============================================================
// ROLE MESSAGE SPLITTING
// ============================================================
export type { RoleMessage } from './roles.js';
export { splitRoleMessages } from './roles.js';

// ============================================================
// PARAM GRAMMAR PARSING
// ============================================================
export { parseParamGrammar } from './grammar.js';

// ============================================================
// TEMPLATE INTERPOLATION AND SCANNING
// ============================================================
export type { TemplateReference } from './interpolate.js';
export { interpolate, scanTemplateReferences } from './interpolate.js';

// ============================================================
// CONTENT HASH
// ============================================================
export { computeContentHash } from './hash.js';
