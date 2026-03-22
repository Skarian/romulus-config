import type {
  BlockedDocumentIssue,
  PreviewEntry,
  RepairableValidationIssue,
  RepairableValidationSnapshot,
  RenameRule,
  SourceDocument,
  SourceEntryDocument,
  SourceScopeDocument,
} from "./types";
import { isValidIgnoreRule } from "./ignoreRules";
import { hashHex } from "./stableHash";

const ROOT_PATH = "/";
const ZIP_SUFFIX = ".zip";

export function buildPreviewEntries(document: SourceDocument): PreviewEntry[] {
  return document.entries.map((entry, index) => {
    const scope = normalizeScope(entry.scope) ?? defaultScope();
    const normalizedTorrentUrls = normalizeTorrentUrls(entry);
    const contentBoundaryKey = stableContentBoundaryKey(
      normalizedTorrentUrls,
      scope.normalizedPath,
    );
    const hydrationKey = stableHydrationKey(
      normalizedTorrentUrls,
      scope.normalizedPath,
    );
    const ignoreGlobs = (entry.ignore?.glob ?? [])
      .map((glob) => glob.trim())
      .filter((glob) => glob.length > 0);
    const archiveMode = entry.unarchive?.layout.mode ?? "disabled";
    const archiveModeSummary =
      archiveMode === "disabled"
        ? "Selected files are written directly into the entry subfolder."
        : archiveMode === "flat"
          ? "Extracted non-archive files land directly in the entry subfolder."
          : "Extracted files land inside one derived folder under the entry subfolder. The folder name comes from the selected archive stem unless a dedicated-folder rename rule overrides it.";

    return {
      id: stableEntryId(index, entry, scope.normalizedPath),
      hydrationKey,
      selectionStateKey: contentBoundaryKey,
      displayName: entry.displayName,
      subfolder: entry.subfolder.trim(),
      scope,
      torrents: entry.torrents,
      ignoreGlobs,
      renameRule: entry.rename ?? null,
      unarchive: entry.unarchive ?? null,
      identity: {
        normalizedPath: scope.normalizedPath,
        normalizedTorrentUrls,
        key: contentBoundaryKey,
      },
      hydration: {
        mode: scope.isArchiveSelection ? "archive" : "standard",
        key: hydrationKey,
      },
      folderPreview: {
        directDownloadBase: joinPreviewPath(entry.subfolder.trim()),
        archiveMode,
        archiveModeSummary,
      },
    };
  });
}

export function buildRepairableValidationSnapshot(
  document: SourceDocument,
  entries = buildPreviewEntries(document),
): RepairableValidationSnapshot {
  const issues = document.entries.flatMap((entry, index) =>
    validateEditableEntry(entry, entries[index]),
  );
  const issuesBySourceId: Record<string, RepairableValidationIssue[]> = {};

  for (const issue of issues) {
    issuesBySourceId[issue.sourceId] ??= [];
    issuesBySourceId[issue.sourceId]?.push(issue);
  }

  return {
    issues,
    issuesBySourceId,
    saveReadiness:
      issues.length === 0
        ? {
            status: "ready",
            blockers: [],
          }
        : {
            status: "blocked",
            blockers: issues.map((issue) => ({
              code: "repairable-validation" as const,
              message: issue.message,
              sourceId: issue.sourceId,
              sourceName: issue.sourceName,
            })),
          },
  };
}

export function findUnsupportedFeatureIssues(
  document: SourceDocument,
): BlockedDocumentIssue[] {
  return document.entries.flatMap((entry) => {
    const issues: BlockedDocumentIssue[] = [];
    if (entry.scope?.includeNestedFiles === true) {
      issues.push({
        family: "unsupported-editor-features",
        heading: "Unsupported editor features",
        code: "unsupported-include-nested-files",
        message: `Source "${entry.displayName}" uses Include nested files, which this editor does not support yet.`,
      });
    }
    if (entry.unarchive?.recursive === true) {
      issues.push({
        family: "unsupported-editor-features",
        heading: "Unsupported editor features",
        code: "unsupported-recursive-unarchive",
        message: `Source "${entry.displayName}" uses Recursive unarchive, which this editor does not support yet.`,
      });
    }
    return issues;
  });
}

export function findDuplicateSourceIssues(
  document: SourceDocument,
  entries = buildPreviewEntries(document),
): BlockedDocumentIssue[] {
  const issues: BlockedDocumentIssue[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }

    for (let candidateIndex = index + 1; candidateIndex < entries.length; candidateIndex += 1) {
      const candidate = entries[candidateIndex];
      if (!candidate) {
        continue;
      }

      if (entry.identity.normalizedPath !== candidate.identity.normalizedPath) {
        continue;
      }

      const sharedTorrentUrl = entry.identity.normalizedTorrentUrls.find((url) =>
        candidate.identity.normalizedTorrentUrls.includes(url),
      );
      if (!sharedTorrentUrl) {
        continue;
      }

      issues.push({
        family: "duplicate-sources",
        heading: "Duplicate sources",
        code: "duplicate-source",
        message: `Sources "${document.entries[index]?.displayName ?? entry.displayName}" and "${document.entries[candidateIndex]?.displayName ?? candidate.displayName}" are duplicates because they share a magnet URL and the same scope.`,
      });
    }
  }

  return issues;
}

export function normalizeScope(scope: SourceScopeDocument | undefined) {
  if (!scope) {
    return defaultScope();
  }

  const normalizedPath = normalizeDeclaredPath(scope.path);
  if (!normalizedPath) {
    return null;
  }

  return {
    normalizedPath,
    includeNestedFiles: scope.includeNestedFiles ?? false,
    isArchiveSelection: normalizedPath.toLowerCase().endsWith(ZIP_SUFFIX),
  };
}

export function normalizeDeclaredPath(raw: string): string | null {
  const trimmed = raw.trim();
  const candidate =
    trimmed.length === 0 || trimmed.includes("\\")
      ? null
      : trimmed === ROOT_PATH
        ? ROOT_PATH
        : trimmed.startsWith(ROOT_PATH)
          ? trimmed
          : `${ROOT_PATH}${trimmed}`;

  const hasTraversalSegments =
    candidate
      ?.split("/")
      .filter((segment) => segment.length > 0)
      .some((segment) => segment === "." || segment === "..") ?? false;

  if (!candidate || hasTraversalSegments) {
    return null;
  }

  if (candidate.endsWith("/")) {
    return candidate;
  }

  if (candidate.toLowerCase().endsWith(ZIP_SUFFIX)) {
    return candidate;
  }

  return null;
}

export function normalizeTorrentUrls(entry: Pick<SourceEntryDocument, "torrents">) {
  return Array.from(
    new Set(
      entry.torrents
        .map((torrent) => torrent.url.trim())
        .filter((url) => url.length > 0),
    ),
  ).sort();
}

function validateEditableEntry(
  entry: SourceEntryDocument,
  previewEntry: PreviewEntry | undefined,
): RepairableValidationIssue[] {
  if (!previewEntry) {
    return [];
  }

  const issues: RepairableValidationIssue[] = [];
  const normalizedIgnoreGlobs = (entry.ignore?.glob ?? [])
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0);
  for (const glob of normalizedIgnoreGlobs) {
    if (!isValidIgnoreRule(glob)) {
      issues.push({
        code: "invalid-ignore-rule",
        sourceId: previewEntry.id,
        sourceName: previewEntry.displayName,
        fieldPath: "ignore.glob",
        message: `Invalid ignore rule: ${glob}.`,
      });
    }
  }

  const renameIssue = validateRenameRule(entry.rename, "Rename pattern is invalid");
  if (renameIssue) {
    issues.push({
      code: "invalid-rename-rule",
      sourceId: previewEntry.id,
      sourceName: previewEntry.displayName,
      fieldPath: "rename",
      message: renameIssue,
    });
  }

  if (entry.unarchive?.layout.mode === "dedicatedFolder") {
    const dedicatedFolderRenameIssue = validateRenameRule(
      entry.unarchive.layout.rename,
      "Dedicated-folder rename pattern is invalid",
      "Dedicated-folder rename rule requires both pattern and replacement.",
    );
    if (dedicatedFolderRenameIssue) {
      issues.push({
        code: "invalid-dedicated-folder-rename-rule",
        sourceId: previewEntry.id,
        sourceName: previewEntry.displayName,
        fieldPath: "unarchive.layout.rename",
        message: dedicatedFolderRenameIssue,
      });
    }
  }

  return issues;
}

function validateRenameRule(
  rule: RenameRule | undefined,
  invalidPrefix: string,
  missingMessage = "Rename rule requires both pattern and replacement.",
): string | null {
  if (!rule) {
    return null;
  }

  if (rule.pattern.trim().length === 0 || rule.replacement.trim().length === 0) {
    return missingMessage;
  }

  try {
    new RegExp(rule.pattern);
    return null;
  } catch (error) {
    return error instanceof Error && error.message.length > 0
      ? `${invalidPrefix}: ${error.message}`
      : `${invalidPrefix}.`;
  }
}

function stableEntryId(
  index: number,
  entry: SourceEntryDocument,
  normalizedPath: string,
): string {
  const seed = [
    String(index),
    entry.displayName,
    entry.subfolder,
    normalizedPath,
    ...entry.torrents.flatMap((torrent) => [torrent.url.trim(), torrent.partName ?? ""]),
  ].join("|");

  return hashHex(seed).slice(0, 12);
}

function stableContentBoundaryKey(
  normalizedTorrentUrls: string[],
  normalizedPath: string,
): string {
  const seed = [...normalizedTorrentUrls, normalizedPath].join("|");
  return hashHex(seed);
}

function stableHydrationKey(
  normalizedTorrentUrls: string[],
  normalizedPath: string,
): string {
  const mode = normalizedPath.toLowerCase().endsWith(ZIP_SUFFIX)
    ? "archive"
    : "standard";
  const seed =
    mode === "archive"
      ? `${mode}|${normalizedTorrentUrls.join("|")}|${normalizedPath}`
      : `${mode}|${normalizedTorrentUrls.join("|")}`;

  return hashHex(seed);
}

function joinPreviewPath(...segments: string[]): string {
  const filtered = segments
    .flatMap((segment) => segment.split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return filtered.length === 0 ? "/" : `/${filtered.join("/")}`;
}

function defaultScope() {
  return {
    normalizedPath: ROOT_PATH,
    includeNestedFiles: false,
    isArchiveSelection: false,
  };
}
