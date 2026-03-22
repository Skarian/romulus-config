import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEditorState } from "./editorState";
import type { SourceDocument } from "./types";

const FIXTURE_REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("buildEditorState returns blocked shell state when the document is blocked", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Source One",
          subfolder: "one",
          scope: {
            path: "/ROMs/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
        {
          displayName: "Source Two",
          subfolder: "two",
          scope: {
            path: "ROMs/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
      ],
    });

    const state = buildEditorState(repoRoot);

    assert.equal(state.status, "blocked");
    assert.equal(state.entries.length, 0);
    assert.equal(state.hydration.missingSourceIds.length, 0);
    assert.deepEqual(
      state.blocked.groups.map((group) => group.heading),
      ["Duplicate sources"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("buildEditorState returns editable shell state with repairable validation and missing hydration", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Editable Source",
          subfolder: "editable",
          ignore: {
            glob: ["["],
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const state = buildEditorState(repoRoot);

    assert.equal(state.status, "editable");
    assert.equal(state.entries.length, 1);
    assert.equal(state.diskFingerprint === null, false);
    assert.equal(state.editable.validation.saveReadiness.status, "blocked");
    const [entry] = state.entries;
    assert.ok(entry);
    assert.deepEqual(state.hydration.missingSourceIds, [entry.id]);
    assert.equal(state.hydration.sourceStates[entry.id]?.status, "missing");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function createTempRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "romulus-editor-state-"));
  const schemaTargetDirectory = path.join(repoRoot, "references/romulus/docs");
  mkdirSync(schemaTargetDirectory, { recursive: true });
  writeFileSync(
    path.join(schemaTargetDirectory, "schema.json"),
    readFileSync(
      path.join(FIXTURE_REPO_ROOT, "references/romulus/docs/schema.json"),
      "utf8",
    ),
    "utf8",
  );
  return repoRoot;
}

function writeSourceDocument(repoRoot: string, document: SourceDocument) {
  writeFileSync(
    path.join(repoRoot, "source.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}
