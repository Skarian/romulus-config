export type RenameRule = {
  pattern: string;
  replacement: string;
};

export type SourceScopeDocument = {
  path: string;
  includeNestedFiles?: boolean;
};

export type SourceTorrentDocument = {
  url: string;
  partName?: string | null;
};

export type UnarchiveLayoutMode = "flat" | "dedicatedFolder";

export type UnarchiveLayoutDocument = {
  mode: UnarchiveLayoutMode;
  rename?: RenameRule;
};

export type UnarchiveDocument = {
  recursive?: boolean;
  layout: UnarchiveLayoutDocument;
};

export type IgnoreRulesDocument = {
  glob?: string[];
};

export type SourceEntryDocument = {
  displayName: string;
  subfolder: string;
  scope?: SourceScopeDocument;
  torrents: SourceTorrentDocument[];
  ignore?: IgnoreRulesDocument;
  rename?: RenameRule;
  unarchive?: UnarchiveDocument;
};

export type SourceDocument = {
  version: number;
  entries: SourceEntryDocument[];
};

export type NormalizedScope = {
  normalizedPath: string;
  includeNestedFiles: boolean;
  isArchiveSelection: boolean;
};

export type PreviewEntry = {
  id: string;
  hydrationKey: string;
  displayName: string;
  subfolder: string;
  scope: NormalizedScope;
  torrents: SourceTorrentDocument[];
  ignoreGlobs: string[];
  renameRule: RenameRule | null;
  unarchive: UnarchiveDocument | null;
  folderPreview: {
    directDownloadBase: string;
    archiveMode: "disabled" | "flat" | "dedicatedFolder";
    archiveModeSummary: string;
  };
};

export type HydrationLogLevel = "info" | "success" | "error";
export type HydrationLogVisibility = "basic" | "verbose";

export type HydrationLogEntry = {
  id: string;
  timestamp: string;
  level: HydrationLogLevel;
  visibility: HydrationLogVisibility;
  message: string;
};

export type HydrationSourceStatus = "missing" | "ready" | "preparing" | "error";

export type HydrationSourceState = {
  mode: "standard" | "archive";
  status: HydrationSourceStatus;
  updatedAt: string | null;
  fileCount: number;
  statusLabel: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
};

export type HydrationState = {
  lastHydratedAt: string | null;
  missingSourceIds: string[];
  running: boolean;
  apiKeyConfigured: boolean;
  logs: HydrationLogEntry[];
  sourceStates: Record<string, HydrationSourceState>;
};

export type ValidationIssue = {
  kind:
    | "json"
    | "schema"
    | "runtime-invalid-version"
    | "runtime-invalid-subfolder"
    | "runtime-invalid-path"
    | "runtime-invalid-scope"
    | "runtime-invalid-ignore-rule"
    | "runtime-invalid-rename-rule";
  message: string;
};

export type SourceFileRow = {
  id: string;
  originalName: string;
  relativePath: string;
  sizeBytes: number | null;
  partLabel: string | null;
  isArchiveCandidate: boolean;
  kind: "standard" | "archive";
};

export type PreviewFixtureSample = {
  id: string;
  originalName: string;
  relativeDirectory: string;
  outputNameOverride: string | null;
};

export type PreviewFixture = {
  fixtureKey: string;
  sourceFileId: string | null;
  archiveDisplayName: string;
  archiveBaseName: string;
  samples: PreviewFixtureSample[];
  updatedAt: string;
};

export type SourceFilesState = {
  entryId: string;
  sourceStatus: HydrationSourceStatus;
  sourceMode: "standard" | "archive";
  updatedAt: string | null;
  statusLabel: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  outerArchiveName: string | null;
  previewFixtures: PreviewFixture[];
  selectedRowIds?: string[];
  files: SourceFileRow[];
};

export type SimulatorState =
  | {
      status: "missing";
      generatedAt: string;
      configPath: string;
      schemaPath: string;
      cachePath: string;
      issues: ValidationIssue[];
      entries: PreviewEntry[];
      notes: string[];
      hydration: HydrationState;
    }
  | {
      status: "invalid";
      generatedAt: string;
      configPath: string;
      schemaPath: string;
      cachePath: string;
      issues: ValidationIssue[];
      entries: PreviewEntry[];
      notes: string[];
      hydration: HydrationState;
    }
  | {
      status: "accepted";
      generatedAt: string;
      configPath: string;
      schemaPath: string;
      cachePath: string;
      issues: ValidationIssue[];
      entries: PreviewEntry[];
      notes: string[];
      hydration: HydrationState;
    };
