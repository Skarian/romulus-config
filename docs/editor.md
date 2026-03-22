# Editor Guide

Use this guide when you want to run the local editor while editing `source.json` to see a live preview of the expected Romulus android app behavior

The main reason to use the editor is to make it easier to know how the config affects what user's can see and how download happens (ex: rename policy, archive extraction)

If you need help building the config itself, start with [build-your-own-config.md](./build-your-own-config.md)
If you need the field-by-field config reference, use [config-reference.md](./config-reference.md)

## Prerequisites

To run the local editor, you need Node.js installed on your computer. `npm` comes with Node.js

Install Node.js here:

- https://nodejs.org/en/download

## Before You Run Anything

Open a terminal, navigate to the `romulus-config` folder, and run the commands there

`source.json` at repository root is the config file you are simulating so make edits there

The editor reads that file when running. Edit `source.json`, keep the editor running, and the browser should automatically refresh to show the new validation state and preview data

Local-only files:

- `editor/.env.local` holds your `REAL_DEBRID_API_KEY`
- `editor/.local/` holds cache data and is gitignored

## Setup

1. Open a terminal
2. Navigate to the `romulus-config` folder
3. Run `npm --prefix editor install`
4. Copy the sample env file:

```bash
cp editor/.env.sample editor/.env.local
```

5. Add your `REAL_DEBRID_API_KEY` to `editor/.env.local`
6. Run `npm --prefix editor run dev`

## Commands

Install dependencies:

```bash
npm --prefix editor install
```

Start the editor:

```bash
npm --prefix editor run dev
```

## Editing Workflow

1. Edit `source.json`
2. Keep the editor running
3. Check that the config is accepted
4. Click `Manage database`, then `Refresh Database` when you need to pull or refresh file lists from Real-Debrid for each magnet
5. Open a source and compare the Files list with the Download Folder Preview
6. Use `Rename Policy`, `File Ignore Policy`, and `Statistics` below the workbench when you want the editor to help shape the selected source entry
7. Keep adjusting the config until the preview matches what you want

`Rename Policy` writes managed rename rules back to the selected source entry in `source.json`

`File Ignore Policy` writes the selected entry’s `ignore.glob` list back to `source.json`

The `Files` list and `Download Folder Preview` react to your current unsaved rename and ignore draft so you can inspect the effect before writing anything back to `source.json`

If a source has `unarchive` enabled and preview needs sample extracted files, Download Folder Preview prompts for `Sample File Extensions` such as `.cue, .bin`

That saved `Sample File Extensions` policy is editor-local and applies to the same content boundary until you edit it again

If two selected outputs would land on the same final path, the preview numbers them as `(1)`, `(2)`, and so on so you can spot the collision without leaving the tree

Current valid ignore rules are authoritative over saved selection state. If they hide selected rows, those saved selections are cleared.

If a managed rename rule already contains phrases that are not currently present in the hydrated cache, `Rename Policy` keeps those phrases visible and marks them as not currently observed so you can still remove them deliberately

Use `Discard local changes` if you want to throw away the current unsaved draft and snap the maintainer editor back to the saved `source.json` entry

Applying one policy keeps any unsaved draft from the other policy section in place so you can save them independently without losing local work

`Statistics` surfaces phrase frequencies, multi-group counts, mixed-pattern warnings, and draft impact counts so you can make those edits from real hydrated data instead of guessing

## Refreshing Data

Use `Manage database`, then `Refresh Database` when you want to refresh the local database of files from each magnet

Use `Refresh` inside a selected source when you want to repull only that source or continue a `preparing` ZIP source from its saved Real-Debrid resume state

## Logs

Use `View Logs` to inspect database update activity while the editor is running

The logs include:

- a basic view for normal progress
- a verbose view for deeper debugging

## What Persists Locally

The editor keeps some local state in its SQLite cache so your workflow is less fragile:

- lists of files in torrents
- selected files per source
- saved `Sample File Extensions` per content boundary

That state is local to your machine and lives under `editor/.local/`
