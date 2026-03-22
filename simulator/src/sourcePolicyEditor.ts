import { isValidIgnoreRule } from "./ignoreRules";
import type { ParentheticalPhraseStat } from "./policyAnalysis";
import type {
  HydrationSourceStatus,
  PreviewEntry,
  SourceFilesRequest,
  SourceFilesState,
} from "./types";

export type ManagedRenameDraftMode = "none" | "all" | "phrases";

export type ManagedRenameDraft = {
  mode: ManagedRenameDraftMode;
  phrases: string[];
};

export type SourcePolicyEditorState = {
  renameMode: ManagedRenameDraftMode;
  renamePhrases: string[];
  ignoreGlobs: string[];
};

export type PendingPolicySave = {
  entryId: string;
  rename: boolean;
  ignore: boolean;
};

export type PhraseOption = {
  phrase: string;
  count: number;
  observed: boolean;
};

export function buildSourceFilesRequest(
  entry: Pick<PreviewEntry, "id" | "hydrationKey" | "selectionStateKey" | "scope" | "ignoreGlobs">,
): SourceFilesRequest {
  return {
    hydrationKey: entry.hydrationKey,
    selectionStateKey: entry.selectionStateKey,
    legacyEntryId: entry.id,
    scope: entry.scope,
    ignoreGlobs: entry.ignoreGlobs.filter((glob) => isValidIgnoreRule(glob)),
  };
}

export function matchSourceFilesToEntry(
  entry: Pick<PreviewEntry, "hydrationKey" | "selectionStateKey"> | null,
  sourceFiles: SourceFilesState | null,
) {
  if (
    !entry ||
    !sourceFiles ||
    sourceFiles.hydrationKey !== entry.hydrationKey ||
    sourceFiles.selectionStateKey !== entry.selectionStateKey
  ) {
    return null;
  }

  return sourceFiles;
}

export function updateSourceFilesForEntry(
  sourceFiles: SourceFilesState | null,
  entry: Pick<PreviewEntry, "hydrationKey" | "selectionStateKey">,
  applyUpdate: (current: SourceFilesState) => SourceFilesState,
) {
  if (
    !sourceFiles ||
    sourceFiles.hydrationKey !== entry.hydrationKey ||
    sourceFiles.selectionStateKey !== entry.selectionStateKey
  ) {
    return sourceFiles;
  }

  return applyUpdate(sourceFiles);
}

export function beginEntryRequest(
  requestRevisions: Map<string, number>,
  entryId: string,
) {
  const nextRevision = (requestRevisions.get(entryId) ?? 0) + 1;
  requestRevisions.set(entryId, nextRevision);
  return nextRevision;
}

export function isLatestEntryRequest(
  requestRevisions: Map<string, number>,
  entryId: string,
  requestRevision: number,
) {
  return (requestRevisions.get(entryId) ?? 0) === requestRevision;
}

export function shouldForceSourceRefresh(
  isArchiveSelection: boolean,
  sourceStatus: HydrationSourceStatus | null | undefined,
) {
  return !(isArchiveSelection && sourceStatus === "preparing");
}

export function syncSourcePolicyEditorState(
  currentState: SourcePolicyEditorState,
  savedRenameDraft: ManagedRenameDraft,
  savedIgnoreGlobs: string[],
  pendingSave: PendingPolicySave | null,
  entryId: string,
): SourcePolicyEditorState {
  const matchingPendingSave = pendingSave?.entryId === entryId ? pendingSave : null;

  return {
    renameMode:
      matchingPendingSave && !matchingPendingSave.rename
        ? currentState.renameMode
        : savedRenameDraft.mode,
    renamePhrases:
      matchingPendingSave && !matchingPendingSave.rename
        ? currentState.renamePhrases
        : [...savedRenameDraft.phrases],
    ignoreGlobs:
      matchingPendingSave && !matchingPendingSave.ignore
        ? currentState.ignoreGlobs
        : savedIgnoreGlobs.length > 0
          ? [...savedIgnoreGlobs]
          : [""],
  };
}

export function toggleSourceFileSelection(
  selectedRowIds: string[],
  visibleRowIds: string[],
  toggledRowId: string,
) {
  const visibleRowIdSet = new Set(visibleRowIds);
  const nextSelectedVisibleRowIds = visibleRowIds.filter((rowId) =>
    selectedRowIds.includes(rowId),
  );
  const selectedVisibleRowIdSet = new Set(nextSelectedVisibleRowIds);

  if (selectedVisibleRowIdSet.has(toggledRowId)) {
    selectedVisibleRowIdSet.delete(toggledRowId);
  } else {
    selectedVisibleRowIdSet.add(toggledRowId);
  }

  const hiddenSelectedRowIds = selectedRowIds.filter((rowId) => !visibleRowIdSet.has(rowId));

  return [
    ...hiddenSelectedRowIds,
    ...visibleRowIds.filter((rowId) => selectedVisibleRowIdSet.has(rowId)),
  ];
}

export function buildPhraseOptions(
  observedPhrases: ParentheticalPhraseStat[],
  selectedPhrases: string[],
): PhraseOption[] {
  const observedPhraseCountMap = new Map(
    observedPhrases.map((phrase) => [phrase.phrase, phrase.count]),
  );
  return normalizeStrings([
    ...observedPhrases.map((phrase) => phrase.phrase),
    ...selectedPhrases,
  ])
    .map((phrase) => ({
      phrase,
      count: observedPhraseCountMap.get(phrase) ?? 0,
      observed: observedPhraseCountMap.has(phrase),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (left.observed !== right.observed) {
        return left.observed ? -1 : 1;
      }
      return left.phrase.localeCompare(right.phrase);
    });
}

function normalizeStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}
