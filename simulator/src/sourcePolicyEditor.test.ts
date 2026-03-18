import assert from "node:assert/strict";
import test from "node:test";

import {
  beginEntryRequest,
  buildPhraseOptions,
  isLatestEntryRequest,
  matchSourceFilesToEntry,
  shouldForceSourceRefresh,
  syncSourcePolicyEditorState,
  type PendingPolicySave,
  toggleSourceFileSelection,
  updateSourceFilesForEntry,
} from "./sourcePolicyEditor";
import type { SourceFilesState } from "./types";

test("matchSourceFilesToEntry drops stale source file payloads from other entries", () => {
  const sourceFiles = createSourceFilesState("entry-a");

  assert.equal(matchSourceFilesToEntry("entry-b", sourceFiles), null);
  assert.equal(matchSourceFilesToEntry("entry-a", sourceFiles), sourceFiles);
});

test("updateSourceFilesForEntry ignores responses for a different entry", () => {
  const sourceFiles = createSourceFilesState("entry-a");

  assert.equal(
    updateSourceFilesForEntry(sourceFiles, "entry-b", (current) => ({
      ...current,
      selectedRowIds: ["row-1"],
    })),
    sourceFiles,
  );
});

test("updateSourceFilesForEntry applies updates for the active entry", () => {
  const sourceFiles = createSourceFilesState("entry-a");

  assert.deepEqual(
    updateSourceFilesForEntry(sourceFiles, "entry-a", (current) => ({
      ...current,
      selectedRowIds: ["row-1"],
    })),
    {
      ...sourceFiles,
      selectedRowIds: ["row-1"],
    },
  );
});

test("beginEntryRequest increments revisions per entry", () => {
  const requestRevisions = new Map<string, number>();

  assert.equal(beginEntryRequest(requestRevisions, "entry-a"), 1);
  assert.equal(beginEntryRequest(requestRevisions, "entry-a"), 2);
  assert.equal(beginEntryRequest(requestRevisions, "entry-b"), 1);
});

test("isLatestEntryRequest only accepts the newest revision for an entry", () => {
  const requestRevisions = new Map<string, number>();
  const staleRevision = beginEntryRequest(requestRevisions, "entry-a");
  const latestRevision = beginEntryRequest(requestRevisions, "entry-a");

  assert.equal(isLatestEntryRequest(requestRevisions, "entry-a", staleRevision), false);
  assert.equal(isLatestEntryRequest(requestRevisions, "entry-a", latestRevision), true);
  assert.equal(isLatestEntryRequest(requestRevisions, "entry-b", 1), false);
});

test("shouldForceSourceRefresh preserves preparing archive resumes", () => {
  assert.equal(shouldForceSourceRefresh(true, "preparing"), false);
  assert.equal(shouldForceSourceRefresh(true, "ready"), true);
  assert.equal(shouldForceSourceRefresh(false, "preparing"), true);
  assert.equal(shouldForceSourceRefresh(true, null), true);
});

test("syncSourcePolicyEditorState fully resets local drafts when there is no pending save", () => {
  const nextState = syncSourcePolicyEditorState(
    {
      renameMode: "phrases",
      renamePhrases: ["(World)"],
      ignoreGlobs: ["*.tmp"],
    },
    {
      mode: "all",
      phrases: ["(USA)", "(World)"],
    },
    ["*.txt"],
    null,
    "entry-a",
  );

  assert.deepEqual(nextState, {
    renameMode: "all",
    renamePhrases: ["(USA)", "(World)"],
    ignoreGlobs: ["*.txt"],
  });
});

test("syncSourcePolicyEditorState preserves unsaved ignore globs after a rename-only save", () => {
  const nextState = syncSourcePolicyEditorState(
    {
      renameMode: "phrases",
      renamePhrases: ["(World)"],
      ignoreGlobs: ["*.tmp"],
    },
    {
      mode: "phrases",
      phrases: ["(World)"],
    },
    ["*.txt"],
    pendingSave("entry-a", { rename: true, ignore: false }),
    "entry-a",
  );

  assert.deepEqual(nextState, {
    renameMode: "phrases",
    renamePhrases: ["(World)"],
    ignoreGlobs: ["*.tmp"],
  });
});

test("syncSourcePolicyEditorState preserves unsaved rename changes after an ignore-only save", () => {
  const nextState = syncSourcePolicyEditorState(
    {
      renameMode: "phrases",
      renamePhrases: ["(World)"],
      ignoreGlobs: ["*.tmp"],
    },
    {
      mode: "none",
      phrases: [],
    },
    ["*.tmp"],
    pendingSave("entry-a", { rename: false, ignore: true }),
    "entry-a",
  );

  assert.deepEqual(nextState, {
    renameMode: "phrases",
    renamePhrases: ["(World)"],
    ignoreGlobs: ["*.tmp"],
  });
});

test("toggleSourceFileSelection preserves hidden selections while toggling visible rows", () => {
  const nextSelectedRowIds = toggleSourceFileSelection(
    ["hidden-row", "visible-a"],
    ["visible-a", "visible-b"],
    "visible-b",
  );

  assert.deepEqual(nextSelectedRowIds, ["hidden-row", "visible-a", "visible-b"]);
});

test("buildPhraseOptions keeps saved phrases visible even when they are not currently observed", () => {
  const phraseOptions = buildPhraseOptions(
    [{ phrase: "(World)", count: 2 }],
    ["(World)", "(USA)"],
  );

  assert.deepEqual(phraseOptions, [
    { phrase: "(World)", count: 2, observed: true },
    { phrase: "(USA)", count: 0, observed: false },
  ]);
});

test("buildPhraseOptions sorts observed phrases by descending file count", () => {
  const phraseOptions = buildPhraseOptions(
    [
      { phrase: "(Rev 1)", count: 3 },
      { phrase: "(World)", count: 7 },
      { phrase: "(USA)", count: 7 },
    ],
    [],
  );

  assert.deepEqual(phraseOptions, [
    { phrase: "(USA)", count: 7, observed: true },
    { phrase: "(World)", count: 7, observed: true },
    { phrase: "(Rev 1)", count: 3, observed: true },
  ]);
});

function pendingSave(
  entryId: string,
  sections: {
    rename: boolean;
    ignore: boolean;
  },
): PendingPolicySave {
  return {
    entryId,
    ...sections,
  };
}

function createSourceFilesState(entryId: string): SourceFilesState {
  return {
    entryId,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [],
    files: [],
  };
}
