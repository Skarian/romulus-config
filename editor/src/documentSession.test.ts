import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocumentSessionApi,
  createEmptyDocumentSessionState,
  documentSessionReducer,
  type DocumentSessionAction,
} from "./documentSession";
import type { DocumentSessionApi } from "./documentSession";
import type { SourceDocument, SourceEntryDocument } from "./types";

test("document session loads the baseline and tracks per-source dirty state with stable source refs", () => {
  const document = createDocument({
    entries: [
      createEntry({
        displayName: "Source One",
        subfolder: "one",
        torrents: [{ url: "magnet:?xt=urn:btih:AAA" }],
      }),
      createEntry({
        displayName: "Source Two",
        subfolder: "two",
        torrents: [{ url: "magnet:?xt=urn:btih:BBB" }],
      }),
    ],
  });
  const harness = createHarness(document);

  let api = harness.api();
  assert.deepEqual(api.selectors.baselineDocument, document);
  assert.deepEqual(api.selectors.draftDocument, document);
  assert.equal(api.selectors.dirty, false);
  assert.equal(api.selectors.entries.length, 2);

  const firstSource = api.selectors.entries[0];
  const secondSource = api.selectors.entries[1];
  assert.ok(firstSource);
  assert.ok(secondSource);
  assert.equal(firstSource.dirty, false);
  assert.equal(secondSource.dirty, false);

  const firstRef = api.intents.openSource(firstSource.entry.id);
  assert.equal(firstRef, firstSource.ref);

  api.intents.setSourceRenameRule(firstRef, {
    pattern: "\\s+\\(USA\\)$",
    replacement: "",
  });

  api = harness.api();
  assert.equal(api.selectors.dirty, true);
  assert.equal(api.selectors.entries[0]?.dirty, true);
  assert.equal(api.selectors.entries[1]?.dirty, false);
  assert.equal(api.intents.openSource(api.selectors.entries[0]?.entry.id ?? ""), firstRef);
  assert.equal(api.selectors.getSource(firstRef)?.dirty, true);
});

test("document session save preview stays blocked until repairable validation is fixed", () => {
  const harness = createHarness(
    createDocument({
      entries: [
        createEntry({
          displayName: "Broken Ignore",
          subfolder: "broken",
          ignore: {
            glob: ["["],
          },
          torrents: [{ url: "magnet:?xt=urn:btih:AAA" }],
        }),
      ],
    }),
  );

  let api = harness.api();
  const sourceRef = api.selectors.entries[0]?.ref ?? null;
  assert.ok(sourceRef);

  const blockedPreview = api.intents.prepareSavePreview("./references/romulus/docs/schema.json");
  assert.ok(blockedPreview);
  assert.equal(blockedPreview.status, "blocked");
  assert.deepEqual(
    blockedPreview.blockers.map((blocker) => blocker.code),
    ["repairable-validation"],
  );

  api.intents.setSourceIgnoreGlobs(sourceRef, [" *.cue ", "*.cue", " "]);

  api = harness.api();
  const readyPreview = api.intents.prepareSavePreview("./references/romulus/docs/schema.json");
  assert.ok(readyPreview);
  assert.equal(readyPreview.status, "ready");
  assert.deepEqual(readyPreview.preview.document.entries[0]?.ignore?.glob, ["*.cue"]);
  assert.match(readyPreview.preview.text, /"glob": \[\n\s+"\*\.cue"\n\s+\]/);
});

test("document session resetSourcePolicies restores the source draft back to the baseline policies", () => {
  const document = createDocument({
    entries: [
      createEntry({
        displayName: "Resettable Source",
        subfolder: "resettable",
        ignore: {
          glob: ["*.tmp"],
        },
        rename: {
          pattern: "\\s+\\(USA\\)$",
          replacement: "",
        },
        torrents: [{ url: "magnet:?xt=urn:btih:AAA" }],
      }),
    ],
  });
  const harness = createHarness(document);

  let api = harness.api();
  const sourceRef = api.selectors.entries[0]?.ref ?? null;
  assert.ok(sourceRef);

  api.intents.setSourceRenameRule(sourceRef, {
    pattern: "\\s+\\(World\\)$",
    replacement: "",
  });
  api = harness.api();
  api.intents.setSourceIgnoreGlobs(sourceRef, ["*.zip"]);

  api = harness.api();
  assert.equal(api.selectors.getSource(sourceRef)?.dirty, true);

  api.intents.resetSourcePolicies(sourceRef);

  api = harness.api();
  assert.equal(api.selectors.dirty, false);
  assert.equal(api.selectors.getSource(sourceRef)?.dirty, false);
  assert.deepEqual(
    api.selectors.getSource(sourceRef)?.rawEntry.rename,
    document.entries[0]?.rename ?? null,
  );
  assert.deepEqual(
    api.selectors.getSource(sourceRef)?.rawEntry.ignore,
    document.entries[0]?.ignore ?? null,
  );
});

test("document session undo and redo restore prior draft states", () => {
  const harness = createHarness(
    createDocument({
      entries: [
        createEntry({
          displayName: "Undo Source",
          subfolder: "undo",
          torrents: [{ url: "magnet:?xt=urn:btih:AAA" }],
        }),
      ],
    }),
  );

  let api = harness.api();
  const sourceRef = api.selectors.entries[0]?.ref ?? null;
  assert.ok(sourceRef);

  api.intents.setSourceIgnoreGlobs(sourceRef, ["*.zip"]);

  api = harness.api();
  assert.equal(api.selectors.dirty, true);
  assert.equal(api.selectors.canUndo, true);
  assert.equal(api.selectors.canRedo, false);
  assert.deepEqual(api.selectors.getSource(sourceRef)?.rawEntry.ignore?.glob, ["*.zip"]);

  api.intents.undo();

  api = harness.api();
  assert.equal(api.selectors.dirty, false);
  assert.equal(api.selectors.canUndo, false);
  assert.equal(api.selectors.canRedo, true);
  assert.equal(api.selectors.getSource(sourceRef)?.rawEntry.ignore, undefined);

  api.intents.redo();

  api = harness.api();
  assert.equal(api.selectors.dirty, true);
  assert.equal(api.selectors.canUndo, true);
  assert.equal(api.selectors.canRedo, false);
  assert.deepEqual(api.selectors.getSource(sourceRef)?.rawEntry.ignore?.glob, ["*.zip"]);
});

test("document session setSourceUnarchive and resetSourcePolicies round-trip the unarchive draft", () => {
  const document = createDocument({
    entries: [
      createEntry({
        displayName: "Archive Source",
        subfolder: "archive",
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
            rename: {
              pattern: "\\s+\\(USA\\)$",
              replacement: "",
            },
          },
        },
      }),
    ],
  });
  const harness = createHarness(document);

  let api = harness.api();
  const sourceRef = api.selectors.entries[0]?.ref ?? null;
  assert.ok(sourceRef);

  api.intents.setSourceUnarchive(sourceRef, {
    layout: {
      mode: "flat",
    },
  });

  api = harness.api();
  assert.equal(api.selectors.dirty, true);
  assert.deepEqual(api.selectors.getSource(sourceRef)?.rawEntry.unarchive, {
    layout: {
      mode: "flat",
    },
  });

  api.intents.resetSourcePolicies(sourceRef);

  api = harness.api();
  assert.equal(api.selectors.dirty, false);
  assert.deepEqual(
    api.selectors.getSource(sourceRef)?.rawEntry.unarchive,
    document.entries[0]?.unarchive ?? null,
  );
});

function createHarness(document: SourceDocument) {
  let state = createEmptyDocumentSessionState();
  const dispatch = (action: DocumentSessionAction) => {
    state = documentSessionReducer(state, action);
  };

  dispatch({
    type: "load",
    document,
  });

  return {
    api(): DocumentSessionApi {
      const api = createDocumentSessionApi(state, dispatch);
      assert.ok(api);
      return api;
    },
  };
}

function createDocument(overrides: Partial<SourceDocument>): SourceDocument {
  return {
    version: 1,
    entries: [],
    ...overrides,
  };
}

function createEntry(overrides: Partial<SourceEntryDocument>): SourceEntryDocument {
  return {
    displayName: "Source",
    subfolder: "source",
    torrents: [{ url: "magnet:?xt=urn:btih:AAA" }],
    ...overrides,
  };
}
