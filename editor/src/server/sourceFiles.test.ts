import test from "node:test";
import assert from "node:assert/strict";

import { buildPreviewEntries } from "../runtimeValidation";
import type {
  CachedArchiveEntryDescriptor,
  CachedProviderFileRecord,
} from "./cacheDb";
import {
  buildArchiveSourceFiles,
  buildScopedArchiveSourceFiles,
  buildScopedStandardSourceFiles,
  buildStandardSourceFiles,
} from "./sourceFiles";

test("buildStandardSourceFiles applies scope before ignore globs and sorts by original name", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo GameCube",
        subfolder: "gc",
        scope: {
          path: "/games/",
        },
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

  const files: CachedProviderFileRecord[] = [
    providerFile("/games/Zelda.iso", 10),
    providerFile("/games/Alpha.iso", 12),
    providerFile("/games/notes.txt", 1),
    providerFile("/games/sub/Mario.iso", 20),
    providerFile("/other/Metroid.iso", 30),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Alpha.iso", "Zelda.iso"],
  );
  assert.deepEqual(
    result.map((file) => file.relativePath),
    ["/games/Alpha.iso", "/games/Zelda.iso"],
  );
});

test("buildArchiveSourceFiles applies ignore globs to archive entry basenames", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo Entertainment System",
        subfolder: "nes",
        scope: {
          path: "/ROMs/Nintendo.zip",
        },
        ignore: {
          glob: ["*.nfo"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:BBB",
          },
        ],
      },
    ],
  });

  const files: CachedArchiveEntryDescriptor[] = [
    archiveEntry("A/Metroid.nes", 10),
    archiveEntry("A/readme.nfo", 1),
  ];

  const result = buildArchiveSourceFiles(entry, files);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "Metroid.nes");
  assert.equal(result[0].relativePath, "/A/Metroid.nes");
});

test("buildScopedStandardSourceFiles keeps scoped rows before ignore filtering", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo Game Boy",
        subfolder: "gb",
        scope: {
          path: "/roms/",
        },
        ignore: {
          glob: ["*.txt"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:RAW",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/roms/Alpha.gb", 10),
    providerFile("/roms/notes.txt", 1),
    providerFile("/other/Bravo.gb", 12),
  ];

  const result = buildScopedStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Alpha.gb", "notes.txt"],
  );
});

test("buildScopedStandardSourceFiles sorts file names case-insensitively and keeps same-name ties stable", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo Game Boy Advance",
        subfolder: "gba",
        scope: {
          path: "/roms/",
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:ORDER",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/roms/beta.gb", 10),
    providerFile("/roms/Alpha.gb", 11),
    providerFile("/roms/alpha.gb", 12),
    providerFile("/roms/Beta.gb", 13),
  ];

  const result = buildScopedStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Alpha.gb", "alpha.gb", "beta.gb", "Beta.gb"],
  );
});

test("buildScopedArchiveSourceFiles keeps archive rows before ignore filtering", () => {
  const files: CachedArchiveEntryDescriptor[] = [
    archiveEntry("Games/Alpha.gb", 10),
    archiveEntry("Games/readme.txt", 1),
  ];

  const result = buildScopedArchiveSourceFiles(files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Alpha.gb", "readme.txt"],
  );
});

test("buildScopedArchiveSourceFiles sorts file names case-insensitively and keeps same-name ties stable", () => {
  const files: CachedArchiveEntryDescriptor[] = [
    archiveEntry("Games/beta.gb", 10),
    archiveEntry("Games/Alpha.gb", 11),
    archiveEntry("Games/alpha.gb", 12),
    archiveEntry("Games/Beta.gb", 13),
  ];

  const result = buildScopedArchiveSourceFiles(files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Alpha.gb", "alpha.gb", "beta.gb", "Beta.gb"],
  );
});

test("buildStandardSourceFiles treats parentheses literally in ignore globs like the app", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo Gameboy Advance",
        subfolder: "gba",
        ignore: {
          glob: ["* (Japan).zip"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:CCC",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/'89 Dennou Kyuusei Uranai (Japan).zip", 10),
    providerFile("/1999 - Hore, Mitakotoka! Seikimatsu (Japan).zip", 11),
    providerFile("/Other Region.zip", 12),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Other Region.zip"],
  );
});

test("buildStandardSourceFiles treats a leading exclamation point literally in ignore globs", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo DS",
        subfolder: "nds",
        ignore: {
          glob: ["!special.zip"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:DDD",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/!special.zip", 10),
    providerFile("/ordinary.zip", 11),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["ordinary.zip"],
  );
});

test("buildStandardSourceFiles treats a leading hash literally in ignore globs", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo DS",
        subfolder: "nds",
        ignore: {
          glob: ["#beta.zip"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:EEE",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/#beta.zip", 10),
    providerFile("/release.zip", 11),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["release.zip"],
  );
});

test("buildStandardSourceFiles matches dotfiles in ignore globs like the app", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo DS",
        subfolder: "nds",
        ignore: {
          glob: ["*.zip"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:FFF",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/.hidden.zip", 10),
    providerFile("/visible.7z", 11),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["visible.7z"],
  );
});

test("buildStandardSourceFiles lowercases ignore globs and basenames like the app", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo DS",
        subfolder: "nds",
        ignore: {
          glob: ["* (japan).zip"],
        },
        torrents: [
          {
            url: "magnet:?xt=urn:btih:GGG",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/Alpha (JAPAN).ZIP", 10),
    providerFile("/Bravo (USA).zip", 11),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => file.originalName),
    ["Bravo (USA).zip"],
  );
});

test("buildStandardSourceFiles only marks zip, rar, and 7z as archive candidates", () => {
  const [entry] = buildPreviewEntries({
    version: 1,
    entries: [
      {
        displayName: "Nintendo GameCube",
        subfolder: "gc",
        torrents: [
          {
            url: "magnet:?xt=urn:btih:AAA",
          },
        ],
      },
    ],
  });

  const files: CachedProviderFileRecord[] = [
    providerFile("/Alpha.zip", 10),
    providerFile("/Bravo.rar", 10),
    providerFile("/Charlie.7z", 10),
    providerFile("/Delta.tar", 10),
    providerFile("/Echo.gz", 10),
  ];

  const result = buildStandardSourceFiles(entry, files);

  assert.deepEqual(
    result.map((file) => ({ name: file.originalName, isArchiveCandidate: file.isArchiveCandidate })),
    [
      { name: "Alpha.zip", isArchiveCandidate: true },
      { name: "Bravo.rar", isArchiveCandidate: true },
      { name: "Charlie.7z", isArchiveCandidate: true },
      { name: "Delta.tar", isArchiveCandidate: false },
      { name: "Echo.gz", isArchiveCandidate: false },
    ],
  );
});

function providerFile(path: string, sizeBytes: number): CachedProviderFileRecord {
  return {
    providerFileId: `${path}-${sizeBytes}`,
    originalName: path.split("/").pop() ?? path,
    path,
    sizeBytes,
    partLabel: null,
    locator: {
      sourceMagnetUri: "magnet:?xt=urn:btih:AAA",
      torrentId: "torrent-id",
      providerFileIds: ["file-id"],
      selectedProviderFileId: "file-id",
      path,
      partLabel: null,
    },
  };
}

function archiveEntry(path: string, sizeBytes: number): CachedArchiveEntryDescriptor {
  return {
    identity: {
      localHeaderOffset: 1,
      compressedSize: sizeBytes,
      uncompressedSize: sizeBytes,
      crc32: 1,
      normalizedPath: path,
    },
    entryPath: path,
    sizeBytes,
  };
}
