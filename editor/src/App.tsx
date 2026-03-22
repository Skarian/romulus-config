import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";

import initialEditorState from "virtual:romulus-editor-state";

import {
  formatArchiveSampleExtensions,
  validateArchiveSampleExtensionsInput,
} from "./archiveSamplePolicy";
import { isSupportedArchiveName } from "./archiveSupport";
import {
  buildDownloadPreview,
  type ArchiveFixtureDescriptor,
  type ArchiveFixtureSampleDescriptor,
  finalOutputName,
  type PreviewTreeNode,
} from "./downloadPreview";
import { useDocumentSession } from "./documentSession";
import {
  buildHydrationStateByHydrationKey,
  getHydrationStateForEntry,
} from "./hydrationStateLookup";
import { getPendingHydrationEntryIds } from "./hydrationRefreshSelection";
import { buildPreviewEntries } from "./runtimeValidation";
import { useSourceEditorController } from "./sourceEditorController";
import { useSourceListController } from "./sourceListController";
import {
  beginEntryRequest,
  buildSourceFilesRequest,
  isLatestEntryRequest,
  matchSourceFilesToEntry,
  toggleSourceFileSelection,
  updateSourceFilesForEntry,
} from "./sourcePolicyEditor";
import type {
  BlockedIssueGroup,
  ClearLocalDataSelection,
  EditableDocumentState,
  PreviewEntry,
    PreviewFixture,
    PreviewFixtureSample,
    SessionSourceReference,
    EditorState,
    SourceDocumentSavePreparationResult,
    SourceFilesRequest,
    SourceFilesState,
    SourceFileRow,
  } from "./types";

type HydrationMode = "missing" | "all";

type ClearDatabaseSelection = ClearLocalDataSelection;

const EMPTY_CLEAR_DATABASE_SELECTION: ClearDatabaseSelection = {
  fileCache: false,
  savedSelections: false,
  savedPreviewData: false,
  updateLogs: false,
};

type SourceRowDragData = {
  type: "source-row";
  sourceRef: SessionSourceReference;
};

function App() {
  const [state, setState] = useState<EditorState>(initialEditorState);
  const [sessionEditableState, setSessionEditableState] = useState<EditableDocumentState | null>(
    initialEditorState.status === "editable" ? initialEditorState.editable : null,
  );
  const [selectedSourceRef, setSelectedSourceRef] = useState<SessionSourceReference | null>(null);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<SourceFilesState | null>(null);
  const [infoEntryId, setInfoEntryId] = useState<string | null>(null);
  const [showHydrationModal, setShowHydrationModal] = useState(false);
  const [hydrationMode, setHydrationMode] = useState<HydrationMode>("missing");
  const [showRefreshDraftConflictModal, setShowRefreshDraftConflictModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showVerboseLogs, setShowVerboseLogs] = useState(false);
  const [hydrationRequestError, setHydrationRequestError] = useState<string | null>(null);
  const [sourceFilesRequestError, setSourceFilesRequestError] = useState<string | null>(null);
  const [sourceFilesRequestRevision, setSourceFilesRequestRevision] = useState(0);
  const [previewRequestError, setPreviewRequestError] = useState<string | null>(null);
  const [showArchivePatternModal, setShowArchivePatternModal] = useState(false);
  const [archivePatternPromptMode, setArchivePatternPromptMode] = useState<
    "auto" | "manual" | null
  >(null);
  const [archivePatternDraft, setArchivePatternDraft] = useState("");
  const [archivePatternError, setArchivePatternError] = useState<string | null>(null);
  const [savingArchivePattern, setSavingArchivePattern] = useState(false);
  const [showManualReloadModal, setShowManualReloadModal] = useState(false);
  const [showExternalReloadModal, setShowExternalReloadModal] = useState(false);
  const [missingCacheSourceName, setMissingCacheSourceName] = useState<string | null>(null);
  const [savePreparation, setSavePreparation] = useState<
    Extract<SourceDocumentSavePreparationResult, { status: "ready" }> | null
  >(null);
  const [savingSourceDocument, setSavingSourceDocument] = useState(false);
  const [pendingRefreshAfterSave, setPendingRefreshAfterSave] = useState<HydrationMode | null>(
    null,
  );
  const [reopenHydrationOnSaveCancel, setReopenHydrationOnSaveCancel] = useState(false);
  const [showClearDatabaseModal, setShowClearDatabaseModal] = useState(false);
  const [showClearDatabaseConfirmModal, setShowClearDatabaseConfirmModal] = useState(false);
  const [clearDatabaseSelection, setClearDatabaseSelection] = useState<ClearDatabaseSelection>(
    EMPTY_CLEAR_DATABASE_SELECTION,
  );
  const [clearingDatabase, setClearingDatabase] = useState(false);
  const [showDatabaseMenu, setShowDatabaseMenu] = useState(false);
  const selectedFileSaveRevisionRef = useRef(new Map<string, number>());
  const previewFixtureSaveRevisionRef = useRef(new Map<string, number>());
  const archivePatternSaveRevisionRef = useRef(new Map<string, number>());
  const pendingLocalConfigUpdateCountRef = useRef(0);
  const previousSelectedSourceRef = useRef<SessionSourceReference | null>(null);
  const lastHydrationRunIdRef = useRef<number | null>(state.hydration.lastRun?.runId ?? null);
  const databaseMenuRef = useRef<HTMLDivElement | null>(null);
  const documentSession = useDocumentSession(
    sessionEditableState,
  );
  const hydrationStatesByHydrationKey = useMemo(
    () => buildHydrationStateByHydrationKey(state.entries, state.hydration.sourceStates),
    [state.entries, state.hydration.sourceStates],
  );
  const sourceListController = useSourceListController({
    documentSession,
    hydrationStatesByHydrationKey,
  });
  const selectedSource =
    documentSession?.selectors.getSource(selectedSourceRef) ?? null;
  const selectedEntry = selectedSource?.entry ?? null;
  const selectedSourceFilesRequest = useMemo(
    () => (selectedEntry ? buildSourceFilesRequest(selectedEntry) : null),
    [selectedEntry],
  );
  const selectedEntryHydrationState = getHydrationStateForEntry(
    selectedEntry,
    hydrationStatesByHydrationKey,
  );
  const selectedEntrySourceFiles = matchSourceFilesToEntry(
    selectedEntry,
    selectedSourceFiles,
  );
  const infoEntry = sourceListController.rows.find((row) => row.entry.id === infoEntryId)?.entry ?? null;
  const sourceEditorController = useSourceEditorController({
    documentSession,
    sourceRef: selectedSourceRef,
    sourceFiles: selectedEntrySourceFiles,
  });
  const effectiveSourceFiles = sourceEditorController.effectiveSourceFiles;
  const visibleSourceFiles = sourceEditorController.visibleSourceFiles;
  const selectedRowIds = sourceEditorController.selectedRowIds;
  const archiveSampleExtensions = selectedEntrySourceFiles?.archiveSampleExtensions ?? [];
  const archivePatternValidation = useMemo(
    () => validateArchiveSampleExtensionsInput(archivePatternDraft),
    [archivePatternDraft],
  );
  const selectedActualRows = sourceEditorController.selectedActualRows;
  const downloadPreview = sourceEditorController.downloadPreview;
  const visibleLogs = useMemo(
    () =>
      state.hydration.logs.filter(
        (entry) => showVerboseLogs || entry.visibility === "basic",
      ),
    [showVerboseLogs, state.hydration.logs],
  );
  const structureModal = sourceListController.structureModal;
  const structureValidation = sourceListController.structureValidation;
  const deleteSource = sourceListController.deleteSource;
  const sourceListRowOrder = useMemo(
    () => sourceListController.rows.map((row) => row.ref),
    [sourceListController.rows],
  );
  const pendingHydrationEntryIds = useMemo(
    () =>
      getPendingHydrationEntryIds(
        sourceListController.rows.map((row) => ({
          entryId: row.entry.id,
          status: row.hydrationState?.status,
        })),
      ),
    [sourceListController.rows],
  );
  const hasHydrationLogs = state.hydration.running || state.hydration.logs.length > 0;
  const canStartMissingCacheRefresh = pendingHydrationEntryIds.length > 0;
  const canStartHydration =
    state.entries.length > 0 &&
    state.hydration.apiKeyConfigured &&
    !state.hydration.running &&
    (hydrationMode === "all" || canStartMissingCacheRefresh);
  const clearDatabaseSelectionCount = Object.values(clearDatabaseSelection).filter(Boolean).length;
  const configStatusInvalid =
    state.status === "blocked" ||
    (state.status === "editable" && state.editable.validation.issues.length > 0);
  const configStatusLabel = configStatusInvalid ? "Config invalid" : "Config valid";
  const sourceCountLabel = `${sourceListController.rows.length} source${sourceListController.rows.length === 1 ? "" : "s"} configured`;
  const draftStatusLabel = formatDraftStatusSummary({
    dirty: sourceListController.dirty,
    dirtyEntryCount: sourceListController.rows.filter((row) => row.dirty).length,
    baselineEntryCount: documentSession?.selectors.baselineDocument?.entries.length ?? 0,
    draftEntryCount: documentSession?.selectors.draftDocument?.entries.length ?? 0,
  });
  const selectedEntryHydrationRefreshKey = useMemo(() => {
    if (!selectedEntry?.hydrationKey) {
      return null;
    }
    return JSON.stringify({
      hydrationKey: selectedEntry.hydrationKey,
      status: selectedEntryHydrationState?.status ?? "missing",
      updatedAt: selectedEntryHydrationState?.updatedAt ?? null,
      errorMessage: selectedEntryHydrationState?.errorMessage ?? null,
    });
  }, [
    selectedEntryHydrationState?.errorMessage,
    selectedEntryHydrationState?.status,
    selectedEntryHydrationState?.updatedAt,
    selectedEntry?.hydrationKey,
  ]);
  const hasOpenModal =
    showHydrationModal ||
    showRefreshDraftConflictModal ||
    showLogModal ||
    infoEntry !== null ||
    showManualReloadModal ||
    showExternalReloadModal ||
    missingCacheSourceName !== null ||
    savePreparation !== null ||
    showClearDatabaseModal ||
    showClearDatabaseConfirmModal;

  useEffect(() => {
    if (state.status === "blocked") {
      setSelectedSourceRef(null);
    }
  }, [state.status]);

  useEffect(() => {
    const lastRun = state.hydration.lastRun;
    if (!lastRun || lastHydrationRunIdRef.current === lastRun.runId) {
      return;
    }
    lastHydrationRunIdRef.current = lastRun.runId;
    if (lastRun.outcome === "success") {
      toast.success("Database update completed.");
      return;
    }
    if (lastRun.outcome === "mixed") {
      toast(
        `Database update finished: ${lastRun.successCount} succeeded, ${lastRun.failureCount} failed. Open View Logs for more detail.`,
      );
      return;
    }
    toast.error("Database update failed. Open View Logs for more detail.");
  }, [state.hydration.lastRun]);

  useEffect(() => {
    if (previousSelectedSourceRef.current !== null && selectedSourceRef === null) {
      window.scrollTo({ top: 0 });
    }
    previousSelectedSourceRef.current = selectedSourceRef;
  }, [selectedSourceRef]);

  useEffect(() => {
    if (!showDatabaseMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        databaseMenuRef.current &&
        event.target instanceof Node &&
        !databaseMenuRef.current.contains(event.target)
      ) {
        setShowDatabaseMenu(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowDatabaseMenu(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showDatabaseMenu]);

  useEffect(() => {
    if (state.status !== "editable" || selectedEntry) {
      setShowDatabaseMenu(false);
    }
  }, [selectedEntry, state.status]);

  useEffect(() => {
    setArchivePatternDraft(formatArchiveSampleExtensions(archiveSampleExtensions));
    setArchivePatternError(null);
    if (
      sourceEditorController.unarchiveRelevant &&
      selectedEntry?.unarchive &&
      selectedEntrySourceFiles &&
      archiveSampleExtensions.length === 0
    ) {
      setArchivePatternPromptMode("auto");
      setShowArchivePatternModal(true);
      return;
    }
    setArchivePatternPromptMode(null);
    setShowArchivePatternModal(false);
  }, [
    archiveSampleExtensions,
    sourceEditorController.unarchiveRelevant,
    selectedEntry?.selectionStateKey,
    selectedEntry?.unarchive,
    selectedEntrySourceFiles?.selectionStateKey,
  ]);

  useEffect(() => {
    void refreshState();
    const eventSource = new EventSource("/__editor/events");
    eventSource.addEventListener("state", () => {
      void refreshState();
    });
    eventSource.addEventListener("config-updated", () => {
      handleConfigUpdated();
    });
    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedSourceFilesRequest) {
      setSelectedSourceFiles(null);
      setSourceFilesRequestError(null);
      return;
    }
    setSelectedSourceFiles((current) =>
      current &&
      current.hydrationKey === selectedSourceFilesRequest.hydrationKey &&
      current.selectionStateKey === selectedSourceFilesRequest.selectionStateKey
        ? current
        : null,
    );
    setSourceFilesRequestError(null);
    let cancelled = false;
    void loadSourceFiles(selectedSourceFilesRequest)
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
  }, [
    selectedEntryHydrationRefreshKey,
    selectedSourceFilesRequest,
    sourceFilesRequestRevision,
  ]);

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
      const response = await fetch("/__editor/state");
      if (!response.ok) {
        return null;
      }
      const nextState = (await response.json()) as EditorState;
      setState(nextState);
      return nextState;
    } catch {
      return null;
    }
  }

  function applyReloadedState(nextState: EditorState) {
    setState(nextState);
    setSessionEditableState(nextState.status === "editable" ? nextState.editable : null);
    setSelectedSourceRef(null);
    setSelectedSourceFiles(null);
    setSavePreparation(null);
  }

  function handleConfigUpdated() {
    if (pendingLocalConfigUpdateCountRef.current > 0) {
      pendingLocalConfigUpdateCountRef.current -= 1;
      return;
    }
    if (!documentSession) {
      void refreshState();
      return;
    }
    setShowExternalReloadModal(true);
  }

  async function reloadFromDisk() {
    const nextState = await refreshState();
    if (!nextState) {
      toast.error("Could not reload source.json");
      return;
    }
    applyReloadedState(nextState);
    setShowManualReloadModal(false);
    setShowExternalReloadModal(false);
    toast.success("Reloaded source.json from disk");
  }

  async function loadSourceFiles(request: SourceFilesRequest) {
    const response = await fetch("/__editor/source-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error("Source files could not be loaded");
    }
    return (await response.json()) as SourceFilesState;
  }

  function openHydrationModal() {
    setHydrationMode("missing");
    setHydrationRequestError(null);
    setShowHydrationModal(true);
  }

  function buildHydrationRequestPayload(
    mode: HydrationMode,
    snapshot: EditorState,
    entryIdsForPendingRefresh: string[],
  ) {
    return mode === "all"
      ? {
          entryIds: snapshot.entries.map((entry) => entry.id),
          forceRefresh: true,
        }
      : {
          entryIds: entryIdsForPendingRefresh,
          forceRefresh: false,
        };
  }

  async function requestHydrationJob(entryIds: string[], forceRefresh: boolean) {
    setHydrationRequestError(null);
    try {
      const response = await fetch("/__editor/hydrate", {
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
      setShowRefreshDraftConflictModal(false);
      setShowLogModal(true);
      await refreshState();
      return true;
    } catch (error) {
      setHydrationRequestError(
        error instanceof Error ? error.message : "The update could not be started",
      );
      return false;
    }
  }

  async function requestHydration(
    mode: HydrationMode,
    snapshot: EditorState = state,
  ) {
    const { entryIds, forceRefresh } = buildHydrationRequestPayload(
      mode,
      snapshot,
      pendingHydrationEntryIds,
    );
    return requestHydrationJob(entryIds, forceRefresh);
  }

  async function startHydrationFlow() {
    if (sourceListController.dirty) {
      setShowHydrationModal(false);
      setShowRefreshDraftConflictModal(true);
      return;
    }
    await requestHydration(hydrationMode);
  }

  async function savePreviewFixture(
    nextFixture: PreviewFixture,
  ) {
    if (!selectedEntry || !selectedSourceFiles) {
      return;
    }
    const requestKey = `${selectedEntry.hydrationKey}:${nextFixture.fixtureKey}`;
    const requestRevision = beginEntryRequest(
      previewFixtureSaveRevisionRef.current,
      requestKey,
    );
    setPreviewRequestError(null);
    try {
      const response = await fetch("/__editor/preview-fixtures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hydrationKey: selectedEntry.hydrationKey,
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
        updateSourceFilesForEntry(current, selectedEntry, (matchingSourceFiles) => ({
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

    const requestKey = `${selectedEntry.selectionStateKey}:archive-sample-extensions`;
    const requestRevision = beginEntryRequest(
      archivePatternSaveRevisionRef.current,
      requestKey,
    );

    const response = await fetch("/__editor/archive-sample-extensions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        selectionStateKey: selectedEntry.selectionStateKey,
        unarchiveEnabled: selectedEntry.unarchive !== null,
        fileExtensions,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      fileExtensions?: string[];
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Sample File Extensions could not be saved");
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
      updateSourceFilesForEntry(current, selectedEntry, (matchingSourceFiles) => ({
        ...matchingSourceFiles,
        archiveSampleExtensions: payload.fileExtensions ?? [],
      })),
    );
  }

  async function submitArchivePattern() {
    if (!archivePatternValidation.canSave) {
      setArchivePatternError(
        archivePatternValidation.error ?? "Enter at least one file extension.",
      );
      return;
    }

    setSavingArchivePattern(true);
    setArchivePatternError(null);
    try {
      await saveArchiveSampleExtensions(archivePatternValidation.fileExtensions);
      toast.success("Sample File Extensions saved");
      setArchivePatternPromptMode(null);
      setShowArchivePatternModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Could not save Sample File Extensions. Check the console for details.");
      setArchivePatternError(
        error instanceof Error
          ? error.message
          : "Sample File Extensions could not be saved",
      );
    } finally {
      setSavingArchivePattern(false);
    }
  }

  function closeArchivePatternModal() {
    const promptMode = archivePatternPromptMode;
    setShowArchivePatternModal(false);
    setArchivePatternPromptMode(null);
    if (promptMode === "auto") {
      setSelectedSourceRef(null);
    }
  }

  async function saveSelectedRowIds(nextSelectedRowIds: string[]) {
    if (!selectedEntry || !selectedSourceFiles || !selectedSourceFilesRequest) {
      return;
    }
    const requestKey = selectedEntry.selectionStateKey;
    const requestRevision = beginEntryRequest(
      selectedFileSaveRevisionRef.current,
      requestKey,
    );

    const previousSelectedRowIds = selectedSourceFiles.selectedRowIds ?? [];
    setSelectedSourceFiles((current) =>
      updateSourceFilesForEntry(current, selectedEntry, (matchingSourceFiles) => ({
        ...matchingSourceFiles,
        selectedRowIds: nextSelectedRowIds,
      })),
    );

    try {
      const response = await fetch("/__editor/selected-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: selectedSourceFilesRequest,
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
          requestKey,
          requestRevision,
        )
      ) {
        return;
      }
      setSelectedSourceFiles((current) =>
        updateSourceFilesForEntry(current, selectedEntry, (matchingSourceFiles) => ({
          ...matchingSourceFiles,
          selectedRowIds: payload.selectedRowIds ?? [],
        })),
      );
    } catch (error) {
      if (
        !isLatestEntryRequest(
          selectedFileSaveRevisionRef.current,
          requestKey,
          requestRevision,
        )
      ) {
        return;
      }
      setSelectedSourceFiles((current) =>
        updateSourceFilesForEntry(current, selectedEntry, (matchingSourceFiles) => ({
          ...matchingSourceFiles,
          selectedRowIds: previousSelectedRowIds,
        })),
      );
      toast.error(
        error instanceof Error ? error.message : "Selected files could not be saved",
      );
    }
  }

  function handleSourceRowOpen(entryId: string, displayName: string) {
    const result = sourceListController.openSource(entryId);
    if (result.status === "opened") {
      setSelectedSourceRef(result.sourceRef);
      return;
    }
    if (result.status === "missing-cache") {
      setMissingCacheSourceName(displayName);
      return;
    }
    toast.error("That source is no longer available");
  }

  function closeSaveConfirmation() {
    if (savingSourceDocument) {
      return;
    }
    setSavePreparation(null);
    if (reopenHydrationOnSaveCancel) {
      setShowHydrationModal(true);
    }
    setPendingRefreshAfterSave(null);
    setReopenHydrationOnSaveCancel(false);
  }

  function openSaveConfirmation(options?: {
    pendingRefreshMode?: HydrationMode;
    reopenHydrationOnCancel?: boolean;
  }) {
    const nextSavePreparation = sourceListController.prepareSavePreview(state.schemaPath);
    if (!nextSavePreparation) {
      if (options?.reopenHydrationOnCancel) {
        setShowHydrationModal(true);
      }
      return;
    }
    if (nextSavePreparation.status !== "ready") {
      console.error("Save Changes was blocked", nextSavePreparation.blockers);
      if (
        nextSavePreparation.blockers.some(
          (blocker) => blocker.code === "repairable-validation",
        )
      ) {
        toast.error(
          "Save Changes is blocked by draft validation issues. Fix the highlighted source rules and check the browser console for details.",
        );
        if (options?.reopenHydrationOnCancel) {
          setShowHydrationModal(true);
        }
        return;
      }
      toast.error(
        nextSavePreparation.blockers[0]?.message ?? "Save Changes is blocked right now",
      );
      if (options?.reopenHydrationOnCancel) {
        setShowHydrationModal(true);
      }
      return;
    }
    setPendingRefreshAfterSave(options?.pendingRefreshMode ?? null);
    setReopenHydrationOnSaveCancel(options?.reopenHydrationOnCancel ?? false);
    setSavePreparation(nextSavePreparation);
  }

  async function saveSourceDocument() {
    if (!savePreparation) {
      return;
    }

    setSavingSourceDocument(true);
    pendingLocalConfigUpdateCountRef.current = 1;
    try {
      const response = await fetch("/__editor/save-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preview: {
            checksum: savePreparation.preview.checksum,
            text: savePreparation.preview.text,
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "source.json could not be saved");
      }

      const refreshModeAfterSave = pendingRefreshAfterSave;
      sourceListController.commitSave(savePreparation.preview.document);
      const nextState = await refreshState();
      if (!nextState) {
        setState((current) =>
          current.status !== "editable"
            ? current
            : {
                ...current,
                diskFingerprint: savePreparation.preview.checksum,
                editable: {
                  sourceDocument: savePreparation.preview.document,
                  validation: savePreparation.validation,
                },
                entries: buildPreviewEntries(savePreparation.preview.document),
              },
        );
      }
      setSavePreparation(null);
      setPendingRefreshAfterSave(null);
      setReopenHydrationOnSaveCancel(false);
      toast.success("Changes saved to source.json");
      if (refreshModeAfterSave) {
        if (!nextState) {
          setHydrationRequestError(
            "Changes were saved, but the editor could not refresh its current state. Open Update Database and try again.",
          );
          setShowHydrationModal(true);
        } else {
          const started = await requestHydration(refreshModeAfterSave, nextState);
          if (!started) {
            setShowHydrationModal(true);
          }
        }
      }
      setTimeout(() => {
        pendingLocalConfigUpdateCountRef.current = 0;
      }, 1_000);
    } catch (error) {
      pendingLocalConfigUpdateCountRef.current = 0;
      console.error(error);
      toast.error("Could not save changes. Check the console for details.");
    } finally {
      setSavingSourceDocument(false);
    }
  }

  async function clearDatabase() {
    if (clearDatabaseSelectionCount === 0) {
      return;
    }

    const selection = clearDatabaseSelection;
    setShowClearDatabaseConfirmModal(false);
    setShowClearDatabaseModal(false);
    setClearingDatabase(true);
    setClearDatabaseSelection(EMPTY_CLEAR_DATABASE_SELECTION);

    try {
      const response = await fetch("/__editor/clear-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selection,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "The local database data could not be cleared");
      }

      if (selection.updateLogs && !state.hydration.running) {
        setShowLogModal(false);
      }
      await refreshState();
      toast.success("Local database data cleared.");
    } catch (error) {
      console.error(error);
      toast.error("Could not clear local database data. Check the console for details.");
    } finally {
      setClearingDatabase(false);
    }
  }

  function requestManualReload() {
    if (sourceListController.dirty) {
      setShowManualReloadModal(true);
      return;
    }
    void reloadFromDisk();
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Romulus Config Editor</p>
          <h1>Romulus Config Editor</h1>
          <p className="hero-copy">
            This page reads <code>source.json</code> directly, checks that it is
            valid, and updates when the file changes. Use{" "}
            <strong>Update Database</strong> to load file lists from Real-Debrid,
            then open a source to preview what Romulus will show and where files
            will be saved
          </p>
        </div>
        <div className="hero-actions">
          <div
            className={`config-status-inline${configStatusInvalid ? " is-invalid" : " is-valid"}`}
          >
            <span className="config-status-dot" aria-hidden="true" />
            <span>{configStatusLabel}</span>
          </div>
          {state.status === "blocked" ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                requestManualReload();
              }}
            >
              Reload source.json
            </button>
          ) : null}
          <div className="hero-meta-inline">
            <span>Last updated</span>
            <strong>
              {state.hydration.lastHydratedAt
                ? formatTimestamp(state.hydration.lastHydratedAt)
                : "Never"}
            </strong>
          </div>
        </div>
      </section>

      {!selectedEntry ? (
        <section className="source-list-section">
          {state.status === "editable" ? (
            <>
              <div className="source-list-toolbar">
                <div className="source-list-toolbar-group">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      openSaveConfirmation();
                    }}
                    disabled={!sourceListController.dirty || state.hydration.running}
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={sourceListController.undo}
                    disabled={!sourceListController.canUndo || state.hydration.running}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={sourceListController.redo}
                    disabled={!sourceListController.canRedo || state.hydration.running}
                  >
                    Redo
                  </button>
                </div>
                <div className="source-list-toolbar-group source-list-toolbar-group-right">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={requestManualReload}
                    disabled={state.hydration.running}
                  >
                    Reload source.json
                  </button>
                  <div className="toolbar-menu" ref={databaseMenuRef}>
                    <button
                      type="button"
                      className="ghost-button toolbar-menu-button"
                      aria-expanded={showDatabaseMenu}
                      onClick={() => setShowDatabaseMenu((current) => !current)}
                    >
                      Manage database ▾
                    </button>
                    {showDatabaseMenu ? (
                      <div className="toolbar-menu-popover">
                        <button
                          type="button"
                          className="toolbar-menu-item"
                          onClick={() => {
                            setShowDatabaseMenu(false);
                            openHydrationModal();
                          }}
                          disabled={state.entries.length === 0 || state.hydration.running}
                        >
                          Refresh Database
                        </button>
                        <button
                          type="button"
                          className="toolbar-menu-item"
                          onClick={() => {
                            setShowDatabaseMenu(false);
                            setShowLogModal(true);
                          }}
                          disabled={!hasHydrationLogs || (state.hydration.running && showLogModal)}
                        >
                          View Logs
                        </button>
                        <button
                          type="button"
                          className="toolbar-menu-item"
                          onClick={() => {
                            setShowDatabaseMenu(false);
                            setShowClearDatabaseModal(true);
                          }}
                          disabled={state.hydration.running || clearingDatabase}
                        >
                          Clear Database
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="source-list-status-line">
                <span>{sourceCountLabel}</span>
                <span>{draftStatusLabel}</span>
              </div>
            </>
          ) : null}
          {state.status === "blocked" ? (
            <BlockedDocumentPanel
              groups={state.blocked.groups}
              onReload={() => {
                requestManualReload();
              }}
            />
          ) : sourceListController.rows.length === 0 ? (
            <article className="panel">
              <EmptyState
                title="No sources yet"
                body="Add a source to start editing source.json."
              />
              <div className="source-list-footer">
                <button
                  type="button"
                  className="source-list-add-button"
                  onClick={sourceListController.openCreateSourceModal}
                  disabled={state.hydration.running}
                >
                  + Add source
                </button>
              </div>
            </article>
          ) : (
            <>
              <div className="source-list">
                {sourceListController.rows.map((row) => (
                  <SourceListRowCard
                    key={row.ref}
                    row={row}
                    rowOrder={sourceListRowOrder}
                    disabled={state.hydration.running}
                    onOpen={() => {
                      handleSourceRowOpen(row.entry.id, row.entry.displayName);
                    }}
                    onEdit={() => sourceListController.openEditSourceModal(row.ref)}
                    onDelete={() => sourceListController.requestDeleteSource(row.ref)}
                    onInfo={() => setInfoEntryId(row.entry.id)}
                    onMove={(sourceRef, targetIndex) => {
                      sourceListController.moveSource(sourceRef, targetIndex);
                    }}
                  />
                ))}
              </div>
              <div className="source-list-footer">
                <button
                  type="button"
                  className="source-list-add-button"
                  onClick={sourceListController.openCreateSourceModal}
                  disabled={state.hydration.running}
                >
                  + Add source
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {selectedEntry ? (
        <>
          <div className="workbench-header">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelectedSourceRef(null)}
            >
              Back to sources
            </button>
            <div>
              <p className="workbench-kicker">Selected source</p>
              <strong>{selectedEntry.displayName}</strong>
            </div>
          </div>

          <article className="panel disclosure-panel">
            <details className="section-disclosure">
              <summary className="section-disclosure-summary">
                <PanelTitle
                  title="Source Info"
                  subtitle="Read-only source definition details for the current editor session"
                />
                <span className="disclosure-chip">Show details</span>
              </summary>
              <div className="section-disclosure-body">
                <dl className="details-grid">
                  <DetailRow label="Display Name" value={selectedEntry.displayName} />
                  <DetailRow label="Subfolder" value={selectedEntry.subfolder} />
                  <DetailRow label="Path" value={selectedEntry.scope.normalizedPath} />
                  <DetailRow
                    label="Mode"
                    value={selectedEntry.scope.isArchiveSelection ? "ZIP source" : "Folder source"}
                  />
                  <DetailRow
                    label="Torrent Links"
                    value={String(selectedEntry.torrents.length)}
                  />
                </dl>
              </div>
            </details>
          </article>

          <section className="workbench-layout">
            <article className="panel workbench-panel">
              <div className="panel-title-row">
                <PanelTitle
                  title="Files List"
                  subtitle="Preview the files you want Romulus to show for this source"
                />
              </div>
              <div className="panel-scroll-body">
                <FilesPanel
                  sourceFiles={visibleSourceFiles}
                  errorMessage={sourceFilesRequestError}
                  selectedRowIds={selectedRowIds}
                  baseFileCount={effectiveSourceFiles?.files.length ?? 0}
                  searchText={sourceEditorController.fileSearchText}
                  showSearch={sourceEditorController.showFileSearch}
                  onSearchChange={sourceEditorController.setFileSearchText}
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
                {selectedEntry.unarchive && sourceEditorController.unarchiveRelevant ? (
                  <div className="preview-pattern-toolbar">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setArchivePatternDraft(
                          formatArchiveSampleExtensions(archiveSampleExtensions),
                        );
                        setArchivePatternError(null);
                        setArchivePatternPromptMode("manual");
                        setShowArchivePatternModal(true);
                      }}
                    >
                      Edit Sample File Extensions
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="panel-scroll-body">
                <DownloadPreviewPanel
                  entry={selectedEntry}
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
                  onClick={closeArchivePatternModal}
                >
                  <div
                    className="preview-panel-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Sample File Extensions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="modal-header">
                      <h2>Sample File Extensions</h2>
                    </div>
                    <div className="modal-body">
                      <div className="modal-copy">
                        <p>
                          This source is configured to extract files from an archive. Enter
                          the expected file extensions to populate the download preview.
                        </p>
                      </div>
                      <div className="field-stack">
                        <label className="field">
                          <span>Sample File Extensions</span>
                          <input
                            type="text"
                            value={archivePatternDraft}
                            onChange={(event) => {
                              setArchivePatternDraft(event.target.value);
                              setArchivePatternError(null);
                            }}
                            placeholder=".cue, .bin"
                          />
                        </label>
                        {(archivePatternError ?? archivePatternValidation.error) ? (
                          <div className="inline-error">
                            {archivePatternError ?? archivePatternValidation.error}
                          </div>
                        ) : null}
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={closeArchivePatternModal}
                          disabled={savingArchivePattern}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => {
                            void submitArchivePattern();
                          }}
                          disabled={savingArchivePattern || !archivePatternValidation.canSave}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          </section>

          <SourcePolicyWorkbench
            controller={sourceEditorController}
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
          showHeaderClose={false}
        >
          {!state.hydration.apiKeyConfigured ? (
            <p>
              Add your <code>REAL_DEBRID_API_KEY</code> to <code>editor/.env.local</code>
              before loading file lists.
            </p>
          ) : (
            <div className="field-stack">
              <p>Choose how much local cache to update.</p>
              <label className="field">
                <span>
                  <input
                    type="radio"
                    name="hydration-mode"
                    checked={hydrationMode === "missing"}
                    onChange={() => setHydrationMode("missing")}
                  />
                  {" "}
                  Only Load Missing Cache
                </span>
                <small>Loads file cache for sources that still need local cache work.</small>
              </label>
              <label className="field">
                <span>
                  <input
                    type="radio"
                    name="hydration-mode"
                    checked={hydrationMode === "all"}
                    onChange={() => setHydrationMode("all")}
                  />
                  {" "}
                  Refresh All Cache
                </span>
                <small>Rebuilds file cache for every source, even when local cache already exists.</small>
              </label>
            </div>
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
              disabled={!canStartHydration}
              title={
                hydrationMode === "missing" && !canStartMissingCacheRefresh
                  ? "No Cache Work Needed"
                  : undefined
              }
              onClick={() => {
                void startHydrationFlow();
              }}
            >
              Start Update
            </button>
          </div>
        </Modal>
      ) : null}

      {showRefreshDraftConflictModal ? (
        <Modal
          title="Unsaved changes detected"
          onClose={() => {
            setShowRefreshDraftConflictModal(false);
            setShowHydrationModal(true);
          }}
        >
          <p>
            Refresh Database always runs against the saved <code>source.json</code> on
            disk. Save the current draft first, or continue using <code>source.json</code> on
            disk.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setShowRefreshDraftConflictModal(false);
                openSaveConfirmation({
                  pendingRefreshMode: hydrationMode,
                  reopenHydrationOnCancel: true,
                });
              }}
            >
              Save now
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void (async () => {
                  const started = await requestHydration(hydrationMode);
                  if (!started) {
                    setShowHydrationModal(true);
                  }
                })();
              }}
            >
              Use source.json on disk
            </button>
          </div>
        </Modal>
      ) : null}

      {structureModal && structureValidation ? (
        <Modal
          title={
            structureModal.mode === "create"
              ? "Create Source"
              : "Update Source"
          }
          onClose={sourceListController.closeStructureModal}
          showHeaderClose={false}
        >
          <div className="field-stack">
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={structureModal.draft.displayName}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  sourceListController.updateStructureDraft((current) => ({
                    ...current,
                    displayName: nextValue,
                  }));
                }}
              />
              {structureValidation.displayNameError ? (
                <span className="inline-error">
                  {structureValidation.displayNameError}
                </span>
              ) : null}
            </label>
            <label className="field">
              <span>Subfolder</span>
              <input
                type="text"
                value={structureModal.draft.subfolder}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  sourceListController.updateStructureDraft((current) => ({
                    ...current,
                    subfolder: nextValue,
                  }));
                }}
              />
              {structureValidation.subfolderError ? (
                <span className="inline-error">
                  {structureValidation.subfolderError}
                </span>
              ) : null}
            </label>
            <label className="field">
              <span>Path</span>
              <input
                type="text"
                value={structureModal.draft.scopePath}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  sourceListController.updateStructureDraft((current) => ({
                    ...current,
                    scopePath: nextValue,
                  }));
                }}
                placeholder="/ or /ROMs/Game.zip"
              />
              {structureValidation.scopePathError ? (
                <span className="inline-error">
                  {structureValidation.scopePathError}
                </span>
              ) : null}
            </label>
            {structureModal.draft.torrents.map((torrent, index) => (
              <div key={index} className="field-stack">
                <label className="field">
                  <span>{`Magnet URL ${index + 1}`}</span>
                  <input
                    type="text"
                    value={torrent.url}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      sourceListController.updateStructureDraft((current) => ({
                        ...current,
                        torrents: current.torrents.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                url: nextValue,
                              }
                            : candidate,
                        ),
                      }));
                    }}
                  />
                  {structureValidation.torrentErrors[index]?.urlError ? (
                    <span className="inline-error">
                      {structureValidation.torrentErrors[index]?.urlError}
                    </span>
                  ) : null}
                </label>
                <label className="field">
                  <span>{`Part name ${index + 1}`}</span>
                  <input
                    type="text"
                    value={torrent.partName}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      sourceListController.updateStructureDraft((current) => ({
                        ...current,
                        torrents: current.torrents.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                partName: nextValue,
                              }
                            : candidate,
                        ),
                      }));
                    }}
                  />
                  {structureValidation.torrentErrors[index]?.partNameError ? (
                    <span className="inline-error">
                      {structureValidation.torrentErrors[index]?.partNameError}
                    </span>
                  ) : null}
                </label>
                <div className="policy-actions-row">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      sourceListController.updateStructureDraft((current) => ({
                        ...current,
                        torrents:
                          current.torrents.length === 1
                            ? current.torrents
                            : current.torrents.filter(
                                (_candidate, candidateIndex) => candidateIndex !== index,
                              ),
                      }));
                    }}
                    disabled={structureModal.draft.torrents.length <= 1}
                  >
                    Remove Torrent
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                sourceListController.updateStructureDraft((current) => ({
                  ...current,
                  torrents: [
                    ...current.torrents,
                    {
                      url: "",
                      partName: "",
                    },
                  ],
                }));
              }}
            >
              Add Torrent
            </button>
            {structureValidation.duplicateError ? (
              <div className="inline-error">
                {structureValidation.duplicateError}
              </div>
            ) : null}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={sourceListController.closeStructureModal}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!structureValidation.valid}
              onClick={() => {
                sourceListController.confirmStructureModal();
              }}
            >
              {structureModal.mode === "create"
                ? "Create Source"
                : "Update Source"}
            </button>
          </div>
        </Modal>
      ) : null}

      {deleteSource ? (
        <Modal
          title="Delete Source"
          onClose={sourceListController.cancelDeleteSource}
          showHeaderClose={false}
        >
          <p>
            Delete <strong>{deleteSource.entry.displayName}</strong> from the current draft?
            This does not persist to source.json until you save.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={sourceListController.cancelDeleteSource}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button danger-button"
              onClick={() => {
                sourceListController.confirmDeleteSource();
              }}
            >
              Delete Source
            </button>
          </div>
        </Modal>
      ) : null}

      {savePreparation ? (
        <Modal
          title="Save Changes"
          onClose={closeSaveConfirmation}
          showHeaderClose={false}
        >
          <p>
            Save the current draft into <code>source.json</code>.
          </p>
          <details>
            <summary>Preview source.json</summary>
            <pre>{savePreparation.preview.text}</pre>
          </details>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={closeSaveConfirmation}
              disabled={savingSourceDocument}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void saveSourceDocument();
              }}
              disabled={savingSourceDocument}
            >
              {savingSourceDocument ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Modal>
      ) : null}

      {showClearDatabaseModal ? (
        <Modal
          title="Clear Database"
          onClose={() => {
            if (!clearingDatabase) {
              setShowClearDatabaseModal(false);
              setClearDatabaseSelection(EMPTY_CLEAR_DATABASE_SELECTION);
            }
          }}
          showHeaderClose={false}
        >
          <p>
            Choose what to remove from the local database. This only affects cached
            local editor data and does not modify source.json.
          </p>
          <div className="field-stack">
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={clearDatabaseSelection.fileCache}
                  onChange={(event) =>
                    setClearDatabaseSelection((current) => ({
                      ...current,
                      fileCache: event.target.checked,
                    }))
                  }
                />
                {" "}
                File Cache
              </span>
              <small>Removes cached file lists downloaded for your sources.</small>
            </label>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={clearDatabaseSelection.savedSelections}
                  onChange={(event) =>
                    setClearDatabaseSelection((current) => ({
                      ...current,
                      savedSelections: event.target.checked,
                    }))
                  }
                />
                {" "}
                Saved Selections
              </span>
              <small>Removes saved file selections for your sources.</small>
            </label>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={clearDatabaseSelection.savedPreviewData}
                  onChange={(event) =>
                    setClearDatabaseSelection((current) => ({
                      ...current,
                      savedPreviewData: event.target.checked,
                    }))
                  }
                />
                {" "}
                Saved Preview Data
              </span>
              <small>Removes saved Sample File Extensions.</small>
            </label>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={clearDatabaseSelection.updateLogs}
                  onChange={(event) =>
                    setClearDatabaseSelection((current) => ({
                      ...current,
                      updateLogs: event.target.checked,
                    }))
                  }
                />
                {" "}
                Update Logs
              </span>
              <small>Removes saved database update logs.</small>
            </label>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setShowClearDatabaseModal(false);
                setClearDatabaseSelection(EMPTY_CLEAR_DATABASE_SELECTION);
              }}
              disabled={clearingDatabase}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button danger-button"
              onClick={() => setShowClearDatabaseConfirmModal(true)}
              disabled={clearDatabaseSelectionCount === 0 || clearingDatabase}
            >
              Clear Selected Data
            </button>
          </div>
        </Modal>
      ) : null}

      {showClearDatabaseConfirmModal ? (
        <Modal
          title="Confirm Clear Database"
          onClose={() => {
            if (!clearingDatabase) {
              setShowClearDatabaseConfirmModal(false);
            }
          }}
          showHeaderClose={false}
        >
          <p>
            This will permanently remove the selected local database data. This cannot be
            undone.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowClearDatabaseConfirmModal(false)}
              disabled={clearingDatabase}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button danger-button"
              onClick={() => {
                void clearDatabase();
              }}
              disabled={clearingDatabase}
            >
              Clear Data
            </button>
          </div>
        </Modal>
      ) : null}

      {showManualReloadModal ? (
        <Modal
          title="Reload source.json"
          onClose={() => setShowManualReloadModal(false)}
          showHeaderClose={false}
        >
          <p>
            Reloading from disk will discard your current drafts and edit history. Any
            unsaved changes in the editor will be lost.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowManualReloadModal(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void reloadFromDisk();
              }}
            >
              Reload from Disk
            </button>
          </div>
        </Modal>
      ) : null}

      {showExternalReloadModal ? (
        <Modal
          title="source.json changed on disk"
          onClose={() => setShowExternalReloadModal(false)}
          showHeaderClose={false}
        >
          <p>
            source.json changed outside the editor. Reload from disk to discard the
            current draft, or keep the current draft active and continue editing.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowExternalReloadModal(false)}
            >
              Keep Current Draft
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void reloadFromDisk();
              }}
            >
              Reload from Disk
            </button>
          </div>
        </Modal>
      ) : null}

      {missingCacheSourceName ? (
        <Modal
          title="File cache required"
          onClose={() => setMissingCacheSourceName(null)}
        >
          <p>
            Refresh Database before opening <strong>{missingCacheSourceName}</strong>. This
            source does not currently have local file cache for its current content
            boundary.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setMissingCacheSourceName(null)}
            >
              Close
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
            <InfoRow label="Path" value={infoEntry.scope.normalizedPath} />
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
  sourceFiles,
  errorMessage,
  selectedRowIds,
  baseFileCount,
  searchText,
  showSearch,
  onSearchChange,
  onRetry,
  onToggle,
}: {
  sourceFiles: SourceFilesState | null;
  errorMessage: string | null;
  selectedRowIds: string[];
  baseFileCount: number;
  searchText: string;
  showSearch: boolean;
  onSearchChange: (value: string) => void;
  onRetry: () => void;
  onToggle: (fileId: string) => void;
}) {
  if (!sourceFiles) {
    return (
      errorMessage ? (
        <div className="empty-state">
          <strong>Could not load files</strong>
          <p>The file list could not be loaded for this source. Try again.</p>
          <button type="button" className="ghost-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <EmptyState
          title="Loading files"
          body="Checking the local database for this source."
        />
      )
    );
  }

  const loadError = errorMessage ? <div className="inline-error">{errorMessage}</div> : null;
  const loadFailureState = (
    <>
      {loadError}
      <div className="empty-state">
        <strong>Could not load files</strong>
        <p>The file list could not be loaded for this source. Try again.</p>
        <button type="button" className="ghost-button" onClick={onRetry}>
          Retry
        </button>
      </div>
    </>
  );

  if (sourceFiles.sourceStatus === "missing") {
    return loadFailureState;
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
              ? "The outer ZIP is already prepared, but the editor could not finish reading it. Use Refresh to retry from the saved provider state."
              : `${sourceFiles.statusLabel ?? "Preparing"}${sourceFiles.progressPercent === null ? "" : ` (${sourceFiles.progressPercent}%)`}. Wait for the Real-Debrid download to finish, then use Refresh to continue.`
          }
        />
      </>
    );
  }

  if (sourceFiles.sourceStatus === "error") {
    return loadFailureState;
  }

  if (sourceFiles.files.length === 0 && !(baseFileCount > 0 && searchText.trim().length > 0)) {
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
      {showSearch ? (
        <div className="field">
          <input
            type="search"
            value={searchText}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search files"
          />
        </div>
      ) : null}
      {sourceFiles.files.length === 0 ? (
        <EmptyState
          title="No files matched your search"
          body="Try a different file name or clear the current search."
        />
      ) : (
        <ul className="file-list">
          {sourceFiles.files.map((file) => {
            const checked = selectedRowIds.includes(file.id);
            return (
              <li key={file.id} className="file-row">
                <div className="file-toggle">
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
                  </div>
                </div>
                <div className="file-meta">
                  {file.sizeBytes !== null ? <small>{formatBytes(file.sizeBytes)}</small> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
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
  archiveFixtures: ArchiveFixtureDescriptor[];
  previewTree: PreviewTreeNode;
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
  controller,
}: {
  controller: ReturnType<typeof useSourceEditorController>;
}) {
  const entry = controller.source?.entry;
  const [showStatistics, setShowStatistics] = useState(false);
  const statisticsWarnings = [
    ...controller.analysis.warnings,
    ...controller.invalidIgnoreGlobs.map((glob) => `Invalid ignore glob: ${glob}`),
  ];

  useEffect(() => {
    setShowStatistics(false);
  }, [entry?.id]);

  if (!entry) {
    return null;
  }

  return (
    <section className="maintainer-layout">
      {controller.unarchiveRelevant ? (
        <article className="panel policy-panel-wide">
          <PanelTitle
            title="Unarchive"
            subtitle="Choose how archive files should be extracted in the current draft"
          />
          {!controller.sourceReady ? (
            <div className="panel-scroll-body policy-body">
              <EmptyState
                title="No unarchive controls yet"
                body="Hydrate and open this source first so the editor can inspect archive files."
              />
            </div>
          ) : (
            <div className="policy-editor-body unarchive-surface">
              <div className="unarchive-toolbar">
                <div>
                  <span className="toolbar-label">Extraction</span>
                  <p className="section-copy">
                    Turn archive extraction on or off for the current draft.
                  </p>
                </div>
                <div className="policy-mode-row">
                  <button
                    type="button"
                    className={!controller.unarchiveEnabled ? "primary-button" : "ghost-button"}
                    onClick={() => controller.setUnarchiveEnabled(false)}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    className={controller.unarchiveEnabled ? "primary-button" : "ghost-button"}
                    onClick={() => controller.setUnarchiveEnabled(true)}
                  >
                    On
                  </button>
                </div>
              </div>
              {controller.unarchiveEnabled ? (
                <>
                  <div className="choice-grid">
                    <button
                      type="button"
                      className={`choice-card ${
                        controller.unarchiveLayoutMode === "flat"
                          ? "choice-card-active"
                          : ""
                      }`}
                      onClick={() => controller.setUnarchiveLayoutMode("flat")}
                    >
                      <strong>Flat</strong>
                      <small>Extract files directly into the source subfolder.</small>
                    </button>
                    <button
                      type="button"
                      className={`choice-card ${
                        controller.unarchiveLayoutMode === "dedicatedFolder"
                          ? "choice-card-active"
                          : ""
                      }`}
                      onClick={() => controller.setUnarchiveLayoutMode("dedicatedFolder")}
                    >
                      <strong>Dedicated Folder</strong>
                      <small>Put each extracted archive inside its own named folder.</small>
                    </button>
                  </div>
                  {controller.unarchiveLayoutMode === "dedicatedFolder" ? (
                    <div className="subsection-card field-stack">
                      <div className="subsection-heading">
                        <strong>Dedicated Folder Rename</strong>
                        <p>
                          Control how each extracted folder name is derived before files are saved.
                        </p>
                      </div>
                      {controller.dedicatedRenameWarnings.length > 0 ? (
                        <div className="policy-warning-list">
                          {controller.dedicatedRenameWarnings.map((warning) => (
                            <p key={warning}>{warning}</p>
                          ))}
                        </div>
                      ) : null}
                      <div className="policy-mode-row">
                        <button
                          type="button"
                          className={
                            controller.dedicatedRenameMode === "none"
                              ? "primary-button"
                              : "ghost-button"
                          }
                          onClick={() => controller.updateDedicatedRenameDraft("none", [])}
                        >
                          No rename
                        </button>
                        <button
                          type="button"
                          className={
                            controller.dedicatedRenameMode === "all"
                              ? "primary-button"
                              : "ghost-button"
                          }
                          onClick={() => controller.updateDedicatedRenameDraft("all")}
                        >
                          All phrases
                        </button>
                        <button
                          type="button"
                          className={
                            controller.dedicatedRenameMode === "phrases"
                              ? "primary-button"
                              : "ghost-button"
                          }
                          onClick={() => controller.updateDedicatedRenameDraft("phrases")}
                        >
                          Selected phrases
                        </button>
                        <button
                          type="button"
                          className={
                            controller.dedicatedRenameMode === "custom"
                              ? "primary-button"
                              : "ghost-button"
                          }
                          onClick={() => controller.updateDedicatedRenameDraft("custom")}
                        >
                          Custom
                        </button>
                      </div>
                      {controller.dedicatedRenameMode === "custom" ? (
                        <div className="field-stack">
                          <label className="field">
                            <span>Pattern</span>
                            <input
                              type="text"
                              value={controller.customDedicatedRenameRule.pattern}
                              onChange={(event) =>
                                controller.updateCustomDedicatedRenameRule({
                                  ...controller.customDedicatedRenameRule,
                                  pattern: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Replacement</span>
                            <input
                              type="text"
                              value={controller.customDedicatedRenameRule.replacement}
                              onChange={(event) =>
                                controller.updateCustomDedicatedRenameRule({
                                  ...controller.customDedicatedRenameRule,
                                  replacement: event.target.value,
                                })
                              }
                            />
                          </label>
                          {controller.dedicatedRenameIssue ? (
                            <div className="inline-error">{controller.dedicatedRenameIssue}</div>
                          ) : null}
                        </div>
                      ) : null}
                      {controller.dedicatedRenameMode === "phrases" ? (
                        <>
                          <div className="panel-scroll-body policy-editor-scroll">
                            <ul className="policy-checklist">
                              {controller.dedicatedPhraseOptions.length === 0 ? (
                                <li>
                                  <span className="policy-check-copy">
                                    <strong>None</strong>
                                    <small>No parenthetical phrases are currently detected.</small>
                                  </span>
                                </li>
                              ) : (
                                controller.dedicatedPhraseOptions.map((phrase) => {
                                  const checked = controller.dedicatedRenamePhrases.includes(
                                    phrase.phrase,
                                  );
                                  return (
                                    <li key={phrase.phrase}>
                                      <label className="policy-check">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            controller.updateDedicatedRenameDraft(
                                              "phrases",
                                              checked
                                                ? controller.dedicatedRenamePhrases.filter(
                                                    (value) => value !== phrase.phrase,
                                                  )
                                                : [
                                                    ...controller.dedicatedRenamePhrases,
                                                    phrase.phrase,
                                                  ].sort(),
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
                                })
                              )}
                            </ul>
                          </div>
                          {controller.dedicatedPhraseOptions.length > 0 ? (
                            <div className="policy-actions-row policy-checklist-actions">
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={controller.selectAllDedicatedPhrases}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={controller.clearDedicatedPhrases}
                              >
                                Select none
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </article>
      ) : null}

      <article className="panel policy-panel policy-scroll-panel">
        <PanelTitle
          title="Rename"
          subtitle="Select the exact parenthetical phrases this source should strip before saving final files"
        />
        {!controller.sourceReady ? (
          <div className="panel-scroll-body policy-body">
            <EmptyState
              title="No rename analysis yet"
              body="Hydrate and open this source first so the editor can inspect its observed file names."
            />
          </div>
        ) : (
          <div className="policy-editor-body">
            {controller.renameWarnings.length > 0 ? (
              <div className="policy-warning-list">
                {controller.renameWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <div className="policy-mode-row">
              <button
                type="button"
                className={controller.renameMode === "none" ? "primary-button" : "ghost-button"}
                onClick={() => {
                  controller.updateRenameDraft("none", []);
                }}
              >
                No rename
              </button>
              <button
                type="button"
                className={controller.renameMode === "all" ? "primary-button" : "ghost-button"}
                onClick={() => {
                  controller.updateRenameDraft("all");
                }}
              >
                All phrases
              </button>
              <button
                type="button"
                className={controller.renameMode === "phrases" ? "primary-button" : "ghost-button"}
                onClick={() => {
                  controller.updateRenameDraft("phrases");
                }}
              >
                Selected phrases
              </button>
              <button
                type="button"
                className={controller.renameMode === "custom" ? "primary-button" : "ghost-button"}
                onClick={() => {
                  controller.updateRenameDraft("custom");
                }}
              >
                Custom
              </button>
            </div>
            {controller.renameMode === "custom" ? (
              <div className="field-stack">
                <label className="field">
                  <span>Pattern</span>
                  <input
                    type="text"
                    value={controller.customRenameRule.pattern}
                    onChange={(event) =>
                      controller.updateCustomRenameRule({
                        ...controller.customRenameRule,
                        pattern: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Replacement</span>
                  <input
                    type="text"
                    value={controller.customRenameRule.replacement}
                    onChange={(event) =>
                      controller.updateCustomRenameRule({
                        ...controller.customRenameRule,
                        replacement: event.target.value,
                      })
                    }
                  />
                </label>
                {controller.renameIssue ? (
                  <div className="inline-error">{controller.renameIssue}</div>
                ) : null}
              </div>
            ) : null}
            {controller.renameMode === "phrases" ? (
              <>
                <div className="panel-scroll-body policy-editor-scroll">
                  <ul className="policy-checklist">
                    {controller.phraseOptions.length === 0 ? (
                      <li>
                        <span className="policy-check-copy">
                          <strong>None</strong>
                          <small>No parenthetical phrases are currently detected.</small>
                        </span>
                      </li>
                    ) : (
                      controller.phraseOptions.map((phrase) => {
                        const checked = controller.renamePhrases.includes(phrase.phrase);
                        return (
                          <li key={phrase.phrase}>
                            <label className="policy-check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  controller.updateRenameDraft(
                                    "phrases",
                                    checked
                                      ? controller.renamePhrases.filter(
                                          (value) => value !== phrase.phrase,
                                        )
                                      : [...controller.renamePhrases, phrase.phrase].sort(),
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
                      })
                    )}
                  </ul>
                </div>
                {controller.phraseOptions.length > 0 ? (
                  <div className="policy-actions-row policy-checklist-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={controller.selectAllPhrases}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={controller.clearPhrases}
                    >
                      Select none
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="policy-actions-row">
              <span className="policy-summary">
                {controller.draftRenameChangedCount === null
                  ? "Hydrate this source to count affected file names"
                  : `${controller.draftRenameChangedCount} file(s) would change with the current rename draft`}
              </span>
            </div>
          </div>
        )}
      </article>

      <article className="panel policy-panel policy-scroll-panel">
        <PanelTitle
          title="Ignore"
          subtitle="Edit the ignore globs for this source's shared draft"
        />
        <div className="policy-editor-body">
          <div className="panel-scroll-body policy-editor-scroll">
            <div className="field-stack">
              {controller.currentIgnoreGlobs.map((glob, index) => {
                const normalizedGlob = glob.trim();
                const rowHasInvalidGlob =
                  normalizedGlob.length > 0 &&
                  controller.invalidIgnoreGlobs.includes(normalizedGlob);
                return (
                  <div key={`${entry.id}-${index}`} className="policy-glob-row">
                    <label className="field">
                      <span>{index === 0 ? "Ignore glob" : `Ignore glob ${index + 1}`}</span>
                      <input
                        type="text"
                        value={glob}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          controller.updateIgnoreGlobs(
                            controller.currentIgnoreGlobs.map((candidate, candidateIndex) =>
                              candidateIndex === index ? nextValue : candidate,
                            ),
                          );
                        }}
                        placeholder={index === 0 ? "* (Japan)*.zip" : "Optional additional glob"}
                      />
                      {rowHasInvalidGlob ? (
                        <span className="inline-error">
                          This ignore glob is invalid. Fix or remove it before saving.
                        </span>
                      ) : null}
                    </label>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        controller.updateIgnoreGlobs(
                          controller.currentIgnoreGlobs.length === 1
                            ? [""]
                            : controller.currentIgnoreGlobs.filter(
                                (_candidate, candidateIndex) => candidateIndex !== index,
                              ),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="policy-actions-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                controller.updateIgnoreGlobs([...controller.currentIgnoreGlobs, ""]);
              }}
            >
              Add ignore glob
            </button>
          </div>
        </div>
      </article>

      <article className="panel policy-panel policy-panel-wide">
        <div className="panel-title-row">
          <PanelTitle
            title="Statistics"
            subtitle="Use the observed counts to judge how the current draft changes this source"
          />
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowStatistics((current) => !current)}
          >
            {showStatistics ? "Hide" : "Show"}
          </button>
        </div>
        {showStatistics ? (
          <div className="panel-scroll-body policy-body">
            {!controller.sourceReady ? (
              <EmptyState
                title="No statistics yet"
                body="Hydrate and open this source first so the editor can compute policy guidance from real cached file names."
              />
            ) : (
              <div className="field-stack">
                <div className="field-stack">
                  <h3>File Cache</h3>
                  <div className="policy-stats-grid">
                    <InfoRow label="Files" value={String(controller.fileCacheStats.files)} />
                    <InfoRow
                      label="Total Size"
                      value={formatBytes(controller.fileCacheStats.totalSizeBytes)}
                    />
                    <InfoRow
                      label="Files with Parentheses"
                      value={String(controller.fileCacheStats.withParenthesesCount)}
                    />
                    <InfoRow
                      label="Files with Multiple Parenthetical Groups"
                      value={String(controller.fileCacheStats.multiParenthesesCount)}
                    />
                  </div>
                </div>
                <div className="field-stack">
                  <h3>Current Draft</h3>
                  <div className="policy-stats-grid">
                    <InfoRow label="Files" value={String(controller.draftStats.files)} />
                    <InfoRow
                      label="Total Size"
                      value={formatBytes(controller.draftStats.totalSizeBytes)}
                    />
                    <InfoRow
                      label="Files with Parentheses"
                      value={String(controller.draftStats.withParenthesesCount)}
                    />
                    <InfoRow
                      label="Files with Multiple Parenthetical Groups"
                      value={String(controller.draftStats.multiParenthesesCount)}
                    />
                    <InfoRow
                      label="Files Renamed"
                      value={
                        controller.draftRenameChangedCount === null
                          ? "Unavailable"
                          : String(controller.draftRenameChangedCount)
                      }
                    />
                    <InfoRow
                      label="Excluded by Scope"
                      value={String(controller.excludedByScopeCount)}
                    />
                    <InfoRow
                      label="Ignored by Rules"
                      value={
                        controller.invalidIgnoreGlobs.length > 0
                          ? "Invalid globs"
                          : controller.draftIgnoreCount === null
                            ? "Unavailable"
                            : String(controller.draftIgnoreCount)
                      }
                    />
                  </div>
                </div>
                {statisticsWarnings.length > 0 ? (
                  <div className="policy-warning-list">
                    {statisticsWarnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </article>
    </section>
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
      showHeaderClose={false}
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
    <Modal title="Remove Example File" onClose={onClose} showHeaderClose={false}>
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

function SourceListRowCard({
  row,
  rowOrder,
  disabled,
  onOpen,
  onEdit,
  onDelete,
  onInfo,
  onMove,
}: {
  row: ReturnType<typeof useSourceListController>["rows"][number];
  rowOrder: SessionSourceReference[];
  disabled: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onInfo: () => void;
  onMove: (sourceRef: SessionSourceReference, targetIndex: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const currentIndex = rowOrder.indexOf(row.ref);
  const sourceState = row.hydrationState;
  const typeLabel = row.entry.scope.isArchiveSelection ? "ZIP" : "Folder";
  const statusLabel = formatSourceStatus(sourceState?.status ?? "missing");
  const combinedBadgeLabel = `${typeLabel} · ${statusLabel}`;
  const combinedBadgeTitle = row.missingCache
    ? "Refresh Database to load file cache before opening this source"
    : undefined;

  useEffect(() => {
    const element = containerRef.current;
    const dragHandle = dragHandleRef.current;
    if (!element || !dragHandle || disabled || currentIndex < 0) {
      return;
    }

    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => ({
          type: "source-row",
          sourceRef: row.ref,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          return isSourceRowDragData(source.data) && source.data.sourceRef !== row.ref;
        },
        getData: ({ input, element: target }) =>
          attachClosestEdge(
            {
              type: "source-row-target",
              sourceRef: row.ref,
            },
            {
              input,
              element: target,
              allowedEdges: ["top", "bottom"],
            },
          ),
        onDragEnter: ({ self }) => {
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDrag: ({ self }) => {
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDragLeave: () => {
          setClosestEdge(null);
        },
        onDrop: ({ source, self }) => {
          setClosestEdge(null);
          const data = source.data;
          if (!isSourceRowDragData(data)) {
            return;
          }
          const startIndex = rowOrder.indexOf(data.sourceRef);
          if (startIndex < 0) {
            return;
          }
          const nextOrder = reorderWithEdge({
            list: rowOrder,
            startIndex,
            indexOfTarget: currentIndex,
            closestEdgeOfTarget: extractClosestEdge(self.data),
            axis: "vertical",
          });
          const nextIndex = nextOrder.indexOf(data.sourceRef);
          if (nextIndex < 0 || nextIndex === startIndex) {
            return;
          }
          onMove(data.sourceRef, nextIndex);
        },
      }),
    );
  }, [currentIndex, disabled, onMove, row.ref, rowOrder]);

  return (
    <div
      ref={containerRef}
      className={`source-row${isDragging ? " is-dragging" : ""}`}
    >
      {closestEdge === "top" ? (
        <div className="source-row-drop-indicator source-row-drop-indicator-top" aria-hidden="true">
          <span />
        </div>
      ) : null}
      {closestEdge === "bottom" ? (
        <div
          className="source-row-drop-indicator source-row-drop-indicator-bottom"
          aria-hidden="true"
        >
          <span />
        </div>
      ) : null}
      <div className="source-row-shell">
        <button
          ref={dragHandleRef}
          type="button"
          className="source-drag-handle"
          disabled={disabled}
          aria-label={`Reorder ${row.entry.displayName}`}
          title={`Reorder ${row.entry.displayName}`}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        <div className="source-row-main">
          <div className="source-row-header">
            <button
              type="button"
              className="source-open-button"
              disabled={disabled}
              onClick={onOpen}
            >
              <strong>{row.entry.displayName}</strong>
            </button>
          </div>
          <div className="source-row-controls">
            <SourceRowBadge
              variant={row.entry.scope.isArchiveSelection ? "zip" : "folder"}
              title={combinedBadgeTitle}
            >
              {combinedBadgeLabel}
            </SourceRowBadge>
            <div className="source-row-action-buttons">
              <button
                type="button"
                className="info-button"
                disabled={disabled}
                onClick={onEdit}
                aria-label={`Edit ${row.entry.displayName}`}
                title="Edit source"
              >
                ✎
              </button>
              <button
                type="button"
                className="info-button"
                disabled={disabled}
                onClick={onDelete}
                aria-label={`Delete ${row.entry.displayName}`}
                title="Delete source"
              >
                ×
              </button>
              <button
                type="button"
                className="info-button"
                disabled={disabled}
                onClick={onInfo}
                aria-label={`Show info for ${row.entry.displayName}`}
                title="View source info"
              >
                i
              </button>
            </div>
          </div>
          <details className="source-details">
            <summary>Path and folder</summary>
            <dl className="source-details-grid">
              <DetailRow label="Subfolder" value={row.entry.subfolder} />
              <DetailRow label="Path" value={row.entry.scope.normalizedPath} />
            </dl>
          </details>
        </div>
      </div>
    </div>
  );
}

function SourceRowBadge({
  children,
  title,
  variant = "neutral",
}: {
  children: ReactNode;
  title?: string;
  variant?: "neutral" | "zip" | "folder";
}) {
  return (
    <span className={`source-row-badge source-row-badge-${variant}`} title={title}>
      {children}
    </span>
  );
}

function BlockedDocumentPanel({
  groups,
  onReload,
}: {
  groups: BlockedIssueGroup[];
  onReload: () => void;
}) {
  return (
    <article className="panel">
      <div className="validation-header">
        <div>
          <h2>Editor Unavailable</h2>
          <p>
            This editor cannot open the current source.json until the issues below are fixed.
            Edit source.json directly, then reload.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={onReload}>
          Reload source.json
        </button>
      </div>
      <div className="error-box">
        {groups.map((group) => (
          <div key={group.family}>
            <h3>{group.heading}</h3>
            <ul className="issue-list">
              {group.issues.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}

function Modal({
  title,
  children,
  onClose,
  showHeaderClose = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  showHeaderClose?: boolean;
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
          {showHeaderClose ? (
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          ) : null}
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

function formatDraftStatusSummary({
  dirty,
  dirtyEntryCount,
  baselineEntryCount,
  draftEntryCount,
}: {
  dirty: boolean;
  dirtyEntryCount: number;
  baselineEntryCount: number;
  draftEntryCount: number;
}) {
  if (!dirty) {
    return "No unsaved changes";
  }
  if (baselineEntryCount !== draftEntryCount || dirtyEntryCount <= 0) {
    return "Unsaved changes";
  }
  return `${dirtyEntryCount} unsaved change${dirtyEntryCount === 1 ? "" : "s"}`;
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

function isSourceRowDragData(
  data: Record<string | symbol, unknown>,
): data is SourceRowDragData {
  return data.type === "source-row" && typeof data.sourceRef === "string";
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
