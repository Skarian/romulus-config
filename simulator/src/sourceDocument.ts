import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  buildPreviewEntries,
  buildRepairableValidationSnapshot,
  findDuplicateSourceIssues,
  findUnsupportedFeatureIssues,
  normalizeScope,
} from "./runtimeValidation";
import type {
  BlockedDocumentIssue,
  BlockedDocumentState,
  BlockedIssueFamily,
  BlockedIssueGroup,
  SourceDocument,
  SourceDocumentLoadResult,
} from "./types";
import { hashHex } from "./stableHash";
import {
  normalizeSourceDocumentForSave,
  prepareSourceDocumentSave as prepareSharedSourceDocumentSave,
  serializeSourceDocument,
} from "./sourceDocumentSave";

const BLOCKED_PANEL_TITLE = "Editor Unavailable" as const;
const BLOCKED_PANEL_BODY =
  "This editor cannot open the current source.json until the issues below are fixed. Edit source.json directly, then reload." as const;
const BLOCKED_FAMILY_ORDER: BlockedIssueFamily[] = [
  "invalid-source-json",
  "unsupported-editor-features",
  "duplicate-sources",
];

export function getSourceDocumentPaths(repoRoot: string) {
  return {
    configPath: path.join(repoRoot, "source.json"),
    schemaPath: path.join(repoRoot, "references/romulus/docs/schema.json"),
  };
}

export function readSourceDocument(repoRoot: string) {
  const { configPath, schemaPath } = getSourceDocumentPaths(repoRoot);
  const rawText = readText(configPath);
  return {
    configPath,
    schemaPath,
    rawText,
    diskFingerprint: hashText(rawText),
    rawDocument: JSON.parse(rawText) as SourceDocument,
  };
}

export function loadSourceDocument(repoRoot: string): SourceDocumentLoadResult {
  const { configPath, schemaPath } = getSourceDocumentPaths(repoRoot);
  if (!existsSync(configPath)) {
    return buildBlockedLoadResult(configPath, schemaPath, null, [
      invalidSourceJsonIssue("schema", "source.json does not match the required Romulus format."),
    ]);
  }

  const rawText = readText(configPath);
  const diskFingerprint = hashText(rawText);
  let rawDocument: SourceDocument;
  try {
    rawDocument = JSON.parse(rawText) as SourceDocument;
  } catch {
    return buildBlockedLoadResult(configPath, schemaPath, diskFingerprint, [
      invalidSourceJsonIssue("json-parse", "source.json could not be parsed as valid JSON."),
    ]);
  }

  if (!isSchemaValid(schemaPath, rawDocument)) {
    return buildBlockedLoadResult(configPath, schemaPath, diskFingerprint, [
      invalidSourceJsonIssue("schema", "source.json does not match the required Romulus format."),
    ]);
  }

  if (rawDocument.version !== 1) {
    return buildBlockedLoadResult(configPath, schemaPath, diskFingerprint, [
      invalidSourceJsonIssue(
        "unsupported-version",
        `source.json version "${String(rawDocument.version)}" is not supported.`,
      ),
    ]);
  }

  const entries = buildPreviewEntries(rawDocument);
  const blockedIssues = [
    ...findUnsupportedFeatureIssues(rawDocument),
    ...findDuplicateSourceIssues(rawDocument, entries),
  ];
  if (blockedIssues.length > 0) {
    return buildBlockedLoadResult(configPath, schemaPath, diskFingerprint, blockedIssues);
  }

  return {
    status: "editable",
    configPath,
    schemaPath,
    diskFingerprint,
    editable: {
      sourceDocument: rawDocument,
      validation: buildRepairableValidationSnapshot(rawDocument, entries),
    },
    entries,
  };
}

export function prepareSourceDocumentSave(
  _schemaPath: string,
  document: SourceDocument,
) {
  return prepareSharedSourceDocumentSave(document);
}

export { normalizeSourceDocumentForSave, serializeSourceDocument };

export function commitSourceDocumentSavePreview(
  configPath: string,
  preview: {
    checksum: string;
    text: string;
  },
) {
  if (hashText(preview.text) !== preview.checksum) {
    throw new Error("Save preview checksum did not match the preview text.");
  }

  writeTextAtomic(configPath, preview.text);
}

function buildBlockedLoadResult(
  configPath: string,
  schemaPath: string,
  diskFingerprint: string | null,
  issues: BlockedDocumentIssue[],
): SourceDocumentLoadResult {
  return {
    status: "blocked",
    configPath,
    schemaPath,
    diskFingerprint,
    blocked: {
      title: BLOCKED_PANEL_TITLE,
      body: BLOCKED_PANEL_BODY,
      groups: groupBlockedIssues(issues),
    },
    entries: [],
  };
}

function groupBlockedIssues(issues: BlockedDocumentIssue[]): BlockedIssueGroup[] {
  const groupedIssues = new Map<BlockedIssueFamily, BlockedIssueGroup>();

  for (const family of BLOCKED_FAMILY_ORDER) {
    const familyIssues = issues.filter((issue) => issue.family === family);
    if (familyIssues.length === 0) {
      continue;
    }
    groupedIssues.set(family, {
      family,
      heading: familyIssues[0]?.heading ?? "Invalid source.json",
      issues: familyIssues,
    });
  }

  return BLOCKED_FAMILY_ORDER.flatMap((family) => {
    const group = groupedIssues.get(family);
    return group ? [group] : [];
  });
}

function invalidSourceJsonIssue(
  code: "json-parse" | "schema" | "unsupported-version",
  message: string,
): BlockedDocumentIssue {
  return {
    family: "invalid-source-json",
    heading: "Invalid source.json",
    code,
    message,
  };
}

function isSchemaValid(schemaPath: string, document: SourceDocument) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });

  const schemaText = readText(schemaPath);
  const validate = ajv.compile(JSON.parse(schemaText));
  return validate(document);
}

function writeTextAtomic(configPath: string, text: string) {
  const tempPath = `${configPath}.tmp`;
  writeFileSync(tempPath, text, "utf8");
  renameSync(tempPath, configPath);
}

function readText(filePath: string) {
  return readFileSync(filePath, "utf8");
}

function hashText(value: string) {
  return hashHex(value);
}
