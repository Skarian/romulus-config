import { createHash } from "node:crypto";

import type {
  PreviewEntry,
  RenameRule,
  SourceDocument,
  SourceEntryDocument,
  SourceScopeDocument,
  ValidationIssue,
} from "./types";
import { isValidIgnoreRule } from "./ignoreRules";

const ROOT_PATH = "/";
const ZIP_SUFFIX = ".zip";

export function buildPreviewEntries(document: SourceDocument): PreviewEntry[] {
  return document.entries.map((entry, index) => {
    const scope = normalizeScope(entry.scope) ?? defaultScope();
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
      hydrationKey: stableHydrationKey(entry, scope.normalizedPath),
      displayName: entry.displayName,
      subfolder: entry.subfolder.trim(),
      scope,
      torrents: entry.torrents,
      ignoreGlobs,
      renameRule: entry.rename ?? null,
      unarchive: entry.unarchive ?? null,
      folderPreview: {
        directDownloadBase: joinPreviewPath(entry.subfolder.trim()),
        archiveMode,
        archiveModeSummary,
      },
    };
  });
}

export function validateRuntime(document: SourceDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (document.version !== 1) {
    issues.push({
      kind: "runtime-invalid-version",
      message: `Unsupported source version: ${document.version}.`,
    });
  }

  for (const entry of document.entries) {
    if (entry.subfolder.trim().length === 0) {
      issues.push({
        kind: "runtime-invalid-subfolder",
        message: `Invalid subfolder: ${entry.subfolder}.`,
      });
    }

    const normalizedScope = normalizeScope(entry.scope);
    if (normalizedScope === null) {
      issues.push({
        kind: "runtime-invalid-path",
        message: `Invalid path: ${entry.scope?.path ?? ""}.`,
      });
    } else if (
      normalizedScope.isArchiveSelection &&
      normalizedScope.includeNestedFiles
    ) {
      issues.push({
        kind: "runtime-invalid-scope",
        message: "Exact .zip scope cannot set includeNestedFiles to true.",
      });
    }

    for (const pattern of entry.ignore?.glob ?? []) {
      if (!isValidIgnoreRule(pattern)) {
        issues.push({
          kind: "runtime-invalid-ignore-rule",
          message: `Invalid ignore rule: ${pattern}.`,
        });
      }
    }

    const renameIssue = validateRenameRule(entry.rename, "Rename pattern is invalid");
    if (renameIssue) {
      issues.push(renameIssue);
    }

    const layoutRenameIssue = validateRenameRule(
      entry.unarchive?.layout.rename,
      "Dedicated-folder rename pattern is invalid",
    );
    if (layoutRenameIssue) {
      issues.push(layoutRenameIssue);
    }
  }

  return issues;
}

function validateRenameRule(
  rule: RenameRule | undefined,
  invalidPrefix: string,
): ValidationIssue | null {
  if (!rule) {
    return null;
  }

  if (rule.pattern.trim().length === 0 || rule.replacement.trim().length === 0) {
    return {
      kind: "runtime-invalid-rename-rule",
      message: `${invalidPrefix.replace("pattern is invalid", "rule requires both pattern and replacement")}.`,
    };
  }

  try {
    new RegExp(rule.pattern);
    return null;
  } catch (error) {
    const message =
      error instanceof Error && error.message.length > 0
        ? `${invalidPrefix}: ${error.message}`
        : `${invalidPrefix}.`;
    return {
      kind: "runtime-invalid-rename-rule",
      message,
    };
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
    String(entry.scope?.includeNestedFiles ?? false),
    ...entry.torrents.flatMap((torrent) => [torrent.url, torrent.partName ?? ""]),
  ].join("|");

  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function stableHydrationKey(
  entry: SourceEntryDocument,
  normalizedPath: string,
): string {
  const mode = normalizedPath.toLowerCase().endsWith(ZIP_SUFFIX)
    ? "archive"
    : "standard";
  const torrentUrls = entry.torrents
    .map((torrent) => torrent.url.trim())
    .sort()
    .join("|");
  const seed =
    mode === "archive"
      ? `${mode}|${torrentUrls}|${normalizedPath}`
      : `${mode}|${torrentUrls}`;

  return createHash("sha256").update(seed).digest("hex");
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

function normalizeScope(scope: SourceScopeDocument | undefined) {
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

function normalizeDeclaredPath(raw: string): string | null {
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
