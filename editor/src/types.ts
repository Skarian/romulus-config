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
  $schema?: string;
  version: number;
  entries: SourceEntryDocument[];
};

export type NormalizedScope = {
  normalizedPath: string;
  includeNestedFiles: boolean;
  isArchiveSelection: boolean;
};

export type SourceContentBoundaryIdentity = {
  normalizedPath: string;
  normalizedTorrentUrls: string[];
  key: string;
};

export type SourceHydrationIdentity = {
  mode: "standard" | "archive";
  key: string;
};

export type SessionSourceReference = string;

export type PreviewEntry = {
  id: string;
  hydrationKey: string;
  selectionStateKey: string;
  displayName: string;
  subfolder: string;
  scope: NormalizedScope;
  torrents: SourceTorrentDocument[];
  ignoreGlobs: string[];
  renameRule: RenameRule | null;
  unarchive: UnarchiveDocument | null;
  identity: SourceContentBoundaryIdentity;
  hydration: SourceHydrationIdentity;
  folderPreview: {
    directDownloadBase: string;
    archiveMode: "disabled" | "flat" | "dedicatedFolder";
    archiveModeSummary: string;
  };
};

export type SourceFilesRequest = {
  hydrationKey: string;
  selectionStateKey: string;
  legacyEntryId?: string;
  scope: NormalizedScope;
  ignoreGlobs: string[];
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

export type HydrationRunOutcome = "success" | "mixed" | "failed";

export type HydrationRunSummary = {
  runId: number;
  startedAt: string;
  finishedAt: string;
  sourceCount: number;
  successCount: number;
  failureCount: number;
  outcome: HydrationRunOutcome;
  errorMessage: string | null;
};

export type ClearLocalDataSelection = {
  fileCache: boolean;
  savedSelections: boolean;
  savedPreviewData: boolean;
  updateLogs: boolean;
};

export type ClearLocalDataResult = {
  cleared: ClearLocalDataSelection;
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
  lastRun?: HydrationRunSummary | null;
  missingSourceIds: string[];
  running: boolean;
  apiKeyConfigured: boolean;
  logs: HydrationLogEntry[];
  sourceStates: Record<string, HydrationSourceState>;
};

export type BlockedIssueFamily =
  | "invalid-source-json"
  | "unsupported-editor-features"
  | "duplicate-sources";

export type BlockedIssueHeading =
  | "Invalid source.json"
  | "Unsupported editor features"
  | "Duplicate sources";

export type BlockedDocumentIssueCode =
  | "json-parse"
  | "schema"
  | "unsupported-version"
  | "unsupported-include-nested-files"
  | "unsupported-recursive-unarchive"
  | "duplicate-source";

export type BlockedDocumentIssue = {
  family: BlockedIssueFamily;
  heading: BlockedIssueHeading;
  code: BlockedDocumentIssueCode;
  message: string;
};

export type BlockedIssueGroup = {
  family: BlockedIssueFamily;
  heading: BlockedIssueHeading;
  issues: BlockedDocumentIssue[];
};

export type BlockedDocumentState = {
  title: "Editor Unavailable";
  body: "This editor cannot open the current source.json until the issues below are fixed. Edit source.json directly, then reload.";
  groups: BlockedIssueGroup[];
};

export type RepairableValidationIssueCode =
  | "invalid-ignore-rule"
  | "invalid-rename-rule"
  | "invalid-dedicated-folder-rename-rule";

export type RepairableValidationIssue = {
  code: RepairableValidationIssueCode;
  sourceId: string;
  sourceName: string;
  fieldPath: "ignore.glob" | "rename" | "unarchive.layout.rename";
  message: string;
};

export type SaveBlocker = {
  code:
    | "schema"
    | "unsupported-version"
    | "unsupported-editor-feature"
    | "duplicate-source"
    | "repairable-validation";
  message: string;
  sourceId?: string;
  sourceName?: string;
};

export type SaveReadiness =
  | {
      status: "ready";
      blockers: [];
    }
  | {
      status: "blocked";
      blockers: SaveBlocker[];
    };

export type RepairableValidationSnapshot = {
  issues: RepairableValidationIssue[];
  issuesBySourceId: Record<string, RepairableValidationIssue[]>;
  saveReadiness: SaveReadiness;
};

export type EditableDocumentState = {
  sourceDocument: SourceDocument;
  validation: RepairableValidationSnapshot;
};

export type SourceDocumentSavePreview = {
  checksum: string;
  document: SourceDocument;
  text: string;
};

export type SourceDocumentSavePreparationResult =
  | {
      status: "ready";
      preview: SourceDocumentSavePreview;
      validation: RepairableValidationSnapshot;
    }
  | {
      status: "blocked";
      blockers: SaveBlocker[];
      validation: RepairableValidationSnapshot;
    };

export type SourceDocumentLoadResultBase = {
  configPath: string;
  schemaPath: string;
  diskFingerprint: string | null;
};

export type BlockedSourceDocumentLoadResult = SourceDocumentLoadResultBase & {
  status: "blocked";
  blocked: BlockedDocumentState;
  entries: PreviewEntry[];
};

export type EditableSourceDocumentLoadResult = SourceDocumentLoadResultBase & {
  status: "editable";
  editable: EditableDocumentState;
  entries: PreviewEntry[];
};

export type SourceDocumentLoadResult =
  | BlockedSourceDocumentLoadResult
  | EditableSourceDocumentLoadResult;

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
  hydrationKey: string;
  selectionStateKey: string;
  entryId?: string | null;
  sourceStatus: HydrationSourceStatus;
  sourceMode: "standard" | "archive";
  updatedAt: string | null;
  statusLabel: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  outerArchiveName: string | null;
  archiveSampleExtensions: string[];
  previewFixtures: PreviewFixture[];
  analysisFiles?: SourceFileRow[];
  analysisOriginalNames?: string[];
  scopedOutFileCount?: number;
  selectedRowIds?: string[];
  files: SourceFileRow[];
};

type EditorStateBase = {
  generatedAt: string;
  configPath: string;
  schemaPath: string;
  cachePath: string;
  notes: string[];
  diskFingerprint: string | null;
  hydration: HydrationState;
};

export type EditorState =
  | (EditorStateBase & {
      status: "blocked";
      blocked: BlockedDocumentState;
      editable: null;
      entries: PreviewEntry[];
    })
  | (EditorStateBase & {
      status: "editable";
      blocked: null;
      editable: EditableDocumentState;
      entries: PreviewEntry[];
    });
