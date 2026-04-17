import type { ApplicationCallable } from '@rcrsr/rill';

/**
 * Contract type for prompt extension implementations.
 * Verifies that prompt loader return values carry ApplicationCallable values.
 *
 * Keys are data-driven prompt names (not a fixed field list).
 * Every loader applies `satisfies PromptExtensionContract` at factory return.
 */
export type PromptExtensionContract = {
  readonly [promptName: string]: ApplicationCallable;
};

/**
 * Annotation key for a prompt's unique identifier.
 * Stored in the callable's annotations as `^id`.
 */
export const ANNOTATION_KEY_ID = '^id';

/**
 * Annotation key for a prompt's content hash.
 * Stored in the callable's annotations as `^hash`.
 */
export const ANNOTATION_KEY_HASH = '^hash';

/**
 * Annotation key for a prompt's declared input parameters.
 * Stored in the callable's annotations as `^input`.
 */
export const ANNOTATION_KEY_INPUT = '^input';

/**
 * Annotation key for a prompt's declared output type.
 * Stored in the callable's annotations as `^output`.
 */
export const ANNOTATION_KEY_OUTPUT = '^output';

/**
 * Annotation key for a prompt's human-readable description.
 * Stored in the callable's annotations as `^description`.
 */
export const ANNOTATION_KEY_DESCRIPTION = '^description';
