# Simulator Guide

Use this guide when you want to run the local simulator while editing `source.json` to see a live preview of the expected Romulus android app behavior

The main reason to use the simulator is to make it easier to know how the config affects what user's can see and how download happens (ex: rename policy, archive extraction)

If you need help building the config itself, start with [build-your-own-config.md](./build-your-own-config.md)
If you need the field-by-field config reference, use [config-reference.md](./config-reference.md)

## Prerequisites

To run the local simulator, you need Node.js installed on your computer. `npm` comes with Node.js

Install Node.js here:

- https://nodejs.org/en/download

## Before You Run Anything

Open a terminal, navigate to the `romulus-config` folder, and run the commands there

`source.json` at repository root is the config file you are simulating so make edits there

The simulator reads that file when running. Edit `source.json`, keep the simulator running, and the browser should automatically refresh to show the new validation state and preview data

Local-only files:

- `simulator/.env.local` holds your `REAL_DEBRID_API_KEY`
- `simulator/.local/` holds cache data and is gitignored

## Setup

1. Open a terminal
2. Navigate to the `romulus-config` folder
3. Run `npm --prefix simulator install`
4. Copy the sample env file:

```bash
cp simulator/.env.sample simulator/.env.local
```

5. Add your `REAL_DEBRID_API_KEY` to `simulator/.env.local`
6. Run `npm --prefix simulator run dev`

## Commands

Install dependencies:

```bash
npm --prefix simulator install
```

Start the simulator:

```bash
npm --prefix simulator run dev
```

## Editing Workflow

1. Edit `source.json`
2. Keep the simulator running
3. Check that the config is accepted
4. Click `Update Database` when you need to pull or refresh file lists from Real-Debrid for each magnet
5. Open a source and compare the Files list with the Download Folder Preview
6. Keep adjusting the config until the preview matches what you want

## Refreshing Data

Use `Update Database` when you want to refresh the local database of files from each magnet

Use `Refresh` inside a selected source when you want to repull only that source or resume a completed archive download on ReadDebrid

## Logs

Use `View Logs` to inspect database update activity while the simulator is running

The logs include:

- a basic view for normal progress
- a verbose view for deeper debugging

## What Persists Locally

The simulator keeps some local state in its SQLite cache so your workflow is less fragile:

- lists of files in torrents
- selected files per source
- archive preview fixtures

That state is local to your machine and lives under `simulator/.local/`
