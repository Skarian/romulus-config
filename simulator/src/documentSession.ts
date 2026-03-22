import { useEffect, useMemo, useReducer } from "react";

import {
  buildPreviewEntries,
  buildRepairableValidationSnapshot,
} from "./runtimeValidation";
import { prepareSourceDocumentSave } from "./sourceDocumentSave";
import type {
  EditableDocumentState,
  PreviewEntry,
  RenameRule,
  RepairableValidationIssue,
  RepairableValidationSnapshot,
  SessionSourceReference,
  SourceDocument,
  SourceEntryDocument,
  SourceDocumentSavePreparationResult,
  UnarchiveDocument,
} from "./types";

export type DocumentSessionState = {
  baselineDocument: SourceDocument | null;
  draftDocument: SourceDocument | null;
  sourceRefs: SessionSourceReference[];
  nextSourceRefId: number;
  undoStack: SourceDocument[];
  redoStack: SourceDocument[];
};

export type DocumentSessionAction =
  | {
      type: "load";
      document: SourceDocument | null;
    }
  | {
      type: "create-source";
      entry: SourceEntryDocument;
      index?: number;
    }
  | {
      type: "update-source-structure";
      ref: SessionSourceReference;
      entry: SourceEntryDocument;
    }
  | {
      type: "delete-source";
      ref: SessionSourceReference;
    }
  | {
      type: "move-source";
      ref: SessionSourceReference;
      targetIndex: number;
    }
  | {
      type: "commit-save";
      document: SourceDocument;
    }
  | {
      type: "update";
      apply: (current: SourceDocument) => SourceDocument;
    }
  | {
      type: "undo";
    }
  | {
      type: "redo";
    };

export type DocumentSessionApi = {
  selectors: {
    baselineDocument: SourceDocument | null;
    draftDocument: SourceDocument | null;
    entries: Array<{
      ref: SessionSourceReference;
      entry: PreviewEntry;
      baselineEntry: PreviewEntry | null;
      issues: RepairableValidationIssue[];
      dirty: boolean;
    }>;
    validation: RepairableValidationSnapshot | null;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    getSource(
      ref: SessionSourceReference | null,
    ):
      | {
          ref: SessionSourceReference;
          entry: PreviewEntry;
          baselineEntry: PreviewEntry | null;
          rawEntry: SourceEntryDocument;
          rawBaselineEntry: SourceEntryDocument | null;
          issues: RepairableValidationIssue[];
          dirty: boolean;
        }
      | null;
  };
  intents: {
    openSource(entryId: string): SessionSourceReference | null;
    createSource(entry: SourceEntryDocument, index?: number): void;
    updateSourceStructure(ref: SessionSourceReference, entry: SourceEntryDocument): void;
    deleteSource(ref: SessionSourceReference): void;
    moveSource(ref: SessionSourceReference, targetIndex: number): void;
    setSourceRenameRule(ref: SessionSourceReference, renameRule: RenameRule | null): void;
    setSourceIgnoreGlobs(ref: SessionSourceReference, ignoreGlobs: string[]): void;
    setSourceUnarchive(ref: SessionSourceReference, unarchive: UnarchiveDocument | null): void;
    resetSourcePolicies(ref: SessionSourceReference): void;
    prepareSavePreview(schemaPath: string): SourceDocumentSavePreparationResult | null;
    commitSave(document: SourceDocument): void;
    undo(): void;
    redo(): void;
  };
};

type DocumentSessionDispatch = (action: DocumentSessionAction) => void;

export function useDocumentSession(
  editableState: EditableDocumentState | null,
): DocumentSessionApi | null {
  const [state, dispatch] = useReducer(
    documentSessionReducer,
    undefined,
    createEmptyDocumentSessionState,
  );

  useEffect(() => {
    dispatch({
      type: "load",
      document: editableState?.sourceDocument ?? null,
    });
  }, [editableState?.sourceDocument]);

  return useMemo(() => createDocumentSessionApi(state, dispatch), [state]);
}

export function createEmptyDocumentSessionState(): DocumentSessionState {
  return {
    baselineDocument: null,
    draftDocument: null,
    sourceRefs: [],
    nextSourceRefId: 1,
    undoStack: [],
    redoStack: [],
  };
}

export function createDocumentSessionApi(
  state: DocumentSessionState,
  dispatch: DocumentSessionDispatch,
): DocumentSessionApi | null {
  const draftDocument = state.draftDocument;
  if (!draftDocument) {
    return null;
  }

  const draftEntries = buildPreviewEntries(draftDocument);
  const baselineEntries = state.baselineDocument
    ? buildPreviewEntries(state.baselineDocument)
    : [];
  const validation = buildRepairableValidationSnapshot(draftDocument, draftEntries);
  const entries = draftEntries.map((entry, index) => {
    const ref = state.sourceRefs[index] ?? `source-${index + 1}`;
    const rawEntry = state.draftDocument?.entries[index] ?? null;
    const rawBaselineEntry = state.baselineDocument?.entries[index] ?? null;
    return {
      ref,
      entry,
      baselineEntry: baselineEntries[index] ?? null,
      issues: validation.issuesBySourceId[entry.id] ?? [],
      dirty: !sameEntryJson(rawEntry, rawBaselineEntry),
    };
  });
  const dirty = !sameDocumentJson(state.baselineDocument, draftDocument);

  return {
    selectors: {
      baselineDocument: state.baselineDocument,
      draftDocument,
      entries,
      validation,
      dirty,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
      getSource(ref) {
        if (!ref) {
          return null;
        }
        const index = state.sourceRefs.indexOf(ref);
        if (index < 0) {
          return null;
        }
        const entry = draftEntries[index];
        if (!entry) {
          return null;
        }
        return {
          ref,
          entry,
          baselineEntry: baselineEntries[index] ?? null,
          rawEntry: draftDocument.entries[index] as SourceEntryDocument,
          rawBaselineEntry:
            (state.baselineDocument?.entries[index] as SourceEntryDocument | undefined) ??
            null,
          issues: validation.issuesBySourceId[entry.id] ?? [],
          dirty: !sameEntryJson(
            draftDocument.entries[index] as SourceEntryDocument | undefined,
            (state.baselineDocument?.entries[index] as SourceEntryDocument | undefined) ?? null,
          ),
        };
      },
    },
    intents: {
      openSource(entryId) {
        const index = draftEntries.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
          return null;
        }
        return state.sourceRefs[index] ?? null;
      },
      createSource(entry, index) {
        dispatch({
          type: "create-source",
          entry: cloneEntryValue(entry),
          index,
        });
      },
      updateSourceStructure(ref, entry) {
        dispatch({
          type: "update-source-structure",
          ref,
          entry: cloneEntryValue(entry),
        });
      },
      deleteSource(ref) {
        dispatch({
          type: "delete-source",
          ref,
        });
      },
      moveSource(ref, targetIndex) {
        dispatch({
          type: "move-source",
          ref,
          targetIndex,
        });
      },
      setSourceRenameRule(ref, renameRule) {
        dispatch({
          type: "update",
          apply(current) {
            return replaceSourceEntry(current, ref, state.sourceRefs, (entry) => {
              if (!renameRule) {
                const { rename: _rename, ...rest } = entry;
                return rest;
              }
              return {
                ...entry,
                rename: {
                  pattern: renameRule.pattern,
                  replacement: renameRule.replacement,
                },
              };
            });
          },
        });
      },
      setSourceIgnoreGlobs(ref, ignoreGlobs) {
        dispatch({
          type: "update",
          apply(current) {
            return replaceSourceEntry(current, ref, state.sourceRefs, (entry) => {
              const nextIgnoreGlobs = [...ignoreGlobs];
              if (nextIgnoreGlobs.length === 0) {
                const { ignore: _ignore, ...rest } = entry;
                return rest;
              }
              return {
                ...entry,
                ignore: {
                  glob: nextIgnoreGlobs,
                },
              };
            });
          },
        });
      },
      setSourceUnarchive(ref, unarchive) {
        dispatch({
          type: "update",
          apply(current) {
            return replaceSourceEntry(current, ref, state.sourceRefs, (entry) => {
              if (!unarchive) {
                const { unarchive: _unarchive, ...rest } = entry;
                return rest;
              }
              return {
                ...entry,
                unarchive: cloneEntryValue(unarchive),
              };
            });
          },
        });
      },
      resetSourcePolicies(ref) {
        dispatch({
          type: "update",
          apply(current) {
            const index = state.sourceRefs.indexOf(ref);
            if (index < 0) {
              return current;
            }
            const baselineEntry = state.baselineDocument?.entries[index];
            if (!baselineEntry) {
              return current;
            }
            return replaceSourceEntry(
              current,
              ref,
              state.sourceRefs,
              (entry) => ({
                ...entry,
                ...(baselineEntry.ignore ? { ignore: cloneEntryValue(baselineEntry.ignore) } : {}),
                ...(baselineEntry.rename ? { rename: cloneEntryValue(baselineEntry.rename) } : {}),
                ...(baselineEntry.unarchive
                  ? { unarchive: cloneEntryValue(baselineEntry.unarchive) }
                  : {}),
              }),
              {
                clearIgnore: !baselineEntry.ignore,
                clearRename: !baselineEntry.rename,
                clearUnarchive: !baselineEntry.unarchive,
              },
            );
          },
        });
      },
      prepareSavePreview(_schemaPath) {
        return prepareSourceDocumentSave(draftDocument);
      },
      commitSave(document) {
        dispatch({
          type: "commit-save",
          document,
        });
      },
      undo() {
        dispatch({ type: "undo" });
      },
      redo() {
        dispatch({ type: "redo" });
      },
    },
  };
}

export function documentSessionReducer(
  state: DocumentSessionState,
  action: DocumentSessionAction,
): DocumentSessionState {
  if (action.type === "load") {
    const document = action.document ? cloneDocument(action.document) : null;
    return {
      baselineDocument: document,
      draftDocument: document ? cloneDocument(document) : null,
      sourceRefs: document ? createSourceRefs(document.entries.length) : [],
      nextSourceRefId: document ? document.entries.length + 1 : 1,
      undoStack: [],
      redoStack: [],
    };
  }

  if (action.type === "undo") {
    if (!state.draftDocument || state.undoStack.length === 0) {
      return state;
    }
    const nextDraftDocument = state.undoStack[state.undoStack.length - 1];
    const nextUndoStack = state.undoStack.slice(0, -1);
    return {
      ...state,
      draftDocument: cloneDocument(nextDraftDocument),
      sourceRefs: syncSourceRefs(state.sourceRefs, nextDraftDocument.entries.length),
      undoStack: nextUndoStack,
      redoStack: state.draftDocument
        ? [...state.redoStack, cloneDocument(state.draftDocument)]
        : state.redoStack,
    };
  }

  if (action.type === "redo") {
    if (!state.draftDocument || state.redoStack.length === 0) {
      return state;
    }
    const nextDraftDocument = state.redoStack[state.redoStack.length - 1];
    const nextRedoStack = state.redoStack.slice(0, -1);
    return {
      ...state,
      draftDocument: cloneDocument(nextDraftDocument),
      sourceRefs: syncSourceRefs(state.sourceRefs, nextDraftDocument.entries.length),
      undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
      redoStack: nextRedoStack,
    };
  }

  if (action.type === "commit-save") {
    const document = cloneDocument(action.document);
    return {
      ...state,
      baselineDocument: document,
      draftDocument: cloneDocument(document),
      sourceRefs: syncSourceRefs(state.sourceRefs, document.entries.length, state.nextSourceRefId),
      nextSourceRefId:
        document.entries.length > state.sourceRefs.length
          ? state.nextSourceRefId + (document.entries.length - state.sourceRefs.length)
          : state.nextSourceRefId,
    };
  }

  if (action.type === "create-source") {
    if (!state.draftDocument) {
      return state;
    }
    const insertIndex = clampIndex(action.index ?? state.draftDocument.entries.length, state.draftDocument.entries.length);
    const nextDraftDocument = {
      ...cloneDocument(state.draftDocument),
      entries: insertAtIndex(
        state.draftDocument.entries.map((entry) => cloneEntryValue(entry)),
        insertIndex,
        cloneEntryValue(action.entry),
      ),
    };
    const nextSourceRef = `source-${state.nextSourceRefId}`;
    return {
      ...state,
      draftDocument: nextDraftDocument,
      sourceRefs: insertAtIndex(state.sourceRefs, insertIndex, nextSourceRef),
      nextSourceRefId: state.nextSourceRefId + 1,
      undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
      redoStack: [],
    };
  }

  if (action.type === "update-source-structure") {
    if (!state.draftDocument) {
      return state;
    }
    const index = state.sourceRefs.indexOf(action.ref);
    if (index < 0) {
      return state;
    }
    const nextDraftDocument = {
      ...cloneDocument(state.draftDocument),
      entries: state.draftDocument.entries.map((entry, entryIndex) =>
        entryIndex === index ? cloneEntryValue(action.entry) : cloneEntryValue(entry),
      ),
    };
    if (sameDocumentJson(state.draftDocument, nextDraftDocument)) {
      return state;
    }
    return {
      ...state,
      draftDocument: nextDraftDocument,
      undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
      redoStack: [],
    };
  }

  if (action.type === "delete-source") {
    if (!state.draftDocument) {
      return state;
    }
    const index = state.sourceRefs.indexOf(action.ref);
    if (index < 0) {
      return state;
    }
    const nextDraftDocument = {
      ...cloneDocument(state.draftDocument),
      entries: state.draftDocument.entries
        .filter((_entry, entryIndex) => entryIndex !== index)
        .map((entry) => cloneEntryValue(entry)),
    };
    return {
      ...state,
      draftDocument: nextDraftDocument,
      sourceRefs: state.sourceRefs.filter((ref) => ref !== action.ref),
      undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
      redoStack: [],
    };
  }

  if (action.type === "move-source") {
    if (!state.draftDocument) {
      return state;
    }
    const index = state.sourceRefs.indexOf(action.ref);
    if (index < 0) {
      return state;
    }
    const targetIndex = clampIndex(action.targetIndex, state.draftDocument.entries.length - 1);
    if (index === targetIndex) {
      return state;
    }
    const nextDraftDocument = {
      ...cloneDocument(state.draftDocument),
      entries: moveArrayItem(
        state.draftDocument.entries.map((entry) => cloneEntryValue(entry)),
        index,
        targetIndex,
      ),
    };
    return {
      ...state,
      draftDocument: nextDraftDocument,
      sourceRefs: moveArrayItem(state.sourceRefs, index, targetIndex),
      undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
      redoStack: [],
    };
  }

  if (!state.draftDocument) {
    return state;
  }

  const nextDraftDocument = action.apply(cloneDocument(state.draftDocument));
  if (sameDocumentJson(state.draftDocument, nextDraftDocument)) {
    return state;
  }

  return {
    ...state,
    draftDocument: nextDraftDocument,
    sourceRefs: syncSourceRefs(state.sourceRefs, nextDraftDocument.entries.length, state.nextSourceRefId),
    nextSourceRefId:
      nextDraftDocument.entries.length > state.sourceRefs.length
        ? state.nextSourceRefId + (nextDraftDocument.entries.length - state.sourceRefs.length)
        : state.nextSourceRefId,
    undoStack: [...state.undoStack, cloneDocument(state.draftDocument)],
    redoStack: [],
  };
}

function replaceSourceEntry(
  document: SourceDocument,
  ref: SessionSourceReference,
  sourceRefs: SessionSourceReference[],
  apply: (entry: SourceEntryDocument) => SourceEntryDocument,
  options?: {
    clearIgnore?: boolean;
    clearRename?: boolean;
    clearUnarchive?: boolean;
  },
) {
  const index = sourceRefs.indexOf(ref);
  if (index < 0) {
    return document;
  }

  return {
    ...document,
    entries: document.entries.map((entry, entryIndex) => {
      if (entryIndex !== index) {
        return entry;
      }
      const nextEntry = apply(entry as SourceEntryDocument);
      if (!options?.clearIgnore && !options?.clearRename && !options?.clearUnarchive) {
        return nextEntry;
      }
      const finalizedEntry = { ...nextEntry };
      if (options.clearIgnore) {
        delete finalizedEntry.ignore;
      }
      if (options.clearRename) {
        delete finalizedEntry.rename;
      }
      if (options.clearUnarchive) {
        delete finalizedEntry.unarchive;
      }
      return finalizedEntry;
    }),
  };
}

function createSourceRefs(count: number) {
  return Array.from({ length: count }, (_value, index) => `source-${index + 1}`);
}

function syncSourceRefs(
  sourceRefs: SessionSourceReference[],
  nextCount: number,
  nextSourceRefId?: number,
) {
  if (sourceRefs.length === nextCount) {
    return sourceRefs;
  }
  if (sourceRefs.length > nextCount) {
    return sourceRefs.slice(0, nextCount);
  }
  const startId = nextSourceRefId ?? sourceRefs.length + 1;
  return [
    ...sourceRefs,
    ...Array.from(
      { length: nextCount - sourceRefs.length },
      (_value, index) => `source-${startId + index}`,
    ),
  ];
}

function cloneDocument(document: SourceDocument) {
  return JSON.parse(JSON.stringify(document)) as SourceDocument;
}

function cloneEntryValue<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameDocumentJson(
  left: SourceDocument | null | undefined,
  right: SourceDocument | null | undefined,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameEntryJson(
  left: SourceEntryDocument | null | undefined,
  right: SourceEntryDocument | null | undefined,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function clampIndex(index: number, maxIndex: number) {
  return Math.max(0, Math.min(index, maxIndex));
}

function insertAtIndex<T>(items: T[], index: number, value: T) {
  return [...items.slice(0, index), value, ...items.slice(index)];
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [moved] = nextItems.splice(fromIndex, 1);
  if (typeof moved === "undefined") {
    return items;
  }
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
}
