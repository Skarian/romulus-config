import { createHash } from "node:crypto";

import type { HydrationLogVisibility } from "../types";
import type {
  CachedArchiveContainer,
  CachedProviderFileRecord,
  CachedProviderLocator,
  CachedProviderResumeMarker,
} from "./cacheDb";

const BASE_URL = "https://api.real-debrid.com/rest/1.0/";
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const SELECTED_FLAG = 1;
const TERMINAL_FAILURE_STATUSES = new Set(["magnet_error", "error", "virus", "dead"]);

const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 10_000];

export const REAL_DEBRID_INTER_REQUEST_DELAY_MS = 1_000;
export const REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS = 2_000;

type AvailableHostDto = {
  host: string;
};

type AddedMagnetDto = {
  id: string;
};

type TorrentInfoDto = {
  id: string;
  status?: string | null;
  progress?: number | null;
  files: TorrentFileDto[];
  links: string[];
};

type TorrentFileDto = {
  id: number;
  path: string;
  bytes?: number | null;
  selected: number;
  unrestricted?: string | null;
  link?: string | null;
};

type UnrestrictedLinkDto = {
  filename?: string | null;
  download: string;
};

type ReadyLink = {
  restrictedUrl: string;
};

type AcquisitionWaiting = {
  kind: "waiting";
  statusLabel: string;
  progressPercent: number | null;
  resumeMarker: CachedProviderResumeMarker;
};

type AcquisitionLinksReady = {
  kind: "links-ready";
  resumeMarker: CachedProviderResumeMarker;
  readyLinks: ReadyLink[];
};

export type AcquisitionStatus = AcquisitionWaiting | AcquisitionLinksReady;

type ProviderSelectionCandidate = {
  file: TorrentFileDto;
  selectionId: string;
};

type ProviderSource = {
  magnetUri: string;
  partLabel: string | null;
};

class RealDebridHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "RealDebridHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class RequestBudget {
  private blockedUntil: number | null = null;
  private nextRequestAt: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly sleep: (durationMs: number) => Promise<void>,
    private readonly interRequestDelayMs: number,
    private readonly onRateLimit: (
      delayMs: number,
      usedFallbackDelay: boolean,
      retryAttempt: number,
    ) => void,
  ) {}

  async run<T>(block: () => Promise<T>): Promise<T> {
    for (let retryAttempt = 0; ; retryAttempt += 1) {
      await this.delayIfRequired();
      try {
        const result = await block();
        this.recordInterRequestDelay();
        return result;
      } catch (error) {
        this.recordInterRequestDelay();
        if (
          !(
            error instanceof RealDebridHttpError &&
            error.status === HTTP_TOO_MANY_REQUESTS &&
            retryAttempt < RATE_LIMIT_RETRY_DELAYS_MS.length
          )
        ) {
          throw error;
        }

        const retryDelayMs = error.retryAfterSeconds === null
          ? RATE_LIMIT_RETRY_DELAYS_MS[retryAttempt]
          : error.retryAfterSeconds * 1_000;
        this.recordRetryAfter(this.now() + retryDelayMs);
        this.onRateLimit(
          retryDelayMs,
          error.retryAfterSeconds === null,
          retryAttempt + 1,
        );
      }
    }
  }

  private async delayIfRequired() {
    const blockedUntil = Math.max(
      this.blockedUntil ?? 0,
      this.nextRequestAt ?? 0,
    );
    if (blockedUntil === 0) {
      return;
    }
    const remaining = blockedUntil - this.now();
    if (remaining <= 0) {
      this.blockedUntil = null;
      this.nextRequestAt = null;
      return;
    }
    await this.sleep(remaining);
    this.blockedUntil = null;
    this.nextRequestAt = null;
  }

  private recordInterRequestDelay() {
    this.imposeDelay(this.interRequestDelayMs);
  }

  imposeDelay(durationMs: number) {
    const nextRequestAt = this.now() + durationMs;
    const current = this.nextRequestAt;
    if (current === null || nextRequestAt > current) {
      this.nextRequestAt = nextRequestAt;
    }
  }

  private recordRetryAfter(until: number) {
    const current = this.blockedUntil;
    if (current === null || until > current) {
      this.blockedUntil = until;
    }
  }
}

type RealDebridClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (durationMs: number) => Promise<void>;
  now?: () => number;
  onLog?: (message: string, visibility?: HydrationLogVisibility) => void;
};

type ExactZipAcquisition = {
  exactMatch: CachedProviderFileRecord;
  status: AcquisitionStatus;
};

export class RealDebridClient {
  private readonly budget: RequestBudget;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (durationMs: number) => Promise<void>;
  private readonly onLog: (
    message: string,
    visibility?: HydrationLogVisibility,
  ) => void;

  constructor(
    private readonly apiKey: string,
    options: RealDebridClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleep ?? delay;
    this.onLog = options.onLog ?? (() => {});
    this.budget = new RequestBudget(
      options.now ?? Date.now,
      this.sleepImpl,
      REAL_DEBRID_INTER_REQUEST_DELAY_MS,
      (delayMs, usedFallbackDelay, retryAttempt) => {
        this.log(
          `Real-Debrid rate limited the simulator; retry ${retryAttempt} will wait ${formatDuration(delayMs)}${usedFallbackDelay ? " (fallback cooldown)." : "."}`,
          "basic",
        );
      },
    );
  }

  async cooldownBetweenSources() {
    this.log(
      `Cooling down ${formatDuration(REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS)} before the next source.`,
      "basic",
    );
    await this.sleepImpl(REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS);
  }

  async enumerateProviderFiles(
    sources: ProviderSource[],
  ): Promise<CachedProviderFileRecord[]> {
    const temporaryTorrentIds = new Set<string>();

    try {
      const files: CachedProviderFileRecord[] = [];
      for (const source of sources) {
        this.log(
          `provider-inventory: adding magnet for ${describeSource(source.magnetUri, source.partLabel)}.`,
          "verbose",
        );
        const host = await this.firstAvailableHost();
        this.log(`provider-inventory: selected host ${host}.`, "verbose");
        const addedTorrent = await this.budget.run(() =>
          this.postForm<AddedMagnetDto>("torrents/addMagnet", {
            magnet: source.magnetUri,
            host,
          }),
        );
        this.log(`provider-inventory: magnet added as torrent ${addedTorrent.id}.`, "verbose");
        temporaryTorrentIds.add(addedTorrent.id);
        const info = await this.readTorrentInfoWithRetry(addedTorrent.id);
        this.log(
          `provider-inventory: torrent ${addedTorrent.id} exposed ${info.files.length} provider file(s).`,
          "verbose",
        );
        const keyedFiles = withSelectionIds(info.files, source);
        for (const candidate of keyedFiles) {
          files.push({
            providerFileId: candidate.selectionId,
            originalName: substringAfterLast(
              substringAfterLast(candidate.file.path, "/"),
              "\\",
            ),
            path: candidate.file.path,
            sizeBytes: candidate.file.bytes ?? null,
            partLabel: source.partLabel,
            locator: {
              sourceMagnetUri: source.magnetUri,
              torrentId: addedTorrent.id,
              providerFileIds: [candidate.selectionId],
              selectedProviderFileId: candidate.selectionId,
              path: candidate.file.path,
              partLabel: source.partLabel,
            },
          });
        }
      }

      return files;
    } finally {
      for (const torrentId of temporaryTorrentIds) {
        try {
          this.log(`provider-inventory: deleting temporary torrent ${torrentId}.`, "verbose");
          await this.deleteTorrent(torrentId);
        } catch {
        }
      }
    }
  }

  async startExactZipAcquisition(
    sources: ProviderSource[],
    exactPath: string,
  ): Promise<ExactZipAcquisition> {
    const normalizedExactPath = normalizeProviderPath(exactPath);
    this.log(`archive-match: resolving exact path ${normalizedExactPath}.`, "verbose");

    for (const source of sources) {
      const host = await this.firstAvailableHost();
      this.log(`archive-selection: selected host ${host}.`, "verbose");
      this.log(
        `archive-selection: adding magnet for ${describeSource(source.magnetUri, source.partLabel)}.`,
        "verbose",
      );
      const addedTorrent = await this.budget.run(() =>
        this.postForm<AddedMagnetDto>("torrents/addMagnet", {
          magnet: source.magnetUri,
          host,
        }),
      );
      this.log(`archive-selection: magnet added as torrent ${addedTorrent.id}.`, "verbose");

      try {
        const info = await this.readTorrentInfoWithRetry(addedTorrent.id);
        const keyedFiles = withSelectionIds(info.files, source);
        const match = keyedFiles.find(
          (candidate) =>
            normalizeProviderPath(candidate.file.path) === normalizedExactPath,
        );

        if (!match) {
          this.log(
            `archive-match: exact path ${normalizedExactPath} was not present on torrent ${addedTorrent.id}; deleting temporary torrent.`,
            "verbose",
          );
          try {
            await this.deleteTorrent(addedTorrent.id);
          } catch {
          }
          continue;
        }

        const exactMatch: CachedProviderFileRecord = {
          providerFileId: match.selectionId,
          originalName: substringAfterLast(
            substringAfterLast(match.file.path, "/"),
            "\\",
          ),
          path: match.file.path,
          sizeBytes: match.file.bytes ?? null,
          partLabel: source.partLabel,
          locator: {
            sourceMagnetUri: source.magnetUri,
            torrentId: addedTorrent.id,
            providerFileIds: [match.selectionId],
            selectedProviderFileId: match.selectionId,
            path: match.file.path,
            partLabel: source.partLabel,
          },
        };

        this.log(
          `archive-match: matched provider file ${exactMatch.originalName} on torrent ${addedTorrent.id}.`,
          "verbose",
        );
        const marker = await this.selectMatchedFiles(
          addedTorrent.id,
          [String(match.file.id)],
          source.magnetUri,
        );
        const verifiedMarker = await this.verifySelection(marker);
        const status = await this.inspectAcquisition(verifiedMarker);
        return {
          exactMatch,
          status,
        };
      } catch (error) {
        try {
          await this.deleteTorrent(addedTorrent.id);
        } catch {
        }
        throw error;
      }
    }

    throw new Error(`Exact zip path was not found: ${exactPath}`);
  }

  async findExactZipMatch(
    sources: ProviderSource[],
    exactPath: string,
  ): Promise<CachedProviderFileRecord> {
    this.log(
      `archive-match: resolving exact path ${normalizeProviderPath(exactPath)}.`,
      "verbose",
    );
    const inventory = await this.enumerateProviderFiles(sources);
    const match = inventory.find(
      (file) => normalizeProviderPath(file.path) === normalizeProviderPath(exactPath),
    );

    if (!match) {
      throw new Error(`Exact zip path was not found: ${exactPath}`);
    }

    this.log(
      `archive-match: matched provider file ${match.originalName} via torrent ${match.locator.torrentId}.`,
      "verbose",
    );

    return match;
  }

  async startAcquisition(locator: CachedProviderLocator): Promise<AcquisitionStatus> {
    this.log(
      `archive-acquisition: starting selection for ${normalizeProviderPath(locator.path)}.`,
      "verbose",
    );
    const marker = await this.startSelection(locator);
    const verifiedMarker = await this.verifySelection(marker);
    return this.inspectAcquisition(verifiedMarker);
  }

  async resumeAcquisition(
    marker: CachedProviderResumeMarker,
  ): Promise<AcquisitionStatus> {
    this.log(`archive-acquisition: resuming torrent ${marker.torrentId}.`, "verbose");
    const verifiedMarker = await this.verifySelection(marker);
    return this.inspectAcquisition(verifiedMarker);
  }

  async materializeArchiveContainer(
    exactMatch: CachedProviderFileRecord,
    acquisitionStatus: AcquisitionLinksReady,
  ): Promise<CachedArchiveContainer> {
    if (acquisitionStatus.readyLinks.length !== 1) {
      throw new Error("Exact zip link mapping was not available");
    }
    this.log(
      `archive-materialize: unrestricting selected archive link for torrent ${acquisitionStatus.resumeMarker.torrentId}.`,
      "verbose",
    );
    const unrestricted = await this.budget.run(() =>
      this.postForm<UnrestrictedLinkDto>("unrestrict/link", {
        link: acquisitionStatus.readyLinks[0].restrictedUrl,
      }),
    );
    this.log(
      `archive-materialize: unrestricted archive name ${unrestricted.filename ?? exactMatch.originalName}.`,
      "verbose",
    );

    return {
      archiveUrl: unrestricted.download,
      originalName: unrestricted.filename ?? exactMatch.originalName,
      providerLocator: {
        ...exactMatch.locator,
        torrentId: acquisitionStatus.resumeMarker.torrentId,
      },
    };
  }

  async releaseAcquisition(marker: CachedProviderResumeMarker) {
    this.log(
      `archive-cleanup: deleting provider torrent ${marker.torrentId}.`,
      "verbose",
    );
    await this.deleteTorrent(marker.torrentId);
  }

  private async startSelection(
    locator: CachedProviderLocator,
  ): Promise<CachedProviderResumeMarker> {
    const host = await this.firstAvailableHost();
    this.log(`archive-selection: selected host ${host}.`, "verbose");
    const addedTorrent = await this.budget.run(() =>
      this.postForm<AddedMagnetDto>("torrents/addMagnet", {
        magnet: locator.sourceMagnetUri,
        host,
      }),
    );
    this.log(`archive-selection: magnet added as torrent ${addedTorrent.id}.`, "verbose");
    const info = await this.readTorrentInfoWithRetry(addedTorrent.id);
    const keyedFiles = withSelectionIds(info.files, {
      magnetUri: locator.sourceMagnetUri,
      partLabel: locator.partLabel,
    });
    const selectedSelectionIds = [...locator.providerFileIds].sort();
    const selectedFiles = keyedFiles.filter(
      (candidate) => selectedSelectionIds.includes(candidate.selectionId),
    );

    const actualSelectionIds = selectedFiles
      .map((candidate) => candidate.selectionId)
      .sort();
    if (JSON.stringify(actualSelectionIds) !== JSON.stringify(selectedSelectionIds)) {
      throw new Error("Queued provider selection could not be resolved on fresh provider torrent");
    }

    const selectedProviderFileIds = selectedFiles
      .map((candidate) => String(candidate.file.id))
      .sort();
    return this.selectMatchedFiles(
      addedTorrent.id,
      selectedProviderFileIds,
      locator.sourceMagnetUri,
    );
  }

  private async selectMatchedFiles(
    torrentId: string,
    providerFileIds: string[],
    sourceMagnetUri: string,
  ): Promise<CachedProviderResumeMarker> {
    const selectedProviderFileIds = [...providerFileIds].sort();
    this.log(
      `archive-selection: selecting provider file ids ${selectedProviderFileIds.join(",")} on torrent ${torrentId}.`,
      "verbose",
    );
    await this.budget.run(() =>
      this.postFormVoid(`torrents/selectFiles/${torrentId}`, {
        files: selectedProviderFileIds.join(","),
      }),
    );

    return {
      torrentId,
      sourceMagnetUri,
      selectedProviderFileIds,
    };
  }

  private async verifySelection(
    marker: CachedProviderResumeMarker,
  ): Promise<CachedProviderResumeMarker> {
    const expectedSelection = [...marker.selectedProviderFileIds].sort();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const info = await this.getTorrentInfo(marker.torrentId);
      failIfTerminalStatus(info.status);
      const actualSelection = info.files
        .filter((file) => file.selected === SELECTED_FLAG)
        .map((file) => String(file.id))
        .sort();
      if (JSON.stringify(actualSelection) === JSON.stringify(expectedSelection)) {
        this.log(
          `archive-selection: verified torrent ${marker.torrentId} with ${actualSelection.length} selected file(s).`,
          "verbose",
        );
        return marker;
      }
      this.log(
        `archive-selection: verification attempt ${attempt + 1} for torrent ${marker.torrentId} saw ${actualSelection.length}/${expectedSelection.length} selected file(s).`,
        "verbose",
      );
      if (attempt < 4) {
        await delay(500);
      }
    }

    throw new Error(`Provider selection did not stick for torrent ${marker.torrentId}`);
  }

  private async inspectAcquisition(
    marker: CachedProviderResumeMarker,
  ): Promise<AcquisitionStatus> {
    const info = await this.getTorrentInfo(marker.torrentId);
    failIfTerminalStatus(info.status);
    const readyLinks = this.readyLinks(info, marker);
    this.log(
      `archive-acquisition: torrent ${marker.torrentId} status=${info.status?.trim() || "unknown"} progress=${info.progress ?? "unknown"} readyLinks=${readyLinks.length}.`,
      "verbose",
    );
    if (readyLinks.length === 0) {
      return {
        kind: "waiting",
        statusLabel: info.status?.trim() || "unknown",
        progressPercent: info.progress ?? null,
        resumeMarker: marker,
      };
    }

    return {
      kind: "links-ready",
      resumeMarker: marker,
      readyLinks,
    };
  }

  private readyLinks(
    info: TorrentInfoDto,
    marker: CachedProviderResumeMarker,
  ): ReadyLink[] {
    const selectedFiles = info.files.filter(
      (file) =>
        file.selected === SELECTED_FLAG &&
        marker.selectedProviderFileIds.includes(String(file.id)),
    );
    const selectedFileLinks = selectedFiles
      .map((file) => [file.link, file.unrestricted].find((value) => value?.trim()))
      .filter((value): value is string => Boolean(value))
      .map((restrictedUrl) => ({ restrictedUrl }));
    const distinctSelectedFileLinks = dedupeLinks(selectedFileLinks);
    if (distinctSelectedFileLinks.length > 0) {
      return distinctSelectedFileLinks;
    }

    const fallbackLinks = dedupeLinks(
      info.links
        .filter((link) => link.trim().length > 0)
        .map((restrictedUrl) => ({ restrictedUrl })),
    );
    if (fallbackLinks.length > 1 && selectedFiles.length <= 1) {
      throw new Error("Provider returned multiple ready links for one selected file");
    }
    return fallbackLinks;
  }

  private async firstAvailableHost(): Promise<string> {
    const hosts = await this.budget.run(() =>
      this.getJson<AvailableHostDto[]>("torrents/availableHosts"),
    );
    const host = hosts[0]?.host;
    if (!host) {
      throw new Error("No Real-Debrid hosts are available");
    }
    return host;
  }

  private async getTorrentInfo(torrentId: string): Promise<TorrentInfoDto> {
    this.log(`provider-torrent-info: reading torrent ${torrentId}.`, "verbose");
    return this.budget.run(() => this.getJson<TorrentInfoDto>(`torrents/info/${torrentId}`));
  }

  private async readTorrentInfoWithRetry(torrentId: string): Promise<TorrentInfoDto> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.getTorrentInfo(torrentId);
      } catch (error) {
        if (
          error instanceof RealDebridHttpError &&
          error.status === HTTP_NOT_FOUND &&
          attempt < 2
        ) {
          await delay(500);
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Torrent info could not be loaded for ${torrentId}`);
  }

  private async deleteTorrent(torrentId: string): Promise<void> {
    await this.budget.run(() => this.delete(`torrents/delete/${torrentId}`));
  }

  private async getJson<T>(resource: string): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${resource}`, {
      method: "GET",
      headers: this.authHeaders(),
    });
    return parseJsonResponse<T>(response);
  }

  private async postForm<T>(
    resource: string,
    body: Record<string, string>,
  ): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${resource}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    return parseJsonResponse<T>(response);
  }

  private async postFormVoid(
    resource: string,
    body: Record<string, string>,
  ): Promise<void> {
    const response = await this.fetchImpl(`${BASE_URL}${resource}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    await ensureSuccess(response);
  }

  private async delete(resource: string): Promise<void> {
    const response = await this.fetchImpl(`${BASE_URL}${resource}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });
    await ensureSuccess(response);
  }

  private authHeaders() {
    const trimmed = this.apiKey.trim();
    if (trimmed.length === 0) {
      throw new Error("REAL_DEBRID_API_KEY is missing");
    }
    return {
      Authorization: `Bearer ${trimmed}`,
    };
  }

  private log(message: string, visibility: HydrationLogVisibility = "verbose") {
    this.onLog(message, visibility);
  }
}

function withSelectionIds(
  files: TorrentFileDto[],
  source: ProviderSource,
): ProviderSelectionCandidate[] {
  const occurrences = new Map<string, number>();
  return files.map((file) => {
    const normalizedPath = normalizeProviderPath(file.path);
    const occurrenceKey = `${normalizedPath}|${file.bytes ?? "unknown"}`;
    const occurrenceIndex = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrenceIndex);
    return {
      file,
      selectionId: providerSelectionId(
        source,
        normalizedPath,
        file.bytes ?? null,
        occurrenceIndex,
      ),
    };
  });
}

function providerSelectionId(
  source: ProviderSource,
  normalizedPath: string,
  sizeBytes: number | null,
  occurrenceIndex: number,
): string {
  const seed = [
    source.magnetUri,
    source.partLabel ?? "",
    normalizedPath,
    sizeBytes === null ? "unknown" : String(sizeBytes),
    String(occurrenceIndex),
  ].join("|");

  return createHash("md5").update(seed).digest("hex");
}

export function normalizeProviderPath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").replace(/^\/+/, "");
}

function substringAfterLast(value: string, needle: string): string {
  const index = value.lastIndexOf(needle);
  return index >= 0 ? value.slice(index + needle.length) : value;
}

function failIfTerminalStatus(status: string | null | undefined) {
  const normalizedStatus = status?.trim().toLowerCase() ?? "";
  if (TERMINAL_FAILURE_STATUSES.has(normalizedStatus)) {
    throw new Error(`Provider acquisition failed with status: ${status ?? "unknown"}`);
  }
}

function dedupeLinks(links: ReadyLink[]): ReadyLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.restrictedUrl)) {
      return false;
    }
    seen.add(link.restrictedUrl);
    return true;
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  await ensureSuccess(response);
  const body = await response.text();
  if (body.trim().length === 0) {
    throw new Error("Real-Debrid returned an empty response body where JSON was expected");
  }
  return JSON.parse(body) as T;
}

async function ensureSuccess(response: Response) {
  if (response.ok) {
    return;
  }
  if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
    throw new Error("Real-Debrid authentication failed");
  }
  const message = await response.text();
  throw new RealDebridHttpError(
    response.status,
    message || `${response.status} ${response.statusText}`,
    parseRetryAfter(response.headers.get("Retry-After")),
  );
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function formatDuration(durationMs: number) {
  return `${Math.ceil(durationMs / 1_000)}s`;
}

function describeSource(magnetUri: string, partLabel: string | null) {
  const hash = magnetUri.slice(-12);
  return partLabel ? `${partLabel} (${hash})` : hash;
}
