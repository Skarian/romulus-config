import { useEffect, useMemo, useState } from "react";

import type { DocumentSessionApi } from "./documentSession";
import { getHydrationStateForEntry } from "./hydrationStateLookup";
import {
  buildSourceEntryFromStructureDraft,
  createBlankSourceStructureDraft,
  createSourceStructureDraftFromEntry,
  type SourceStructureDraft,
  validateSourceStructureDraft,
} from "./sourceStructureEditor";
import type { HydrationSourceState, SessionSourceReference } from "./types";

type OpenSourceResult =
  | {
      status: "opened";
      sourceRef: SessionSourceReference;
    }
  | {
      status: "missing-cache";
    }
  | {
      status: "missing-source";
    };

type StructureModalState = {
  mode: "create" | "edit";
  sourceRef: SessionSourceReference | null;
  draft: SourceStructureDraft;
};

export function useSourceListController({
  documentSession,
  hydrationStatesByHydrationKey,
}: {
  documentSession: DocumentSessionApi | null;
  hydrationStatesByHydrationKey: ReadonlyMap<string, HydrationSourceState>;
}) {
  const rows = useMemo(
    () =>
      documentSession?.selectors.entries.map((source) => {
        const hydrationState = getHydrationStateForEntry(
          source.entry,
          hydrationStatesByHydrationKey,
        );
        return {
          ...source,
          hydrationState,
          missingCache: hydrationState?.status !== "ready",
        };
      }) ?? [],
    [documentSession, hydrationStatesByHydrationKey],
  );
  const [structureModal, setStructureModal] = useState<StructureModalState | null>(null);
  const [deleteSourceRef, setDeleteSourceRef] = useState<SessionSourceReference | null>(null);
  const structureSource = documentSession?.selectors.getSource(structureModal?.sourceRef ?? null) ?? null;
  const structureValidation = useMemo(() => {
    if (!documentSession?.selectors.draftDocument || !structureModal) {
      return null;
    }
    return validateSourceStructureDraft(
      documentSession.selectors.draftDocument,
      structureModal.draft,
      structureModal.mode === "edit" && structureSource
        ? {
            excludeIndex: documentSession.selectors.entries.findIndex(
              (entry) => entry.ref === structureSource.ref,
            ),
          }
        : {},
    );
  }, [documentSession, structureModal, structureSource]);

  useEffect(() => {
    if (!structureModal || structureModal.mode !== "edit") {
      return;
    }
    if (!structureSource) {
      setStructureModal(null);
    }
  }, [structureModal, structureSource]);

  function openSource(entryId: string): OpenSourceResult {
    const row = rows.find((candidate) => candidate.entry.id === entryId);
    if (!row) {
      return {
        status: "missing-source",
      };
    }
    if (row.missingCache) {
      return {
        status: "missing-cache",
      };
    }
    const sourceRef = documentSession?.intents.openSource(entryId) ?? null;
    if (!sourceRef) {
      return {
        status: "missing-source",
      };
    }
    return {
      status: "opened",
      sourceRef,
    };
  }

  return {
    dirty: documentSession?.selectors.dirty ?? false,
    canUndo: documentSession?.selectors.canUndo ?? false,
    canRedo: documentSession?.selectors.canRedo ?? false,
    saveReadiness: documentSession?.selectors.validation?.saveReadiness ?? null,
    rows,
    structureModal,
    structureValidation,
    deleteSource: deleteSourceRef
      ? (documentSession?.selectors.getSource(deleteSourceRef) ?? null)
      : null,
    openSource,
    openCreateSourceModal() {
      setStructureModal({
        mode: "create",
        sourceRef: null,
        draft: createBlankSourceStructureDraft(),
      });
    },
    openEditSourceModal(ref: SessionSourceReference) {
      const source = documentSession?.selectors.getSource(ref) ?? null;
      if (!source) {
        return;
      }
      setStructureModal({
        mode: "edit",
        sourceRef: ref,
        draft: createSourceStructureDraftFromEntry(source.rawEntry),
      });
    },
    closeStructureModal() {
      setStructureModal(null);
    },
    updateStructureDraft(
      apply: (current: SourceStructureDraft) => SourceStructureDraft,
    ) {
      setStructureModal((current) =>
        current
          ? {
              ...current,
              draft: apply(current.draft),
            }
          : current,
      );
    },
    confirmStructureModal() {
      if (!structureModal || !structureValidation?.valid) {
        return false;
      }
      if (structureModal.mode === "create") {
        documentSession?.intents.createSource(
          buildSourceEntryFromStructureDraft(structureModal.draft),
        );
      } else if (structureSource) {
        documentSession?.intents.updateSourceStructure(
          structureSource.ref,
          buildSourceEntryFromStructureDraft(structureModal.draft, structureSource.rawEntry),
        );
      }
      setStructureModal(null);
      return true;
    },
    requestDeleteSource(ref: SessionSourceReference) {
      setDeleteSourceRef(ref);
    },
    cancelDeleteSource() {
      setDeleteSourceRef(null);
    },
    confirmDeleteSource() {
      if (!deleteSourceRef) {
        return false;
      }
      documentSession?.intents.deleteSource(deleteSourceRef);
      setDeleteSourceRef(null);
      return true;
    },
    moveSource(ref: SessionSourceReference, targetIndex: number) {
      documentSession?.intents.moveSource(ref, targetIndex);
    },
    undo() {
      documentSession?.intents.undo();
    },
    redo() {
      documentSession?.intents.redo();
    },
    prepareSavePreview(schemaPath: string) {
      return documentSession?.intents.prepareSavePreview(schemaPath) ?? null;
    },
    commitSave(document: NonNullable<DocumentSessionApi>["selectors"]["draftDocument"]) {
      if (!document) {
        return;
      }
      documentSession?.intents.commitSave(document);
    },
  };
}
