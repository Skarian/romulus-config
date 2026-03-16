import { HttpRangeReader, ZipReader, type Entry } from "@zip.js/zip.js";

import type { CachedArchiveEntryDescriptor } from "./cacheDb";

type RemoteZipLogger = (message: string) => void;

export async function enumerateRemoteZip(
  archiveUrl: string,
  options: {
    onLog?: RemoteZipLogger;
  } = {},
): Promise<CachedArchiveEntryDescriptor[]> {
  const logger = options.onLog ?? (() => {});
  logger("remote-zip: opening remote archive with zip.js HttpRangeReader.");

  const reader = new ZipReader(
    new HttpRangeReader(archiveUrl),
  );

  try {
    const rawEntries = await reader.getEntries();
    logger(`remote-zip: zip.js returned ${rawEntries.length} raw entr${rawEntries.length === 1 ? "y" : "ies"}.`);

    const entries = rawEntries
      .filter((entry) => !entry.directory)
      .map(mapEntry);

    logger(`remote-zip: enumerated ${entries.length} file entr${entries.length === 1 ? "y" : "ies"}.`);
    return entries;
  } finally {
    await reader.close();
    logger("remote-zip: zip.js reader closed.");
  }
}

function mapEntry(entry: Entry): CachedArchiveEntryDescriptor {
  const normalizedPath = normalizeEntryPath(entry.filename);

  return {
    identity: {
      localHeaderOffset: entry.offset,
      compressedSize: Math.max(0, entry.compressedSize),
      uncompressedSize: Math.max(0, entry.uncompressedSize),
      crc32: entry.signature,
      normalizedPath,
    },
    entryPath: normalizedPath,
    sizeBytes: Math.max(0, entry.uncompressedSize),
  };
}

function normalizeEntryPath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").replace(/^\/+/, "");
}
