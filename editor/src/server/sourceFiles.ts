import type { PreviewEntry, SourceFileRow } from "../types";
import { isSupportedArchiveName } from "../archiveSupport";
import { compileIgnoreMatcher } from "../ignoreRules";
import type {
  CachedArchiveEntryDescriptor,
  CachedProviderFileRecord,
} from "./cacheDb";
import { normalizeProviderPath } from "./realDebrid";

export function buildStandardSourceFiles(
  entry: Pick<PreviewEntry, "scope" | "ignoreGlobs">,
  files: CachedProviderFileRecord[],
): SourceFileRow[] {
  return filterIgnoredSourceFiles(
    buildScopedStandardSourceFiles(entry, files),
    entry.ignoreGlobs,
  );
}

export function buildScopedStandardSourceFiles(
  entry: Pick<PreviewEntry, "scope">,
  files: CachedProviderFileRecord[],
): SourceFileRow[] {
  return sortSourceFilesByOriginalName(
    files
      .filter((file) => matchesScope(entry, normalizeProviderPath(file.path)))
      .map((file) => ({
        id: file.providerFileId,
        originalName: file.originalName,
        relativePath: `/${normalizeProviderPath(file.path)}`,
        sizeBytes: file.sizeBytes,
        partLabel: file.partLabel,
        isArchiveCandidate: isArchiveCandidate(file.originalName),
        kind: "standard" as const,
      })),
  );
}

export function listStandardSourceOriginalNames(
  entry: Pick<PreviewEntry, "scope">,
  files: CachedProviderFileRecord[],
) {
  return buildScopedStandardSourceFiles(entry, files).map((file) => file.originalName);
}

export function buildArchiveSourceFiles(
  entry: Pick<PreviewEntry, "ignoreGlobs">,
  files: CachedArchiveEntryDescriptor[],
): SourceFileRow[] {
  return filterIgnoredSourceFiles(
    buildScopedArchiveSourceFiles(files),
    entry.ignoreGlobs,
  );
}

export function buildScopedArchiveSourceFiles(
  files: CachedArchiveEntryDescriptor[],
): SourceFileRow[] {
  return sortSourceFilesByOriginalName(
    files.map((file) => ({
      id: archiveEntryId(file),
      originalName: basename(file.entryPath),
      relativePath: `/${file.entryPath}`,
      sizeBytes: file.sizeBytes,
      partLabel: null,
      isArchiveCandidate: isArchiveCandidate(file.entryPath),
      kind: "archive" as const,
    })),
  );
}

export function listArchiveSourceOriginalNames(
  files: CachedArchiveEntryDescriptor[],
) {
  return buildScopedArchiveSourceFiles(files).map((file) => file.originalName);
}

export function isArchiveCandidate(pathValue: string): boolean {
  return isSupportedArchiveName(pathValue);
}

function matchesScope(entry: Pick<PreviewEntry, "scope">, normalizedPath: string): boolean {
  const scopePath = entry.scope.normalizedPath.replace(/^\/+/, "");
  if (entry.scope.normalizedPath === "/") {
    return entry.scope.includeNestedFiles || !normalizedPath.includes("/");
  }

  const scopePrefix = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  if (!normalizedPath.startsWith(scopePrefix)) {
    return false;
  }
  if (entry.scope.includeNestedFiles) {
    return true;
  }

  const remainder = normalizedPath.slice(scopePrefix.length);
  return !remainder.includes("/");
}

function basename(pathValue: string): string {
  const segments = pathValue.split("/");
  return segments[segments.length - 1] || pathValue;
}

function archiveEntryId(entry: CachedArchiveEntryDescriptor): string {
  return [
    entry.identity.localHeaderOffset,
    entry.identity.compressedSize,
    entry.identity.uncompressedSize,
    entry.identity.crc32,
    entry.identity.normalizedPath,
  ].join(":");
}

function filterIgnoredSourceFiles(sourceFiles: SourceFileRow[], ignoreGlobs: string[]) {
  const matcher = compileIgnoreMatcher(ignoreGlobs);
  return sourceFiles.filter((file) => !matcher(file.originalName));
}

function sortSourceFilesByOriginalName(sourceFiles: SourceFileRow[]) {
  return sourceFiles
    .map((file, index) => ({
      file,
      index,
      normalizedName: file.originalName.toLowerCase(),
    }))
    .sort((left, right) => {
      const nameComparison = left.normalizedName.localeCompare(right.normalizedName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.index - right.index;
    })
    .map(({ file }) => file);
}
