import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { PreviewFixture, PreviewFixtureSample } from "../types";

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
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  source_count: number;
  error_message: string | null;
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

type SelectedFileStateRecord = {
  hydration_key: string;
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

  getSelectedRowIds(hydrationKey: string): string[] {
    const row = this.database
      .prepare(`
        SELECT *
        FROM selected_file_state
        WHERE hydration_key = ?
      `)
      .get(hydrationKey) as SelectedFileStateRecord | undefined;

    if (!row) {
      return [];
    }

    return JSON.parse(row.selected_row_ids_json) as string[];
  }

  setSelectedRowIds(hydrationKey: string, selectedRowIds: string[]) {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO selected_file_state (
          hydration_key,
          selected_row_ids_json,
          updated_at
        ) VALUES (
          @hydration_key,
          @selected_row_ids_json,
          @updated_at
        )
        ON CONFLICT(hydration_key) DO UPDATE SET
          selected_row_ids_json = excluded.selected_row_ids_json,
          updated_at = excluded.updated_at
      `)
      .run({
        hydration_key: hydrationKey,
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

  startHydrationRun(sourceCount: number): number {
    const startedAt = new Date().toISOString();
    const result = this.database
      .prepare(`
        INSERT INTO hydration_runs (
          started_at,
          finished_at,
          status,
          source_count,
          error_message
        ) VALUES (?, NULL, 'running', ?, NULL)
      `)
      .run(startedAt, sourceCount);

    return Number(result.lastInsertRowid);
  }

  finishHydrationRun(
    runId: number,
    status: "completed" | "failed",
    errorMessage: string | null,
  ) {
    this.database
      .prepare(`
        UPDATE hydration_runs
        SET finished_at = ?, status = ?, error_message = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), status, errorMessage, runId);
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
        error_message TEXT
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

      CREATE TABLE IF NOT EXISTS selected_file_state (
        hydration_key TEXT PRIMARY KEY,
        selected_row_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
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
  return {
    fixtureKey: record.fixture_key,
    sourceFileId: record.source_file_id,
    archiveDisplayName: record.archive_display_name,
    archiveBaseName: record.archive_base_name,
    samples: JSON.parse(record.samples_json) as PreviewFixtureSample[],
    updatedAt: record.updated_at,
  };
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
  resumeMarker: CachedProviderResumeMarker,
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
