import type { ApplicationCallable } from '@rcrsr/rill';

/**
 * Contract type for fs extension implementations.
 * Verifies required functions exist with expected callable types.
 *
 * Backend implementations must provide all 12 functions.
 * Path arguments are mount-prefixed strings (e.g. "/mount/file.txt"):
 * - read(path): Read file content
 * - write(path, content): Write file content
 * - append(path, content): Append to file
 * - list(path?): List directory entries
 * - find(pattern?): Find files by pattern
 * - exists(path): Check file/directory existence
 * - remove(path): Delete file/directory
 * - stat(path): Get file metadata
 * - mkdir(path): Create directory
 * - copy(src, dest): Copy file/directory
 * - move(src, dest): Move file/directory
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
