import fs from "node:fs";
import path from "node:path";

import { normalizeArchiveSampleExtensions } from "../archiveSamplePolicy";
import {
  analyzeParentheticalSuffixes,
  buildManagedRenameRule,
  detectManagedRenamePolicy,
} from "../policyAnalysis";
import { buildPreviewEntries } from "../runtimeValidation";
import { buildSimulatorState } from "../simulatorState";
import {
  readSourceDocument,
  validateSourceDocument,
  writeSourceDocumentAtomic,
} from "../sourceDocument";
import type {
  HydrationLogEntry,
  HydrationLogLevel,
  HydrationLogVisibility,
  PreviewFixture,
  PreviewFixtureSample,
  HydrationSourceState,
  PreviewEntry,
  SourceDocument,
  SimulatorState,
  SourceFilesState,
} from "../types";
import {
  createErrorCacheRow,
  createPreparingArchiveCacheRow,
  createReadyArchiveCacheRow,
  createReadyStandardCacheRow,
  isArchivePayload,
  isReadyStandardPayload,
  SimulatorCacheDb,
  type CachedProviderFileRecord,
  type SourceCacheRow,
} from "./cacheDb";
import {
  REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS,
  REAL_DEBRID_INTER_REQUEST_DELAY_MS,
  RealDebridClient,
  type AcquisitionStatus,
} from "./realDebrid";
import { enumerateRemoteZip } from "./remoteZip";
import {
  buildArchiveSourceFiles,
  buildScopedArchiveSourceFiles,
  buildScopedStandardSourceFiles,
  buildStandardSourceFiles,
} from "./sourceFiles";

type BackendEvent = {
  type: "state";
} | {
  type: "config-updated";
};

type BackendSubscriber = (event: BackendEvent) => void;

export type SourceEntryPolicyUpdateInput = {
  entryId: string;
  selectionStateKey: string;
  displayName: string;
  subfolder: string;
  renamePolicy?: {
    mode: "none" | "all" | "phrases";
    phrases: string[];
  };
  ignoreGlobs?: string[];
  confirmReplaceCustomRename?: boolean;
};

export type SourceEntryPolicyUpdateResult =
  | {
      status: "ok";
    }
  | {
      status: "needs-confirmation";
      kind: "custom-rename";
      error: string;
    };

const MAX_LOGS = 300;

class RetryableArchiveHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableArchiveHydrationError";
  }
}

export class SimulatorBackend {
  private readonly cacheDb: SimulatorCacheDb;
  private readonly subscribers = new Set<BackendSubscriber>();
  private readonly logEntries: HydrationLogEntry[] = [];
  private hydrationRunning = false;
  private currentRunPromise: Promise<void> | null = null;

  constructor(
    private readonly repoRoot: string,
    private readonly apiKey: string,
  ) {
    this.cacheDb = new SimulatorCacheDb(
      path.join(repoRoot, "simulator/.local/cache.db"),
    );
  }

  buildState(): SimulatorState {
    const baseState = buildSimulatorState(this.repoRoot, {
      running: this.hydrationRunning,
      apiKeyConfigured: this.apiKey.trim().length > 0,
      logs: [...this.logEntries],
    });
    const sourceStates: Record<string, HydrationSourceState> = {};
    const missingSourceIds: string[] = [];

    for (const entry of baseState.entries) {
      const cached = this.cacheDb.getSourceCache(entry.hydrationKey);
      if (!cached) {
        missingSourceIds.push(entry.id);
        sourceStates[entry.id] = {
          mode: entry.scope.isArchiveSelection ? "archive" : "standard",
          status: "missing",
          updatedAt: null,
          fileCount: 0,
          statusLabel: null,
          progressPercent: null,
          errorMessage: null,
        };
        continue;
      }

      sourceStates[entry.id] = {
        mode: cached.mode,
        status: cached.status,
        updatedAt: cached.updatedAt,
        fileCount: countCachedFiles(cached),
        statusLabel: cached.statusLabel,
        progressPercent: cached.progressPercent,
        errorMessage: cached.errorMessage,
      };
    }

    return {
      ...baseState,
      hydration: {
        lastHydratedAt: this.cacheDb.getLatestFinishedHydrationAt(),
        missingSourceIds,
        running: this.hydrationRunning,
        apiKeyConfigured: this.apiKey.trim().length > 0,
        logs: [...this.logEntries],
        sourceStates,
      },
    };
  }

  getSourceFiles(entryId: string): SourceFilesState {
    const state = this.buildState();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error(`Unknown source entry: ${entryId}`);
    }

    const cached = this.cacheDb.getSourceCache(entry.hydrationKey);
    const previewFixtures = this.cacheDb.listPreviewFixtures(entry.hydrationKey);
    const archiveSampleExtensions = this.cacheDb.getArchiveSampleExtensions(entry.hydrationKey);
    const persistedSelectedRowIds = this.cacheDb.getSelectedRowIds(entry.selectionStateKey, {
      previousEntryId: entry.id,
      hydrationKey: entry.hydrationKey,
    });
    const sourceMode = entry.scope.isArchiveSelection ? "archive" : "standard";
    if (!cached) {
      return {
        entryId,
        sourceStatus: "missing",
        sourceMode,
        updatedAt: null,
        statusLabel: null,
        progressPercent: null,
        errorMessage: null,
        outerArchiveName: null,
        archiveSampleExtensions,
        previewFixtures,
        analysisFiles: [],
        analysisOriginalNames: [],
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    if (cached.status === "error") {
      return {
        entryId,
        sourceStatus: "error",
        sourceMode: cached.mode,
        updatedAt: cached.updatedAt,
        statusLabel: cached.statusLabel,
        progressPercent: cached.progressPercent,
        errorMessage: cached.errorMessage,
        outerArchiveName: null,
        archiveSampleExtensions,
        previewFixtures,
        analysisFiles: [],
        analysisOriginalNames: [],
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    if (cached.status === "preparing") {
      return {
        entryId,
        sourceStatus: "preparing",
        sourceMode: cached.mode,
        updatedAt: cached.updatedAt,
        statusLabel: cached.statusLabel,
        progressPercent: cached.progressPercent,
        errorMessage: cached.errorMessage,
        outerArchiveName: isArchivePayload(cached.payload)
          ? cached.payload.outerZip?.originalName ?? cached.payload.exactMatch.originalName
          : null,
        archiveSampleExtensions,
        previewFixtures,
        analysisFiles: [],
        analysisOriginalNames: [],
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    const analysisFiles =
      cached.mode === "standard" && isReadyStandardPayload(cached.payload)
        ? buildScopedStandardSourceFiles(entry, cached.payload.files)
        : cached.mode === "archive" &&
            isArchivePayload(cached.payload) &&
            cached.payload.entries
          ? buildScopedArchiveSourceFiles(cached.payload.entries)
          : [];
    const analysisOriginalNames = analysisFiles.map((file) => file.originalName);
    const files =
      cached.mode === "standard" && isReadyStandardPayload(cached.payload)
        ? buildStandardSourceFiles(entry, cached.payload.files)
        : cached.mode === "archive" &&
            isArchivePayload(cached.payload) &&
            cached.payload.entries
          ? buildArchiveSourceFiles(entry, cached.payload.entries)
          : [];
    const availableFileIds = new Set(files.map((file) => file.id));
    const selectedRowIds = persistedSelectedRowIds.filter((fileId) =>
      availableFileIds.has(fileId),
    );
    if (selectedRowIds.length !== persistedSelectedRowIds.length) {
      this.cacheDb.setSelectedRowIds(entry.selectionStateKey, selectedRowIds);
    }

    return {
      entryId,
      sourceStatus: "ready",
      sourceMode: cached.mode,
      updatedAt: cached.updatedAt,
      statusLabel: cached.statusLabel,
      progressPercent: cached.progressPercent,
      errorMessage: cached.errorMessage,
      analysisFiles,
      analysisOriginalNames,
      outerArchiveName:
        cached.mode === "archive" &&
        isArchivePayload(cached.payload)
          ? cached.payload.outerZip?.originalName ?? cached.payload.exactMatch.originalName
          : null,
      archiveSampleExtensions,
      previewFixtures,
      selectedRowIds,
      files,
    };
  }

  subscribe(subscriber: BackendSubscriber) {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publishConfigUpdated() {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "config-updated" });
    }
  }

  runHydration(
    entryIds?: string[],
    options: { forceRefresh?: boolean } = {},
  ) {
    if (this.currentRunPromise) {
      return this.currentRunPromise;
    }

    const state = this.buildState();
    if (state.status !== "accepted") {
      throw new Error("Config must be accepted before the database can be updated");
    }
    if (this.apiKey.trim().length === 0) {
      throw new Error("REAL_DEBRID_API_KEY is missing in simulator/.env.local");
    }

    const entries = uniqueEntriesByHydrationKey(state.entries.filter(
      (entry) => !entryIds || entryIds.includes(entry.id),
    ));
    if (options.forceRefresh) {
      for (const entry of entries) {
        this.cacheDb.clearSourceCache(entry.hydrationKey);
      }
    }
    const client = new RealDebridClient(this.apiKey, {
      onLog: (message, visibility = "verbose") => {
        this.log("info", message, visibility);
        this.publishState();
      },
    });
    const runId = this.cacheDb.startHydrationRun(entries.length);
    this.hydrationRunning = true;
    this.publishState();
    this.log("info", `Starting database hydration for ${entries.length} source cache job(s).`);
    this.log("info", "Hydration is running strictly one source at a time.");
    this.log(
      "info",
      `Real-Debrid requests are paced at ${Math.ceil(REAL_DEBRID_INTER_REQUEST_DELAY_MS / 1_000)}s intervals with ${Math.ceil(REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS / 1_000)}s between sources.`,
    );

    const runPromise = (async () => {
      let failureCount = 0;
      try {
        for (const [index, entry] of entries.entries()) {
          this.log(
            "info",
            `Hydrating source cache ${index + 1}/${entries.length}: ${entry.displayName} (${entry.scope.isArchiveSelection ? "archive" : "standard"}).`,
          );
          try {
            if (entry.scope.isArchiveSelection) {
              await this.hydrateArchiveEntry(client, entry);
            } else {
              await this.hydrateStandardEntry(client, entry);
            }
            this.log("success", `${entry.displayName}: source hydration completed.`);
          } catch (error) {
            failureCount += 1;
            const message = error instanceof Error ? error.message : String(error);
            if (!(error instanceof RetryableArchiveHydrationError)) {
              this.cacheDb.setSourceCache(
                createErrorCacheRow(
                  entry.hydrationKey,
                  entry.scope.isArchiveSelection ? "archive" : "standard",
                  message,
                ),
              );
            }
            this.log("error", `${entry.displayName}: ${message}`);
            this.publishState();
          }

          if (index < entries.length - 1) {
            await client.cooldownBetweenSources();
            this.publishState();
          }
        }
        this.cacheDb.finishHydrationRun(
          runId,
          failureCount > 0 ? "failed" : "completed",
          failureCount > 0 ? `${failureCount} source(s) failed during hydration.` : null,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.cacheDb.finishHydrationRun(runId, "failed", message);
        throw error;
      } finally {
        this.hydrationRunning = false;
        this.currentRunPromise = null;
        this.publishState();
      }
    })();

    this.currentRunPromise = runPromise;
    void runPromise.catch(() => {});
    return runPromise;
  }

  setPreviewFixture(
    entryId: string,
    fixtureInput: {
      fixtureKey?: string;
      sourceFileId: string | null;
      archiveDisplayName: string;
      archiveBaseName: string;
      samples: PreviewFixtureSample[];
    },
  ): PreviewFixture {
    const state = this.buildState();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error(`Unknown source entry: ${entryId}`);
    }

    const fixtureKey =
      fixtureInput.fixtureKey ??
      previewFixtureKey(entry.hydrationKey, fixtureInput.sourceFileId);
    return this.cacheDb.setPreviewFixture(entry.hydrationKey, {
      fixtureKey,
      sourceFileId: fixtureInput.sourceFileId,
      archiveDisplayName: fixtureInput.archiveDisplayName,
      archiveBaseName: fixtureInput.archiveBaseName,
      samples: fixtureInput.samples,
    });
  }

  setArchiveSampleExtensions(entryId: string, fileExtensions: string[]) {
    const state = this.buildState();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error(`Unknown source entry: ${entryId}`);
    }
    if (!entry.unarchive) {
      throw new Error("Unarchive must be configured before saving archive sample extensions");
    }

    return this.cacheDb.setArchiveSampleExtensions(
      entry.hydrationKey,
      normalizeArchiveSampleExtensions(fileExtensions),
    );
  }

  setSelectedRowIds(entryId: string, selectedRowIds: string[]) {
    const state = this.buildState();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error(`Unknown source entry: ${entryId}`);
    }

    const normalizedSelectedRowIds = Array.from(
      new Set(selectedRowIds.filter((rowId) => rowId.trim().length > 0)),
    );
    const sourceFiles = this.getSourceFiles(entryId);
    const availableFileIds = new Set(sourceFiles.files.map((file) => file.id));
    const nextSelectedRowIds =
      sourceFiles.sourceStatus === "ready"
        ? normalizedSelectedRowIds.filter((rowId) => availableFileIds.has(rowId))
        : normalizedSelectedRowIds;
    this.cacheDb.setSelectedRowIds(entry.selectionStateKey, nextSelectedRowIds);
    return nextSelectedRowIds;
  }

  updateSourceEntryPolicy(
    input: SourceEntryPolicyUpdateInput,
  ): SourceEntryPolicyUpdateResult {
    assertValidSourceEntryPolicyUpdateInput(input);
    const state = this.buildState();
    if (state.status !== "accepted") {
      throw new Error("Config must be accepted before source policies can be edited");
    }

    const entry = resolveSelectedEntry(state.entries, input);
    if (!entry) {
      throw new Error("The selected source changed on disk. Reload the simulator state and try again.");
    }

    const sourceFiles = this.getSourceFiles(entry.id);
    if (sourceFiles.sourceStatus !== "ready") {
      throw new Error("Source files must be loaded before policies can be edited");
    }

    const analysis = analyzeParentheticalSuffixes(
      sourceFiles.analysisOriginalNames ?? sourceFiles.files.map((file) => file.originalName),
    );
    if (input.renamePolicy) {
      const detectedRenamePolicy = detectManagedRenamePolicy(
        entry.renameRule,
        analysis.parentheticalPhrases.map((phrase) => phrase.phrase),
      );
      if (detectedRenamePolicy.isCustom && !input.confirmReplaceCustomRename) {
        return {
          status: "needs-confirmation",
          kind: "custom-rename",
          error:
            "This source already has a custom rename regex. Confirm replacement before overwriting it.",
        };
      }
    }

    const { configPath, schemaPath, rawDocument } = readSourceDocument(this.repoRoot);
    const entries = rawDocument.entries;
    if (!Array.isArray(entries)) {
      throw new Error("The selected source could not be located in source.json");
    }

    const targetIndex = resolveSourceEntryWriteIndex(rawDocument as SourceDocument, entry);
    if (targetIndex < 0 || targetIndex >= entries.length) {
      throw new Error("The selected source changed on disk. Reload the simulator state and try again.");
    }

    const targetEntry = entries[targetIndex];
    if (!targetEntry || typeof targetEntry !== "object" || Array.isArray(targetEntry)) {
      throw new Error("The selected source entry is not editable");
    }

    if (input.renamePolicy) {
      const availablePhrases = analysis.parentheticalPhrases.map((phrase) => phrase.phrase);
      const nextRenameRule = buildManagedRenameRule(
        input.renamePolicy.mode,
        input.renamePolicy.phrases,
        availablePhrases,
      );
      applyRenameRuleToDocumentEntry(targetEntry, nextRenameRule);
    }
    if (input.ignoreGlobs) {
      applyIgnoreGlobsToDocumentEntry(
        targetEntry,
        normalizeIgnoreGlobs(input.ignoreGlobs),
      );
    }

    const issues = validateSourceDocument(rawDocument as SourceDocument, schemaPath);
    if (issues.length > 0) {
      throw new Error(issues[0]?.message ?? "The updated source.json would be invalid");
    }

    writeSourceDocumentAtomic(configPath, rawDocument);
    return {
      status: "ok",
    };
  }

  private async hydrateStandardEntry(
    client: RealDebridClient,
    entry: PreviewEntry,
  ) {
    this.log(
      "info",
      `${entry.displayName}: enumerating provider files from ${entry.torrents.length} torrent source(s).`,
    );
    const files = await client.enumerateProviderFiles(
      entry.torrents.map((torrent) => ({
        magnetUri: torrent.url,
        partLabel: torrent.partName ?? null,
      })),
    );
    this.cacheDb.setSourceCache(createReadyStandardCacheRow(entry.hydrationKey, files));
    this.log("success", `${entry.displayName}: cached ${files.length} provider file(s).`);
    this.publishState();
  }

  private async hydrateArchiveEntry(
    client: RealDebridClient,
    entry: PreviewEntry,
  ) {
    const existing = this.cacheDb.getSourceCache(entry.hydrationKey);
    let exactMatch: CachedProviderFileRecord;
    let status: AcquisitionStatus;

    if (
      existing?.status === "preparing" &&
      isArchivePayload(existing.payload) &&
      existing.payload.resumeMarker
    ) {
      this.log(
        "info",
        `${entry.displayName}: resuming archive preparation from cached torrent ${existing.payload.resumeMarker.torrentId}.`,
      );
      exactMatch = existing.payload.exactMatch;
      status = await client.resumeAcquisition(existing.payload.resumeMarker);
    } else {
      this.log(
        "info",
        `${entry.displayName}: resolving exact outer zip ${entry.scope.normalizedPath}.`,
      );
      const acquisition = await client.startExactZipAcquisition(
        entry.torrents.map((torrent) => ({
          magnetUri: torrent.url,
          partLabel: torrent.partName ?? null,
        })),
        entry.scope.normalizedPath,
      );
      exactMatch = acquisition.exactMatch;
      this.log(
        "info",
        `${entry.displayName}: exact outer zip resolved to provider file ${exactMatch.originalName}.`,
      );
      status = acquisition.status;
    }

    if (status.kind === "links-ready") {
      try {
        this.log(
          "info",
          `${entry.displayName}: provider links are ready on torrent ${status.resumeMarker.torrentId}.`,
        );
        const outerZip = await client.materializeArchiveContainer(exactMatch, status);
        this.log(
          "info",
          `${entry.displayName}: enumerating remote zip entries for ${outerZip.originalName}.`,
        );
        const entries = await enumerateRemoteZip(outerZip.archiveUrl, {
          onLog: (message) => {
            this.log("info", `${entry.displayName}: ${message}`, "verbose");
            this.publishState();
          },
        });
        try {
          await client.releaseAcquisition(status.resumeMarker);
        } catch (error) {
          this.log(
            "error",
            `${entry.displayName}: could not delete provider torrent ${status.resumeMarker.torrentId} after archive enumeration (${error instanceof Error ? error.message : String(error)}).`,
            "verbose",
          );
        }
        this.cacheDb.setSourceCache(
          createReadyArchiveCacheRow(
            entry.hydrationKey,
            exactMatch,
            null,
            outerZip,
            entries,
          ),
        );
        this.log(
          "success",
          `${entry.displayName}: cached ${entries.length} archive entry row(s).`,
        );
        this.publishState();
        return;
      } catch (error) {
        this.cacheDb.setSourceCache(
          createPreparingArchiveCacheRow(
            entry.hydrationKey,
            exactMatch,
            status.resumeMarker,
            "downloaded",
            100,
          ),
        );
        this.publishState();
        throw new RetryableArchiveHydrationError(
          `archive handling failed after provider links were ready (${error instanceof Error ? error.message : String(error)}). Refresh this source to retry from the prepared torrent`,
        );
      }
    }

    this.cacheDb.setSourceCache(
      createPreparingArchiveCacheRow(
        entry.hydrationKey,
        exactMatch,
        status.resumeMarker,
        status.statusLabel,
        status.progressPercent,
      ),
    );
    this.log(
      "info",
      `${entry.displayName}: archive preparation is still waiting (${status.statusLabel}${formatProgress(status.progressPercent)}) on torrent ${status.resumeMarker.torrentId}. Try again after the Real-Debrid download finishes.`,
    );
    this.publishState();
  }

  private log(
    level: HydrationLogLevel,
    message: string,
    visibility: HydrationLogVisibility = "basic",
  ) {
    const normalizedMessage = normalizeLogMessage(message);
    const entry: HydrationLogEntry = {
      id: `${Date.now()}-${this.logEntries.length}`,
      timestamp: new Date().toISOString(),
      level,
      visibility,
      message: normalizedMessage,
    };
    this.logEntries.push(entry);
    if (this.logEntries.length > MAX_LOGS) {
      this.logEntries.splice(0, this.logEntries.length - MAX_LOGS);
    }

    const label = level.toUpperCase();
    console.log(`[simulator:${label}] ${normalizedMessage}`);
  }

  private publishState() {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "state" });
    }
  }
}

function countCachedFiles(cached: SourceCacheRow): number {
  if (cached.status !== "ready" || !cached.payload) {
    return 0;
  }
  if (isReadyStandardPayload(cached.payload)) {
    return cached.payload.files.length;
  }
  if (isArchivePayload(cached.payload)) {
    return cached.payload.entries?.length ?? 0;
  }
  return 0;
}

function formatProgress(progressPercent: number | null) {
  return progressPercent === null ? "" : ` ${progressPercent}%`;
}

function normalizeLogMessage(message: string) {
  return message.endsWith(".") && !message.endsWith("...") ? message.slice(0, -1) : message;
}

function normalizeIgnoreGlobs(ignoreGlobs: string[]) {
  return Array.from(
    new Set(ignoreGlobs.map((glob) => glob.trim()).filter((glob) => glob.length > 0)),
  );
}

function assertValidSourceEntryPolicyUpdateInput(
  input: SourceEntryPolicyUpdateInput,
) {
  if (typeof input.entryId !== "string" || input.entryId.trim().length === 0) {
    throw new Error("Invalid source entry policy payload");
  }
  if (
    typeof input.selectionStateKey !== "string" ||
    input.selectionStateKey.trim().length === 0 ||
    typeof input.displayName !== "string" ||
    input.displayName.trim().length === 0 ||
    typeof input.subfolder !== "string" ||
    input.subfolder.trim().length === 0
  ) {
    throw new Error("Invalid source entry policy payload");
  }

  if (input.renamePolicy) {
    if (
      !["none", "all", "phrases"].includes(input.renamePolicy.mode) ||
      !Array.isArray(input.renamePolicy.phrases) ||
      input.renamePolicy.phrases.some((phrase) => typeof phrase !== "string")
    ) {
      throw new Error("Invalid source entry policy payload");
    }
  }

  if (
    input.ignoreGlobs &&
    (!Array.isArray(input.ignoreGlobs) ||
      input.ignoreGlobs.some((glob) => typeof glob !== "string"))
  ) {
    throw new Error("Invalid source entry policy payload");
  }

  if (
    typeof input.confirmReplaceCustomRename !== "undefined" &&
    typeof input.confirmReplaceCustomRename !== "boolean"
  ) {
    throw new Error("Invalid source entry policy payload");
  }
}

function applyRenameRuleToDocumentEntry(
  entry: Record<string, unknown>,
  renameRule: PreviewEntry["renameRule"],
) {
  if (!renameRule) {
    delete entry.rename;
    return;
  }

  entry.rename = {
    pattern: renameRule.pattern,
    replacement: renameRule.replacement,
  };
}

function applyIgnoreGlobsToDocumentEntry(
  entry: Record<string, unknown>,
  ignoreGlobs: string[],
) {
  if (ignoreGlobs.length === 0) {
    if (
      entry.ignore &&
      typeof entry.ignore === "object" &&
      !Array.isArray(entry.ignore)
    ) {
      delete (entry.ignore as Record<string, unknown>).glob;
      if (Object.keys(entry.ignore as Record<string, unknown>).length === 0) {
        delete entry.ignore;
      }
    } else {
      delete entry.ignore;
    }
    return;
  }

  if (!entry.ignore || typeof entry.ignore !== "object" || Array.isArray(entry.ignore)) {
    entry.ignore = {};
  }
  (entry.ignore as Record<string, unknown>).glob = ignoreGlobs;
}

export function ensureLocalArtifacts(repoRoot: string) {
  fs.mkdirSync(path.join(repoRoot, "simulator/.local"), { recursive: true });
}

export function previewFixtureKey(
  hydrationKey: string,
  sourceFileId: string | null,
) {
  return sourceFileId === null
    ? `${hydrationKey}::archive-scope`
    : `${hydrationKey}::${sourceFileId}`;
}

function uniqueEntriesByHydrationKey(entries: PreviewEntry[]) {
  const uniqueEntries = new Map<string, PreviewEntry>();
  for (const entry of entries) {
    if (!uniqueEntries.has(entry.hydrationKey)) {
      uniqueEntries.set(entry.hydrationKey, entry);
    }
  }
  return [...uniqueEntries.values()];
}

function resolveSourceEntryWriteIndex(
  document: SourceDocument,
  selectedEntry: PreviewEntry,
) {
  const freshEntries = buildPreviewEntries(document);
  const exactIndex = freshEntries.findIndex((candidate) => candidate.id === selectedEntry.id);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  const fallbackMatches = freshEntries
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        candidate.selectionStateKey === selectedEntry.selectionStateKey &&
        candidate.displayName === selectedEntry.displayName &&
        candidate.subfolder === selectedEntry.subfolder,
    );
  if (fallbackMatches.length === 1) {
    return fallbackMatches[0].index;
  }

  return -1;
}

function resolveSelectedEntry(
  entries: PreviewEntry[],
  input: Pick<
    SourceEntryPolicyUpdateInput,
    "entryId" | "selectionStateKey" | "displayName" | "subfolder"
  >,
) {
  const exactMatch = entries.find((candidate) => candidate.id === input.entryId);
  if (exactMatch) {
    return exactMatch;
  }

  const fallbackMatches = entries.filter(
    (candidate) =>
      candidate.selectionStateKey === input.selectionStateKey &&
      candidate.displayName === input.displayName &&
      candidate.subfolder === input.subfolder,
  );
  return fallbackMatches.length === 1 ? fallbackMatches[0] : null;
}
