import test from "node:test";
import assert from "node:assert/strict";

import { buildPreviewEntries } from "./runtimeValidation";
import {
  buildDownloadPreview,
  defaultStandardArchiveFixture,
} from "./downloadPreview";
import type {
  PreviewFixture,
  SourceFilesState,
  SourceFileRow,
} from "./types";

test("buildDownloadPreview applies dedicated-folder and entry rename for standard archive fixtures", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
        },
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
            rename: {
              pattern: "\\s*\\(Disc 1\\)$",
              replacement: "",
            },
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Metal Gear Solid (Disc 1).7z",
      relativePath: "/Metal Gear Solid (Disc 1).7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];
  const fixture: PreviewFixture = {
    ...defaultStandardArchiveFixture(entry, selectedRows[0]),
    samples: [
      {
        id: "sample-1",
        originalName: "Metal Gear Solid (Disc 1).cue",
        relativeDirectory: "disc",
        outputNameOverride: null,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [fixture],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Metal Gear Solid",
    "/psx/Metal Gear Solid/Metal Gear Solid (Disc 1).chd",
  ]);
  assert.equal(result.archiveFixtures[0]?.outerFolderName, "Metal Gear Solid");
});

test("buildDownloadPreview saves non-archive archive-selection rows directly into the entry subfolder", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.bin$",
          replacement: ".img",
        },
        scope: {
          path: "/ROMs/Game.zip",
        },
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
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
  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-entry",
      originalName: "Track 01.bin",
      relativePath: "/disc/Track 01.bin",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: false,
      kind: "archive",
    },
  ];
  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "archive",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: "Game (USA).zip",
    archiveSampleExtensions: [],
    previewFixtures: [],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Track 01.img",
  ]);
});

test("buildDownloadPreview keeps the dedicated folder visible before sample files are added", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Ridge Racer.7z",
      relativePath: "/Ridge Racer.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Ridge Racer",
  ]);
});

test("buildDownloadPreview generates archive samples from source-level extensions", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Ridge Racer.7z",
      relativePath: "/Ridge Racer.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [".cue", ".bin"],
    previewFixtures: [],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Ridge Racer.bin",
    "/psx/Ridge Racer.chd",
  ]);
  assert.deepEqual(
    result.archiveFixtures[0]?.samples.map((sample) => sample.generated),
    [true, true],
  );
});

test("buildDownloadPreview ignores persisted output overrides and uses current rename rules", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
        },
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Ridge Racer.7z",
      relativePath: "/Ridge Racer.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Ridge Racer.cue",
            relativeDirectory: "",
            outputNameOverride: "old-name.bin",
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Ridge Racer",
    "/psx/Ridge Racer/Ridge Racer.chd",
  ]);
});

test("buildDownloadPreview keeps original directory input out of the final output tree", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Ridge Racer.7z",
      relativePath: "/Ridge Racer.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Ridge Racer.cue",
            relativeDirectory: "disc/subdir",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Ridge Racer.chd",
  ]);
});

test("buildDownloadPreview uses the selected archive entry name for dedicated remote archive extraction", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        scope: {
          path: "/packs/Game.zip",
        },
        unarchive: {
          layout: {
            mode: "dedicatedFolder",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "inner-archive",
      originalName: "Disc 1.zip",
      relativePath: "/nested/Disc 1.zip",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "archive",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "archive",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: "Game.zip",
    archiveSampleExtensions: [],
    previewFixtures: [],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Disc 1",
  ]);
});

test("buildDownloadPreview keeps nested archive outputs empty without a pattern or custom samples", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        unarchive: {
          recursive: true,
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "outer-archive",
      originalName: "Collection.zip",
      relativePath: "/Collection.zip",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Disc Set.zip",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), ["/psx"]);
});

test("buildDownloadPreview does not apply entry rename to extracted archive filenames", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.zip$",
          replacement: ".pkg",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Collection.7z",
      relativePath: "/Collection.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Disc Set.zip",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Disc Set.zip",
  ]);
});

test("buildDownloadPreview keeps flat standard archive extraction in the entry subfolder", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "archive-row",
      originalName: "Ridge Racer.7z",
      relativePath: "/Ridge Racer.7z",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Ridge Racer.cue",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Ridge Racer.chd",
  ]);
});

test("buildDownloadPreview keeps flat archive-selection extraction in the entry subfolder", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        scope: {
          path: "/packs/Game.zip",
        },
        rename: {
          pattern: "\\.bin$",
          replacement: ".img",
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "inner-archive",
      originalName: "Disc 1.zip",
      relativePath: "/nested/Disc 1.zip",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "archive",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "archive",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: "Game.zip",
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        fixtureKey: `${entry.hydrationKey}::inner-archive`,
        sourceFileId: "inner-archive",
        archiveDisplayName: "Disc 1.zip",
        archiveBaseName: "Disc 1",
        samples: [
          {
            id: "sample-1",
            originalName: "Track 01.bin",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Track 01.img",
  ]);
});

test("buildDownloadPreview keeps recursive flat extraction in the entry subfolder", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\.cue$",
          replacement: ".chd",
        },
        unarchive: {
          recursive: true,
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

  const selectedRows: SourceFileRow[] = [
    {
      id: "outer-archive",
      originalName: "Collection.zip",
      relativePath: "/Collection.zip",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: true,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [
      {
        ...defaultStandardArchiveFixture(entry, selectedRows[0]),
        samples: [
          {
            id: "sample-1",
            originalName: "Disc Set.zip",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      {
        fixtureKey: `${entry.hydrationKey}::outer-archive::sample:sample-1`,
        sourceFileId: null,
        archiveDisplayName: "Disc Set.zip",
        archiveBaseName: "Disc Set",
        samples: [
          {
            id: "sample-2",
            originalName: "Track 01.cue",
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Track 01.chd",
  ]);
});

test("buildDownloadPreview numbers duplicate direct outputs instead of collapsing them", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Sony PlayStation",
        subfolder: "psx",
        rename: {
          pattern: "\\s*\\([^)]*\\)",
          replacement: "",
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:AAA",
          },
        ],
      },
    ],
  });

  const selectedRows: SourceFileRow[] = [
    {
      id: "row-1",
      originalName: "Alpha (USA).chd",
      relativePath: "/Alpha (USA).chd",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: false,
      kind: "standard",
    },
    {
      id: "row-2",
      originalName: "Alpha (Japan).chd",
      relativePath: "/Alpha (Japan).chd",
      sizeBytes: 1,
      partLabel: null,
      isArchiveCandidate: false,
      kind: "standard",
    },
  ];

  const sourceFiles: SourceFilesState = {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    entryId: entry.id,
    sourceStatus: "ready",
    sourceMode: "standard",
    updatedAt: null,
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    outerArchiveName: null,
    archiveSampleExtensions: [],
    previewFixtures: [],
    files: selectedRows,
  };

  const result = buildDownloadPreview(entry, sourceFiles, selectedRows);

  assert.deepEqual(flattenTree(result.tree), [
    "/psx",
    "/psx/Alpha (1).chd",
    "/psx/Alpha (2).chd",
  ]);
});

function flattenTree(node: { name: string; children: Array<{ name: string; children: unknown[] }> }) {
  const paths: string[] = [];

  function walk(current: typeof node, prefix: string[]) {
    for (const child of current.children) {
      const nextPrefix = [...prefix, child.name];
      paths.push(`/${nextPrefix.join("/")}`);
      walk(child as typeof node, nextPrefix);
    }
  }

  walk(node, []);
  return paths;
}
