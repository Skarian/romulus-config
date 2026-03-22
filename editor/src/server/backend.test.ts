import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSourceFilesRequest } from "../sourcePolicyEditor";
import type { PreviewEntry, SourceFilesRequest } from "../types";
import {
  createPreparingArchiveCacheRow,
  createReadyStandardCacheRow,
  type CachedProviderFileRecord,
} from "./cacheDb";
import { ensureLocalArtifacts, EditorBackend } from "./backend";
import { RealDebridClient } from "./realDebrid";

const FIXTURE_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("selected file state stays isolated per entry even when standard sources share a hydration key", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Source One",
          subfolder: "one",
          scope: {
            path: "/set-one/",
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
            path: "/set-two/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "");
    const [firstEntry, secondEntry] = backend.buildState().entries;
    assert.ok(firstEntry);
    assert.ok(secondEntry);
    assert.equal(firstEntry.hydrationKey, secondEntry.hydrationKey);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(firstEntry.hydrationKey, [
        providerFile("set-one/Alpha (USA).zip", "/set-one/Alpha (USA).zip"),
        providerFile("set-two/Bravo (USA).zip", "/set-two/Bravo (USA).zip"),
      ]),
    );

    const [firstFile] = backend.getSourceFiles(sourceFilesRequest(firstEntry)).files;
    const [secondFile] = backend.getSourceFiles(sourceFilesRequest(secondEntry)).files;
    assert.ok(firstFile);
    assert.ok(secondFile);

    assert.deepEqual(
      backend.setSelectedRowIds(sourceFilesRequest(firstEntry), [firstFile.id]),
      [firstFile.id],
    );
    assert.deepEqual(
      backend.setSelectedRowIds(sourceFilesRequest(secondEntry), [secondFile.id]),
      [secondFile.id],
    );

    assert.deepEqual(backend.getSourceFiles(sourceFilesRequest(firstEntry)).selectedRowIds, [firstFile.id]);
    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(secondEntry)).selectedRowIds,
      [secondFile.id],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runHydration processes shared standard cache keys only once", async () => {
  const repoRoot = createTempRepo();
  const originalEnumerateProviderFiles = RealDebridClient.prototype.enumerateProviderFiles;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Source One",
          subfolder: "one",
          scope: {
            path: "/set-one/",
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
            path: "/set-two/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
      ],
    });

    let enumerateCount = 0;
    RealDebridClient.prototype.enumerateProviderFiles = async function (_sources) {
      enumerateCount += 1;
      return [
        providerFile("Alpha.zip", "/set-one/Alpha.zip"),
        providerFile("Bravo.zip", "/set-two/Bravo.zip"),
      ];
    };

    const backend = new EditorBackend(repoRoot, "token");

    await backend.runHydration();

    const state = backend.buildState();
    const [firstEntry, secondEntry] = state.entries;
    assert.ok(firstEntry);
    assert.ok(secondEntry);
    assert.equal(enumerateCount, 1);
    assert.deepEqual(state.hydration.missingSourceIds, []);
    assert.equal(state.hydration.sourceStates[firstEntry.id]?.status, "ready");
    assert.equal(state.hydration.sourceStates[secondEntry.id]?.status, "ready");
    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(secondEntry)).files.map((file) => file.originalName),
      ["Bravo.zip"],
    );
  } finally {
    RealDebridClient.prototype.enumerateProviderFiles = originalEnumerateProviderFiles;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runHydration resumes a preparing archive when force refresh is not requested", async () => {
  const repoRoot = createTempRepo();
  const originalResumeAcquisition = RealDebridClient.prototype.resumeAcquisition;
  const originalStartExactZipAcquisition = RealDebridClient.prototype.startExactZipAcquisition;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Archive Source",
          subfolder: "psx",
          scope: {
            path: "/ROMs/Game.zip",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "token");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: {
        setSourceCache: (row: ReturnType<typeof createPreparingArchiveCacheRow>) => void;
        getSourceCache: (cacheKey: string) => { status: string } | null;
      };
    }).cacheDb;
    cacheDb.setSourceCache(
      createPreparingArchiveCacheRow(
        entry.hydrationKey,
        providerFile("Game.zip", "/ROMs/Game.zip"),
        {
          torrentId: "existing-torrent",
          sourceMagnetUri: "magnet:?xt=urn:btih:AAA",
          selectedProviderFileIds: ["7"],
        },
        "downloading",
        50,
      ),
    );

    let resumedTorrentId: string | null = null;
    let startedFresh = false;
    RealDebridClient.prototype.resumeAcquisition = async function (marker) {
      resumedTorrentId = marker.torrentId;
      return {
        kind: "waiting",
        statusLabel: "downloading",
        progressPercent: 75,
        resumeMarker: marker,
      };
    };
    RealDebridClient.prototype.startExactZipAcquisition = async function () {
      startedFresh = true;
      throw new Error("should not start a fresh archive acquisition");
    };

    await backend.runHydration([entry.id], { forceRefresh: false });

    assert.equal(resumedTorrentId, "existing-torrent");
    assert.equal(startedFresh, false);
    assert.equal(cacheDb.getSourceCache(entry.hydrationKey)?.status, "preparing");
  } finally {
    RealDebridClient.prototype.resumeAcquisition = originalResumeAcquisition;
    RealDebridClient.prototype.startExactZipAcquisition = originalStartExactZipAcquisition;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runHydration keeps a links-ready archive retryable when post-download handling fails", async () => {
  const repoRoot = createTempRepo();
  const originalStartExactZipAcquisition = RealDebridClient.prototype.startExactZipAcquisition;
  const originalMaterializeArchiveContainer =
    RealDebridClient.prototype.materializeArchiveContainer;
  const originalReleaseAcquisition = RealDebridClient.prototype.releaseAcquisition;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Archive Source",
          subfolder: "psx",
          scope: {
            path: "/ROMs/Game.zip",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "token");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    let releasedTorrentId: string | null = null;
    RealDebridClient.prototype.startExactZipAcquisition = async function () {
      return {
        exactMatch: providerFile("Game.zip", "/ROMs/Game.zip"),
        status: {
          kind: "links-ready" as const,
          resumeMarker: {
            torrentId: "prepared-torrent",
            sourceMagnetUri: "magnet:?xt=urn:btih:AAA",
            selectedProviderFileIds: ["7"],
          },
          readyLinks: [{ restrictedUrl: "https://restricted.example/archive" }],
        },
      };
    };
    RealDebridClient.prototype.materializeArchiveContainer = async function () {
      throw new Error("remote zip probe failed");
    };
    RealDebridClient.prototype.releaseAcquisition = async function (marker) {
      releasedTorrentId = marker.torrentId;
    };

    await backend.runHydration([entry.id], { forceRefresh: false });

    const cacheDb = (backend as unknown as {
      cacheDb: {
        getSourceCache: (cacheKey: string) => ReturnType<
          typeof createPreparingArchiveCacheRow
        > | null;
      };
    }).cacheDb;
    const cached = cacheDb.getSourceCache(entry.hydrationKey);
    assert.ok(cached);
    assert.equal(cached.status, "preparing");
    assert.equal(cached.statusLabel, "downloaded");
    assert.equal(cached.progressPercent, 100);
    assert.equal(releasedTorrentId, null);

    const state = backend.buildState();
    assert.equal(state.hydration.sourceStates[entry.id]?.status, "preparing");
  } finally {
    RealDebridClient.prototype.startExactZipAcquisition = originalStartExactZipAcquisition;
    RealDebridClient.prototype.materializeArchiveContainer =
      originalMaterializeArchiveContainer;
    RealDebridClient.prototype.releaseAcquisition = originalReleaseAcquisition;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runHydration persists the latest update logs and run summary across backend reloads", async () => {
  const repoRoot = createTempRepo();
  const originalEnumerateProviderFiles = RealDebridClient.prototype.enumerateProviderFiles;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Logged Source",
          subfolder: "logged",
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    RealDebridClient.prototype.enumerateProviderFiles = async function () {
      return [providerFile("Logged.zip")];
    };

    let backend = new EditorBackend(repoRoot, "token");
    await backend.runHydration();

    let state = backend.buildState();
    assert.equal(state.hydration.logs.length > 0, true);
    assert.equal(state.hydration.lastRun?.outcome, "success");
    assert.equal(state.hydration.lastRun?.sourceCount, 1);
    assert.equal(state.hydration.lastRun?.successCount, 1);
    assert.equal(state.hydration.lastRun?.failureCount, 0);

    backend = new EditorBackend(repoRoot, "token");
    state = backend.buildState();
    assert.equal(state.hydration.logs.length > 0, true);
    assert.equal(state.hydration.lastRun?.outcome, "success");
    assert.equal(state.hydration.lastRun?.sourceCount, 1);
    assert.equal(state.hydration.lastRun?.successCount, 1);
    assert.equal(state.hydration.lastRun?.failureCount, 0);
  } finally {
    RealDebridClient.prototype.enumerateProviderFiles = originalEnumerateProviderFiles;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runHydration with force refresh preserves prior cache for sources that fail", async () => {
  const repoRoot = createTempRepo();
  const originalEnumerateProviderFiles = RealDebridClient.prototype.enumerateProviderFiles;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Cached Source",
          subfolder: "cached",
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
        {
          displayName: "Failing Source",
          subfolder: "failing",
          torrents: [
            {
              url: "magnet:?xt=urn:btih:BBB",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "token");
    const [cachedEntry, failingEntry] = backend.buildState().entries;
    assert.ok(cachedEntry);
    assert.ok(failingEntry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(cachedEntry.hydrationKey, [providerFile("Old-Cached.zip")]),
    );
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(failingEntry.hydrationKey, [providerFile("Old-Failing.zip")]),
    );

    RealDebridClient.prototype.enumerateProviderFiles = async function (sources) {
      if (sources[0]?.magnetUri === "magnet:?xt=urn:btih:AAA") {
        return [providerFile("Fresh-Cached.zip")];
      }
      throw new Error("provider request failed");
    };

    await backend.runHydration(undefined, { forceRefresh: true });

    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(cachedEntry)).files.map((file) => file.originalName),
      ["Fresh-Cached.zip"],
    );
    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(failingEntry)).files.map((file) => file.originalName),
      ["Old-Failing.zip"],
    );
    assert.equal(backend.buildState().hydration.lastRun?.outcome, "mixed");
  } finally {
    RealDebridClient.prototype.enumerateProviderFiles = originalEnumerateProviderFiles;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("selected file state survives entry reorder and presentation renames", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Target Source",
          subfolder: "target",
          scope: {
            path: "/set-target/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
        {
          displayName: "Other Source",
          subfolder: "other",
          scope: {
            path: "/set-other/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "");
    const entries = backend.buildState().entries;
    const targetEntry = entries.find((entry) => entry.subfolder === "target");
    assert.ok(targetEntry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(targetEntry.hydrationKey, [
        providerFile("Alpha.zip", "/set-target/Alpha.zip"),
        providerFile("Bravo.zip", "/set-other/Bravo.zip"),
      ]),
    );

    const [targetFile] = backend.getSourceFiles(sourceFilesRequest(targetEntry)).files;
    assert.ok(targetFile);
    assert.deepEqual(
      backend.setSelectedRowIds(sourceFilesRequest(targetEntry), [targetFile.id]),
      [targetFile.id],
    );

    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Other Source",
          subfolder: "other",
          scope: {
            path: "/set-other/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
        {
          displayName: "Retitled Source",
          subfolder: "retitled-target",
          scope: {
            path: "/set-target/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
      ],
    });

    const reorderedEntry = backend
      .buildState()
      .entries.find((entry) => entry.subfolder === "retitled-target");
    assert.ok(reorderedEntry);
    assert.notEqual(reorderedEntry.id, targetEntry.id);
    assert.equal(reorderedEntry.selectionStateKey, targetEntry.selectionStateKey);
    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(reorderedEntry)).selectedRowIds,
      [targetFile.id],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("selected file state falls back from legacy entry ids into the scoped key", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Target Source",
          subfolder: "target",
          scope: {
            path: "/set-target/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: {
        setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void;
        database: {
          prepare: (sql: string) => {
            run: (...params: unknown[]) => void;
            get: (...params: unknown[]) => { selected_row_ids_json: string } | undefined;
          };
        };
      };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(entry.hydrationKey, [
        providerFile("Alpha.zip", "/set-target/Alpha.zip"),
      ]),
    );

    cacheDb.database
      .prepare(`
        INSERT INTO selected_file_state_by_entry (
          entry_id,
          selected_row_ids_json,
          updated_at
        ) VALUES (?, ?, ?)
      `)
      .run(entry.id, JSON.stringify(["Alpha.zip"]), new Date().toISOString());

    assert.deepEqual(backend.getSourceFiles(sourceFilesRequest(entry)).selectedRowIds, ["Alpha.zip"]);

    const migratedRow = cacheDb.database
      .prepare(`
        SELECT selected_row_ids_json
        FROM selected_file_state_by_scope
        WHERE state_key = ?
      `)
      .get(entry.selectionStateKey);
    assert.deepEqual(
      migratedRow ? JSON.parse(migratedRow.selected_row_ids_json) : null,
      ["Alpha.zip"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("getSourceFiles keeps analysis names from the scoped raw inventory before ignore filtering", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Nintendo Entertainment System",
          subfolder: "nes",
          ignore: {
            glob: ["*.txt"],
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(entry.hydrationKey, [
        providerFile("Alpha.zip"),
        providerFile("notes.txt"),
      ]),
    );

    const sourceFiles = backend.getSourceFiles(sourceFilesRequest(entry));

    assert.deepEqual(
      sourceFiles.analysisOriginalNames,
      ["Alpha.zip", "notes.txt"],
    );
    assert.deepEqual(
      sourceFiles.analysisFiles?.map((file) => file.originalName),
      ["Alpha.zip", "notes.txt"],
    );
    assert.deepEqual(
      sourceFiles.files.map((file) => file.originalName),
      ["Alpha.zip"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("getSourceFiles reports how many cached files are excluded by the current scope", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Scoped Source",
          subfolder: "scoped",
          scope: {
            path: "/roms/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SCOPE",
            },
          ],
        },
      ],
    });

    const backend = new EditorBackend(repoRoot, "");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(entry.hydrationKey, [
        providerFile("Alpha.zip", "/roms/Alpha.zip"),
        providerFile("Bravo.zip", "/roms/sub/Bravo.zip"),
        providerFile("Charlie.zip", "/other/Charlie.zip"),
      ]),
    );

    const sourceFiles = backend.getSourceFiles(sourceFilesRequest(entry));

    assert.equal(sourceFiles.scopedOutFileCount, 2);
    assert.deepEqual(
      sourceFiles.analysisFiles?.map((file) => file.originalName),
      ["Alpha.zip"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("archive sample extensions persist across structural changes that keep the content boundary", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Sony PlayStation",
          subfolder: "psx",
          scope: {
            path: "/disc-a/",
          },
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    let backend = new EditorBackend(repoRoot, "");
    const [firstEntry] = backend.buildState().entries;
    assert.ok(firstEntry);

    backend.setArchiveSampleExtensions(
      archiveSampleExtensionsRequest(firstEntry),
      ["cue", ".bin", ".cue"],
    );

    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Sony PlayStation Renamed",
          subfolder: "psx-renamed",
          scope: {
            path: "/disc-a/",
          },
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    backend = new EditorBackend(repoRoot, "");
    const [renamedEntry] = backend.buildState().entries;
    assert.ok(renamedEntry);

    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(renamedEntry)).archiveSampleExtensions,
      [".cue", ".bin"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("archive sample extensions do not carry across scope-only standard path changes", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Sony PlayStation",
          subfolder: "psx",
          scope: {
            path: "/disc-a/",
          },
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    let backend = new EditorBackend(repoRoot, "");
    const [firstEntry] = backend.buildState().entries;
    assert.ok(firstEntry);

    backend.setArchiveSampleExtensions(
      archiveSampleExtensionsRequest(firstEntry),
      [".cue", ".bin"],
    );

    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Sony PlayStation",
          subfolder: "psx",
          scope: {
            path: "/disc-b/",
          },
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    backend = new EditorBackend(repoRoot, "");
    const [movedEntry] = backend.buildState().entries;
    assert.ok(movedEntry);
    assert.equal(movedEntry.hydrationKey, firstEntry.hydrationKey);
    assert.notEqual(movedEntry.selectionStateKey, firstEntry.selectionStateKey);

    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(movedEntry)).archiveSampleExtensions,
      [],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("clearLocalData removes only the selected local database categories", async () => {
  const repoRoot = createTempRepo();
  const originalEnumerateProviderFiles = RealDebridClient.prototype.enumerateProviderFiles;

  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Clearable Source",
          subfolder: "clearable",
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    RealDebridClient.prototype.enumerateProviderFiles = async function () {
      return [providerFile("Alpha.zip")];
    };

    const backend = new EditorBackend(repoRoot, "token");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    await backend.runHydration();

    const [file] = backend.getSourceFiles(sourceFilesRequest(entry)).files;
    assert.ok(file);
    backend.setSelectedRowIds(sourceFilesRequest(entry), [file.id]);
    backend.setArchiveSampleExtensions(archiveSampleExtensionsRequest(entry), [".cue"]);

    backend.clearLocalData({
      fileCache: false,
      savedSelections: true,
      savedPreviewData: false,
      updateLogs: true,
    });

    assert.deepEqual(backend.getSourceFiles(sourceFilesRequest(entry)).selectedRowIds, []);
    assert.deepEqual(
      backend.getSourceFiles(sourceFilesRequest(entry)).archiveSampleExtensions,
      [".cue"],
    );
    assert.equal(backend.buildState().hydration.logs.length, 0);
    assert.equal(backend.buildState().hydration.missingSourceIds.includes(entry.id), false);

    backend.clearLocalData({
      fileCache: true,
      savedSelections: false,
      savedPreviewData: true,
      updateLogs: false,
    });

    assert.equal(backend.buildState().hydration.missingSourceIds.includes(entry.id), true);
    assert.deepEqual(backend.getSourceFiles(sourceFilesRequest(entry)).archiveSampleExtensions, []);
  } finally {
    RealDebridClient.prototype.enumerateProviderFiles = originalEnumerateProviderFiles;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function createTempRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "romulus-config-backend-"));
  mkdirSync(path.join(repoRoot, "references/romulus/docs"), { recursive: true });
  ensureLocalArtifacts(repoRoot);
  writeFileSync(
    path.join(repoRoot, "references/romulus/docs/schema.json"),
    readFileSync(path.join(FIXTURE_REPO_ROOT, "references/romulus/docs/schema.json"), "utf8"),
    "utf8",
  );
  return repoRoot;
}

function sourceFilesRequest(entry: PreviewEntry): SourceFilesRequest {
  return buildSourceFilesRequest(entry);
}

function archiveSampleExtensionsRequest(entry: PreviewEntry) {
  return {
    selectionStateKey: entry.selectionStateKey,
    unarchiveEnabled: entry.unarchive !== null,
  };
}

function writeSourceDocument(
  repoRoot: string,
  document: {
    version: number;
    entries: Array<Record<string, unknown>>;
  },
) {
  writeFileSync(
    path.join(repoRoot, "source.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

function providerFile(
  originalName: string,
  pathValue = `/${originalName}`,
): CachedProviderFileRecord {
  return {
    providerFileId: originalName,
    originalName,
    path: pathValue,
    sizeBytes: 1,
    partLabel: null,
    locator: {
      sourceMagnetUri: "magnet:?xt=urn:btih:AAA",
      torrentId: "torrent-1",
      providerFileIds: [originalName],
      selectedProviderFileId: originalName,
      path: pathValue,
      partLabel: null,
    },
  };
}
