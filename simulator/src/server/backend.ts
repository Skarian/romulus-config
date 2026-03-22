import fs from "node:fs";
import path from "node:path";

import { normalizeArchiveSampleExtensions } from "../archiveSamplePolicy";
import { buildPreviewEntries } from "../runtimeValidation";
import { buildSimulatorState } from "../simulatorState";
import {
  commitSourceDocumentSavePreview,
  getSourceDocumentPaths,
} from "../sourceDocument";
import type {
  ClearLocalDataResult,
  ClearLocalDataSelection,
  HydrationLogEntry,
  HydrationLogLevel,
  HydrationLogVisibility,
  HydrationRunSummary,
  PreviewFixture,
  PreviewFixtureSample,
    HydrationSourceState,
    PreviewEntry,
    SimulatorState,
    SourceFilesRequest,
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

class RetryableArchiveHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableArchiveHydrationError";
  }
}

export class SimulatorBackend {
  private readonly cacheDb: SimulatorCacheDb;
  private readonly subscribers = new Set<BackendSubscriber>();
  private hydrationRunning = false;
  private currentRunId: number | null = null;
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
    const latestRunId = this.currentRunId ?? this.cacheDb.getLatestHydrationRunId();
    const baseState = buildSimulatorState(this.repoRoot, {
      running: this.hydrationRunning,
      apiKeyConfigured: this.apiKey.trim().length > 0,
      logs: this.cacheDb.listHydrationLogs(latestRunId),
      lastRun: this.cacheDb.getLatestHydrationRunSummary(),
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
        lastRun: this.cacheDb.getLatestHydrationRunSummary(),
        missingSourceIds,
        running: this.hydrationRunning,
        apiKeyConfigured: this.apiKey.trim().length > 0,
        logs: this.cacheDb.listHydrationLogs(latestRunId),
        sourceStates,
      },
    };
  }

  getSourceFiles(request: SourceFilesRequest): SourceFilesState {
    const cached = this.cacheDb.getSourceCache(request.hydrationKey);
    const previewFixtures = this.cacheDb.listPreviewFixtures(request.hydrationKey);
    const archiveSampleExtensions = this.cacheDb.getArchiveSampleExtensions(
      request.selectionStateKey,
      {
        hydrationKey: request.hydrationKey,
      },
    );
    const persistedSelectedRowIds = this.cacheDb.getSelectedRowIds(request.selectionStateKey, {
      previousEntryId: request.legacyEntryId,
      hydrationKey: request.hydrationKey,
    });
    const sourceMode = request.scope.isArchiveSelection ? "archive" : "standard";
    if (!cached) {
      return {
        hydrationKey: request.hydrationKey,
        selectionStateKey: request.selectionStateKey,
        entryId: request.legacyEntryId ?? null,
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
        scopedOutFileCount: 0,
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    if (cached.status === "error") {
      return {
        hydrationKey: request.hydrationKey,
        selectionStateKey: request.selectionStateKey,
        entryId: request.legacyEntryId ?? null,
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
        scopedOutFileCount: 0,
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    if (cached.status === "preparing") {
      return {
        hydrationKey: request.hydrationKey,
        selectionStateKey: request.selectionStateKey,
        entryId: request.legacyEntryId ?? null,
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
        scopedOutFileCount: 0,
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

    const analysisFiles =
      cached.mode === "standard" && isReadyStandardPayload(cached.payload)
        ? buildScopedStandardSourceFiles(request, cached.payload.files)
        : cached.mode === "archive" &&
            isArchivePayload(cached.payload) &&
            cached.payload.entries
          ? buildScopedArchiveSourceFiles(cached.payload.entries)
          : [];
    const analysisOriginalNames = analysisFiles.map((file) => file.originalName);
    const scopedOutFileCount =
      cached.mode === "standard" && isReadyStandardPayload(cached.payload)
        ? Math.max(cached.payload.files.length - analysisFiles.length, 0)
        : 0;
    const files =
      cached.mode === "standard" && isReadyStandardPayload(cached.payload)
        ? buildStandardSourceFiles(request, cached.payload.files)
        : cached.mode === "archive" &&
            isArchivePayload(cached.payload) &&
            cached.payload.entries
          ? buildArchiveSourceFiles(request, cached.payload.entries)
          : [];
    const availableFileIds = new Set(files.map((file) => file.id));
    const selectedRowIds = persistedSelectedRowIds.filter((fileId) =>
      availableFileIds.has(fileId),
    );
    if (selectedRowIds.length !== persistedSelectedRowIds.length) {
      this.cacheDb.setSelectedRowIds(request.selectionStateKey, selectedRowIds);
    }

    return {
      hydrationKey: request.hydrationKey,
      selectionStateKey: request.selectionStateKey,
      entryId: request.legacyEntryId ?? null,
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
      scopedOutFileCount,
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
    if (state.status !== "editable") {
      throw new Error("Config must be editable before the database can be updated");
    }
    if (this.apiKey.trim().length === 0) {
      throw new Error("REAL_DEBRID_API_KEY is missing in simulator/.env.local");
    }

    const entries = uniqueEntriesByHydrationKey(state.entries.filter(
      (entry) => !entryIds || entryIds.includes(entry.id),
    ));
    if (entries.length === 0) {
      throw new Error("No source cache jobs were selected");
    }
    const client = new RealDebridClient(this.apiKey, {
      onLog: (message, visibility = "verbose") => {
        this.log("info", message, visibility);
        this.publishState();
      },
    });
    const runId = this.cacheDb.startHydrationRun(entries.length);
    this.currentRunId = runId;
    this.hydrationRunning = true;
    this.publishState();
    this.log("info", `Starting database hydration for ${entries.length} source cache job(s).`);
    this.log("info", "Hydration is running strictly one source at a time.");
    this.log(
      "info",
      `Real-Debrid requests are paced at ${Math.ceil(REAL_DEBRID_INTER_REQUEST_DELAY_MS / 1_000)}s intervals with ${Math.ceil(REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS / 1_000)}s between sources.`,
    );

    const runPromise = (async () => {
      let successCount = 0;
      let failureCount = 0;
      try {
        for (const [index, entry] of entries.entries()) {
          const previousCache = this.cacheDb.getSourceCache(entry.hydrationKey);
          this.log(
            "info",
            `Hydrating source cache ${index + 1}/${entries.length}: ${entry.displayName} (${entry.scope.isArchiveSelection ? "archive" : "standard"}).`,
          );
          try {
            if (entry.scope.isArchiveSelection) {
              await this.hydrateArchiveEntry(client, entry, options.forceRefresh ?? false);
            } else {
              await this.hydrateStandardEntry(client, entry);
            }
            successCount += 1;
            this.log("success", `${entry.displayName}: source hydration completed.`);
          } catch (error) {
            failureCount += 1;
            const message = error instanceof Error ? error.message : String(error);
            if (previousCache) {
              this.cacheDb.setSourceCache(previousCache);
            } else if (!(error instanceof RetryableArchiveHydrationError)) {
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
          {
            successCount,
            failureCount,
          },
          failureCount > 0 ? `${failureCount} source(s) failed during hydration.` : null,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.cacheDb.finishHydrationRun(
          runId,
          "failed",
          {
            successCount,
            failureCount,
          },
          message,
        );
        throw error;
      } finally {
        this.hydrationRunning = false;
        this.currentRunId = null;
        this.currentRunPromise = null;
        this.publishState();
      }
    })();

    this.currentRunPromise = runPromise;
    void runPromise.catch(() => {});
    return runPromise;
  }

  clearLocalData(selection: ClearLocalDataSelection): ClearLocalDataResult {
    const normalizedSelection = {
      fileCache: Boolean(selection.fileCache),
      savedSelections: Boolean(selection.savedSelections),
      savedPreviewData: Boolean(selection.savedPreviewData),
      updateLogs: Boolean(selection.updateLogs),
    };
    if (!Object.values(normalizedSelection).some(Boolean)) {
      throw new Error("Select at least one local database category to clear");
    }
    if (this.hydrationRunning) {
      throw new Error("The local database cannot be cleared while Update Database is running");
    }
    this.cacheDb.clearLocalData(normalizedSelection);
    this.publishState();
    return {
      cleared: normalizedSelection,
    };
  }

  setPreviewFixture(
    hydrationKey: string,
    fixtureInput: {
      fixtureKey?: string;
      sourceFileId: string | null;
      archiveDisplayName: string;
      archiveBaseName: string;
      samples: PreviewFixtureSample[];
    },
  ): PreviewFixture {
    const fixtureKey =
      fixtureInput.fixtureKey ??
      previewFixtureKey(hydrationKey, fixtureInput.sourceFileId);
    return this.cacheDb.setPreviewFixture(hydrationKey, {
      fixtureKey,
      sourceFileId: fixtureInput.sourceFileId,
      archiveDisplayName: fixtureInput.archiveDisplayName,
      archiveBaseName: fixtureInput.archiveBaseName,
      samples: fixtureInput.samples,
    });
  }

  setArchiveSampleExtensions(
    request: {
      selectionStateKey: string;
      unarchiveEnabled: boolean;
    },
    fileExtensions: string[],
  ) {
    if (!request.unarchiveEnabled) {
      throw new Error("Unarchive must be configured before saving archive sample extensions");
    }

    return this.cacheDb.setArchiveSampleExtensions(
      request.selectionStateKey,
      normalizeArchiveSampleExtensions(fileExtensions),
    );
  }

  setSelectedRowIds(request: SourceFilesRequest, selectedRowIds: string[]) {
    const normalizedSelectedRowIds = Array.from(
      new Set(selectedRowIds.filter((rowId) => rowId.trim().length > 0)),
    );
    const sourceFiles = this.getSourceFiles(request);
    const availableFileIds = new Set(sourceFiles.files.map((file) => file.id));
    const nextSelectedRowIds =
      sourceFiles.sourceStatus === "ready"
        ? normalizedSelectedRowIds.filter((rowId) => availableFileIds.has(rowId))
        : normalizedSelectedRowIds;
    this.cacheDb.setSelectedRowIds(request.selectionStateKey, nextSelectedRowIds);
    return nextSelectedRowIds;
  }

  saveDocumentPreview(preview: {
    checksum: string;
    text: string;
  }) {
    const { configPath } = getSourceDocumentPaths(this.repoRoot);
    commitSourceDocumentSavePreview(configPath, preview);
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
    forceRefresh: boolean,
  ) {
    const existing = this.cacheDb.getSourceCache(entry.hydrationKey);
    let exactMatch: CachedProviderFileRecord;
    let status: AcquisitionStatus;

    if (
      !forceRefresh &&
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
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      level,
      visibility,
      message: normalizedMessage,
    };
    if (this.currentRunId !== null) {
      this.cacheDb.appendHydrationLog(this.currentRunId, entry);
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
