import fs from "node:fs";
import path from "node:path";

import { buildSimulatorState } from "../simulatorState";
import type {
  HydrationLogEntry,
  HydrationLogLevel,
  HydrationLogVisibility,
  PreviewFixture,
  PreviewFixtureSample,
  HydrationSourceState,
  PreviewEntry,
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
  buildStandardSourceFiles,
} from "./sourceFiles";

type BackendEvent = {
  type: "state";
} | {
  type: "config-updated";
};

type BackendSubscriber = (event: BackendEvent) => void;

const MAX_LOGS = 300;

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
    const persistedSelectedRowIds = this.cacheDb.getSelectedRowIds(entry.hydrationKey);
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
        previewFixtures,
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
        previewFixtures,
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
        previewFixtures,
        selectedRowIds: persistedSelectedRowIds,
        files: [],
      };
    }

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
      this.cacheDb.setSelectedRowIds(entry.hydrationKey, selectedRowIds);
    }

    return {
      entryId,
      sourceStatus: "ready",
      sourceMode: cached.mode,
      updatedAt: cached.updatedAt,
      statusLabel: cached.statusLabel,
      progressPercent: cached.progressPercent,
      errorMessage: cached.errorMessage,
      outerArchiveName:
        cached.mode === "archive" &&
        isArchivePayload(cached.payload)
          ? cached.payload.outerZip?.originalName ?? cached.payload.exactMatch.originalName
          : null,
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

  async runHydration(
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

    const entries = state.entries.filter(
      (entry) => !entryIds || entryIds.includes(entry.id),
    );
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
    this.log("info", `Starting database hydration for ${entries.length} source(s).`);
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
            `Hydrating source ${index + 1}/${entries.length}: ${entry.displayName} (${entry.scope.isArchiveSelection ? "archive" : "standard"}).`,
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
            this.cacheDb.setSourceCache(
              createErrorCacheRow(
                entry.hydrationKey,
                entry.scope.isArchiveSelection ? "archive" : "standard",
                message,
              ),
            );
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
    this.cacheDb.setSelectedRowIds(entry.hydrationKey, nextSelectedRowIds);
    return nextSelectedRowIds;
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
      this.cacheDb.setSourceCache(
        createReadyArchiveCacheRow(
          entry.hydrationKey,
          exactMatch,
          status.resumeMarker,
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
