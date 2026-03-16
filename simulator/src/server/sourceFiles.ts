import type { PreviewEntry, SourceFileRow } from "../types";
import { isSupportedArchiveName } from "../archiveSupport";
import { compileIgnoreMatcher } from "../ignoreRules";
import type {
  CachedArchiveEntryDescriptor,
  CachedProviderFileRecord,
} from "./cacheDb";
import { normalizeProviderPath } from "./realDebrid";

export function buildStandardSourceFiles(
  entry: PreviewEntry,
  files: CachedProviderFileRecord[],
): SourceFileRow[] {
  const matcher = compileIgnoreMatcher(entry.ignoreGlobs);
  return files
    .filter((file) => matchesScope(entry, normalizeProviderPath(file.path)))
    .filter((file) => !matcher(file.originalName))
    .map((file) => ({
      id: file.providerFileId,
      originalName: file.originalName,
      relativePath: `/${normalizeProviderPath(file.path)}`,
      sizeBytes: file.sizeBytes,
      partLabel: file.partLabel,
      isArchiveCandidate: isArchiveCandidate(file.originalName),
      kind: "standard" as const,
    }))
    .sort((left, right) => left.originalName.localeCompare(right.originalName));
}

export function buildArchiveSourceFiles(
  entry: PreviewEntry,
  files: CachedArchiveEntryDescriptor[],
): SourceFileRow[] {
  const matcher = compileIgnoreMatcher(entry.ignoreGlobs);
  return files
    .filter((file) => !matcher(basename(file.entryPath)))
    .map((file) => ({
      id: archiveEntryId(file),
      originalName: basename(file.entryPath),
      relativePath: `/${file.entryPath}`,
      sizeBytes: file.sizeBytes,
      partLabel: null,
      isArchiveCandidate: isArchiveCandidate(file.entryPath),
      kind: "archive" as const,
    }))
    .sort((left, right) => left.originalName.localeCompare(right.originalName));
}

export function isArchiveCandidate(pathValue: string): boolean {
  return isSupportedArchiveName(pathValue);
}

function matchesScope(entry: PreviewEntry, normalizedPath: string): boolean {
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
