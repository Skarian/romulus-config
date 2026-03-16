import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";

import initialSimulatorState from "virtual:romulus-simulator-state";

import { isSupportedArchiveName } from "./archiveSupport";
import {
  applyRenameRule,
  type ArchiveFixtureDescriptor,
  buildDownloadPreview,
  finalOutputName,
  type PreviewTreeNode,
} from "./downloadPreview";
import type {
  PreviewEntry,
  PreviewFixture,
  PreviewFixtureSample,
  SimulatorState,
  SourceFilesState,
  SourceFileRow,
} from "./types";

function App() {
  const [state, setState] = useState<SimulatorState>(initialSimulatorState);
  const [selectedHydrationKey, setSelectedHydrationKey] = useState<string | null>(null);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<SourceFilesState | null>(null);
  const [infoEntryId, setInfoEntryId] = useState<string | null>(null);
  const [showConfigDetails, setShowConfigDetails] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showHydrationModal, setShowHydrationModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showVerboseLogs, setShowVerboseLogs] = useState(false);
  const [hydrationRequestError, setHydrationRequestError] = useState<string | null>(null);
  const [previewRequestError, setPreviewRequestError] = useState<string | null>(null);
  const selectedHydrationKeyRef = useRef<string | null>(selectedHydrationKey);

  const selectedEntry =
    state.entries.find((entry) => entry.hydrationKey === selectedHydrationKey) ?? null;
  const infoEntry =
    state.entries.find((entry) => entry.id === infoEntryId) ?? null;
  const selectedRowIds = selectedSourceFiles?.selectedRowIds ?? [];
  const selectedActualRows = useMemo(() => {
    if (!selectedSourceFiles || !selectedEntry) {
      return [];
    }
    const selectedSet = new Set(selectedRowIds);
    return selectedSourceFiles.files.filter((file) => selectedSet.has(file.id));
  }, [selectedEntry, selectedRowIds, selectedSourceFiles]);
  const downloadPreview = useMemo(
    () =>
      selectedEntry
        ? buildDownloadPreview(selectedEntry, selectedSourceFiles, selectedActualRows)
        : {
            tree: {
              name: "/",
              kind: "folder" as const,
              children: [],
            },
            archiveFixtures: [],
          },
    [selectedActualRows, selectedEntry, selectedSourceFiles],
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
  const hasOpenModal =
    showHydrationModal || showLogModal || infoEntry !== null;

  useEffect(() => {
    selectedHydrationKeyRef.current = selectedHydrationKey;
  }, [selectedHydrationKey]);

  useEffect(() => {
    void refreshState();
    const eventSource = new EventSource("/__simulator/events");
    eventSource.addEventListener("state", () => {
      void refreshState();
    });
    eventSource.addEventListener("config-updated", () => {
      void handleConfigUpdated();
    });
    eventSource.onerror = () => {
      eventSource.close();
    };
    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedEntry) {
      setSelectedSourceFiles(null);
      return;
    }
    let cancelled = false;
    void loadSourceFiles(selectedEntry.id).then((nextState) => {
      if (!cancelled) {
        setSelectedSourceFiles(nextState);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEntry, state]);

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

    const selectedHydrationKey = selectedHydrationKeyRef.current;
    if (!selectedHydrationKey) {
      toast.success("Config updated");
      return;
    }

    const selectedEntryStillExists = nextState.entries.some(
      (entry) => entry.hydrationKey === selectedHydrationKey,
    );
    if (selectedEntryStillExists) {
      toast.success("Config updated");
      return;
    }

    setSelectedHydrationKey(null);
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
    await requestHydration([selectedEntry.id], true);
  }

  async function savePreviewFixture(
    nextFixture: PreviewFixture,
  ) {
    if (!selectedEntry || !selectedSourceFiles) {
      return;
    }
    setPreviewRequestError(null);
    try {
      const response = await fetch("/__simulator/preview-fixtures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId: selectedEntry.id,
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
      setSelectedSourceFiles((current) =>
        current
          ? {
              ...current,
              previewFixtures: upsertPreviewFixture(
                current.previewFixtures,
                savedFixture,
              ),
            }
          : current,
      );
    } catch (error) {
      setPreviewRequestError(
        error instanceof Error ? error.message : "The example file could not be saved",
      );
    }
  }

  async function saveSelectedRowIds(nextSelectedRowIds: string[]) {
    if (!selectedEntry || !selectedSourceFiles) {
      return;
    }

    const previousSelectedRowIds = selectedSourceFiles.selectedRowIds ?? [];
    setSelectedSourceFiles((current) =>
      current
        ? {
            ...current,
            selectedRowIds: nextSelectedRowIds,
          }
        : current,
    );

    try {
      const response = await fetch("/__simulator/selected-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryId: selectedEntry.id,
          selectedRowIds: nextSelectedRowIds,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Selected files could not be saved");
      }
      const payload = (await response.json()) as { selectedRowIds?: string[] };
      setSelectedSourceFiles((current) =>
        current
          ? {
              ...current,
              selectedRowIds: payload.selectedRowIds ?? [],
            }
          : current,
      );
    } catch (error) {
      setSelectedSourceFiles((current) =>
        current
          ? {
              ...current,
              selectedRowIds: previousSelectedRowIds,
            }
          : current,
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
                      onClick={() => setSelectedHydrationKey(entry.hydrationKey)}
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
              onClick={() => setSelectedHydrationKey(null)}
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
                <PanelTitle title="Files" subtitle="Pick the files you want Romulus to use for this source" />
            <button
              type="button"
              className="ghost-button"
              disabled={state.hydration.running}
                  onClick={() => {
                    void refreshSelectedSource();
                  }}
                >
                  Refresh Source
                </button>
              </div>
              <div className="panel-scroll-body">
                <FilesPanel
                  entry={selectedEntry}
                  sourceFiles={selectedSourceFiles}
                  selectedRowIds={selectedRowIds}
                  onToggle={(fileId) => {
                    const nextIds = selectedRowIds.includes(fileId)
                      ? selectedRowIds.filter((id) => id !== fileId)
                      : [...selectedRowIds, fileId];
                    void saveSelectedRowIds(nextIds);
                  }}
                />
              </div>
            </article>

            <article className="panel workbench-panel">
              <PanelTitle
                title="Download Folder Preview"
                subtitle="Preview where the selected files would end up after your current rules are applied"
              />
              <div className="panel-scroll-body">
                <DownloadPreviewPanel
                  entry={selectedEntry}
                  selectedRows={selectedActualRows}
                  sourceFiles={selectedSourceFiles}
                  archiveFixtures={downloadPreview.archiveFixtures}
                  previewTree={downloadPreview.tree}
                  errorMessage={previewRequestError}
                  onSaveFixture={(fixture) => {
                    void savePreviewFixture(fixture);
                  }}
                />
              </div>
            </article>
          </section>
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
  selectedRowIds,
  onToggle,
}: {
  entry: PreviewEntry;
  sourceFiles: SourceFilesState | null;
  selectedRowIds: string[];
  onToggle: (fileId: string) => void;
}) {
  if (!sourceFiles) {
    return (
      <EmptyState
              title="Loading saved file list"
        body={`Checking the local database for ${entry.displayName}.`}
      />
    );
  }

  if (sourceFiles.sourceStatus === "missing") {
    return (
      <EmptyState
        title="This source has not been loaded yet"
        body="Use Update Database to pull its file list from Real-Debrid before previewing it here."
      />
    );
  }

  if (sourceFiles.sourceStatus === "preparing") {
    return (
      <EmptyState
        title="This ZIP file is still being prepared"
        body={`${sourceFiles.statusLabel ?? "Preparing"}${sourceFiles.progressPercent === null ? "" : ` (${sourceFiles.progressPercent}%)`}. Wait for the Real-Debrid download to finish, then use Refresh to continue.`}
      />
    );
  }

  if (sourceFiles.sourceStatus === "error") {
    return (
      <EmptyState
        title="Could not load this source"
        body={sourceFiles.errorMessage ?? "The saved data for this source is in an error state."}
      />
    );
  }

  if (sourceFiles.files.length === 0) {
    return (
      <EmptyState
        title="No files matched this source"
        body="The source loaded successfully, but your scope and ignore rules filtered everything out."
      />
    );
  }

  return (
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
    sample: ArchiveFixtureDescriptor["samples"][number] | null;
  } | null>(null);
  const [removeSample, setRemoveSample] = useState<{
    descriptor: ArchiveFixtureDescriptor;
    sample: ArchiveFixtureDescriptor["samples"][number];
  } | null>(null);

  const fixtureFolderMap = useMemo(
    () => buildFixtureFolderMap(archiveFixtures),
    [archiveFixtures],
  );
  const fixtureSampleMap = useMemo(
    () => buildFixtureSampleMap(archiveFixtures),
    [archiveFixtures],
  );

  if (!sourceFiles || selectedRows.length === 0) {
    return (
      <EmptyState
        title="No preview yet"
        body="Select one or more files on the left to see where Romulus would save them."
      />
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

      {editingSample ? (
        <ArchiveSampleModal
          entry={entry}
          descriptor={editingSample.descriptor}
          sample={editingSample.sample}
          onClose={() => setEditingSample(null)}
          onSave={(nextSample) => {
            const existingSamples = editingSample.descriptor.samples;
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
                removeSample.descriptor.samples.filter(
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

function ArchiveSampleModal({
  entry,
  descriptor,
  sample,
  onClose,
  onSave,
}: {
  entry: PreviewEntry;
  descriptor: ArchiveFixtureDescriptor;
  sample: ArchiveFixtureDescriptor["samples"][number] | null;
  onClose: () => void;
  onSave: (sample: PreviewFixtureSample) => void;
}) {
  const defaultPlaceholderName = `[${descriptor.archiveBaseName}]`;
  const [draftName, setDraftName] = useState(sample?.originalName ?? "");
  const [draftDirectory, setDraftDirectory] = useState(sample?.relativeDirectory ?? "");
  const [shouldClearPlaceholderOnFocus, setShouldClearPlaceholderOnFocus] = useState(
    sample?.id === "default" && sample.originalName === defaultPlaceholderName,
  );
  const computedOutputName = finalOutputName(entry, draftName, null);

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
            onFocus={() => {
              if (!shouldClearPlaceholderOnFocus || draftName !== defaultPlaceholderName) {
                return;
              }
              setDraftName("");
              setShouldClearPlaceholderOnFocus(false);
            }}
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
      sample: ArchiveFixtureDescriptor["samples"][number];
    }
  >;
  onAdd: (descriptor: ArchiveFixtureDescriptor) => void;
  onEdit: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureDescriptor["samples"][number],
  ) => void;
  onRemove: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureDescriptor["samples"][number],
  ) => void;
}) {
  return (
    <div className="tree-shell">
      <ul className="tree-list">
        {node.children.map((child) => (
          <TreeBranch
            key={child.name}
            node={child}
            pathSegments={[child.name]}
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
  pathSegments,
  folderActions,
  sampleActions,
  onAdd,
  onEdit,
  onRemove,
}: {
  node: PreviewTreeNode;
  pathSegments: string[];
  folderActions: Map<string, ArchiveFixtureDescriptor>;
  sampleActions: Map<
    string,
    {
      descriptor: ArchiveFixtureDescriptor;
      sample: ArchiveFixtureDescriptor["samples"][number];
    }
  >;
  onAdd: (descriptor: ArchiveFixtureDescriptor) => void;
  onEdit: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureDescriptor["samples"][number],
  ) => void;
  onRemove: (
    descriptor: ArchiveFixtureDescriptor,
    sample: ArchiveFixtureDescriptor["samples"][number],
  ) => void;
}) {
  const nodePath = treePathKey(pathSegments);
  const folderDescriptor = node.kind === "folder" ? folderActions.get(nodePath) : undefined;
  const sampleDescriptor = node.kind === "file" ? sampleActions.get(nodePath) : undefined;

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
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <TreeBranch
              key={`${nodePath}-${child.name}`}
              node={child}
              pathSegments={[...pathSegments, child.name]}
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
    if (!descriptor.outerFolderName) {
      continue;
    }
    nextMap.set(
      treePathKey([...descriptor.baseSegments, descriptor.outerFolderName]),
      descriptor,
    );
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
      sample: ArchiveFixtureDescriptor["samples"][number];
    }
  >();

  for (const descriptor of descriptors) {
    for (const sample of descriptor.samples) {
      nextMap.set(
        treePathKey([
          ...descriptor.baseSegments,
          ...(descriptor.outerFolderName ? [descriptor.outerFolderName] : []),
          sample.outputName,
        ]),
        {
          descriptor,
          sample,
        },
      );
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
