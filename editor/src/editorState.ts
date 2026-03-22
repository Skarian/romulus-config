import path from "node:path";

import { loadSourceDocument } from "./sourceDocument";
import type { HydrationState, HydrationSourceState, EditorState } from "./types";

export function buildEditorState(
  repoRoot: string,
  hydrationInput?: Partial<HydrationState>,
): EditorState {
  const cachePath = path.join(repoRoot, "editor/.local");
  const generatedAt = new Date().toISOString();
  const notes = [
    "Config changes are watched directly from source.json.",
    "File lists are loaded locally through the editor dev server.",
    `The local editor database lives under ${cachePath}.`,
  ];
  const baseHydration: HydrationState = {
    lastHydratedAt: null,
    missingSourceIds: [],
    running: hydrationInput?.running ?? false,
    apiKeyConfigured: hydrationInput?.apiKeyConfigured ?? false,
    logs: hydrationInput?.logs ?? [],
    sourceStates: hydrationInput?.sourceStates ?? {},
  };
  const documentLoad = loadSourceDocument(repoRoot);

  if (documentLoad.status === "blocked") {
    return {
      status: "blocked",
      generatedAt,
      configPath: documentLoad.configPath,
      schemaPath: documentLoad.schemaPath,
      cachePath,
      notes,
      diskFingerprint: documentLoad.diskFingerprint,
      blocked: documentLoad.blocked,
      editable: null,
      entries: [],
      hydration: {
        ...baseHydration,
        missingSourceIds: [],
        sourceStates: {},
      },
    };
  }

  const sourceStates: Record<string, HydrationSourceState> = {};
  const missingSourceIds: string[] = [];

  for (const entry of documentLoad.entries) {
    const cached = baseHydration.sourceStates[entry.id];
    if (!cached) {
      missingSourceIds.push(entry.id);
      sourceStates[entry.id] = {
        mode: entry.hydration.mode,
        status: "missing",
        updatedAt: null,
        fileCount: 0,
        statusLabel: null,
        progressPercent: null,
        errorMessage: null,
      };
      continue;
    }

    sourceStates[entry.id] = cached;
  }

  return {
    status: "editable",
    generatedAt,
    configPath: documentLoad.configPath,
    schemaPath: documentLoad.schemaPath,
    cachePath,
    notes,
    diskFingerprint: documentLoad.diskFingerprint,
    blocked: null,
    editable: documentLoad.editable,
    entries: documentLoad.entries,
    hydration: {
      ...baseHydration,
      missingSourceIds,
      sourceStates,
    },
  };
}
