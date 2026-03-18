import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";

import initialSimulatorState from "virtual:romulus-simulator-state";

import {
  formatArchiveSampleExtensions,
  parseArchiveSampleExtensionsInput,
} from "./archiveSamplePolicy";
import { isSupportedArchiveName } from "./archiveSupport";
import {
  applyRenameRule,
  type ArchiveFixtureDescriptor,
  type ArchiveFixtureSampleDescriptor,
  buildDownloadPreview,
  finalOutputName,
  type PreviewTreeNode,
} from "./downloadPreview";
import { compileIgnoreMatcher, isValidIgnoreRule } from "./ignoreRules";
import {
  analyzeParentheticalSuffixes,
  applyManagedRenameRule,
  buildManagedRenameRule,
  detectManagedRenamePolicy,
} from "./policyAnalysis";
import {
  beginEntryRequest,
  buildPhraseOptions,
  isLatestEntryRequest,
  matchSourceFilesToEntry,
  shouldForceSourceRefresh,
  syncSourcePolicyEditorState,
  type ManagedRenameDraft,
  type PendingPolicySave,
  toggleSourceFileSelection,
  updateSourceFilesForEntry,
} from "./sourcePolicyEditor";
import type {
  PreviewEntry,
  PreviewFixture,
  PreviewFixtureSample,
  SimulatorState,
  SourceFilesState,
  SourceFileRow,
} from "./types";

type SourcePolicyDraft = {
  entryId: string;
  renameMode: ManagedRenameDraft["mode"];
  renamePhrases: string[];
  ignoreGlobs: string[];
  renameDirty: boolean;
  ignoreDirty: boolean;
  hasUnsavedChanges: boolean;
};

function App() {
  const [state, setState] = useState<SimulatorState>(initialSimulatorState);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<SourceFilesState | null>(null);
  const [sourcePolicyDraft, setSourcePolicyDraft] = useState<SourcePolicyDraft | null>(null);
  const [infoEntryId, setInfoEntryId] = useState<string | null>(null);
  const [showConfigDetails, setShowConfigDetails] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showHydrationModal, setShowHydrationModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showVerboseLogs, setShowVerboseLogs] = useState(false);
  const [hydrationRequestError, setHydrationRequestError] = useState<string | null>(null);
  const [sourceFilesRequestError, setSourceFilesRequestError] = useState<string | null>(null);
  const [sourceFilesRequestRevision, setSourceFilesRequestRevision] = useState(0);
  const [previewRequestError, setPreviewRequestError] = useState<string | null>(null);
  const [showArchivePatternModal, setShowArchivePatternModal] = useState(false);
  const [archivePatternDraft, setArchivePatternDraft] = useState("");
  const [archivePatternError, setArchivePatternError] = useState<string | null>(null);
  const [savingArchivePattern, setSavingArchivePattern] = useState(false);
  const selectedEntryIdRef = useRef<string | null>(selectedEntryId);
  const selectedFileSaveRevisionRef = useRef(new Map<string, number>());
  const previewFixtureSaveRevisionRef = useRef(new Map<string, number>());
  const archivePatternSaveRevisionRef = useRef(new Map<string, number>());

  const selectedEntry =
    state.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const selectedEntryHydrationState =
    selectedEntryId ? state.hydration.sourceStates[selectedEntryId] ?? null : null;
  const selectedEntrySourceFiles = matchSourceFilesToEntry(
    selectedEntry?.id ?? null,
    selectedSourceFiles,
  );
  const infoEntry =
    state.entries.find((entry) => entry.id === infoEntryId) ?? null;
  const activeDraft =
    selectedEntry && sourcePolicyDraft?.entryId === selectedEntry.id
      ? sourcePolicyDraft
      : null;
  const analysisFileNames = useMemo(
    () =>
      selectedEntrySourceFiles?.sourceStatus === "ready"
        ? (selectedEntrySourceFiles?.analysisOriginalNames ??
          selectedEntrySourceFiles?.analysisFiles?.map((file) => file.originalName) ??
          selectedEntrySourceFiles?.files.map((file) => file.originalName) ??
          [])
        : [],
    [selectedEntrySourceFiles],
  );
  const availableDraftPhrases = useMemo(
    () =>
      analyzeParentheticalSuffixes(analysisFileNames).parentheticalPhrases.map(
        (phrase) => phrase.phrase,
      ),
    [analysisFileNames],
  );
  const normalizedDraftIgnoreGlobs = useMemo(
    () => normalizeSourcePolicyGlobs(activeDraft?.ignoreGlobs ?? []),
    [activeDraft],
  );
  const hasInvalidDraftIgnoreGlobs = useMemo(
    () => normalizedDraftIgnoreGlobs.some((glob) => !isValidIgnoreRule(glob)),
    [normalizedDraftIgnoreGlobs],
  );
  const effectiveEntry = useMemo(() => {
    if (!selectedEntry) {
      return null;
    }
    if (!activeDraft?.hasUnsavedChanges) {
      return selectedEntry;
    }

    const renameRule = activeDraft.renameDirty
      ? buildManagedRenameRule(
          activeDraft.renameMode,
          activeDraft.renameMode === "all"
            ? availableDraftPhrases
            : activeDraft.renamePhrases,
          availableDraftPhrases,
        )
      : selectedEntry.renameRule;
    const ignoreGlobs =
      activeDraft.ignoreDirty && !hasInvalidDraftIgnoreGlobs
        ? normalizedDraftIgnoreGlobs
        : selectedEntry.ignoreGlobs;

    return {
      ...selectedEntry,
      renameRule,
      ignoreGlobs,
    };
  }, [
    activeDraft,
    availableDraftPhrases,
    hasInvalidDraftIgnoreGlobs,
    normalizedDraftIgnoreGlobs,
    selectedEntry,
  ]);
  const effectiveSourceFiles = useMemo(() => {
    if (!selectedEntrySourceFiles || selectedEntrySourceFiles.sourceStatus !== "ready") {
      return selectedEntrySourceFiles;
    }

    const rawFiles = selectedEntrySourceFiles.analysisFiles ?? selectedEntrySourceFiles.files;
    const ignoreGlobs =
      activeDraft?.ignoreDirty && !hasInvalidDraftIgnoreGlobs
        ? normalizedDraftIgnoreGlobs
        : selectedEntry?.ignoreGlobs ?? [];
    const visibleFiles = filterSourceFilesByIgnoreGlobs(rawFiles, ignoreGlobs);
    const visibleFileIds = new Set(visibleFiles.map((file) => file.id));

    return {
      ...selectedEntrySourceFiles,
      files: visibleFiles,
      selectedRowIds: (selectedEntrySourceFiles.selectedRowIds ?? []).filter((fileId) =>
        visibleFileIds.has(fileId),
      ),
    };
  }, [
    activeDraft,
    hasInvalidDraftIgnoreGlobs,
    normalizedDraftIgnoreGlobs,
    selectedEntry?.ignoreGlobs,
    selectedEntrySourceFiles,
  ]);
  const selectedRowIds = effectiveSourceFiles?.selectedRowIds ?? [];
  const archiveSampleExtensions = selectedEntrySourceFiles?.archiveSampleExtensions ?? [];
  const selectedActualRows = useMemo(() => {
    if (!effectiveSourceFiles || !effectiveEntry) {
      return [];
    }
    const selectedSet = new Set(selectedRowIds);
    return effectiveSourceFiles.files.filter((file) => selectedSet.has(file.id));
  }, [effectiveEntry, effectiveSourceFiles, selectedRowIds]);
  const downloadPreview = useMemo(
    () =>
      effectiveEntry
        ? buildDownloadPreview(effectiveEntry, effectiveSourceFiles, selectedActualRows)
        : {
            tree: {
              name: "/",
              pathKey: "",
              kind: "folder" as const,
              children: [],
            },
            archiveFixtures: [],
          },
    [effectiveEntry, effectiveSourceFiles, selectedActualRows],
  );
  const missingSourceNames = state.entries
    .filter((entry) => state.hydration.missingSourceIds.includes(entry.id))
    .map((entry) => entry.displayName);
  const visibleLogs = useMemo(
    () =>
      state.hydration.logs.filter(
        (entry) => showVerboseLogs || entry.visibility === "basic",
      ),
    [showVerboseLogs, state.hydration.logs],
  );
  const selectedEntryHydrationRefreshKey = useMemo(() => {
    if (!selectedEntryId) {
      return null;
    }
    return JSON.stringify({
      entryId: selectedEntryId,
      status: selectedEntryHydrationState?.status ?? "missing",
      updatedAt: selectedEntryHydrationState?.updatedAt ?? null,
      errorMessage: selectedEntryHydrationState?.errorMessage ?? null,
    });
  }, [
    selectedEntryHydrationState?.errorMessage,
    selectedEntryHydrationState?.status,
    selectedEntryHydrationState?.updatedAt,
    selectedEntryId,
  ]);
  const hasOpenModal =
    showHydrationModal || showLogModal || infoEntry !== null;

  useEffect(() => {
    selectedEntryIdRef.current = selectedEntryId;
  }, [selectedEntryId]);

  useEffect(() => {
    setArchivePatternDraft(formatArchiveSampleExtensions(archiveSampleExtensions));
    setArchivePatternError(null);
    if (selectedEntry?.unarchive && selectedEntrySourceFiles && archiveSampleExtensions.length === 0) {
      setShowArchivePatternModal(true);
      return;
    }
    setShowArchivePatternModal(false);
  }, [
    archiveSampleExtensions,
    selectedEntry?.id,
    selectedEntry?.unarchive,
    selectedEntrySourceFiles?.entryId,
  ]);

  useEffect(() => {
    void refreshState();
    const eventSource = new EventSource("/__simulator/events");
    eventSource.addEventListener("state", () => {
      void refreshState();
    });
    eventSource.addEventListener("config-updated", () => {
      void handleConfigUpdated();
    });
    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedEntryId) {
      setSelectedSourceFiles(null);
      setSourcePolicyDraft(null);
      setSourceFilesRequestError(null);
      return;
    }
    setSelectedSourceFiles((current) => (current?.entryId === selectedEntryId ? current : null));
    setSourceFilesRequestError(null);
    let cancelled = false;
    void loadSourceFiles(selectedEntryId)
      .then((nextState) => {
        if (!cancelled) {
          setSelectedSourceFiles(nextState);
          setSourceFilesRequestError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSourceFilesRequestError(
            error instanceof Error
              ? error.message
              : "Source files could not be loaded",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEntryHydrationRefreshKey, selectedEntryId, sourceFilesRequestRevision]);

  useEffect(() => {
    if (!hasOpenModal) {
      document.body.style.overflow = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hasOpenModal]);

  async function refreshState() {
    try {
      const response = await fetch("/__simulator/state");
      if (!response.ok) {
        return null;
      }
      const nextState = (await response.json()) as SimulatorState;
      setState(nextState);
      return nextState;
    } catch {
      return null;
    }
  }

  async function handleConfigUpdated() {
    const nextState = await refreshState();
    if (!nextState) {
      return;
    }

    const selectedEntryId = selectedEntryIdRef.current;
    if (!selectedEntryId) {
      toast.success("Config updated");
      return;
    }

    const selectedEntryStillExists = nextState.entries.some(
      (entry) => entry.id === selectedEntryId,
    );
    if (selectedEntryStillExists) {
      toast.success("Config updated");
      return;
    }

    setSelectedEntryId(null);
    toast.success("Selected source changed, returned to source list");
  }

  async function loadSourceFiles(entryId: string) {
    const response = await fetch(
      `/__simulator/source-files?entryId=${encodeURIComponent(entryId)}`,
    );
    if (!response.ok) {
      throw new Error("Source files could not be loaded");
    }
    return (await response.json()) as SourceFilesState;
  }

  async function startHydration() {
    await requestHydration(state.entries.map((entry) => entry.id), false);
  }

  async function requestHydration(
    entryIds: string[],
    forceRefresh: boolean,
  ) {
    setHydrationRequestError(null);
    try {
      const response = await fetch("/__simulator/hydrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryIds,
          forceRefresh,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "The update could not be started");
      }
      setShowHydrationModal(false);
      await refreshState();
    } catch (error) {
      setHydrationRequestError(
        error instanceof Error ? error.message : "The update could not be started",
      );
    }
  }

  async function refreshSelectedSource() {
    if (!selectedEntry) {
      return;
    }
    const forceRefresh = shouldForceSourceRefresh(
      selectedEntry.scope.isArchiveSelection,
      selectedEntryHydrationState?.status,
    );
    await requestHydration([selectedEntry.id], forceRefresh);
  }

  async function savePreviewFixture(
    nextFixture: PreviewFixture,
  ) {
    if (!selectedEntry || !selectedSourceFiles) {
      return;
    }
    const requestEntryId = selectedEntry.id;
    const requestKey = `${requestEntryId}:${nextFixture.fixtureKey}`;
    const requestRevision = beginEntryRequest(
      previewFixtureSaveRevisionRef.current,
      requestKey,
    );
    setPreviewRequestError(null);
    try {
      const response = await fetch("/__simulator/preview-fixtures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId: requestEntryId,
          fixtureKey: nextFixture.fixtureKey,
          sourceFileId: nextFixture.sourceFileId,
          archiveDisplayName: nextFixture.archiveDisplayName,
          archiveBaseName: nextFixture.archiveBaseName,
          samples: nextFixture.samples,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "The example file could not be saved");
      }
      const savedFixture = (await response.json()) as PreviewFixture;
      if (
        !isLatestEntryRequest(
          previewFixtureSaveRevisionRef.current,
          requestKey,
          requestRevision,
        )
      ) {
        return;
      }
      setSelectedSourceFiles((current) =>
        updateSourceFilesForEntry(current, requestEntryId, (matchingSourceFiles) => ({
          ...matchingSourceFiles,
          previewFixtures: upsertPreviewFixture(
            matchingSourceFiles.previewFixtures,
            savedFixture,
          ),
        })),
      );
    } catch (error) {
      if (
        !isLatestEntryRequest(
          previewFixtureSaveRevisionRef.current,
          requestKey,
          requestRevision,
        )
      ) {
        return;
      }
      setPreviewRequestError(
        error instanceof Error ? error.message : "The example file could not be saved",
      );
    }
  }

  async function saveArchiveSampleExtensions(fileExtensions: string[]) {
    if (!selectedEntry) {
      throw new Error("No source is selected");
    }

    const requestEntryId = selectedEntry.id;
    const requestKey = `${requestEntryId}:archive-sample-extensions`;
    const requestRevision = beginEntryRequest(
      archivePatternSaveRevisionRef.current,
      requestKey,
    );

    const response = await fetch("/__simulator/archive-sample-extensions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entryId: requestEntryId,
        fileExtensions,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      fileExtensions?: string[];
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "The unarchived file pattern could not be saved");
    }
    if (
      !isLatestEntryRequest(
        archivePatternSaveRevisionRef.current,
        requestKey,
        requestRevision,
      )
    ) {
      return;
    }

    setSelectedSourceFiles((current) =>
      updateSourceFilesForEntry(current, requestEntryId, (matchingSourceFiles) => ({
        ...matchingSourceFiles,
        archiveSampleExtensions: payload.fileExtensions ?? [],
      })),
    );
  }

  async function submitArchivePattern() {
    const nextFileExtensions = parseArchiveSampleExtensionsInput(archivePatternDraft);
    if (nextFileExtensions.length === 0) {
      setArchivePatternError("Enter at least one file extension.");
      return;
    }

    setSavingArchivePattern(true);
    setArchivePatternError(null);
    try {
      await saveArchiveSampleExtensions(nextFileExtensions);
      setShowArchivePatternModal(false);
    } catch (error) {
      setArchivePatternError(
        error instanceof Error
          ? error.message
          : "The unarchived file pattern could not be saved",
      );
    } finally {
      setSavingArchivePattern(false);
    }
  }

  async function saveSelectedRowIds(nextSelectedRowIds: string[]) {
    if (!selectedEntry || !selectedSourceFiles) {
      return;
    }
    const requestEntryId = selectedEntry.id;
    const requestRevision = beginEntryRequest(
      selectedFileSaveRevisionRef.current,
      requestEntryId,
    );

    const previousSelectedRowIds = selectedSourceFiles.selectedRowIds ?? [];
    setSelectedSourceFiles((current) =>
      updateSourceFilesForEntry(current, requestEntryId, (matchingSourceFiles) => ({
        ...matchingSourceFiles,
        selectedRowIds: nextSelectedRowIds,
      })),
    );

    try {
      const response = await fetch("/__simulator/selected-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId: requestEntryId,
          selectedRowIds: nextSelectedRowIds,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Selected files could not be saved");
      }
      const payload = (await response.json()) as { selectedRowIds?: string[] };
      if (
        !isLatestEntryRequest(
          selectedFileSaveRevisionRef.current,
          requestEntryId,
          requestRevision,
        )
      ) {
        return;
      }
      setSelectedSourceFiles((current) =>
        updateSourceFilesForEntry(current, requestEntryId, (matchingSourceFiles) => ({
          ...matchingSourceFiles,
          selectedRowIds: payload.selectedRowIds ?? [],
        })),
      );
    } catch (error) {
      if (
        !isLatestEntryRequest(
          selectedFileSaveRevisionRef.current,
          requestEntryId,
          requestRevision,
        )
      ) {
        return;
      }
      setSelectedSourceFiles((current) =>
        updateSourceFilesForEntry(current, requestEntryId, (matchingSourceFiles) => ({
          ...matchingSourceFiles,
          selectedRowIds: previousSelectedRowIds,
        })),
      );
      toast.error(
        error instanceof Error ? error.message : "Selected files could not be saved",
      );
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Romulus Config Simulator</p>
          <h1>Romulus Config Simulator</h1>
          <p className="hero-copy">
            This page reads <code>source.json</code> directly, checks that it is
            valid, and updates when the file changes. Use{" "}
            <strong>Update Database</strong> to load file lists from Real-Debrid,
            then open a source to preview what Romulus will show and where files
            will be saved
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowHydrationModal(true)}
            disabled={state.entries.length === 0 || state.hydration.running}
          >
            {state.hydration.running ? "Updating Database..." : "Update Database"}
          </button>
          <div className="hero-meta-inline">
            <span>Last updated</span>
            <strong>
              {state.hydration.lastHydratedAt
                ? formatTimestamp(state.hydration.lastHydratedAt)
                : "Never"}
            </strong>
          </div>
          {state.hydration.running || state.hydration.logs.length > 0 ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowLogModal(true)}
            >
              View Logs
            </button>
          ) : null}
        </div>
      </section>

      <article className="panel">
        <div className="validation-header">
          <div>
            <h2>Config Validation</h2>
            <p>
              Status:{" "}
              <strong>{state.status === "accepted" ? "Accepted" : "Error"}</strong>
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowConfigDetails((value) => !value)}
          >
            {showConfigDetails ? "Hide details" : "Show details"}
          </button>
        </div>

        {showConfigDetails ? (
          <dl className="details-grid">
            <DetailRow label="Config" value={state.configPath} />
            <DetailRow label="Schema" value={state.schemaPath} />
          </dl>
        ) : null}

        {state.issues.length > 0 ? (
          <div className="error-box">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowErrorDetails((value) => !value)}
            >
              {showErrorDetails ? "Hide errors" : "Show errors"}
            </button>
            {showErrorDetails ? (
              <ul className="issue-list">
                {state.issues.map((issue) => (
                  <li key={`${issue.kind}-${issue.message}`}>
                    <span className="issue-kind">{issue.kind}</span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </article>

      {!selectedEntry ? (
        <section className="source-list-section">
          {state.entries.length === 0 ? (
            <EmptyState
              title="No sources to preview yet"
              body="Fix the config issues above, or add at least one source entry to source.json."
            />
          ) : (
            <div className="source-list">
              {state.entries.map((entry) => {
                const sourceState = state.hydration.sourceStates[entry.id];
                return (
                  <div key={entry.id} className="source-row">
                    <button
                      type="button"
                      className="source-select"
                      onClick={() => setSelectedEntryId(entry.id)}
                    >
                      <div>
                        <strong>{entry.displayName}</strong>
                        <p>{entry.subfolder}</p>
                      </div>
                      <div className="source-meta">
                        <span>{entry.scope.isArchiveSelection ? "ZIP source" : "Folder source"}</span>
                        <small className={`source-status ${sourceState?.status ?? "missing"}`}>
                          {formatSourceStatus(sourceState?.status ?? "missing")}
                        </small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="info-button"
                      onClick={() => setInfoEntryId(entry.id)}
                      aria-label={`Show info for ${entry.displayName}`}
                    >
                      i
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {selectedEntry ? (
        <>
          <div className="workbench-header">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelectedEntryId(null)}
            >
              Back to sources
            </button>
            <div>
              <p className="workbench-kicker">Selected source</p>
              <strong>{selectedEntry.displayName}</strong>
            </div>
          </div>

          <section className="workbench-layout">
            <article className="panel workbench-panel">
              <div className="panel-title-row">
                <PanelTitle
                  title="Files List Preview"
                  subtitle="Preview the files you want Romulus to show for this source"
                />
                <button
                  type="button"
                  className="ghost-button"
                  disabled={state.hydration.running || !state.hydration.apiKeyConfigured}
                  onClick={() => {
                    void refreshSelectedSource();
                  }}
                >
                  Refresh Source
                </button>
              </div>
              <div className="panel-scroll-body">
                <FilesPanel
                  entry={effectiveEntry ?? selectedEntry}
                  sourceFiles={effectiveSourceFiles}
                  errorMessage={sourceFilesRequestError}
                  selectedRowIds={selectedRowIds}
                  onRetry={() => {
                    setSourceFilesRequestRevision((current) => current + 1);
                  }}
                  onToggle={(fileId) => {
                    const nextIds = toggleSourceFileSelection(
                      selectedEntrySourceFiles?.selectedRowIds ?? [],
                      effectiveSourceFiles?.files.map((file) => file.id) ?? [],
                      fileId,
                    );
                    void saveSelectedRowIds(nextIds);
                  }}
                />
              </div>
            </article>

            <article className="panel workbench-panel preview-workbench-panel">
              <div className="panel-title-row">
                <PanelTitle
                  title="Download Folder Preview"
                  subtitle="Preview where the selected files would end up after your current rules are applied"
                />
                {selectedEntry.unarchive ? (
                  <div className="preview-pattern-toolbar">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setArchivePatternDraft(
                          formatArchiveSampleExtensions(archiveSampleExtensions),
                        );
                        setArchivePatternError(null);
                        setShowArchivePatternModal(true);
                      }}
                    >
                      Edit pattern
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="panel-scroll-body">
                <DownloadPreviewPanel
                  entry={effectiveEntry ?? selectedEntry}
                  selectedRows={selectedActualRows}
                  sourceFiles={effectiveSourceFiles}
                  archiveFixtures={downloadPreview.archiveFixtures}
                  previewTree={downloadPreview.tree}
                  errorMessage={previewRequestError}
                  onSaveFixture={(fixture) => {
                    void savePreviewFixture(fixture);
                  }}
                />
              </div>
              {showArchivePatternModal ? (
                <div
                  className="preview-panel-overlay"
                  role="presentation"
                  onClick={() => setShowArchivePatternModal(false)}
                >
                  <div
                    className="preview-panel-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Unarchived File Pattern"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="modal-header">
                      <h2>Unarchived File Pattern</h2>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setShowArchivePatternModal(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="modal-body">
                      <div className="modal-copy">
                        <strong>{selectedEntry.displayName}</strong>
                        <p>
                          Enter the expected extracted file extensions for archives in this source,
                          separated by commas.
                        </p>
                      </div>
                      <div className="field-stack">
                        <label className="field">
                          <span>File extensions</span>
                          <input
                            type="text"
                            value={archivePatternDraft}
                            onChange={(event) => setArchivePatternDraft(event.target.value)}
                            placeholder=".cue, .bin"
                          />
                        </label>
                        {archivePatternError ? (
                          <div className="inline-error">{archivePatternError}</div>
                        ) : null}
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setShowArchivePatternModal(false)}
                          disabled={savingArchivePattern}
                        >
                          Not now
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => {
                            void submitArchivePattern();
                          }}
                          disabled={savingArchivePattern}
                        >
                          Save pattern
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          </section>

          <SourcePolicyWorkbench
            entry={selectedEntry}
            sourceFiles={selectedEntrySourceFiles}
            onDraftStateChange={setSourcePolicyDraft}
          />
        </>
      ) : null}

      {showLogModal ? (
        <Modal title="Update Logs" onClose={() => setShowLogModal(false)}>
          <div className="log-modal-toolbar">
            <div className="hero-meta-inline">
              <span>Status</span>
              <strong>{state.hydration.running ? "Updating" : "Idle"}</strong>
            </div>
            <div className="log-filter-group">
              <button
                type="button"
                className={showVerboseLogs ? "ghost-button" : "primary-button"}
                onClick={() => setShowVerboseLogs(false)}
              >
                Simple
              </button>
              <button
                type="button"
                className={showVerboseLogs ? "primary-button" : "ghost-button"}
                onClick={() => setShowVerboseLogs(true)}
              >
                Detailed
              </button>
            </div>
          </div>
          {visibleLogs.length === 0 ? (
            <EmptyState
              title="No update logs yet"
              body="Run Update Database to load file lists and watch progress here."
            />
          ) : (
            <ul className="log-list log-list-modal">
              {visibleLogs.map((entry) => (
                <li key={entry.id} className={`log-row ${entry.level}`}>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                  <strong>{entry.message}</strong>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}

      {showHydrationModal ? (
        <Modal
          title="Update Database"
          onClose={() => {
            setShowHydrationModal(false);
            setHydrationRequestError(null);
          }}
        >
          {!state.hydration.apiKeyConfigured ? (
            <p>
              Add your <code>REAL_DEBRID_API_KEY</code> to <code>simulator/.env.local</code>
              before loading file lists.
            </p>
          ) : missingSourceNames.length > 0 ? (
            <>
              <p>
                These sources have not been loaded into the local database yet:
              </p>
              <ul className="plain-list">
                {missingSourceNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>All sources already have saved file lists. Run this again to refresh them.</p>
          )}
          {hydrationRequestError ? (
            <div className="inline-error">{hydrationRequestError}</div>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setShowHydrationModal(false);
                setHydrationRequestError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!state.hydration.apiKeyConfigured || state.hydration.running}
              onClick={() => {
                void startHydration();
              }}
            >
              Start Update
            </button>
          </div>
        </Modal>
      ) : null}

      {infoEntry ? (
        <Modal
          title={infoEntry.displayName}
          onClose={() => setInfoEntryId(null)}
        >
          <div className="info-list">
            <InfoSectionTitle title="Source" />
            <InfoRow label="Name" value={infoEntry.displayName} />
            <InfoRow label="Subfolder" value={infoEntry.subfolder} />
            <InfoRow label="Scope path" value={infoEntry.scope.normalizedPath} />
            <InfoRow
              label="Nested files"
              value={
                infoEntry.scope.includeNestedFiles
                  ? "Include files in subfolders"
                  : "Only include files directly in this folder"
              }
            />
            <InfoRow
              label="Mode"
              value={
                infoEntry.scope.isArchiveSelection
                  ? "Browse inside one ZIP file"
                  : "Browse files directly from the torrent"
              }
            />
            <InfoRow
              label="Torrent links"
              value={String(infoEntry.torrents.length)}
            />
            <InfoSectionTitle title="File rules" />
            <InfoRow
              label="Rename"
              value={infoEntry.renameRule ? "Available" : "Not configured"}
            />
            <InfoRow
              label="Unarchive"
              value={infoEntry.unarchive ? "Available" : "Not configured"}
            />
            <InfoRow
              label="Extract nested archives by default"
              value={
                infoEntry.unarchive
                  ? (infoEntry.unarchive.recursive ? "Yes" : "No")
                  : "Not applicable"
              }
            />
            <InfoSectionTitle title="Filters" />
            <InfoRow
              label="Ignore rules"
              value={
                infoEntry.ignoreGlobs.length > 0
                  ? infoEntry.ignoreGlobs.join(", ")
                  : "No ignore rules configured."
              }
            />
          </div>
        </Modal>
      ) : null}
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 2200,
        }}
      />
    </main>
  );
}

function FilesPanel({
  entry,
  sourceFiles,
  errorMessage,
  selectedRowIds,
  onRetry,
  onToggle,
}: {
  entry: PreviewEntry;
  sourceFiles: SourceFilesState | null;
  errorMessage: string | null;
  selectedRowIds: string[];
  onRetry: () => void;
  onToggle: (fileId: string) => void;
}) {
  if (!sourceFiles) {
    return (
      errorMessage ? (
        <div className="empty-state">
          <strong>Could not load this source</strong>
          <p>{errorMessage}</p>
          <button type="button" className="ghost-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <EmptyState
          title="Loading saved file list"
          body={`Checking the local database for ${entry.displayName}.`}
        />
      )
    );
  }

  const loadError = errorMessage ? <div className="inline-error">{errorMessage}</div> : null;

  if (sourceFiles.sourceStatus === "missing") {
    return (
      <>
        {loadError}
        <EmptyState
          title="This source has not been loaded yet"
          body="Use Update Database to pull its file list from Real-Debrid before previewing it here."
        />
      </>
    );
  }

  if (sourceFiles.sourceStatus === "preparing") {
    const retryableReadyState =
      sourceFiles.statusLabel === "downloaded" && sourceFiles.progressPercent === 100;
    return (
      <>
        {loadError}
        <EmptyState
          title={retryableReadyState ? "This ZIP file is ready to retry" : "This ZIP file is still being prepared"}
          body={
            retryableReadyState
              ? "The outer ZIP is already prepared, but the simulator could not finish reading it. Use Refresh to retry from the saved provider state."
              : `${sourceFiles.statusLabel ?? "Preparing"}${sourceFiles.progressPercent === null ? "" : ` (${sourceFiles.progressPercent}%)`}. Wait for the Real-Debrid download to finish, then use Refresh to continue.`
          }
        />
      </>
    );
  }

  if (sourceFiles.sourceStatus === "error") {
    return (
      <>
        {loadError}
        <EmptyState
          title="Could not load this source"
          body={sourceFiles.errorMessage ?? "The saved data for this source is in an error state."}
        />
      </>
    );
  }

  if (sourceFiles.files.length === 0) {
    return (
      <>
        {loadError}
        <EmptyState
          title="No files matched this source"
          body="The source loaded successfully, but your scope and ignore rules filtered everything out."
        />
      </>
    );
  }

  return (
    <>
      {loadError}
      <ul className="file-list">
        {sourceFiles.files.map((file) => {
          const checked = selectedRowIds.includes(file.id);
          return (
            <li key={file.id} className="file-row">
              <label className="file-toggle">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(file.id)}
                />
                <div className="file-copy">
                  <div className="file-title-row">
                    <strong>{file.originalName}</strong>
                    <CopyStemButton filename={file.originalName} />
                  </div>
                  <p>{file.relativePath}</p>
                  {shouldShowRenameHint(entry, file) ? (
                    <small>
                      Output: {applyRenameRule(entry.renameRule, file.originalName)}
                    </small>
                  ) : null}
                </div>
              </label>
              <div className="file-meta">
                {file.partLabel ? <span>{file.partLabel}</span> : null}
                {file.sizeBytes !== null ? <small>{formatBytes(file.sizeBytes)}</small> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function DownloadPreviewPanel({
  entry,
  selectedRows,
  sourceFiles,
  archiveFixtures,
  previewTree,
  errorMessage,
  onSaveFixture,
}: {
  entry: PreviewEntry;
  selectedRows: SourceFileRow[];
  sourceFiles: SourceFilesState | null;
  archiveFixtures: ReturnType<typeof buildDownloadPreview>["archiveFixtures"];
  previewTree: ReturnType<typeof buildDownloadPreview>["tree"];
  errorMessage: string | null;
  onSaveFixture: (fixture: PreviewFixture) => void;
}) {
  const [editingSample, setEditingSample] = useState<{
    descriptor: ArchiveFixtureDescriptor;
    sample: ArchiveFixtureSampleDescriptor | null;
  } | null>(null);
  const [removeSample, setRemoveSample] = useState<{
    descriptor: ArchiveFixtureDescriptor;
    sample: ArchiveFixtureSampleDescriptor;
  } | null>(null);

  const fixtureFolderMap = useMemo(
    () => buildFixtureFolderMap(archiveFixtures),
    [archiveFixtures],
  );
  const fixtureSampleMap = useMemo(
    () => buildFixtureSampleMap(archiveFixtures),
    [archiveFixtures],
  );
  const emptyFlatArchiveFixtures = useMemo(
    () =>
      archiveFixtures.filter(
        (descriptor) =>
          descriptor.outerFolderName === null && descriptor.samples.length === 0,
      ),
    [archiveFixtures],
  );

  if (!sourceFiles || selectedRows.length === 0) {
    return (
      <>
        <EmptyState
          title="No preview yet"
          body="Select one or more files on the left to see where Romulus would save them."
        />
      </>
    );
  }

  return (
    <>
      {errorMessage ? <div className="inline-error">{errorMessage}</div> : null}

      {previewTree.children.length > 0 ? (
        <TreeView
          node={previewTree}
          folderActions={fixtureFolderMap}
          sampleActions={fixtureSampleMap}
          onAdd={(descriptor) => setEditingSample({ descriptor, sample: null })}
          onEdit={(descriptor, sample) => setEditingSample({ descriptor, sample })}
          onRemove={(descriptor, sample) => setRemoveSample({ descriptor, sample })}
        />
      ) : (
        <EmptyState
          title="No preview yet"
          body="Select files on the left. For archives, use the tree actions to add example extracted files."
        />
      )}
      {emptyFlatArchiveFixtures.length > 0 ? (
        <div className="archive-empty-actions">
          {emptyFlatArchiveFixtures.map((descriptor) => (
            <button
              key={descriptor.fixtureKey}
              type="button"
              className="ghost-button"
              onClick={() => setEditingSample({ descriptor, sample: null })}
            >
              Add example file for {descriptor.archiveDisplayName}
            </button>
          ))}
        </div>
      ) : null}

      {editingSample ? (
        <ArchiveSampleModal
          entry={entry}
          descriptor={editingSample.descriptor}
          sample={editingSample.sample}
          onClose={() => setEditingSample(null)}
          onSave={(nextSample) => {
            const existingSamples = editingSample.descriptor.customSamples;
            const nextSamples = editingSample.sample
              ? existingSamples.map((candidate) =>
                  candidate.id === editingSample.sample?.id ? nextSample : candidate,
                )
              : [...existingSamples, nextSample];
            onSaveFixture(buildFixturePayload(editingSample.descriptor, nextSamples));
            setEditingSample(null);
          }}
        />
      ) : null}

      {removeSample ? (
        <ConfirmFixtureRemovalModal
          sampleName={removeSample.sample.outputName}
          onClose={() => setRemoveSample(null)}
          onConfirm={() => {
            onSaveFixture(
              buildFixturePayload(
                removeSample.descriptor,
                removeSample.descriptor.customSamples.filter(
                  (candidate) => candidate.id !== removeSample.sample.id,
                ),
              ),
            );
            setRemoveSample(null);
          }}
        />
      ) : null}
    </>
  );
}

function SourcePolicyWorkbench({
  entry,
  sourceFiles,
  onDraftStateChange,
}: {
  entry: PreviewEntry;
  sourceFiles: SourceFilesState | null;
  onDraftStateChange: (draft: SourcePolicyDraft | null) => void;
}) {
  const [renameMode, setRenameMode] = useState<"none" | "all" | "phrases">("none");
  const [renamePhrases, setRenamePhrases] = useState<string[]>([]);
  const [ignoreGlobs, setIgnoreGlobs] = useState<string[]>([""]);
  const [renameRequestError, setRenameRequestError] = useState<string | null>(null);
  const [ignoreRequestError, setIgnoreRequestError] = useState<string | null>(null);
  const pendingPolicySaveRef = useRef<PendingPolicySave | null>(null);
  const [confirmRenameReplacement, setConfirmRenameReplacement] = useState<{
    payload: {
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
    appliedSections: {
      rename: boolean;
      ignore: boolean;
    };
    message: string;
  } | null>(null);
  const fileNames = useMemo(
    () =>
      sourceFiles?.sourceStatus === "ready"
        ? (sourceFiles.analysisOriginalNames ??
          sourceFiles.analysisFiles?.map((file) => file.originalName) ??
          sourceFiles.files.map((file) => file.originalName))
        : [],
    [sourceFiles],
  );
  const rawFiles = useMemo(
    () =>
      sourceFiles?.sourceStatus === "ready"
        ? (sourceFiles.analysisFiles ?? sourceFiles.files)
        : [],
    [sourceFiles],
  );
  const analysis = useMemo(() => analyzeParentheticalSuffixes(fileNames), [fileNames]);
  const availablePhrases = useMemo(
    () => analysis.parentheticalPhrases.map((phrase) => phrase.phrase),
    [analysis.parentheticalPhrases],
  );
  const currentRenamePolicy = useMemo(
    () => detectManagedRenamePolicy(entry.renameRule, availablePhrases),
    [availablePhrases, entry.renameRule],
  );
  const entryPolicySignature = useMemo(
    () =>
      JSON.stringify({
        entryId: entry.id,
        ignoreGlobs: entry.ignoreGlobs,
        renameRule: entry.renameRule,
      }),
    [entry.id, entry.ignoreGlobs, entry.renameRule],
  );
  const normalizedIgnoreGlobs = useMemo(
    () => normalizeSourcePolicyGlobs(ignoreGlobs),
    [ignoreGlobs],
  );
  const invalidIgnoreGlobs = useMemo(
    () => normalizedIgnoreGlobs.filter((glob) => !isValidIgnoreRule(glob)),
    [normalizedIgnoreGlobs],
  );
  const savedRenameDraft = useMemo<ManagedRenameDraft>(() => {
    if (currentRenamePolicy.mode === "all") {
      return {
        mode: "all",
        phrases: availablePhrases,
      };
    }
    if (currentRenamePolicy.mode === "phrases") {
      return {
        mode: "phrases",
        phrases: currentRenamePolicy.phrases,
      };
    }
    return {
      mode: "none",
      phrases: [],
    };
  }, [availablePhrases, currentRenamePolicy]);
  const currentRenameDraft = useMemo<ManagedRenameDraft>(() => {
    if (renameMode === "all") {
      return {
        mode: "all",
        phrases: availablePhrases,
      };
    }
    if (renameMode === "phrases") {
      return {
        mode: "phrases",
        phrases: normalizeSourcePolicyGlobs(renamePhrases),
      };
    }
    return {
      mode: "none",
      phrases: [],
    };
  }, [availablePhrases, renameMode, renamePhrases]);
  const phraseOptions = useMemo(() => {
    return buildPhraseOptions(
      analysis.parentheticalPhrases,
      currentRenameDraft.phrases,
    );
  }, [analysis.parentheticalPhrases, currentRenameDraft.phrases]);
  const savedIgnoreGlobs = useMemo(
    () => normalizeSourcePolicyGlobs(entry.ignoreGlobs),
    [entry.ignoreGlobs],
  );
  const renameDirty = useMemo(
    () =>
      currentRenameDraft.mode !== savedRenameDraft.mode ||
      !sameStringArray(currentRenameDraft.phrases, savedRenameDraft.phrases),
    [currentRenameDraft, savedRenameDraft],
  );
  const ignoreDirty = useMemo(
    () => !sameStringArray(normalizedIgnoreGlobs, savedIgnoreGlobs),
    [normalizedIgnoreGlobs, savedIgnoreGlobs],
  );
  const hasUnsavedChanges = renameDirty || ignoreDirty;
  const draftVisibleFiles = useMemo(() => {
    if (sourceFiles?.sourceStatus !== "ready") {
      return [];
    }
    if (invalidIgnoreGlobs.length > 0) {
      return sourceFiles.files;
    }
    return filterSourceFilesByIgnoreGlobs(rawFiles, normalizedIgnoreGlobs);
  }, [invalidIgnoreGlobs.length, normalizedIgnoreGlobs, rawFiles, sourceFiles]);
  const draftIgnoreCount = useMemo(() => {
    if (sourceFiles?.sourceStatus !== "ready") {
      return null;
    }
    if (invalidIgnoreGlobs.length > 0) {
      return null;
    }
    const matchesIgnore = compileIgnoreMatcher(normalizedIgnoreGlobs);
    return fileNames.filter((fileName) => matchesIgnore(fileName)).length;
  }, [fileNames, invalidIgnoreGlobs.length, normalizedIgnoreGlobs, sourceFiles]);
  const draftRenameChangedCount = useMemo(() => {
    if (sourceFiles?.sourceStatus !== "ready") {
      return null;
    }
    if (invalidIgnoreGlobs.length > 0) {
      return null;
    }
    return draftVisibleFiles.filter((file) =>
      applyManagedRenameRule(
        {
          mode: renameMode,
          phrases: renamePhrases,
        },
        file.originalName,
        availablePhrases,
      ) !== file.originalName,
    ).length;
  }, [
    availablePhrases,
    draftVisibleFiles,
    invalidIgnoreGlobs.length,
    renameMode,
    renamePhrases,
    sourceFiles,
  ]);

  useEffect(() => {
    onDraftStateChange({
      entryId: entry.id,
      renameMode: currentRenameDraft.mode,
      renamePhrases: currentRenameDraft.phrases,
      ignoreGlobs,
      renameDirty,
      ignoreDirty,
      hasUnsavedChanges,
    });
  }, [
    currentRenameDraft.mode,
    currentRenameDraft.phrases,
    entry.id,
    hasUnsavedChanges,
    ignoreDirty,
    ignoreGlobs,
    onDraftStateChange,
    renameDirty,
  ]);

  useEffect(() => {
    setRenameRequestError(null);
    setIgnoreRequestError(null);
    setConfirmRenameReplacement(null);
    const nextState = syncSourcePolicyEditorState(
      {
        renameMode,
        renamePhrases,
        ignoreGlobs,
      },
      savedRenameDraft,
      savedIgnoreGlobs,
      pendingPolicySaveRef.current,
      entry.id,
    );
    pendingPolicySaveRef.current = null;
    setRenameMode(nextState.renameMode);
    setRenamePhrases(nextState.renamePhrases);
    setIgnoreGlobs(nextState.ignoreGlobs);
  }, [entryPolicySignature]);

  const renameWarnings = useMemo(() => {
    const nextWarnings = [...analysis.warnings];
    if (currentRenamePolicy.isCustom) {
      nextWarnings.unshift(
        "This source currently uses a custom rename regex from source.json. Applying a simulator rename policy will replace it after confirmation.",
      );
    }
    return nextWarnings;
  }, [analysis.warnings, currentRenamePolicy.isCustom]);

  async function submitPolicyUpdate(payload: {
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
  }, appliedSections: { rename: boolean; ignore: boolean }) {
    pendingPolicySaveRef.current = {
      entryId: entry.id,
      ...appliedSections,
    };
    const response = await fetch("/__simulator/source-entry-policy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseBody = (await response.json()) as {
      status?: "ok" | "needs-confirmation";
      kind?: "custom-rename";
      error?: string;
    };
    if (response.ok) {
      return;
    }
    pendingPolicySaveRef.current = null;
    if (
      response.status === 409 &&
      responseBody.status === "needs-confirmation" &&
      responseBody.kind === "custom-rename"
    ) {
      setConfirmRenameReplacement({
        payload,
        appliedSections,
        message:
          responseBody.error ??
          "This source already has a custom rename regex. Confirm replacement before continuing.",
      });
      return;
    }
    throw new Error(responseBody.error ?? "The source entry policy could not be saved");
  }

  async function applyRenamePolicy() {
    setRenameRequestError(null);
    if (!renameDirty) {
      return;
    }
    if (renameMode === "phrases" && renamePhrases.length === 0) {
      setRenameRequestError(
        "Choose at least one phrase, or switch Rename Policy to Keep names.",
      );
      return;
    }

    try {
      await submitPolicyUpdate({
        entryId: entry.id,
        selectionStateKey: entry.selectionStateKey,
        displayName: entry.displayName,
        subfolder: entry.subfolder,
        renamePolicy: {
          mode: renameMode,
          phrases: renameMode === "all" ? availablePhrases : renamePhrases,
        },
      }, {
        rename: true,
        ignore: false,
      });
    } catch (error) {
      setRenameRequestError(
        error instanceof Error ? error.message : "The rename policy could not be saved",
      );
    }
  }

  async function applyIgnorePolicy() {
    setIgnoreRequestError(null);
    if (!ignoreDirty) {
      return;
    }
    if (invalidIgnoreGlobs.length > 0) {
      setIgnoreRequestError("Fix the invalid ignore globs before saving.");
      return;
    }

    try {
      await submitPolicyUpdate({
        entryId: entry.id,
        selectionStateKey: entry.selectionStateKey,
        displayName: entry.displayName,
        subfolder: entry.subfolder,
        ignoreGlobs: normalizedIgnoreGlobs,
      }, {
        rename: false,
        ignore: true,
      });
    } catch (error) {
      setIgnoreRequestError(
        error instanceof Error ? error.message : "The ignore policy could not be saved",
      );
    }
  }

  const sourceReady = sourceFiles?.sourceStatus === "ready";

  function discardLocalChanges() {
    setRenameRequestError(null);
    setIgnoreRequestError(null);
    setConfirmRenameReplacement(null);
    setRenameMode(savedRenameDraft.mode);
    setRenamePhrases(savedRenameDraft.phrases);
    setIgnoreGlobs(savedIgnoreGlobs.length > 0 ? [...savedIgnoreGlobs] : [""]);
  }

  return (
    <>
      <section className="maintainer-layout">
        <article className="panel policy-panel-wide policy-status-panel">
          <div className="policy-actions-row">
            <span className="policy-summary">
              {hasUnsavedChanges
                ? "Local draft preview is active until you apply or discard these changes"
                : "No local draft changes"}
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={discardLocalChanges}
              disabled={!hasUnsavedChanges}
            >
              Discard local changes
            </button>
          </div>
        </article>

        <article className="panel policy-panel policy-scroll-panel">
          <PanelTitle
            title="Rename Policy"
            subtitle="Select the exact parenthetical phrases this source should strip before saving final files"
          />
          {!sourceReady ? (
            <div className="panel-scroll-body policy-body">
              <EmptyState
                title="No rename analysis yet"
                body="Hydrate and open this source first so the simulator can inspect its observed file names."
              />
            </div>
          ) : (
            <div className="policy-editor-body">
              {renameRequestError ? (
                <div className="inline-error">{renameRequestError}</div>
              ) : null}
              {renameWarnings.length > 0 ? (
                <div className="policy-warning-list">
                  {renameWarnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
              <div className="policy-mode-row">
                <button
                  type="button"
                  className={renameMode === "none" ? "primary-button" : "ghost-button"}
                  onClick={() => {
                    setRenameMode("none");
                    setRenamePhrases([]);
                  }}
                >
                  Keep names
                </button>
                <button
                  type="button"
                  className={renameMode === "all" ? "primary-button" : "ghost-button"}
                  onClick={() => {
                    setRenameMode("all");
                    setRenamePhrases(availablePhrases);
                  }}
                  disabled={availablePhrases.length === 0}
                >
                  All phrases
                </button>
                <button
                  type="button"
                  className={renameMode === "phrases" ? "primary-button" : "ghost-button"}
                  onClick={() => {
                    setRenameMode("phrases");
                    setRenamePhrases((current) =>
                      current.length > 0 ? current : availablePhrases.slice(0, 1),
                    );
                  }}
                  disabled={phraseOptions.length === 0}
                >
                  Selected phrases
                </button>
              </div>
              {renameMode === "phrases" ? (
                phraseOptions.length > 0 ? (
                  <>
                    <div className="panel-scroll-body policy-editor-scroll">
                      <ul className="policy-checklist">
                        {phraseOptions.map((phrase) => {
                          const checked = renamePhrases.includes(phrase.phrase);
                          return (
                            <li key={phrase.phrase}>
                              <label className="policy-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setRenamePhrases((current) =>
                                      checked
                                        ? current.filter((value) => value !== phrase.phrase)
                                        : [...current, phrase.phrase].sort(),
                                    );
                                  }}
                                />
                                <span className="policy-check-copy">
                                  <strong>{phrase.phrase}</strong>
                                  <small>
                                    {phrase.observed
                                      ? `${phrase.count} file(s)`
                                      : "Not currently observed in cached files"}
                                  </small>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="policy-actions-row policy-checklist-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setRenamePhrases(phraseOptions.map((phrase) => phrase.phrase));
                        }}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setRenamePhrases([]);
                        }}
                      >
                        Select none
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="panel-scroll-body policy-editor-scroll">
                    <EmptyState
                      title="No phrases found"
                      body="This source does not currently show any managed parenthetical phrases to edit."
                    />
                  </div>
                )
              ) : null}
              <div className="policy-actions-row">
                <span className="policy-summary">
                  {draftRenameChangedCount === null
                    ? "Hydrate this source to count affected file names"
                    : `${draftRenameChangedCount} file(s) would change with the current rename draft`}
                </span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void applyRenamePolicy();
                  }}
                  disabled={
                    !sourceReady ||
                    !renameDirty ||
                    (renameMode === "phrases" && renamePhrases.length === 0)
                  }
                >
                  Apply Rename Policy
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="panel policy-panel policy-scroll-panel">
          <PanelTitle
            title="File Ignore Policy"
            subtitle="Edit the ignore globs for this source and write them back to source.json"
          />
          <div className="policy-editor-body">
            {ignoreRequestError ? (
              <div className="inline-error">{ignoreRequestError}</div>
            ) : null}
            <div className="panel-scroll-body policy-editor-scroll">
              <div className="field-stack">
                {ignoreGlobs.map((glob, index) => (
                  <div key={`${entry.id}-${index}`} className="policy-glob-row">
                    <label className="field">
                      <span>{index === 0 ? "Ignore glob" : `Ignore glob ${index + 1}`}</span>
                      <input
                        type="text"
                        value={glob}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setIgnoreGlobs((current) =>
                            current.map((candidate, candidateIndex) =>
                              candidateIndex === index ? nextValue : candidate,
                            ),
                          );
                        }}
                        placeholder={index === 0 ? "* (Japan)*.zip" : "Optional additional glob"}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setIgnoreGlobs((current) =>
                          current.length === 1
                            ? [""]
                            : current.filter((_, candidateIndex) => candidateIndex !== index),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="policy-actions-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setIgnoreGlobs((current) => [...current, ""]);
                }}
              >
                Add ignore glob
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void applyIgnorePolicy();
                }}
                disabled={!sourceReady || invalidIgnoreGlobs.length > 0 || !ignoreDirty}
              >
                Apply Ignore Policy
              </button>
            </div>
          </div>
        </article>

        <article className="panel policy-panel policy-panel-wide">
          <PanelTitle
            title="Statistics"
            subtitle="Use the observed counts and phrase frequencies to decide how aggressive your policies should be"
          />
          <div className="panel-scroll-body policy-body">
            {!sourceReady ? (
              <EmptyState
                title="No statistics yet"
                body="Hydrate and open this source first so the simulator can compute policy guidance from real cached file names."
              />
            ) : (
              <>
                <div className="policy-stats-grid">
                  <InfoRow label="Total files" value={String(analysis.totalFiles)} />
                  <InfoRow
                    label="Files with parentheses"
                    value={String(analysis.withParenthesesCount)}
                  />
                  <InfoRow
                    label="Multiple groups"
                    value={String(analysis.multiParenthesesCount)}
                  />
                  <InfoRow
                    label="Mixed-pattern warnings"
                    value={String(analysis.trueMiddleTextCount)}
                  />
                  <InfoRow
                    label="All-phrases dot risk"
                    value={String(analysis.trailingDotTitleCount)}
                  />
                  <InfoRow
                    label="Draft rename changes"
                    value={
                      draftRenameChangedCount === null
                        ? "Unavailable"
                        : String(draftRenameChangedCount)
                    }
                  />
                  <InfoRow
                    label="Draft ignore matches"
                    value={
                      invalidIgnoreGlobs.length > 0
                        ? "Invalid globs"
                        : draftIgnoreCount === null
                          ? "Unavailable"
                          : String(draftIgnoreCount)
                    }
                  />
                  <InfoRow
                    label="Invalid ignore globs"
                    value={String(invalidIgnoreGlobs.length)}
                  />
                </div>

                <details className="policy-disclosure">
                  <summary className="policy-disclosure-summary">
                    More statistics
                  </summary>
                  <div className="policy-disclosure-body">
                    {analysis.warnings.length > 0 || invalidIgnoreGlobs.length > 0 ? (
                      <div className="policy-warning-list">
                        {analysis.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                        {invalidIgnoreGlobs.map((glob) => (
                          <p key={glob}>{`Invalid ignore glob: ${glob}`}</p>
                        ))}
                      </div>
                    ) : null}

                    <div className="policy-phrase-table">
                      <div className="policy-phrase-table-header">
                        <span>Observed phrase</span>
                        <span>Count</span>
                      </div>
                      {analysis.parentheticalPhrases.length > 0 ? (
                        analysis.parentheticalPhrases.map((phrase) => (
                          <div key={phrase.phrase} className="policy-phrase-row">
                            <strong>{phrase.phrase}</strong>
                            <span>{phrase.count}</span>
                          </div>
                        ))
                      ) : (
                        <EmptyState
                          title="No observed phrases"
                          body="This source has no parenthetical suffix data in its current cached file set."
                        />
                      )}
                    </div>
                  </div>
                </details>
              </>
            )}
          </div>
        </article>
      </section>

      {confirmRenameReplacement ? (
        <Modal
          title="Replace Custom Rename Regex"
          onClose={() => setConfirmRenameReplacement(null)}
        >
          <div className="modal-copy">
            <strong>{entry.displayName}</strong>
            <p>{confirmRenameReplacement.message}</p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setConfirmRenameReplacement(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const nextPayload = {
                  ...confirmRenameReplacement.payload,
                  confirmReplaceCustomRename: true,
                };
                const nextAppliedSections = confirmRenameReplacement.appliedSections;
                setConfirmRenameReplacement(null);
                void submitPolicyUpdate(nextPayload, nextAppliedSections).catch((error) => {
                  setRenameRequestError(
                    error instanceof Error
                      ? error.message
                      : "The rename policy could not be saved",
                  );
                });
              }}
            >
              Replace regex
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ArchiveSampleModal({
  entry,
  descriptor,
  sample,
  onClose,
  onSave,
}: {
  entry: PreviewEntry;
  descriptor: ArchiveFixtureDescriptor;
  sample: ArchiveFixtureSampleDescriptor | null;
  onClose: () => void;
  onSave: (sample: PreviewFixtureSample) => void;
}) {
  const [draftName, setDraftName] = useState(sample?.originalName ?? "");
  const [draftDirectory, setDraftDirectory] = useState(sample?.relativeDirectory ?? "");
  const computedOutputName = finalOutputName(
    entry,
    draftName,
    null,
    !isSupportedArchiveName(draftName),
  );

  return (
    <Modal
      title={sample ? "Edit Example File" : "Add Example File"}
      onClose={onClose}
    >
      <div className="modal-copy">
        <strong>{descriptor.archiveDisplayName}</strong>
        <p>
          {descriptor.outerFolderName
            ? `Saved files will appear inside ${descriptor.outerFolderName}/`
            : "Saved files will appear directly in the preview."}
        </p>
      </div>
      <div className="field-stack">
        <label className="field">
          <span>Original file name</span>
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Example: Track 01.cue"
          />
        </label>
        <label className="field">
          <span>Original directory</span>
          <input
            type="text"
            value={draftDirectory}
            onChange={(event) => setDraftDirectory(event.target.value)}
            placeholder="Optional, only used to describe the original archive path"
          />
        </label>
        <div className="fixture-preview-copy">
          <span>Saved as</span>
          <strong>{computedOutputName || "Unavailable until a file name is entered"}</strong>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={draftName.trim().length === 0}
          onClick={() => {
            const normalizedName = draftName.trim();
            if (!normalizedName) {
              return;
            }
            onSave({
              id: sample?.id ?? `${Date.now()}-${normalizedName}`,
              originalName: normalizedName,
              relativeDirectory: draftDirectory.trim(),
              outputNameOverride: null,
            });
          }}
        >
          {sample ? "Save changes" : "Add file"}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmFixtureRemovalModal({
  sampleName,
  onClose,
  onConfirm,
}: {
  sampleName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Remove Example File" onClose={onClose}>
      <div className="modal-copy">
        <strong>{sampleName}</strong>
        <p>This only removes the example file from the preview.</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary-button danger-button" onClick={onConfirm}>
          Remove
        </button>
      </div>
    </Modal>
  );
}

function PanelTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="panel-header">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </header>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoSectionTitle({ title }: { title: string }) {
  return <h3 className="info-section-title">{title}</h3>;
}

function TreeView({
  node,
  folderActions,
  sampleActions,
  onAdd,
  onEdit,
  onRemove,
}: {
  node: PreviewTreeNode;
  folderActions: Map<string, ArchiveFixtureDescriptor>;
  sampleActions: Map<
    string,
    {
      descriptor: ArchiveFixtureDescriptor;
      sample: ArchiveFixtureSampleDescriptor;
    }
  >;
  onAdd: (descriptor: ArchiveFixtureDescriptor) => void;
  onEdit: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureSampleDescriptor,
  ) => void;
  onRemove: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureSampleDescriptor,
  ) => void;
}) {
  return (
    <div className="tree-shell">
      <ul className="tree-list">
        {node.children.map((child) => (
          <TreeBranch
            key={child.pathKey}
            node={child}
            folderActions={folderActions}
            sampleActions={sampleActions}
            onAdd={onAdd}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </div>
  );
}

function TreeBranch({
  node,
  folderActions,
  sampleActions,
  onAdd,
  onEdit,
  onRemove,
}: {
  node: PreviewTreeNode;
  folderActions: Map<string, ArchiveFixtureDescriptor>;
  sampleActions: Map<
    string,
    {
      descriptor: ArchiveFixtureDescriptor;
      sample: ArchiveFixtureSampleDescriptor;
    }
  >;
  onAdd: (descriptor: ArchiveFixtureDescriptor) => void;
  onEdit: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureSampleDescriptor,
  ) => void;
  onRemove: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureSampleDescriptor,
  ) => void;
}) {
  const folderDescriptor = node.kind === "folder" ? folderActions.get(node.pathKey) : undefined;
  const sampleDescriptor = node.kind === "file" ? sampleActions.get(node.pathKey) : undefined;

  return (
    <li>
      <div className="tree-node-row">
        <span className="tree-node-label">
          {node.name}
          {node.kind === "folder" ? "/" : ""}
        </span>
        <div className="tree-node-actions">
          {folderDescriptor ? (
            <TreeActionButton
              label="Add example file"
              icon="add"
              onClick={() => onAdd(folderDescriptor)}
            />
          ) : null}
          {sampleDescriptor ? (
            <>
              {!sampleDescriptor.descriptor.outerFolderName ? (
                <TreeActionButton
                  label="Add example file"
                  icon="add"
                  onClick={() => onAdd(sampleDescriptor.descriptor)}
                />
              ) : null}
              {!sampleDescriptor.sample.generated ? (
                <>
                  <TreeActionButton
                    label="Edit example file"
                    icon="edit"
                    onClick={() =>
                      onEdit(sampleDescriptor.descriptor, sampleDescriptor.sample)
                    }
                  />
                  <TreeActionButton
                    label="Remove example file"
                    icon="remove"
                    onClick={() =>
                      onRemove(sampleDescriptor.descriptor, sampleDescriptor.sample)
                    }
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <TreeBranch
              key={child.pathKey}
              node={child}
              folderActions={folderActions}
              sampleActions={sampleActions}
              onAdd={onAdd}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function upsertPreviewFixture(
  fixtures: PreviewFixture[],
  nextFixture: PreviewFixture,
) {
  const existingIndex = fixtures.findIndex(
    (fixture) => fixture.fixtureKey === nextFixture.fixtureKey,
  );
  if (existingIndex < 0) {
    return [...fixtures, nextFixture];
  }
  return fixtures.map((fixture, index) =>
    index === existingIndex ? nextFixture : fixture,
  );
}

function buildFixtureFolderMap(
  descriptors: ArchiveFixtureDescriptor[],
) {
  const nextMap = new Map<string, ArchiveFixtureDescriptor>();
  for (const descriptor of descriptors) {
    if (!descriptor.outerFolderPathKey) {
      continue;
    }
    nextMap.set(descriptor.outerFolderPathKey, descriptor);
  }
  return nextMap;
}

function buildFixtureSampleMap(
  descriptors: ArchiveFixtureDescriptor[],
) {
  const nextMap = new Map<
    string,
    {
      descriptor: ArchiveFixtureDescriptor;
      sample: ArchiveFixtureSampleDescriptor;
    }
  >();

  for (const descriptor of descriptors) {
    for (const sample of descriptor.samples) {
      if (!sample.outputPathKey) {
        continue;
      }
      nextMap.set(sample.outputPathKey, {
        descriptor,
        sample,
      });
    }
  }

  return nextMap;
}

function buildFixturePayload(
  descriptor: ArchiveFixtureDescriptor,
  samples: PreviewFixtureSample[],
): PreviewFixture {
  return {
    fixtureKey: descriptor.fixtureKey,
    sourceFileId: descriptor.sourceFileId,
    archiveDisplayName: descriptor.archiveDisplayName,
    archiveBaseName: descriptor.archiveBaseName,
    samples,
    updatedAt: new Date().toISOString(),
  };
}

function normalizedSegments(input: string) {
  return input
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function filenameStem(input: string) {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const extensionStart = trimmed.lastIndexOf(".");
  if (extensionStart <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, extensionStart);
}

function treePathKey(segments: string[]) {
  return segments.join("/");
}

function normalizeSourcePolicyGlobs(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function filterSourceFilesByIgnoreGlobs(sourceFiles: SourceFileRow[], ignoreGlobs: string[]) {
  const matcher = compileIgnoreMatcher(ignoreGlobs);
  return sourceFiles.filter((file) => !matcher(file.originalName));
}

function shouldShowRenameHint(entry: PreviewEntry, file: SourceFileRow) {
  if (!entry.renameRule) {
    return false;
  }
  if (entry.unarchive && file.isArchiveCandidate && isSupportedArchiveName(file.originalName)) {
    return false;
  }
  return applyRenameRule(entry.renameRule, file.originalName) !== file.originalName;
}

function formatSourceStatus(status: SourceFilesState["sourceStatus"] | "missing") {
  switch (status) {
    case "ready":
      return "Ready";
    case "preparing":
      return "Waiting on ZIP";
    case "error":
      return "Needs attention";
    case "missing":
    default:
      return "Not loaded yet";
  }
}

function CopyStemButton({ filename }: { filename: string }) {
  const stem = filenameStem(filename);

  return (
    <button
      type="button"
      className="copy-icon-button"
      disabled={stem.length === 0}
      onClick={() => {
        if (stem.length === 0) {
          return;
        }
        void navigator.clipboard
          .writeText(stem)
          .then(() => {
            toast.success(`Copied "${stem}"`);
          })
          .catch(() => {
            toast.error("Clipboard copy failed");
          });
      }}
      title={`Copy ${stem}`}
    >
      <CopyStateIcon state="copy" />
    </button>
  );
}

function CopyStateIcon({ state }: { state: "copy" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2.5h6v8H6z" />
      <path d="M4 5.5H3.5A1.5 1.5 0 0 0 2 7v5.5A1.5 1.5 0 0 0 3.5 14H9a1.5 1.5 0 0 0 1.5-1.5V12" />
    </svg>
  );
}

function TreeActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "add" | "edit" | "remove";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="tree-action-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <TreeActionIcon icon={icon} />
    </button>
  );
}

function TreeActionIcon({ icon }: { icon: "add" | "edit" | "remove" }) {
  if (icon === "add") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3v10M3 8h10" />
      </svg>
    );
  }
  if (icon === "edit") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 11.5V13h1.5l7-7-1.5-1.5-7 7ZM9.75 3.75l1.5 1.5 1-1a1.06 1.06 0 0 0 0-1.5l-.5-.5a1.06 1.06 0 0 0-1.5 0l-1 1Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(1)} KB`;
  }
  if (value < 1_024 * 1_024 * 1_024) {
    return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
  }
  return `${(value / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`;
}

export default App;
