import { useEffect, useMemo, useRef, useState } from "react";

import { archiveBaseName } from "./archiveSupport";
import { applyRenameRule, buildDownloadPreview } from "./downloadPreview";
import type { DocumentSessionApi } from "./documentSession";
import { compileIgnoreMatcher, isValidIgnoreRule } from "./ignoreRules";
import {
  analyzeParentheticalSuffixes,
  buildManagedRenameRule,
  detectManagedRenamePolicy,
} from "./policyAnalysis";
import { buildPhraseOptions } from "./sourcePolicyEditor";
import type {
  RenameRule,
  SessionSourceReference,
  SourceFilesState,
  SourceFileRow,
  UnarchiveDocument,
  UnarchiveLayoutMode,
} from "./types";

export type SourceEditorRenameMode = "none" | "all" | "phrases" | "custom";

export type SourceEditorFileStats = {
  files: number;
  totalSizeBytes: number;
  withParenthesesCount: number;
  multiParenthesesCount: number;
};

const EMPTY_RENAME_RULE: RenameRule = {
  pattern: "",
  replacement: "",
};

export function useSourceEditorController({
  documentSession,
  sourceRef,
  sourceFiles,
}: {
  documentSession: DocumentSessionApi | null;
  sourceRef: SessionSourceReference | null;
  sourceFiles: SourceFilesState | null;
}) {
  const source = documentSession?.selectors.getSource(sourceRef) ?? null;
  const sourceReady = sourceFiles?.sourceStatus === "ready";
  const [fileSearchText, setFileSearchText] = useState("");
  const [activeRenameMode, setActiveRenameMode] = useState<SourceEditorRenameMode>("none");
  const [selectedRenamePhrases, setSelectedRenamePhrases] = useState<string[]>([]);
  const [customRenameRule, setCustomRenameRule] = useState<RenameRule>(EMPTY_RENAME_RULE);
  const [preservedUnarchiveLayoutMode, setPreservedUnarchiveLayoutMode] =
    useState<UnarchiveLayoutMode>("flat");
  const [activeDedicatedRenameMode, setActiveDedicatedRenameMode] =
    useState<SourceEditorRenameMode>("none");
  const [selectedDedicatedRenamePhrases, setSelectedDedicatedRenamePhrases] = useState<string[]>(
    [],
  );
  const [customDedicatedRenameRule, setCustomDedicatedRenameRule] = useState<RenameRule>(
    EMPTY_RENAME_RULE,
  );
  const [preservedDedicatedRenameRule, setPreservedDedicatedRenameRule] =
    useState<RenameRule | null>(null);
  const previousSourceRef = useRef<SessionSourceReference | null>(null);

  const cacheFiles = useMemo(
    () => (sourceReady ? sourceFiles.analysisFiles ?? sourceFiles.files : []),
    [sourceFiles, sourceReady],
  );
  const currentIgnoreGlobs = source?.rawEntry.ignore?.glob ?? [""];
  const normalizedIgnoreGlobs = useMemo(
    () => normalizeSourcePolicyGlobs(currentIgnoreGlobs),
    [currentIgnoreGlobs],
  );
  const nonEmptyIgnoreGlobs = useMemo(
    () => normalizedIgnoreGlobs.filter((glob) => glob.length > 0),
    [normalizedIgnoreGlobs],
  );
  const invalidIgnoreGlobs = useMemo(
    () => nonEmptyIgnoreGlobs.filter((glob) => !isValidIgnoreRule(glob)),
    [nonEmptyIgnoreGlobs],
  );
  const effectiveIgnoreGlobs = useMemo(
    () => nonEmptyIgnoreGlobs.filter((glob) => isValidIgnoreRule(glob)),
    [nonEmptyIgnoreGlobs],
  );
  const draftVisibleFiles = useMemo(
    () => filterSourceFilesByIgnoreGlobs(cacheFiles, effectiveIgnoreGlobs),
    [cacheFiles, effectiveIgnoreGlobs],
  );
  const effectiveSourceFiles = useMemo(() => {
    if (!sourceReady || !sourceFiles) {
      return sourceFiles;
    }
    return {
      ...sourceFiles,
      files: draftVisibleFiles,
    };
  }, [draftVisibleFiles, sourceFiles, sourceReady]);
  const visibleSourceFiles = useMemo(
    () =>
      effectiveSourceFiles
        ? {
            ...effectiveSourceFiles,
            files: filterSourceFilesBySearch(effectiveSourceFiles.files, fileSearchText),
          }
        : effectiveSourceFiles,
    [effectiveSourceFiles, fileSearchText],
  );
  const selectedRowIds = effectiveSourceFiles?.selectedRowIds ?? [];
  const selectedActualRows = useMemo(() => {
    const visibleFiles = effectiveSourceFiles?.files ?? [];
    const selectedSet = new Set(selectedRowIds);
    return visibleFiles.filter((file) => selectedSet.has(file.id));
  }, [effectiveSourceFiles?.files, selectedRowIds]);

  const draftFileNames = useMemo(
    () => draftVisibleFiles.map((file) => file.originalName),
    [draftVisibleFiles],
  );
  const analysis = useMemo(
    () => analyzeParentheticalSuffixes(draftFileNames),
    [draftFileNames],
  );
  const availablePhrases = useMemo(
    () => analysis.parentheticalPhrases.map((phrase) => phrase.phrase),
    [analysis.parentheticalPhrases],
  );
  const currentRenamePolicy = useMemo(
    () => detectManagedRenamePolicy(source?.entry.renameRule ?? null, availablePhrases),
    [availablePhrases, source?.entry.renameRule],
  );
  const renameMode = activeRenameMode;
  const renamePhrases =
    renameMode === "phrases"
      ? selectedRenamePhrases.filter((phrase) => availablePhrases.includes(phrase))
      : selectedRenamePhrases.filter((phrase) => availablePhrases.includes(phrase));
  const phraseOptions = useMemo(
    () => buildPhraseOptions(analysis.parentheticalPhrases, renamePhrases),
    [analysis.parentheticalPhrases, renamePhrases],
  );

  const archiveCandidateBaseNames = useMemo(
    () =>
      draftVisibleFiles
        .filter((file) => file.isArchiveCandidate)
        .map((file) => archiveBaseName(file.originalName)),
    [draftVisibleFiles],
  );
  const dedicatedRenameAnalysis = useMemo(
    () => analyzeParentheticalSuffixes(archiveCandidateBaseNames),
    [archiveCandidateBaseNames],
  );
  const dedicatedAvailablePhrases = useMemo(
    () => dedicatedRenameAnalysis.parentheticalPhrases.map((phrase) => phrase.phrase),
    [dedicatedRenameAnalysis.parentheticalPhrases],
  );
  const currentDedicatedRenameRule =
    source?.rawEntry.unarchive?.layout.mode === "dedicatedFolder"
      ? source.rawEntry.unarchive.layout.rename ?? null
      : null;
  const currentDedicatedRenamePolicy = useMemo(
    () => detectManagedRenamePolicy(currentDedicatedRenameRule, dedicatedAvailablePhrases),
    [currentDedicatedRenameRule, dedicatedAvailablePhrases],
  );
  const dedicatedRenameMode = activeDedicatedRenameMode;
  const dedicatedRenamePhrases =
    dedicatedRenameMode === "phrases"
      ? selectedDedicatedRenamePhrases.filter((phrase) =>
          dedicatedAvailablePhrases.includes(phrase),
        )
      : selectedDedicatedRenamePhrases.filter((phrase) =>
          dedicatedAvailablePhrases.includes(phrase),
        );
  const dedicatedPhraseOptions = useMemo(
    () => buildPhraseOptions(dedicatedRenameAnalysis.parentheticalPhrases, dedicatedRenamePhrases),
    [dedicatedRenameAnalysis.parentheticalPhrases, dedicatedRenamePhrases],
  );

  useEffect(() => {
    if (previousSourceRef.current === sourceRef) {
      return;
    }
    previousSourceRef.current = sourceRef;
    setFileSearchText("");
    setActiveRenameMode(currentRenamePolicy.mode);
    setSelectedRenamePhrases(currentRenamePolicy.mode === "phrases" ? currentRenamePolicy.phrases : []);
    setCustomRenameRule(source?.rawEntry.rename ?? EMPTY_RENAME_RULE);
    setPreservedUnarchiveLayoutMode(source?.rawEntry.unarchive?.layout.mode ?? "flat");
    setActiveDedicatedRenameMode(currentDedicatedRenamePolicy.mode);
    setSelectedDedicatedRenamePhrases(
      currentDedicatedRenamePolicy.mode === "phrases"
        ? currentDedicatedRenamePolicy.phrases
        : [],
    );
    setCustomDedicatedRenameRule(currentDedicatedRenameRule ?? EMPTY_RENAME_RULE);
    setPreservedDedicatedRenameRule(currentDedicatedRenameRule);
  }, [
    currentDedicatedRenamePolicy.mode,
    currentDedicatedRenamePolicy.phrases,
    currentDedicatedRenameRule,
    currentRenamePolicy.mode,
    currentRenamePolicy.phrases,
    source?.rawEntry.rename,
    source?.rawEntry.unarchive?.layout.mode,
    sourceRef,
  ]);

  useEffect(() => {
    if (
      shouldPreserveEmptySelectedPhraseMode(
        activeRenameMode,
        currentRenamePolicy.mode,
        selectedRenamePhrases,
      )
    ) {
      return;
    }
    setActiveRenameMode(currentRenamePolicy.mode);
  }, [activeRenameMode, currentRenamePolicy.mode, selectedRenamePhrases]);

  useEffect(() => {
    if (currentRenamePolicy.mode === "phrases") {
      setSelectedRenamePhrases(currentRenamePolicy.phrases);
      return;
    }
    if (currentRenamePolicy.mode === "custom" && source?.rawEntry.rename) {
      setCustomRenameRule(source.rawEntry.rename);
    }
  }, [currentRenamePolicy.mode, currentRenamePolicy.phrases, source?.rawEntry.rename]);

  useEffect(() => {
    if (
      shouldPreserveEmptySelectedPhraseMode(
        activeDedicatedRenameMode,
        currentDedicatedRenamePolicy.mode,
        selectedDedicatedRenamePhrases,
      )
    ) {
      return;
    }
    setActiveDedicatedRenameMode(currentDedicatedRenamePolicy.mode);
  }, [
    activeDedicatedRenameMode,
    currentDedicatedRenamePolicy.mode,
    selectedDedicatedRenamePhrases,
  ]);

  useEffect(() => {
    if (currentDedicatedRenamePolicy.mode === "phrases") {
      setSelectedDedicatedRenamePhrases(currentDedicatedRenamePolicy.phrases);
      return;
    }
    if (currentDedicatedRenamePolicy.mode === "custom" && currentDedicatedRenameRule) {
      setCustomDedicatedRenameRule(currentDedicatedRenameRule);
    }
    if (currentDedicatedRenameRule) {
      setPreservedDedicatedRenameRule(currentDedicatedRenameRule);
    }
  }, [
    currentDedicatedRenamePolicy.mode,
    currentDedicatedRenamePolicy.phrases,
    currentDedicatedRenameRule,
  ]);

  const downloadPreview = useMemo(
    () =>
      source?.entry
        ? buildDownloadPreview(source.entry, effectiveSourceFiles, selectedActualRows)
        : {
            tree: {
              name: "/",
              pathKey: "",
              kind: "folder" as const,
              children: [],
            },
            archiveFixtures: [],
          },
    [effectiveSourceFiles, selectedActualRows, source?.entry],
  );
  const draftIgnoreCount = useMemo(() => {
    if (!sourceReady || invalidIgnoreGlobs.length > 0) {
      return null;
    }
    const matchesIgnore = compileIgnoreMatcher(effectiveIgnoreGlobs);
    return cacheFiles.filter((file) => matchesIgnore(file.originalName)).length;
  }, [cacheFiles, effectiveIgnoreGlobs, invalidIgnoreGlobs.length, sourceReady]);
  const draftRenameChangedCount = useMemo(() => {
    if (!sourceReady || !source?.entry || invalidIgnoreGlobs.length > 0) {
      return null;
    }
    return draftVisibleFiles.filter(
      (file) => applyRenameRule(source.entry.renameRule, file.originalName) !== file.originalName,
    ).length;
  }, [draftVisibleFiles, invalidIgnoreGlobs.length, source?.entry, sourceReady]);
  const renameWarnings = useMemo(() => {
    const nextWarnings = [...analysis.warnings];
    if (currentRenamePolicy.isCustom) {
      nextWarnings.unshift(
        "This source currently uses a custom rename regex from source.json. Managed rename modes will replace it in the shared draft.",
      );
    }
    return nextWarnings;
  }, [analysis.warnings, currentRenamePolicy.isCustom]);
  const dedicatedRenameWarnings = useMemo(() => {
    const nextWarnings = [...dedicatedRenameAnalysis.warnings];
    if (currentDedicatedRenamePolicy.isCustom) {
      nextWarnings.unshift(
        "This source currently uses a custom dedicated-folder rename regex from source.json. Managed rename modes will replace it in the shared draft.",
      );
    }
    return nextWarnings;
  }, [currentDedicatedRenamePolicy.isCustom, dedicatedRenameAnalysis.warnings]);

  const fileCacheStats = useMemo(
    () => buildSourceFileStats(cacheFiles),
    [cacheFiles],
  );
  const draftStats = useMemo(
    () => buildSourceFileStats(draftVisibleFiles),
    [draftVisibleFiles],
  );
  const excludedByScopeCount = sourceFiles?.scopedOutFileCount ?? 0;
  const renameIssue =
    source?.issues.find((issue) => issue.fieldPath === "rename")?.message ?? null;
  const dedicatedRenameIssue =
    source?.issues.find((issue) => issue.fieldPath === "unarchive.layout.rename")?.message ??
    null;
  const unarchiveEnabled = Boolean(source?.rawEntry.unarchive);
  const unarchiveLayoutMode =
    source?.rawEntry.unarchive?.layout.mode ?? preservedUnarchiveLayoutMode;
  const unarchiveRelevant = draftVisibleFiles.some((file) => file.isArchiveCandidate);
  const sourceInfo = source
    ? {
        displayName: source.entry.displayName,
        subfolder: source.entry.subfolder,
        scopePath: source.entry.scope.normalizedPath,
        mode: source.entry.scope.isArchiveSelection ? "archive" : "standard",
      }
    : null;

  function setRenameRule(nextRule: RenameRule | null) {
    if (!documentSession || !sourceRef) {
      return;
    }
    documentSession.intents.setSourceRenameRule(sourceRef, nextRule);
  }

  function updateRenameDraft(
    nextMode: SourceEditorRenameMode,
    nextPhrases: string[] = renamePhrases,
  ) {
    setActiveRenameMode(nextMode);
    if (nextMode === "phrases") {
      const normalizedPhrases = normalizeSelectedPhrases(nextPhrases, availablePhrases);
      setSelectedRenamePhrases(normalizedPhrases);
      setRenameRule(
        buildManagedRenameRule("phrases", normalizedPhrases, availablePhrases),
      );
      return;
    }
    if (nextMode === "all") {
      setRenameRule(buildManagedRenameRule("all", availablePhrases, availablePhrases));
      return;
    }
    if (nextMode === "custom") {
      setRenameRule(customRenameRule);
      return;
    }
    setRenameRule(null);
  }

  function updateCustomRenameRule(nextRule: RenameRule) {
    setCustomRenameRule(nextRule);
    if (renameMode === "custom") {
      setRenameRule(nextRule);
    }
  }

  function updateIgnoreGlobs(nextIgnoreGlobs: string[]) {
    if (!documentSession || !sourceRef) {
      return;
    }
    documentSession.intents.setSourceIgnoreGlobs(
      sourceRef,
      nextIgnoreGlobs.length > 0 ? nextIgnoreGlobs : [""],
    );
  }

  function setSourceUnarchive(nextUnarchive: UnarchiveDocument | null) {
    if (!documentSession || !sourceRef) {
      return;
    }
    documentSession.intents.setSourceUnarchive(sourceRef, nextUnarchive);
  }

  function setUnarchiveEnabled(nextEnabled: boolean) {
    if (!nextEnabled) {
      if (source?.rawEntry.unarchive?.layout.mode === "dedicatedFolder") {
        setPreservedDedicatedRenameRule(source.rawEntry.unarchive.layout.rename ?? null);
      }
      setSourceUnarchive(null);
      return;
    }
    setSourceUnarchive(
      buildUnarchiveDocument(
        preservedUnarchiveLayoutMode,
        preservedUnarchiveLayoutMode === "dedicatedFolder"
          ? preservedDedicatedRenameRule
          : null,
      ),
    );
  }

  function setUnarchiveLayoutMode(nextLayoutMode: UnarchiveLayoutMode) {
    setPreservedUnarchiveLayoutMode(nextLayoutMode);
    if (source?.rawEntry.unarchive?.layout.mode === "dedicatedFolder") {
      setPreservedDedicatedRenameRule(source.rawEntry.unarchive.layout.rename ?? null);
    }
    setSourceUnarchive(
      buildUnarchiveDocument(
        nextLayoutMode,
        nextLayoutMode === "dedicatedFolder" ? preservedDedicatedRenameRule : null,
      ),
    );
  }

  function updateDedicatedRenameDraft(
    nextMode: SourceEditorRenameMode,
    nextPhrases: string[] = dedicatedRenamePhrases,
  ) {
    if (!unarchiveEnabled || unarchiveLayoutMode !== "dedicatedFolder") {
      return;
    }
    setActiveDedicatedRenameMode(nextMode);

    let nextRule: RenameRule | null;
    if (nextMode === "phrases") {
      const normalizedPhrases = normalizeSelectedPhrases(
        nextPhrases,
        dedicatedAvailablePhrases,
      );
      setSelectedDedicatedRenamePhrases(normalizedPhrases);
      nextRule = buildManagedRenameRule(
        "phrases",
        normalizedPhrases,
        dedicatedAvailablePhrases,
      );
    } else if (nextMode === "all") {
      nextRule = buildManagedRenameRule(
        "all",
        dedicatedAvailablePhrases,
        dedicatedAvailablePhrases,
      );
    } else if (nextMode === "custom") {
      nextRule = customDedicatedRenameRule;
    } else {
      nextRule = null;
    }

    setPreservedDedicatedRenameRule(nextRule);
    setSourceUnarchive(buildUnarchiveDocument("dedicatedFolder", nextRule));
  }

  function updateCustomDedicatedRenameRule(nextRule: RenameRule) {
    setCustomDedicatedRenameRule(nextRule);
    setPreservedDedicatedRenameRule(nextRule);
    if (unarchiveEnabled && unarchiveLayoutMode === "dedicatedFolder" && dedicatedRenameMode === "custom") {
      setSourceUnarchive(buildUnarchiveDocument("dedicatedFolder", nextRule));
    }
  }

  return {
    source,
    sourceInfo,
    sourceReady,
    sourceRef,
    analysis,
    fileCacheStats,
    draftStats,
    excludedByScopeCount,
    availablePhrases,
    renameMode,
    renamePhrases,
    renameIssue,
    customRenameRule,
    phraseOptions,
    currentIgnoreGlobs,
    invalidIgnoreGlobs,
    effectiveSourceFiles,
    visibleSourceFiles,
    fileSearchText,
    showFileSearch:
      (effectiveSourceFiles?.files.length ?? 0) > 0 || fileSearchText.trim().length > 0,
    downloadPreview,
    draftIgnoreCount,
    draftRenameChangedCount,
    renameWarnings,
    dedicatedRenameAnalysis,
    dedicatedAvailablePhrases,
    dedicatedRenameMode,
    dedicatedRenamePhrases,
    dedicatedRenameIssue,
    customDedicatedRenameRule,
    dedicatedPhraseOptions,
    dedicatedRenameWarnings,
    unarchiveEnabled,
    unarchiveLayoutMode,
    unarchiveRelevant,
    selectedRowIds,
    selectedActualRows,
    setFileSearchText,
    updateRenameDraft,
    updateCustomRenameRule,
    updateIgnoreGlobs,
    setUnarchiveEnabled,
    setUnarchiveLayoutMode,
    updateDedicatedRenameDraft,
    updateCustomDedicatedRenameRule,
    selectAllPhrases() {
      updateRenameDraft(
        "phrases",
        phraseOptions
          .filter((phrase) => phrase.observed)
          .map((phrase) => phrase.phrase),
      );
    },
    clearPhrases() {
      updateRenameDraft("phrases", []);
    },
    selectAllDedicatedPhrases() {
      updateDedicatedRenameDraft(
        "phrases",
        dedicatedPhraseOptions
          .filter((phrase) => phrase.observed)
          .map((phrase) => phrase.phrase),
      );
    },
    clearDedicatedPhrases() {
      updateDedicatedRenameDraft("phrases", []);
    },
  };
}

export function buildSourceFileStats(sourceFiles: SourceFileRow[]): SourceEditorFileStats {
  const analysis = analyzeParentheticalSuffixes(sourceFiles.map((file) => file.originalName));
  return {
    files: sourceFiles.length,
    totalSizeBytes: sourceFiles.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    withParenthesesCount: analysis.withParenthesesCount,
    multiParenthesesCount: analysis.multiParenthesesCount,
  };
}

export function filterSourceFilesByIgnoreGlobs(
  sourceFiles: SourceFileRow[],
  ignoreGlobs: string[],
) {
  const matcher = compileIgnoreMatcher(ignoreGlobs);
  return sourceFiles.filter((file) => !matcher(file.originalName));
}

export function filterSourceFilesBySearch(
  sourceFiles: SourceFileRow[],
  searchText: string,
) {
  const normalizedSearchText = searchText.trim().toLowerCase();
  if (normalizedSearchText.length === 0) {
    return sourceFiles;
  }
  return sourceFiles.filter((file) =>
    file.originalName.toLowerCase().includes(normalizedSearchText),
  );
}

function normalizeSourcePolicyGlobs(values: string[]) {
  return values.map((value) => value.trim());
}

function normalizeSelectedPhrases(phrases: string[], availablePhrases: string[]) {
  return Array.from(
    new Set(phrases.filter((phrase) => availablePhrases.includes(phrase))),
  ).sort();
}

export function shouldPreserveEmptySelectedPhraseMode(
  activeMode: SourceEditorRenameMode,
  detectedMode: SourceEditorRenameMode,
  selectedPhrases: string[],
) {
  return activeMode === "phrases" && detectedMode === "none" && selectedPhrases.length === 0;
}

function buildUnarchiveDocument(
  layoutMode: UnarchiveLayoutMode,
  renameRule: RenameRule | null,
): UnarchiveDocument {
  return {
    layout:
      layoutMode === "dedicatedFolder"
        ? {
            mode: "dedicatedFolder",
            ...(renameRule ? { rename: renameRule } : {}),
          }
        : {
            mode: "flat",
          },
  };
}
