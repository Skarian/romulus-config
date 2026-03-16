import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { buildPreviewEntries, validateRuntime } from "./runtimeValidation";
import type {
  HydrationState,
  SimulatorState,
  SourceDocument,
  ValidationIssue,
} from "./types";

export function buildSimulatorState(
  repoRoot: string,
  hydrationInput?: Partial<HydrationState>,
): SimulatorState {
  const configPath = path.join(repoRoot, "source.json");
  const schemaPath = path.join(
    repoRoot,
    "references/romulus/docs/schema.json",
  );
  const cachePath = path.join(repoRoot, "simulator/.local");
  const generatedAt = new Date().toISOString();
  const notes = [
    "Config changes are watched directly from source.json.",
    "File lists are loaded locally through the simulator dev server.",
    `The local simulator database lives under ${cachePath}.`,
  ];
  const baseHydration: HydrationState = {
    lastHydratedAt: null,
    missingSourceIds: [],
    running: hydrationInput?.running ?? false,
    apiKeyConfigured: hydrationInput?.apiKeyConfigured ?? false,
    logs: hydrationInput?.logs ?? [],
    sourceStates: hydrationInput?.sourceStates ?? {},
  };

  if (!existsSync(configPath)) {
    return {
      status: "missing",
      generatedAt,
      configPath,
      schemaPath,
      cachePath,
      issues: [
        {
          kind: "json",
          message:
            "source.json is missing. Add or restore it at the repo root to use the simulator.",
        },
      ],
      entries: [],
      notes,
      hydration: baseHydration,
    };
  }

  const rawDocument = readText(configPath);
  let parsedDocument: SourceDocument;
  try {
    parsedDocument = JSON.parse(rawDocument) as SourceDocument;
  } catch (error) {
    return {
      status: "invalid",
      generatedAt,
      configPath,
      schemaPath,
      cachePath,
      issues: [
        {
          kind: "json",
          message:
            error instanceof Error
              ? error.message
              : "source.json is not valid JSON.",
        },
      ],
      entries: [],
      notes,
      hydration: baseHydration,
    };
  }

  const schemaIssues = validateSchema(schemaPath, parsedDocument);
  if (schemaIssues.length > 0) {
    return {
      status: "invalid",
      generatedAt,
      configPath,
      schemaPath,
      cachePath,
      issues: schemaIssues,
      entries: [],
      notes,
      hydration: baseHydration,
    };
  }

  const runtimeIssues = validateRuntime(parsedDocument);
  const entries = buildPreviewEntries(parsedDocument);
  const hydration = {
    ...baseHydration,
    missingSourceIds:
      hydrationInput?.missingSourceIds ?? entries.map((entry) => entry.id),
  };

  if (runtimeIssues.length > 0) {
    return {
      status: "invalid",
      generatedAt,
      configPath,
      schemaPath,
      cachePath,
      issues: runtimeIssues,
      entries,
      notes,
      hydration,
    };
  }

  return {
    status: "accepted",
    generatedAt,
    configPath,
    schemaPath,
    cachePath,
    issues: [],
    entries,
    notes,
    hydration,
  };
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

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}
