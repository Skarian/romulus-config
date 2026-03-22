import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceFileStats,
  filterSourceFilesByIgnoreGlobs,
  filterSourceFilesBySearch,
  shouldPreserveEmptySelectedPhraseMode,
} from "./sourceEditorController";
import type { SourceFileRow } from "./types";

test("filterSourceFilesBySearch matches original file names case-insensitively", () => {
  const files = [
    createFile("Alpha Quest.zip"),
    createFile("beta quest.zip"),
    createFile("Gamma Force.zip"),
  ];

  assert.deepEqual(
    filterSourceFilesBySearch(files, "QUEST").map((file) => file.originalName),
    ["Alpha Quest.zip", "beta quest.zip"],
  );
  assert.deepEqual(filterSourceFilesBySearch(files, "   "), files);
});

test("filterSourceFilesByIgnoreGlobs preserves only files outside the current ignore set", () => {
  const files = [
    createFile("Alpha Quest.zip"),
    createFile("Alpha Quest.txt"),
    createFile("Beta Force.zip"),
  ];

  assert.deepEqual(
    filterSourceFilesByIgnoreGlobs(files, ["*.txt"]).map((file) => file.originalName),
    ["Alpha Quest.zip", "Beta Force.zip"],
  );
});

test("buildSourceFileStats reports size and parenthetical counts from original names", () => {
  const stats = buildSourceFileStats([
    createFile("Alpha Quest (USA).zip", 10),
    createFile("Beta Force (World) (Proto).zip", 25),
    createFile("Gamma.zip", null),
  ]);

  assert.deepEqual(stats, {
    files: 3,
    totalSizeBytes: 35,
    withParenthesesCount: 2,
    multiParenthesesCount: 1,
  });
});

test("shouldPreserveEmptySelectedPhraseMode keeps phrase mode visible until the first phrase is checked", () => {
  assert.equal(shouldPreserveEmptySelectedPhraseMode("phrases", "none", []), true);
  assert.equal(shouldPreserveEmptySelectedPhraseMode("phrases", "phrases", []), false);
  assert.equal(shouldPreserveEmptySelectedPhraseMode("none", "none", []), false);
  assert.equal(
    shouldPreserveEmptySelectedPhraseMode("phrases", "none", ["(USA)"]),
    false,
  );
});

function createFile(originalName: string, sizeBytes: number | null = 1): SourceFileRow {
  return {
    id: originalName,
    originalName,
    relativePath: `/${originalName}`,
    sizeBytes,
    partLabel: null,
    isArchiveCandidate: originalName.toLowerCase().endsWith(".zip"),
    kind: "standard",
  };
}
