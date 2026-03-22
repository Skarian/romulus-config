import assert from "node:assert/strict";
import test from "node:test";

import { buildHydrationStateByHydrationKey, getHydrationStateForEntry } from "./hydrationStateLookup";
import { buildPreviewEntries } from "./runtimeValidation";
import type { HydrationSourceState, SourceDocument } from "./types";

test("hydration lookup follows stable hydration keys across draft reorder", () => {
  const originalEntries = buildPreviewEntries(
    createDocument([
      { displayName: "Alpha Source", subfolder: "alpha", torrentUrl: "magnet:?xt=urn:btih:AAA" },
      { displayName: "Beta Source", subfolder: "beta", torrentUrl: "magnet:?xt=urn:btih:BBB" },
    ]),
  );
  const lookup = buildHydrationStateByHydrationKey(originalEntries, {
    [originalEntries[0]!.id]: createHydrationState("ready"),
    [originalEntries[1]!.id]: createHydrationState("error"),
  });
  const reorderedEntries = buildPreviewEntries(
    createDocument([
      { displayName: "Beta Source", subfolder: "beta", torrentUrl: "magnet:?xt=urn:btih:BBB" },
      { displayName: "Alpha Source", subfolder: "alpha", torrentUrl: "magnet:?xt=urn:btih:AAA" },
    ]),
  );

  assert.notEqual(reorderedEntries[0]!.id, originalEntries[1]!.id);
  assert.equal(getHydrationStateForEntry(reorderedEntries[0], lookup)?.status, "error");
  assert.equal(getHydrationStateForEntry(reorderedEntries[1], lookup)?.status, "ready");
});

test("hydration lookup returns null when a draft changes hydration identity", () => {
  const originalEntries = buildPreviewEntries(
    createDocument([
      { displayName: "Single Source", subfolder: "single", torrentUrl: "magnet:?xt=urn:btih:AAA" },
    ]),
  );
  const lookup = buildHydrationStateByHydrationKey(originalEntries, {
    [originalEntries[0]!.id]: createHydrationState("ready"),
  });
  const editedEntries = buildPreviewEntries(
    createDocument([
      { displayName: "Single Source", subfolder: "single", torrentUrl: "magnet:?xt=urn:btih:BBB" },
    ]),
  );

  assert.notEqual(editedEntries[0]!.hydrationKey, originalEntries[0]!.hydrationKey);
  assert.equal(getHydrationStateForEntry(editedEntries[0], lookup), null);
});

function createDocument(
  entries: Array<{
    displayName: string;
    subfolder: string;
    torrentUrl: string;
  }>,
): SourceDocument {
  return {
    version: 1,
    entries: entries.map((entry) => ({
      displayName: entry.displayName,
      subfolder: entry.subfolder,
      scope: {
        path: "/",
      },
      torrents: [
        {
          url: entry.torrentUrl,
        },
      ],
    })),
  };
}

function createHydrationState(status: HydrationSourceState["status"]): HydrationSourceState {
  return {
    mode: "standard",
    status,
    updatedAt: null,
    fileCount: 0,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
  };
}
