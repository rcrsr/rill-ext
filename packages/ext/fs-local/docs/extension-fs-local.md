# fs-local Extension

Local filesystem extension for rill with mount-based sandboxing.

## Overview

The `@rcrsr/rill-ext-fs-local` package provides 12 sandboxed filesystem operations. All operations are constrained to configured mount points. Path traversal and symlink escapes are blocked via a 9-step resolution sequence.

## Configuration

```typescript
import { createLocalFsExtension } from '@rcrsr/rill-ext-fs-local';

const ext = await createLocalFsExtension({
  mounts: {
    workspace: {
      path: '/home/user/project',
      mode: 'read-write',
    },
    data: {
      path: '/var/data/csvfiles',
      mode: 'read',
      glob: '*.csv',
      maxFileSize: 5242880, // 5MB
    },
  },
  maxFileSize: 10485760, // 10MB global default
  encoding: 'utf-8',
});
```

## Mount Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Absolute or relative path on host filesystem |
| `mode` | `'read' \| 'write' \| 'read-write'` | Yes | Access mode for this mount |
| `glob` | `string` | No | Optional file pattern filter (e.g. `*.csv`) |
| `maxFileSize` | `number` | No | Per-mount file size limit in bytes |

## Functions

### read(path)

Reads file contents as a string.

- `path` - Mount-prefixed file path, e.g. `/workspace/file.txt`
- Returns file content as string
- Returns invalid `#NOT_FOUND` if file is missing; invalid `#FORBIDDEN` if path escapes the mount sandbox; invalid `#INVALID_INPUT` (`raw.kind == 'size_limit_exceeded'`) if size exceeds limit

### write(path, content)

Writes content to a file, replacing if it exists.

- Returns bytes written as string
- Returns invalid `#FORBIDDEN` if path escapes the sandbox or mount is read-only; invalid `#INVALID_INPUT` (`raw.kind == 'size_limit_exceeded'`) if content exceeds limit

### append(path, content)

Appends content to a file, creating it if it does not exist.

- Returns bytes appended as string
- Returns invalid `#FORBIDDEN` if path escapes the sandbox or mount is read-only; invalid `#INVALID_INPUT` (`raw.kind == 'size_limit_exceeded'`) if total size would exceed limit

### list(path)

Lists directory contents (non-recursive).

- Returns array of `{ name, type, size }` objects

### find(path, pattern?)

Recursively searches for files matching a glob pattern.

- `pattern` defaults to `*` (all files)
- Supported patterns: `*`, `*.ext`, `*.{ext1,ext2}`, `**/*.ext`
- Returns array of relative paths from mount root

### exists(path)

Checks if a file or directory exists.

- Returns `true` or `false`
- Never throws for missing files or path traversal attempts

### remove(path)

Deletes a file.

- Returns `true` if deleted, `false` if not found

### stat(path)

Gets file metadata.

- Returns `{ name, type, size, created, modified }` dict
- Returns invalid `#NOT_FOUND` if file does not exist

### mkdir(path)

Creates a directory (recursive).

- Returns `true` if created, `false` if already exists

### copy(src, dest)

Copies a file within the same mount.

- Returns invalid `#INVALID_INPUT` (`raw.kind == 'cross_mount'`) if src and dest are different mounts

### move(src, dest)

Moves a file within the same mount.

- Returns invalid `#INVALID_INPUT` (`raw.kind == 'cross_mount'`) if src and dest are different mounts

### mounts()

Lists configured mounts.

- Returns array of `{ name, mode, glob }` objects

## Security

The sandbox enforces the following:

1. All paths resolve through `fs.realpath()` to block symlink escapes
2. `..` segments are collapsed before mount boundary check
3. Post-realpath boundary check catches symlinks pointing outside mount
4. Mode checks (`read`, `write`, `read-write`) enforce access control
5. Optional glob patterns restrict file types per mount
6. File size limits prevent large file reads/writes

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #FORBIDDEN`) or finely
(`guard #FORBIDDEN && raw.kind == 'path_escape'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| File or directory not found | `#NOT_FOUND` | `not_found` |
| Path escapes the mount sandbox (symlink or `..`) | `#FORBIDDEN` | `path_escape` |
| Mount mode forbids the operation (e.g. write on read-only) | `#FORBIDDEN` | `mode_violation` |
| Path does not match the mount glob | `#FORBIDDEN` | `glob_violation` |
| Unknown mount referenced | `#INVALID_INPUT` | `unknown_mount` |
| `copy()` / `move()` across different mounts | `#INVALID_INPUT` | `cross_mount` |
| Value or file exceeds configured size limit | `#INVALID_INPUT` | `size_limit_exceeded` |
| Filesystem read or write failure | `#UNAVAILABLE` | `io_error` |
