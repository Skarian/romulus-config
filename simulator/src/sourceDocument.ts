import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { validateRuntime } from "./runtimeValidation";
import type { SourceDocument, ValidationIssue } from "./types";

export function getSourceDocumentPaths(repoRoot: string) {
  return {
    configPath: path.join(repoRoot, "source.json"),
    schemaPath: path.join(repoRoot, "references/romulus/docs/schema.json"),
  };
}

export function sourceDocumentExists(repoRoot: string) {
  return existsSync(getSourceDocumentPaths(repoRoot).configPath);
}

export function readSourceDocument(repoRoot: string) {
  const { configPath, schemaPath } = getSourceDocumentPaths(repoRoot);
  const rawText = readText(configPath);
  return {
    configPath,
    schemaPath,
    rawText,
    rawDocument: JSON.parse(rawText) as Record<string, unknown>,
  };
}

export function validateSourceDocument(document: SourceDocument, schemaPath: string) {
  const schemaIssues = validateSchema(schemaPath, document);
  if (schemaIssues.length > 0) {
    return schemaIssues;
  }

  return validateRuntime(document);
}

export function writeSourceDocumentAtomic(
  configPath: string,
  document: Record<string, unknown>,
) {
  const nextText = `${JSON.stringify(document, null, 2)}\n`;
  const tempPath = `${configPath}.tmp`;
  writeFileSync(tempPath, nextText, "utf8");
  renameSync(tempPath, configPath);
}

function validateSchema(
  schemaPath: string,
  document: SourceDocument,
): ValidationIssue[] {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });

  const schemaText = readText(schemaPath);
  const validate = ajv.compile(JSON.parse(schemaText));
  const valid = validate(document);

  if (valid) {
    return [];
  }

  return (validate.errors ?? []).map((error) => ({
    kind: "schema",
    message: `${error.instancePath || "/"} ${error.message ?? "Schema validation failed"}`.trim(),
  }));
}

function readText(filePath: string) {
  return readFileSync(filePath, "utf8");
}
