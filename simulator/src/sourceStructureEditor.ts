import { normalizeDeclaredPath, normalizeScope } from "./runtimeValidation";
import type { SourceDocument, SourceEntryDocument } from "./types";

export type SourceStructureDraftTorrent = {
  url: string;
  partName: string;
};

export type SourceStructureDraft = {
  displayName: string;
  subfolder: string;
  scopePath: string;
  torrents: SourceStructureDraftTorrent[];
};

export type SourceStructureValidation = {
  displayNameError: string | null;
  subfolderError: string | null;
  scopePathError: string | null;
  torrentErrors: Array<{
    urlError: string | null;
    partNameError: string | null;
  }>;
  duplicateError: string | null;
  valid: boolean;
};

export function createBlankSourceStructureDraft(): SourceStructureDraft {
  return {
    displayName: "",
    subfolder: "",
    scopePath: "/",
    torrents: [
      {
        url: "",
        partName: "",
      },
    ],
  };
}

export function createSourceStructureDraftFromEntry(
  entry: SourceEntryDocument,
): SourceStructureDraft {
  return {
    displayName: entry.displayName,
    subfolder: entry.subfolder,
    scopePath: normalizeScope(entry.scope)?.normalizedPath ?? "/",
    torrents:
      entry.torrents.length > 0
        ? entry.torrents.map((torrent) => ({
            url: torrent.url,
            partName: torrent.partName ?? "",
          }))
        : createBlankSourceStructureDraft().torrents,
  };
}

export function validateSourceStructureDraft(
  document: SourceDocument,
  draft: SourceStructureDraft,
  options: {
    excludeIndex?: number;
  } = {},
): SourceStructureValidation {
  const displayNameError =
    draft.displayName.trim().length === 0 ? "Display name is required." : null;
  const subfolderError =
    draft.subfolder.trim().length === 0 ? "Subfolder is required." : null;
  const normalizedScopePath = normalizeDeclaredPath(draft.scopePath);
  const scopePathError = normalizedScopePath ? null : "Scope is required and must be a valid path.";
  const torrentErrors = draft.torrents.map((torrent) => ({
    urlError: torrent.url.trim().length === 0 ? "Magnet URL is required." : null,
    partNameError: torrent.partName.trim().length === 0 ? "Part name is required." : null,
  }));
  const hasTorrentErrors = torrentErrors.some(
    (error) => error.urlError !== null || error.partNameError !== null,
  );
  const duplicateError =
    displayNameError ||
    subfolderError ||
    scopePathError ||
    hasTorrentErrors
      ? null
      : findDuplicateError(document, draft, normalizedScopePath ?? "/", options.excludeIndex);

  return {
    displayNameError,
    subfolderError,
    scopePathError,
    torrentErrors,
    duplicateError,
    valid:
      displayNameError === null &&
      subfolderError === null &&
      scopePathError === null &&
      !hasTorrentErrors &&
      duplicateError === null,
  };
}

export function buildSourceEntryFromStructureDraft(
  draft: SourceStructureDraft,
  existingEntry?: SourceEntryDocument | null,
): SourceEntryDocument {
  const normalizedScopePath = normalizeDeclaredPath(draft.scopePath) ?? "/";
  const nextEntry: SourceEntryDocument = {
    displayName: draft.displayName.trim(),
    subfolder: draft.subfolder.trim(),
    torrents: draft.torrents.map((torrent) => ({
      url: torrent.url.trim(),
      partName: torrent.partName.trim(),
    })),
  };

  if (normalizedScopePath !== "/") {
    nextEntry.scope = {
      path: normalizedScopePath,
    };
  }

  if (existingEntry?.ignore) {
    nextEntry.ignore = JSON.parse(JSON.stringify(existingEntry.ignore));
  }
  if (existingEntry?.rename) {
    nextEntry.rename = JSON.parse(JSON.stringify(existingEntry.rename));
  }
  if (existingEntry?.unarchive) {
    nextEntry.unarchive = JSON.parse(JSON.stringify(existingEntry.unarchive));
  }

  return nextEntry;
}

function findDuplicateError(
  document: SourceDocument,
  draft: SourceStructureDraft,
  normalizedScopePath: string,
  excludeIndex?: number,
) {
  const candidateUrls = normalizeDraftTorrentUrls(draft);
  for (const [entryIndex, entry] of document.entries.entries()) {
    if (entryIndex === excludeIndex) {
      continue;
    }
    const entryScopePath = normalizeScope(entry.scope)?.normalizedPath ?? "/";
    if (entryScopePath !== normalizedScopePath) {
      continue;
    }
    const sharedUrl = normalizeDraftTorrentUrls({
      displayName: entry.displayName,
      subfolder: entry.subfolder,
      scopePath: entryScopePath,
      torrents: entry.torrents.map((torrent) => ({
        url: torrent.url,
        partName: torrent.partName ?? "",
      })),
    }).find((url) => candidateUrls.includes(url));
    if (!sharedUrl) {
      continue;
    }
    return `This source would duplicate "${entry.displayName}" because they share a magnet URL and the same scope.`;
  }
  return null;
}

function normalizeDraftTorrentUrls(draft: SourceStructureDraft) {
  return Array.from(
    new Set(
      draft.torrents
        .map((torrent) => torrent.url.trim())
        .filter((url) => url.length > 0),
    ),
  ).sort();
}
