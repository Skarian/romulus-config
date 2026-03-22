import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { normalizeArchiveSampleExtensions } from "../archiveSamplePolicy";
import type {
  ClearLocalDataSelection,
  HydrationLogEntry,
  HydrationRunOutcome,
  HydrationRunSummary,
  PreviewFixture,
  PreviewFixtureSample,
} from "../types";

type CachePayload = {
  kind: "standard";
  files: CachedProviderFileRecord[];
} | {
  kind: "archive";
  exactMatch: CachedProviderFileRecord;
  resumeMarker: CachedProviderResumeMarker | null;
  outerZip: CachedArchiveContainer | null;
  entries: CachedArchiveEntryDescriptor[] | null;
};

export type CachedProviderLocator = {
  sourceMagnetUri: string;
  torrentId: string;
  providerFileIds: string[];
  selectedProviderFileId: string;
  path: string;
  partLabel: string | null;
};

export type CachedProviderFileRecord = {
  providerFileId: string;
  originalName: string;
  path: string;
  sizeBytes: number | null;
  partLabel: string | null;
  locator: CachedProviderLocator;
};

export type CachedProviderResumeMarker = {
  torrentId: string;
  sourceMagnetUri: string;
  selectedProviderFileIds: string[];
};

export type CachedArchiveContainer = {
  archiveUrl: string;
  originalName: string;
  providerLocator: CachedProviderLocator;
};

export type CachedArchiveEntryDescriptor = {
  identity: {
    localHeaderOffset: number;
    compressedSize: number;
    uncompressedSize: number;
    crc32: number;
    normalizedPath: string;
  };
  entryPath: string;
  sizeBytes: number;
};

export type SourceCacheRow = {
  cacheKey: string;
  mode: "standard" | "archive";
  status: "ready" | "preparing" | "error";
  updatedAt: string | null;
  statusLabel: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  payload: CachePayload | null;
};

type SourceCacheRowRecord = {
  cache_key: string;
  mode: "standard" | "archive";
  status: "ready" | "preparing" | "error";
  updated_at: string | null;
  status_label: string | null;
  progress_percent: number | null;
  error_message: string | null;
  payload_json: string | null;
};

type HydrationRunRecord = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  source_count: number;
  success_count: number;
  failure_count: number;
  error_message: string | null;
};

type HydrationLogRecord = {
  id: string;
  run_id: number;
  timestamp: string;
  level: "info" | "success" | "error";
  visibility: "basic" | "verbose";
  message: string;
};

type PreviewFixtureRecord = {
  fixture_key: string;
  hydration_key: string;
  source_file_id: string | null;
  archive_display_name: string;
  archive_base_name: string;
  samples_json: string;
  updated_at: string;
};

type ArchiveSampleExtensionsRecord = {
  hydration_key: string;
  file_extensions_json: string;
  updated_at: string;
};

type SelectedFileStateRecord = {
  state_key: string;
  selected_row_ids_json: string;
  updated_at: string;
};

export class SimulatorCacheDb {
  private readonly database: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.database = new Database(dbPath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.initialize();
  }

  close() {
    this.database.close();
  }

  getSourceCache(cacheKey: string): SourceCacheRow | null {
    const row = this.database
      .prepare("SELECT * FROM source_cache WHERE cache_key = ?")
      .get(cacheKey) as SourceCacheRowRecord | undefined;
    return row ? mapSourceCacheRow(row) : null;
  }

  setSourceCache(row: SourceCacheRow) {
    this.database
      .prepare(`
        INSERT INTO source_cache (
          cache_key,
          mode,
          status,
          updated_at,
          status_label,
          progress_percent,
          error_message,
          payload_json
        ) VALUES (
          @cache_key,
          @mode,
          @status,
          @updated_at,
          @status_label,
          @progress_percent,
          @error_message,
          @payload_json
        )
        ON CONFLICT(cache_key) DO UPDATE SET
          mode = excluded.mode,
          status = excluded.status,
          updated_at = excluded.updated_at,
          status_label = excluded.status_label,
          progress_percent = excluded.progress_percent,
          error_message = excluded.error_message,
          payload_json = excluded.payload_json
      `)
      .run({
        cache_key: row.cacheKey,
        mode: row.mode,
        status: row.status,
        updated_at: row.updatedAt,
        status_label: row.statusLabel,
        progress_percent: row.progressPercent,
        error_message: row.errorMessage,
        payload_json: row.payload ? JSON.stringify(row.payload) : null,
      });
  }

  clearSourceCache(cacheKey: string) {
    this.database
      .prepare("DELETE FROM source_cache WHERE cache_key = ?")
      .run(cacheKey);
  }

  getLatestHydrationRunId() {
    const row = this.database
      .prepare(`
        SELECT id
        FROM hydration_runs
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as { id: number } | undefined;
    return row?.id ?? null;
  }

  listHydrationLogs(runId: number | null): HydrationLogEntry[] {
    if (runId === null) {
      return [];
    }
    const rows = this.database
      .prepare(`
        SELECT id, run_id, timestamp, level, visibility, message
        FROM hydration_logs
        WHERE run_id = ?
        ORDER BY timestamp ASC, id ASC
      `)
      .all(runId) as HydrationLogRecord[];
    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      visibility: row.visibility,
      message: row.message,
    }));
  }

  appendHydrationLog(runId: number, entry: HydrationLogEntry) {
    this.database
      .prepare(`
        INSERT INTO hydration_logs (
          id,
          run_id,
          timestamp,
          level,
          visibility,
          message
        ) VALUES (
          @id,
          @run_id,
          @timestamp,
          @level,
          @visibility,
          @message
        )
      `)
      .run({
        id: entry.id,
        run_id: runId,
        timestamp: entry.timestamp,
        level: entry.level,
        visibility: entry.visibility,
        message: entry.message,
      });
  }

  listPreviewFixtures(hydrationKey: string): PreviewFixture[] {
    const rows = this.database
      .prepare(`
        SELECT *
        FROM preview_fixtures
        WHERE hydration_key = ?
        ORDER BY updated_at ASC, fixture_key ASC
      `)
      .all(hydrationKey) as PreviewFixtureRecord[];

    return rows.map(mapPreviewFixture);
  }

  getArchiveSampleExtensions(
    stateKey: string,
    legacyKeys: {
      hydrationKey?: string;
    } = {},
  ) {
    const scopedPolicy = this.readArchiveSampleExtensions(stateKey);
    const persisted =
      scopedPolicy ??
      (legacyKeys.hydrationKey
        ? this.readArchiveSampleExtensions(legacyKeys.hydrationKey)
        : null);

    if (!persisted) {
      return [];
    }

    if (scopedPolicy === null) {
      this.setArchiveSampleExtensions(stateKey, persisted);
    }

    return persisted;
  }

  setArchiveSampleExtensions(stateKey: string, fileExtensions: string[]) {
    const normalizedFileExtensions = normalizeArchiveSampleExtensions(fileExtensions);
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO archive_sample_extension_policies (
          hydration_key,
          file_extensions_json,
          updated_at
        ) VALUES (
          @hydration_key,
          @file_extensions_json,
          @updated_at
        )
        ON CONFLICT(hydration_key) DO UPDATE SET
          file_extensions_json = excluded.file_extensions_json,
          updated_at = excluded.updated_at
      `)
      .run({
        hydration_key: stateKey,
        file_extensions_json: JSON.stringify(normalizedFileExtensions),
        updated_at: updatedAt,
      });

    return {
      fileExtensions: normalizedFileExtensions,
      updatedAt,
    };
  }

  getSelectedRowIds(
    stateKey: string,
    legacyKeys: {
      previousEntryId?: string;
      hydrationKey?: string;
    } = {},
  ): string[] {
    const scopedSelectedRowIds = this.readScopedSelectedRowIds(stateKey);
    const persisted =
      scopedSelectedRowIds ??
      (legacyKeys.previousEntryId
        ? this.readLegacyEntrySelectedRowIds(legacyKeys.previousEntryId)
        : null) ??
      (legacyKeys.hydrationKey
        ? this.readLegacyHydrationSelectedRowIds(legacyKeys.hydrationKey)
        : null);

    if (!persisted) {
      return [];
    }

    if (scopedSelectedRowIds === null) {
      this.setSelectedRowIds(stateKey, persisted);
    }

    return persisted;
  }

  setSelectedRowIds(stateKey: string, selectedRowIds: string[]) {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO selected_file_state_by_scope (
          state_key,
          selected_row_ids_json,
          updated_at
        ) VALUES (
          @state_key,
          @selected_row_ids_json,
          @updated_at
        )
        ON CONFLICT(state_key) DO UPDATE SET
          selected_row_ids_json = excluded.selected_row_ids_json,
          updated_at = excluded.updated_at
      `)
      .run({
        state_key: stateKey,
        selected_row_ids_json: JSON.stringify(selectedRowIds),
        updated_at: updatedAt,
      });
  }

  setPreviewFixture(
    hydrationKey: string,
    fixture: Omit<PreviewFixture, "updatedAt">,
  ): PreviewFixture {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO preview_fixtures (
          fixture_key,
          hydration_key,
          source_file_id,
          archive_display_name,
          archive_base_name,
          samples_json,
          updated_at
        ) VALUES (
          @fixture_key,
          @hydration_key,
          @source_file_id,
          @archive_display_name,
          @archive_base_name,
          @samples_json,
          @updated_at
        )
        ON CONFLICT(fixture_key) DO UPDATE SET
          hydration_key = excluded.hydration_key,
          source_file_id = excluded.source_file_id,
          archive_display_name = excluded.archive_display_name,
          archive_base_name = excluded.archive_base_name,
          samples_json = excluded.samples_json,
          updated_at = excluded.updated_at
      `)
      .run({
        fixture_key: fixture.fixtureKey,
        hydration_key: hydrationKey,
        source_file_id: fixture.sourceFileId,
        archive_display_name: fixture.archiveDisplayName,
        archive_base_name: fixture.archiveBaseName,
        samples_json: JSON.stringify(fixture.samples),
        updated_at: updatedAt,
      });

    return {
      ...fixture,
      updatedAt,
    };
  }

  getLatestFinishedHydrationAt(): string | null {
    const row = this.database
      .prepare(`
        SELECT finished_at
        FROM hydration_runs
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `)
      .get() as { finished_at: string | null } | undefined;
    return row?.finished_at ?? null;
  }

  getLatestHydrationRunSummary(): HydrationRunSummary | null {
    const row = this.database
      .prepare(`
        SELECT *
        FROM hydration_runs
        WHERE finished_at IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as HydrationRunRecord | undefined;
    return row ? mapHydrationRunSummary(row) : null;
  }

  startHydrationRun(sourceCount: number): number {
    const startedAt = new Date().toISOString();
    const result = this.database
      .prepare(`
        INSERT INTO hydration_runs (
          started_at,
          finished_at,
          status,
          source_count,
          success_count,
          failure_count,
          error_message
        ) VALUES (?, NULL, 'running', ?, 0, 0, NULL)
      `)
      .run(startedAt, sourceCount);

    return Number(result.lastInsertRowid);
  }

  finishHydrationRun(
    runId: number,
    status: "completed" | "failed",
    counts: {
      successCount: number;
      failureCount: number;
    },
    errorMessage: string | null,
  ) {
    this.database
      .prepare(`
        UPDATE hydration_runs
        SET finished_at = ?, status = ?, success_count = ?, failure_count = ?, error_message = ?
        WHERE id = ?
      `)
      .run(
        new Date().toISOString(),
        status,
        counts.successCount,
        counts.failureCount,
        errorMessage,
        runId,
      );
  }

  clearLocalData(selection: ClearLocalDataSelection) {
    this.database.transaction(() => {
      if (selection.fileCache) {
        this.database.prepare("DELETE FROM source_cache").run();
      }
      if (selection.savedSelections) {
        this.database.prepare("DELETE FROM selected_file_state").run();
        this.database.prepare("DELETE FROM selected_file_state_by_entry").run();
        this.database.prepare("DELETE FROM selected_file_state_by_scope").run();
      }
      if (selection.savedPreviewData) {
        this.database.prepare("DELETE FROM archive_sample_extension_policies").run();
      }
      if (selection.updateLogs) {
        this.database.prepare("DELETE FROM hydration_logs").run();
      }
    })();
  }

  private initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS source_cache (
        cache_key TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT,
        status_label TEXT,
        progress_percent REAL,
        error_message TEXT,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS hydration_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS hydration_logs (
        id TEXT PRIMARY KEY,
        run_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        visibility TEXT NOT NULL,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS preview_fixtures (
        fixture_key TEXT PRIMARY KEY,
        hydration_key TEXT NOT NULL,
        source_file_id TEXT,
        archive_display_name TEXT NOT NULL,
        archive_base_name TEXT NOT NULL,
        samples_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS archive_sample_extension_policies (
        hydration_key TEXT PRIMARY KEY,
        file_extensions_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS selected_file_state (
        hydration_key TEXT PRIMARY KEY,
        selected_row_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS selected_file_state_by_entry (
        entry_id TEXT PRIMARY KEY,
        selected_row_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS selected_file_state_by_scope (
        state_key TEXT PRIMARY KEY,
        selected_row_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    ensureColumn(this.database, "hydration_runs", "success_count", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(this.database, "hydration_runs", "failure_count", "INTEGER NOT NULL DEFAULT 0");
  }

  private readScopedSelectedRowIds(stateKey: string) {
    const row = this.database
      .prepare(`
        SELECT *
        FROM selected_file_state_by_scope
        WHERE state_key = ?
      `)
      .get(stateKey) as SelectedFileStateRecord | undefined;

    return row ? (JSON.parse(row.selected_row_ids_json) as string[]) : null;
  }

  private readLegacyEntrySelectedRowIds(entryId: string) {
    const row = this.database
      .prepare(`
        SELECT
          entry_id AS state_key,
          selected_row_ids_json,
          updated_at
        FROM selected_file_state_by_entry
        WHERE entry_id = ?
      `)
      .get(entryId) as SelectedFileStateRecord | undefined;

    return row ? (JSON.parse(row.selected_row_ids_json) as string[]) : null;
  }

  private readLegacyHydrationSelectedRowIds(hydrationKey: string) {
    const row = this.database
      .prepare(`
        SELECT
          hydration_key AS state_key,
          selected_row_ids_json,
          updated_at
        FROM selected_file_state
        WHERE hydration_key = ?
      `)
      .get(hydrationKey) as SelectedFileStateRecord | undefined;

    return row ? (JSON.parse(row.selected_row_ids_json) as string[]) : null;
  }

  private readArchiveSampleExtensions(stateKey: string) {
    const row = this.database
      .prepare(`
        SELECT *
        FROM archive_sample_extension_policies
        WHERE hydration_key = ?
      `)
      .get(stateKey) as ArchiveSampleExtensionsRecord | undefined;

    if (!row) {
      return null;
    }

    return normalizeArchiveSampleExtensions(
      JSON.parse(row.file_extensions_json) as string[],
    );
  }
}

function mapSourceCacheRow(record: SourceCacheRowRecord): SourceCacheRow {
  return {
    cacheKey: record.cache_key,
    mode: record.mode,
    status: record.status,
    updatedAt: record.updated_at,
    statusLabel: record.status_label,
    progressPercent: record.progress_percent,
    errorMessage: record.error_message,
    payload: record.payload_json ? (JSON.parse(record.payload_json) as CachePayload) : null,
  };
}

function mapPreviewFixture(record: PreviewFixtureRecord): PreviewFixture {
  const samples = (JSON.parse(record.samples_json) as PreviewFixtureSample[]).filter(
    (sample) =>
      !(
        sample.id === "default" &&
        sample.originalName === `[${record.archive_base_name}]`
      ),
  );

  return {
    fixtureKey: record.fixture_key,
    sourceFileId: record.source_file_id,
    archiveDisplayName: record.archive_display_name,
    archiveBaseName: record.archive_base_name,
    samples,
    updatedAt: record.updated_at,
  };
}

function mapHydrationRunSummary(record: HydrationRunRecord): HydrationRunSummary {
  const outcome: HydrationRunOutcome =
    record.failure_count === 0
      ? "success"
      : record.success_count > 0
        ? "mixed"
        : "failed";

  return {
    runId: record.id,
    startedAt: record.started_at,
    finishedAt: record.finished_at ?? record.started_at,
    sourceCount: record.source_count,
    successCount: record.success_count,
    failureCount: record.failure_count,
    outcome,
    errorMessage: record.error_message,
  };
}

function ensureColumn(
  database: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

export function createReadyStandardCacheRow(
  cacheKey: string,
  files: CachedProviderFileRecord[],
): SourceCacheRow {
  return {
    cacheKey,
    mode: "standard",
    status: "ready",
    updatedAt: new Date().toISOString(),
    statusLabel: null,
    progressPercent: null,
    errorMessage: null,
    payload: {
      kind: "standard",
      files,
    },
  };
}

export function createPreparingArchiveCacheRow(
  cacheKey: string,
  exactMatch: CachedProviderFileRecord,
  resumeMarker: CachedProviderResumeMarker,
  statusLabel: string | null,
  progressPercent: number | null,
): SourceCacheRow {
  return {
    cacheKey,
    mode: "archive",
    status: "preparing",
    updatedAt: new Date().toISOString(),
    statusLabel,
    progressPercent,
    errorMessage: null,
    payload: {
      kind: "archive",
      exactMatch,
      resumeMarker,
      outerZip: null,
      entries: null,
    },
  };
}

export function createReadyArchiveCacheRow(
  cacheKey: string,
  exactMatch: CachedProviderFileRecord,
  resumeMarker: CachedProviderResumeMarker | null,
  outerZip: CachedArchiveContainer,
  entries: CachedArchiveEntryDescriptor[],
): SourceCacheRow {
  return {
    cacheKey,
    mode: "archive",
    status: "ready",
    updatedAt: new Date().toISOString(),
    statusLabel: "downloaded",
    progressPercent: 100,
    errorMessage: null,
    payload: {
      kind: "archive",
      exactMatch,
      resumeMarker,
      outerZip,
      entries,
    },
  };
}

export function createErrorCacheRow(
  cacheKey: string,
  mode: "standard" | "archive",
  errorMessage: string,
): SourceCacheRow {
  return {
    cacheKey,
    mode,
    status: "error",
    updatedAt: new Date().toISOString(),
    statusLabel: null,
    progressPercent: null,
    errorMessage,
    payload: null,
  };
}

export function isReadyStandardPayload(
  payload: SourceCacheRow["payload"],
): payload is Extract<CachePayload, { kind: "standard" }> {
  return payload?.kind === "standard";
}

export function isArchivePayload(
  payload: SourceCacheRow["payload"],
): payload is Extract<CachePayload, { kind: "archive" }> {
  return payload?.kind === "archive";
}
