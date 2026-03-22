# Document Lifecycle

This document defines how the editor treats `source.json` from load through save and reload.

## Document States

The editor recognizes only two document states after load or reload:
1. blocked document
2. editable document

Blocked-document state is entered only for the blocker families defined in [`../behavior/status-and-conflicts.md`](../behavior/status-and-conflicts.md).

## Load Flow

1. The app reads `source.json`.
2. The document persistence service validates and classifies the result.
3. If the result is blocked:
   - the app shell stays on the source-list page
   - the source-list body is replaced with the blocked recovery panel
   - manual reload remains available
4. If the result is editable:
   - the app constructs the document session from the loaded baseline document
   - the source-list page becomes interactive

## Editable Session Shape

If load succeeds as editable, the document session owns these in-memory records:
1. baseline document
   - the last loaded or last successfully saved normalized document
2. draft document
   - the mutable whole-document draft derived from that baseline
3. session-scoped source references
   - opaque references that preserve same-source continuity across supported structural edits inside the live session
4. repairable validation snapshot
   - the current derived validation state for the editable draft
5. undo or redo history
   - session-local history over the draft document

These records exist only for the lifetime of the current editable session.

## Draft Model

1. The document session keeps one authoritative in-memory whole-document draft alongside the current baseline document.
2. Structural create or edit modals are transactional:
   - modal-local until confirm
   - no draft mutation on cancel
3. Source-list and source-editor flows both mutate that same shared document session through its intent methods.
4. Source-editor changes are live draft changes inside that shared document session.
5. Editing an existing source should preserve its session-scoped source reference for as long as that source remains present in the draft.
6. Draft markers on the source list are derived from differences between the shared document session baseline and current draft.
7. Structural source modal validation before confirm remains modal-local because the modal draft is not yet part of the shared document session.
8. Once a structural modal confirms into the shared draft, the resulting source state is governed by the document session's repairable validation model.

## Repairable Validation And Save Readiness

1. After each relevant draft mutation, the document session reevaluates repairable supported-surface validation against the current draft.
2. This validation remains part of editable-document operation; it does not reclassify the document as blocked.
3. The document session exposes:
   - source-scoped field issues for inline presentation in source editors and structural modals
   - document-scoped save readiness and blocking reasons for source-list save controls and save-blocked feedback
4. Validation respects the current draft shape, so disabled or hidden subordinate settings do not participate while their parent feature is off.
5. Invalid custom regexes, invalid ignore globs, and invalid supported field values are examples of repairable validation problems in this layer.
6. Transactional source-list structural modals may perform preconfirm validation locally, but that validation gates only modal confirmation and does not replace document-session save readiness after confirm.

## Source Entry And Return

1. The source-list controller derives the current hydration identity for a source from the shared draft.
2. It checks local persistence for file-cache availability for that hydration identity before navigation.
3. If cache is available:
   - the document session opens or reuses the source's session-scoped reference
   - the app navigates to the source editor
4. If cache is unavailable:
   - the app remains on the source-list page
   - the cache-miss modal is shown
5. Returning from the source editor to the source list keeps the same editable document session alive while allowing page-local UI state to reset.

## Save Flow

1. The main save entrypoint is `Save Changes` on the source-list page.
2. The source-list page asks the document session whether the current draft is save-ready.
3. If the draft is not save-ready:
   - no save preview is built
   - no disk write is attempted
   - the source-list page presents the documented save-blocked feedback
4. If the draft is save-ready, the source-list page asks the document session for a save-ready request derived from the current draft.
5. The source editor has no `source.json` save path.
6. Before save confirmation is shown:
   - deterministic save-time normalization runs through the document persistence boundary
   - the exact post-normalization document is prepared
7. The confirmation modal previews that exact post-normalization document.
8. Confirming save writes exactly that previewed document.
9. Save success:
   - advances the baseline document to the saved normalized document
   - clears `Draft` markers
   - keeps the user on the source-list page
   - keeps live-session undo or redo available
10. Save failure:
   - leaves the baseline document unchanged
   - leaves the draft intact
   - leaves `Draft` markers intact
   - logs the underlying error

## Reload Flow

There are two reload paths:
1. Manual reload
   - available only from the source-list page
   - discards current drafts and edit history only after confirmation
2. External-change reload prompt
   - app-wide
   - may appear while the user is on either top-level page
   - can be declined, in which case the current draft remains active

If reload is accepted, the current editable session is torn down, including its draft, session-scoped source references, and edit history, and the app restarts the load flow.

## Undo And Redo Lifecycle

1. Undo or redo is session-local.
2. It may survive a successful save while the app session remains open.
3. It is cleared by:
   - accepted reload
   - app close
   - full page reload

## Save-As-Dependency Flows

Some flows may require the main save before continuing.

The canonical example is `Refresh Database` with drafts present:
1. the flow must surface the unsaved-changes choice
2. choosing `Save now` must route through the normal main save confirmation
3. only a successful main save allows the dependent flow to continue

No dependent flow may bypass the normal main save lifecycle.
