# Build Your Own Romulus Config

This guide is for getting a custom config working quickly

If you want the full field-by-field reference, use [config-reference.md](./config-reference.md)

## Before You Start

If you want to run the local simulator while following this guide, use [simulator.md](./simulator.md) for setup and commands

## Start Here

Create a `source.json` like this:

```json
{
  "$schema": "./references/romulus/docs/schema.json",
  "version": 1,
  "entries": [
    {
      "displayName": "Nintendo Gamecube",
      "subfolder": "gc",
      "torrents": [
        {
          "url": "magnet:?xt=urn:btih:REPLACE_ME"
        }
      ]
    }
  ]
}
```

That gives you:

- one source row in the app called `Nintendo Gamecube`
- downloads saved into the `gc` subfolder
- files browsed from the root of the torrent

Now run the simulator:

Follow the setup steps in [simulator.md](./simulator.md), then come back here

Open the simulator, confirm the config is accepted, and open the new source. That is the fastest way to get a first win

## Next Step: Hide Files You Do Not Want Listed

If your source includes files you never want to show, add `ignore.glob`

Example: hide Japanese and Europe zip files

```json
{
  "displayName": "Nintendo Entertainment System",
  "subfolder": "nes",
  "ignore": {
    "glob": ["* (Japan)*.zip", "* (Europe)*.zip"]
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

What this changes:

- matching files disappear from the Files list
- matching is case-insensitive
- matching uses the file name only, not the full path

## Next Step: Extract Archives Automatically

If the files users will be interested in are archives (zip, rar, 7z) and you want Romulus to extract them automatically, add `unarchive`

Example: extract selected archives directly into the user configured downloads folder

```json
{
  "displayName": "Nintendo Game Boy Advance",
  "subfolder": "gba",
  "unarchive": {
    "layout": {
      "mode": "flat"
    }
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

What this changes:

- Files will show unarchive controls for that source
- if the user downloads a supported archive, Romulus can extract it
- `flat` means extracted files land directly in the entry subfolder

Supported archive types are:

- `.zip`
- `.rar`
- `.7z`

If you want the extracted files placed into a dedicated sub-folder per selected archive instead, use `dedicatedFolder`

```json
{
  "displayName": "Sony Playstation",
  "subfolder": "psx",
  "unarchive": {
    "layout": {
      "mode": "dedicatedFolder"
    }
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

## Next Step: Point At One Folder Inside A Torrent

If the torrent has a specific subfolder you want to browse instead of the whole root, add `scope`

Example:

```json
{
  "displayName": "Nintendo 3DS",
  "subfolder": "n3ds",
  "scope": {
    "path": "/all/",
    "includeNestedFiles": true
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

What this changes:

- Romulus only shows files inside `/all/`
- nested files are included because `includeNestedFiles` is `true`

The easy mistake here:

- directory scopes must end in `/`

Good:

```json
"path": "/all/"
```

Bad:

```json
"path": "/all"
```

## Next Step: Point At One Big Zip

Sometimes the torrent is really one big zip that contains many files you do not want. In that case, scope the source to that exact zip path so the user can select from files within the zip directly

Example:

```json
{
  "displayName": "Nintendo Game Boy",
  "subfolder": "gb",
  "scope": {
    "path": "/ROMs/Nintendo - Game Boy.zip"
  },
  "unarchive": {
    "layout": {
      "mode": "flat"
    }
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

What this changes:

- Romulus downloads that outer zip in Real-Debrid
- the Files page shows the files inside the zip directly
- the outer zip itself is not the selectable row

The important rule:

- exact file scope is only allowed for `.zip`
- This does not work for `.rar` and `.7z`

## Next Step: Rename Final Output Files

If you want the final saved file names cleaned up, add `rename`

Example:

```json
{
  "displayName": "Sony Playstation Portable",
  "subfolder": "psp",
  "rename": {
    "pattern": "\\s*\\(USA\\)",
    "replacement": ""
  },
  "torrents": [
    {
      "url": "magnet:?xt=urn:btih:REPLACE_ME"
    }
  ]
}
```

What this changes:

- the original row name in Files stays the same
- the final saved output name is renamed

If you also use `dedicatedFolder` unarchive, you can give the top-level extract folder its own rename rule separately. That is covered in [config-reference.md](./config-reference.md)

## A Good Workflow

When building a config from scratch, this is the easiest path:

1. Start with one entry and only `displayName`, `subfolder`, and `torrents`
2. Run the simulator and confirm the source opens
3. Add `ignore.glob` if the file list is noisy
4. Add `scope` if you only want one folder or one exact zip
5. Add `unarchive` if selected files are archives
6. Add `rename` only after the files shown are already correct

That order keeps debugging simple in my experience

## Before You Push To Your Phone

Use the simulator in this repo:

1. edit `source.json`
2. open a terminal
3. navigate to the `romulus-config` folder
4. run `npm --prefix simulator run dev`
5. make sure the config is accepted
6. use `Update Database`
7. open the source
8. compare the Files list and Download Folder Preview with what you expect

If the source is accepted in the simulator and the preview looks right, you are in a much better place before testing on-device

## When You Need More Detail

Use these next:

- [config-reference.md](./config-reference.md) for every field and rule
- [simulator.md](./simulator.md) for the repo-specific simulator workflow
- [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) for the remaining simulator edge cases
