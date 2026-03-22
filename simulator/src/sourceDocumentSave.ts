import Ajv2020 from "ajv/dist/2020.js";

import sourceSchema from "../../references/romulus/docs/schema.json";

import {
  buildPreviewEntries,
  buildRepairableValidationSnapshot,
  findDuplicateSourceIssues,
  findUnsupportedFeatureIssues,
  normalizeScope,
} from "./runtimeValidation";
import { hashHex } from "./stableHash";
import type {
  SourceDocument,
  SourceDocumentSavePreparationResult,
  SourceEntryDocument,
  SourceTorrentDocument,
  UnarchiveDocument,
} from "./types";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateBundledSchema = ajv.compile(sourceSchema);

export function prepareSourceDocumentSave(
  document: SourceDocument,
): SourceDocumentSavePreparationResult {
  const normalizedDocument = normalizeSourceDocumentForSave(document);

  if (!validateBundledSchema(normalizedDocument)) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "schema",
          message: "source.json does not match the required Romulus format.",
        },
      ],
      validation: emptyValidationSnapshot(),
    };
  }

  if (normalizedDocument.version !== 1) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "unsupported-version",
          message: `source.json version "${String(normalizedDocument.version)}" is not supported.`,
        },
      ],
      validation: emptyValidationSnapshot(),
    };
  }

  const entries = buildPreviewEntries(normalizedDocument);
  const unsupportedFeatureIssues = findUnsupportedFeatureIssues(normalizedDocument);
  const duplicateIssues = findDuplicateSourceIssues(normalizedDocument, entries);
  const validation = buildRepairableValidationSnapshot(normalizedDocument, entries);
  const blockers = [
    ...unsupportedFeatureIssues.map((issue) => ({
      code: "unsupported-editor-feature" as const,
      message: issue.message,
    })),
    ...duplicateIssues.map((issue) => ({
      code: "duplicate-source" as const,
      message: issue.message,
    })),
    ...validation.saveReadiness.blockers,
  ];

  if (blockers.length > 0) {
    return {
      status: "blocked",
      blockers,
      validation,
    };
  }

  const text = serializeSourceDocument(normalizedDocument);
  return {
    status: "ready",
    preview: {
      checksum: hashHex(text),
      document: normalizedDocument,
      text,
    },
    validation,
  };
}

export function serializeSourceDocument(document: SourceDocument) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function normalizeSourceDocumentForSave(document: SourceDocument): SourceDocument {
  const normalizedDocument: SourceDocument = {
    version: document.version,
    entries: document.entries.map((entry) => normalizeSourceEntry(entry)),
  };

  if (typeof document.$schema === "string" && document.$schema.length > 0) {
    return {
      $schema: document.$schema,
      version: normalizedDocument.version,
      entries: normalizedDocument.entries,
    };
  }

  return normalizedDocument;
}

function normalizeSourceEntry(entry: SourceEntryDocument): SourceEntryDocument {
  const normalizedEntry: SourceEntryDocument = {
    displayName: entry.displayName,
    subfolder: entry.subfolder,
    torrents: normalizeTorrents(entry.torrents),
  };

  if (entry.scope) {
    const normalizedScope = normalizeScope(entry.scope);
    normalizedEntry.scope = normalizedScope
      ? {
          path: normalizedScope.normalizedPath,
          ...(normalizedScope.includeNestedFiles ? { includeNestedFiles: true } : {}),
        }
      : {
          path: entry.scope.path,
          ...(entry.scope.includeNestedFiles ? { includeNestedFiles: true } : {}),
        };
  }

  const normalizedUnarchive = normalizeUnarchive(entry.unarchive);
  if (normalizedUnarchive) {
    normalizedEntry.unarchive = normalizedUnarchive;
  }

  const normalizedIgnoreGlobs = normalizeIgnoreGlobs(entry.ignore?.glob ?? []);
  if (normalizedIgnoreGlobs.length > 0) {
    normalizedEntry.ignore = {
      glob: normalizedIgnoreGlobs,
    };
  }

  if (entry.rename) {
    normalizedEntry.rename = {
      pattern: entry.rename.pattern,
      replacement: entry.rename.replacement,
    };
  }

  return reorderSourceEntry(normalizedEntry);
}

function reorderSourceEntry(entry: SourceEntryDocument): SourceEntryDocument {
  const orderedEntry = {
    displayName: entry.displayName,
    subfolder: entry.subfolder,
  } as SourceEntryDocument;

  if (entry.scope) {
    orderedEntry.scope = entry.scope;
  }
  if (entry.unarchive) {
    orderedEntry.unarchive = entry.unarchive;
  }
  if (entry.ignore) {
    orderedEntry.ignore = entry.ignore;
  }
  if (entry.rename) {
    orderedEntry.rename = entry.rename;
  }

  orderedEntry.torrents = entry.torrents;
  return orderedEntry;
}

function normalizeTorrents(torrents: SourceTorrentDocument[]): SourceTorrentDocument[] {
  return torrents.map((torrent) => {
    const normalizedTorrent: SourceTorrentDocument = {
      url: torrent.url,
    };
    if (typeof torrent.partName !== "undefined") {
      normalizedTorrent.partName = torrent.partName;
    }
    return normalizedTorrent;
  });
}

function normalizeUnarchive(unarchive: UnarchiveDocument | undefined) {
  if (!unarchive) {
    return undefined;
  }

  const layout =
    unarchive.layout.mode === "dedicatedFolder"
      ? {
          mode: "dedicatedFolder" as const,
          ...(unarchive.layout.rename
            ? {
                rename: {
                  pattern: unarchive.layout.rename.pattern,
                  replacement: unarchive.layout.rename.replacement,
                },
              }
            : {}),
        }
      : {
          mode: "flat" as const,
        };

  return {
    ...(unarchive.recursive ? { recursive: true } : {}),
    layout,
  };
}

function normalizeIgnoreGlobs(ignoreGlobs: string[]) {
  return Array.from(
    new Set(ignoreGlobs.map((glob) => glob.trim()).filter((glob) => glob.length > 0)),
  );
}

function emptyValidationSnapshot() {
  return {
    issues: [],
    issuesBySourceId: {},
    saveReadiness: {
      status: "ready" as const,
      blockers: [] as [],
    },
  };
}
