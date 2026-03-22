# Romulus Config Reference

This is the field-by-field reference for the Romulus config schema

If you are starting from scratch, use [build-your-own-config.md](./build-your-own-config.md) first

## Top-Level Shape

```json
{
  "$schema": "./references/romulus/docs/schema.json",
  "version": 1,
  "entries": []
}
```

Required:

- `version`
- `entries`

## `version`

Must be `1`

## `entries`

Array of source entries

Each entry becomes one source row in Romulus

Required per entry:

- `displayName`
- `subfolder`
- `torrents`

Optional per entry:

- `scope`
- `ignore`
- `rename`
- `unarchive`

## `displayName`

Human-readable source name shown in the app

```json
"displayName": "Nintendo GameCube"
```

## `subfolder`

Output subfolder under the configured download directory

```json
"subfolder": "gc"
```

## `torrents`

One or more torrent definitions

Each torrent object requires:

- `url`: magnet link

Optional:

- `partName`

```json
"torrents": [
  {
    "url": "magnet:?xt=urn:btih:REPLACE_ME",
    "partName": "complete"
  }
]
```

## `scope`

Controls where Romulus browses inside the torrent

If omitted, Romulus uses:

```json
{
  "path": "/",
  "includeNestedFiles": false
}
```

### `scope.path`

Allowed shapes:

1. `/`
2. directory path ending in `/`
3. exact `.zip` file path

Examples:

```json
"path": "/"
```

```json
"path": "/ROMs/"
```

```json
"path": "/ROMs/Nintendo - Game Boy Advance.zip"
```

Rules:

- exact non-`.zip` file paths are rejected
- exact `.zip` enables archive-selection mode
- paths with backslashes are rejected
- paths with `..` are rejected

### `scope.includeNestedFiles`

Optional boolean

Default is `false`

```json
"scope": {
  "path": "/ROMs/",
  "includeNestedFiles": true
}
```

Rule:

- exact `.zip` scope cannot use `includeNestedFiles: true`

## `ignore.glob`

Hide files from the Files list

```json
"ignore": {
  "glob": [
    "*.txt",
    "* (Japan)*.zip"
  ]
}
```

Behavior:

- case-insensitive
- file-name-only matching
- applied after scope filtering in standard mode
- applied to internal file names in archive-selection mode

For known editor-specific glob gaps, see [KNOWN_ISSUES.md](../KNOWN_ISSUES.md)

## `rename`

Optional regex rename rule for final output file names

```json
"rename": {
  "pattern": "\\s*\\(USA\\)",
  "replacement": ""
}
```

Behavior:

- affects final output names
- does not rewrite source JSON
- does not rename file rows shown on Files
- can be toggled off by the user on Files

When unarchive is enabled for supported archives:

- `rename` applies to final extracted non-archive files
- it does not rename archive filenames themselves

## `unarchive`

Optional archive extraction policy

### `unarchive.recursive`

Optional boolean

Default is `false`

```json
"unarchive": {
  "recursive": true,
  "layout": {
    "mode": "flat"
  }
}
```

Supported archive types:

- `.zip`
- `.rar`
- `.7z`

### `unarchive.layout.mode`

Required when `unarchive` exists

Allowed values:

- `flat`
- `dedicatedFolder`

#### `flat`

Extracted non-archive files go directly into the entry subfolder

```json
"layout": {
  "mode": "flat"
}
```

#### `dedicatedFolder`

Extracted non-archive files go into one derived folder inside the entry subfolder

```json
"layout": {
  "mode": "dedicatedFolder"
}
```

### `unarchive.layout.rename`

Optional rename rule for the top-level dedicated folder name

Only allowed when `layout.mode` is `dedicatedFolder`

```json
"layout": {
  "mode": "dedicatedFolder",
  "rename": {
    "pattern": "\\s*\\(Disc\\s*1\\)$",
    "replacement": ""
  }
}
```

Behavior:

- affects only the dedicated extract folder name
- does not rename extracted files inside that folder

## Behavior Notes

### Standard mode

Used when `scope.path` is `/` or a directory path

Romulus resolves torrent files, filters by scope, applies ignore rules, and shows the remaining rows

### Archive-selection mode

Used when `scope.path` is one exact `.zip` path

Romulus prepares that zip, enumerates its internal files, applies ignore rules, and shows those internal rows

The outer zip itself is not a selectable row in this mode

### Output naming

- `rename` affects final output files
- `unarchive.layout.rename` affects the top-level dedicated extract folder only
- collisions are auto-suffixed with ` (n)`

### Extraction behavior

- internal archive directories are flattened
- `flat` writes extracted files directly into the entry subfolder
- `dedicatedFolder` writes them into one folder under the entry subfolder
- recursive extraction keeps extracting supported nested archives until none remain
