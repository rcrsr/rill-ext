import type { ApplicationCallable } from '@rcrsr/rill';

/**
 * Contract type for fs extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 12 functions:
 * - read(mount, path): Read file content
 * - write(mount, path, content): Write file content
 * - append(mount, path, content): Append to file
 * - list(mount, path?): List directory entries
 * - find(mount, pattern?): Find files by pattern
 * - exists(mount, path): Check file/directory existence
 * - remove(mount, path): Delete file/directory
 * - stat(mount, path): Get file metadata
 * - mkdir(mount, path): Create directory
 * - copy(mount, src, dest): Copy file/directory
 * - move(mount, src, dest): Move file/directory
 * - mounts(): List all configured mounts
 */
export type FsExtensionContract = {
  readonly read: ApplicationCallable;
  readonly write: ApplicationCallable;
  readonly append: ApplicationCallable;
  readonly list: ApplicationCallable;
  readonly find: ApplicationCallable;
  readonly exists: ApplicationCallable;
  readonly remove: ApplicationCallable;
  readonly stat: ApplicationCallable;
  readonly mkdir: ApplicationCallable;
  readonly copy: ApplicationCallable;
  readonly move: ApplicationCallable;
  readonly mounts: ApplicationCallable;
};
