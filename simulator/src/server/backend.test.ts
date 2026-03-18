import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildManagedRenameRule } from "../policyAnalysis";
import {
  createPreparingArchiveCacheRow,
  createReadyStandardCacheRow,
  type CachedProviderFileRecord,
} from "./cacheDb";
import { ensureLocalArtifacts, SimulatorBackend } from "./backend";
import { RealDebridClient } from "./realDebrid";

const FIXTURE_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("updateSourceEntryPolicy rewrites only the selected source entry", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Nintendo Entertainment System",
          subfolder: "nes",
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
        {
          displayName: "Super Nintendo Entertainment System",
          subfolder: "snes",
          ignore: {
            glob: ["*.txt"],
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:BBB",
            },
          ],
        },
      ],
    });

    const backend = new SimulatorBackend(repoRoot, "");
    const [nesEntry] = backend.buildState().entries;
    assert.ok(nesEntry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(nesEntry.hydrationKey, [
        providerFile("Super Mario Bros. (World).zip"),
        providerFile("Airwolf (USA) (Acclaim).zip"),
      ]),
    );

    const result = backend.updateSourceEntryPolicy({
      ...policyTarget(nesEntry),
      renamePolicy: {
        mode: "phrases",
        phrases: ["(USA)", "(World)"],
      },
      ignoreGlobs: ["* (Japan)*.zip"],
    });

    assert.deepEqual(result, { status: "ok" });

    const updatedDocument = JSON.parse(
      readFileSync(path.join(repoRoot, "source.json"), "utf8"),
    ) as {
      version: number;
      entries: Array<Record<string, unknown>>;
    };
    const expectedRenameRule = buildManagedRenameRule(
      "phrases",
      ["(USA)", "(World)"],
      ["(Acclaim)", "(USA)", "(World)"],
    );
    assert.ok(expectedRenameRule);

    assert.deepEqual(updatedDocument.entries[0], {
      displayName: "Nintendo Entertainment System",
      subfolder: "nes",
      rename: expectedRenameRule,
      ignore: {
        glob: ["* (Japan)*.zip"],
      },
      torrents: [
        {
          url: "magnet:?xt=urn:btih:AAA",
        },
      ],
    });
    assert.deepEqual(updatedDocument.entries[1], {
      displayName: "Super Nintendo Entertainment System",
      subfolder: "snes",
      ignore: {
        glob: ["*.txt"],
      },
      torrents: [
        {
          url: "magnet:?xt=urn:btih:BBB",
        },
      ],
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("updateSourceEntryPolicy requires confirmation before replacing a custom rename regex", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Nintendo Entertainment System",
          subfolder: "nes",
          rename: {
            pattern: "^(.+?) \\(USA\\)(\\.[^.]+)$",
            replacement: "$1$2",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new SimulatorBackend(repoRoot, "");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(entry.hydrationKey, [
        providerFile("Airwolf (USA) (Acclaim).zip"),
      ]),
    );

    const result = backend.updateSourceEntryPolicy({
      ...policyTarget(entry),
      renamePolicy: {
        mode: "all",
        phrases: ["(USA)", "(Acclaim)"],
      },
    });

    assert.deepEqual(result, {
      status: "needs-confirmation",
      kind: "custom-rename",
      error:
        "This source already has a custom rename regex. Confirm replacement before overwriting it.",
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("updateSourceEntryPolicy targets the selected entry even when standard sources share a hydration key", () => {
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

    const backend = new SimulatorBackend(repoRoot, "");
    const entries = backend.buildState().entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.hydrationKey, entries[1]?.hydrationKey);
    const targetEntry = entries[1];
    assert.ok(targetEntry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(targetEntry.hydrationKey, [
        providerFile("set-one/Alpha (USA).zip", "/set-one/Alpha (USA).zip"),
        providerFile("set-two/Bravo (USA).zip", "/set-two/Bravo (USA).zip"),
      ]),
    );

    const result = backend.updateSourceEntryPolicy({
      ...policyTarget(targetEntry),
      renamePolicy: {
        mode: "phrases",
        phrases: ["(USA)"],
      },
    });

    assert.deepEqual(result, { status: "ok" });

    const updatedDocument = JSON.parse(
      readFileSync(path.join(repoRoot, "source.json"), "utf8"),
    ) as {
      entries: Array<Record<string, unknown>>;
    };

    assert.equal(updatedDocument.entries[0]?.rename, undefined);
    assert.deepEqual(updatedDocument.entries[1]?.rename, {
      pattern: "(?:[\\s.]*(?:\\(USA\\))(?:\\s*(?:\\(USA\\)))*(?:([\\s]+)(?=\\b\\B)|(?:[\\s.]*(?=\\.[^.]+$))))",
      replacement: "$1",
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("updateSourceEntryPolicy re-resolves the selected entry after source order changes", () => {
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
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new SimulatorBackend(repoRoot, "");
    const targetEntry = backend.buildState().entries.find((entry) => entry.subfolder === "two");
    assert.ok(targetEntry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(targetEntry.hydrationKey, [
        providerFile("set-two/Bravo (USA).zip", "/set-two/Bravo (USA).zip"),
      ]),
    );

    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Source Two",
          subfolder: "two",
          scope: {
            path: "/set-two/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
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
      ],
    });

    const result = backend.updateSourceEntryPolicy({
      ...policyTarget(targetEntry),
      renamePolicy: {
        mode: "phrases",
        phrases: ["(USA)"],
      },
    });

    assert.deepEqual(result, { status: "ok" });

    const updatedDocument = JSON.parse(
      readFileSync(path.join(repoRoot, "source.json"), "utf8"),
    ) as {
      entries: Array<Record<string, unknown>>;
    };

    assert.deepEqual(updatedDocument.entries[0]?.rename, {
      pattern: "(?:[\\s.]*(?:\\(USA\\))(?:\\s*(?:\\(USA\\)))*(?:([\\s]+)(?=\\b\\B)|(?:[\\s.]*(?=\\.[^.]+$))))",
      replacement: "$1",
    });
    assert.equal(updatedDocument.entries[1]?.rename, undefined);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

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

    const backend = new SimulatorBackend(repoRoot, "");
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

    const [firstFile] = backend.getSourceFiles(firstEntry.id).files;
    const [secondFile] = backend.getSourceFiles(secondEntry.id).files;
    assert.ok(firstFile);
    assert.ok(secondFile);

    assert.deepEqual(backend.setSelectedRowIds(firstEntry.id, [firstFile.id]), [firstFile.id]);
    assert.deepEqual(backend.setSelectedRowIds(secondEntry.id, [secondFile.id]), [secondFile.id]);

    assert.deepEqual(backend.getSourceFiles(firstEntry.id).selectedRowIds, [firstFile.id]);
    assert.deepEqual(backend.getSourceFiles(secondEntry.id).selectedRowIds, [secondFile.id]);
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

    const backend = new SimulatorBackend(repoRoot, "token");

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
      backend.getSourceFiles(secondEntry.id).files.map((file) => file.originalName),
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

    const backend = new SimulatorBackend(repoRoot, "token");
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

    const backend = new SimulatorBackend(repoRoot, "token");
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

    const backend = new SimulatorBackend(repoRoot, "");
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

    const [targetFile] = backend.getSourceFiles(targetEntry.id).files;
    assert.ok(targetFile);
    assert.deepEqual(backend.setSelectedRowIds(targetEntry.id, [targetFile.id]), [targetFile.id]);

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
    assert.deepEqual(backend.getSourceFiles(reorderedEntry.id).selectedRowIds, [targetFile.id]);
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

    const backend = new SimulatorBackend(repoRoot, "");
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

    assert.deepEqual(backend.getSourceFiles(entry.id).selectedRowIds, ["Alpha.zip"]);

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

test("updateSourceEntryPolicy rejects malformed payloads", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Nintendo Entertainment System",
          subfolder: "nes",
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const backend = new SimulatorBackend(repoRoot, "");
    const [entry] = backend.buildState().entries;
    assert.ok(entry);

    const cacheDb = (backend as unknown as {
      cacheDb: { setSourceCache: (row: ReturnType<typeof createReadyStandardCacheRow>) => void };
    }).cacheDb;
    cacheDb.setSourceCache(
      createReadyStandardCacheRow(entry.hydrationKey, [providerFile("Alpha (USA).zip")]),
    );

    assert.throws(
      () =>
        backend.updateSourceEntryPolicy({
          ...policyTarget(entry),
          renamePolicy: {
            mode: "bogus" as "none",
            phrases: ["(USA)"],
          },
          confirmReplaceCustomRename: "yes" as unknown as boolean,
        }),
      /Invalid source entry policy payload/,
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

    const backend = new SimulatorBackend(repoRoot, "");
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

    const sourceFiles = backend.getSourceFiles(entry.id);

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

test("archive sample extensions persist by hydration key across equivalent sources", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Sony PlayStation A",
          subfolder: "psx",
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
        {
          displayName: "Sony PlayStation B",
          subfolder: "psx-alt",
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

    const backend = new SimulatorBackend(repoRoot, "");
    const [firstEntry, secondEntry] = backend.buildState().entries;
    assert.ok(firstEntry);
    assert.ok(secondEntry);
    assert.equal(firstEntry.hydrationKey, secondEntry.hydrationKey);

    backend.setArchiveSampleExtensions(firstEntry.id, ["cue", ".bin", ".cue"]);

    assert.deepEqual(
      backend.getSourceFiles(secondEntry.id).archiveSampleExtensions,
      [".cue", ".bin"],
    );
  } finally {
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

function policyTarget(entry: {
  id: string;
  selectionStateKey: string;
  displayName: string;
  subfolder: string;
}) {
  return {
    entryId: entry.id,
    selectionStateKey: entry.selectionStateKey,
    displayName: entry.displayName,
    subfolder: entry.subfolder,
  };
}
