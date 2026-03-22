# Server And Persistence

This document defines the backend-facing responsibilities needed by the editor.

## Document Persistence Responsibility

The document persistence layer owns:
1. reading `source.json`
2. validating `source.json`
3. classifying blocked vs editable document outcomes
4. generating the exact post-normalization save preview
5. writing the confirmed document back to disk
6. surfacing external-disk change information needed for reload prompts

It must not expose a second write path that bypasses the main save confirmation boundary.

The document session may coordinate with this layer, but it does not replace it.

## Document Session Relationship

1. Load or reload classification happens before normal editing continues.
2. An editable load result seeds the document session baseline document.
3. The document session owns repairable supported-surface validation and aggregate save readiness for the editable draft.
4. The document session prepares save requests only from a save-ready draft, while the document persistence layer remains the owner of normalization, preview materialization, and disk write.
5. Accepted reload discards the active editable session and restarts this load boundary.

## Repairable Validation Responsibility

Repairable validation for supported editor state belongs to the document session.

This includes:
1. source-scoped field issues for inline editor presentation
2. document-scoped save readiness
3. exclusion of disabled subordinate settings from active validation

Implementation may use pure validation helpers inside or alongside the document session, but that does not create a separate durable service boundary.
Transactional source-list modal validation may reuse those same pure helpers before modal confirm, but the authoritative validation state for the active draft still belongs to the document session.
The document persistence layer may still reject impossible save requests defensively, but it is not the primary owner of editable-session validation state.

## Local Database Responsibility

The local database owns only local editor data:
1. hydrated file cache
2. selected-file state
3. `Sample File Extensions`
4. update logs
5. availability or retrieval queries over those records using the canonical hydration and content-boundary identities

It does not own:
1. source-definition truth
2. source-order truth
3. persistent undo or redo history

The document session may reference local-state identities, but it does not own local-database storage or maintenance.
Selected-file state and saved `Sample File Extensions` remain separate local records keyed by content boundary even when a single source continues across structural edits.
Update logs remain separate from hydrated file cache even if the same backing store retains both.

## Refresh Responsibility

The refresh service owns:
1. hydrating file cache from the saved on-disk document
2. supporting `Only Load Missing Cache`
3. supporting `Refresh All Cache`
4. producing update logs
5. partial success and failure reporting
6. writing refreshed cache and logs through the local persistence boundary

Refresh must not directly consume unsaved draft state.

If the user chooses `Save now`, refresh may continue only after the normal main save completes successfully.

Refresh orchestration belongs outside the document session even when UI flows need both services in sequence.

## Clear-Data Responsibility

The clear-data flow owns removal of only the local database categories exposed in behavior docs:
1. file cache
2. saved selections
3. saved preview data
4. update logs

It must not mutate `source.json`.
It should return only the outcome needed for the source-list controller to update page state and toasts.

## Persistence Invariants

1. The saved-document preview and the actual document write must be identical.
2. File-cache availability and preview or selection data are separate persistence concerns.
3. Clearing one local-data category must not imply that others were cleared.
4. Failed refresh must not wipe previously valid cache for unaffected or unfinished sources.
5. Full refresh must reconcile saved derived state against refreshed inventory rather than proactively deleting it.
6. Document-session responsibilities and local-persistence responsibilities must stay separable at the service boundary.
7. No-cache gating must be derived from local-persistence availability for the current draft's hydration identity.
8. Update logs must remain local-persistence data, not page-owned UI state with an ad hoc backing store.

## Validation Boundary

Blocked-document classification happens at load or reload time before normal editing continues.

Supported-surface validation that the editor can repair remains part of editable-document operation and save gating, not blocked-document classification.
That editable-session validation belongs with document-session and save-request preparation rather than with local persistence or a separate page-owned validator.
