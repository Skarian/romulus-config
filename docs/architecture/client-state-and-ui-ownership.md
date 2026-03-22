# Client State And UI Ownership

This document defines which client layer owns which state and actions.

## App Shell Ownership

The app shell owns:
1. top-level page selection
2. shared header
3. blocked-document presentation
4. app-wide external-change reload prompt

The app shell does not own:
1. blocked vs editable classification logic
2. whole-document draft editing
3. per-source policy editing details
4. refresh-job execution details

## Document Session Ownership

The document session owns:
1. the authoritative editable-document state
2. the editable-session baseline document
3. the whole-document draft
4. session-scoped source references that preserve same-source continuity inside the live session
5. repairable supported-surface validation
6. aggregate save readiness
7. dirty tracking
8. session undo or redo
9. save-request preparation for the current draft
10. the explicit intent methods pages use to request document mutations

Both top-level pages call this shared service directly.

The document session does not own:
1. page navigation
2. modal presentation details
3. load-time file I/O or blocked-document classification
4. local database storage
5. refresh-job execution
6. update-log retention
7. clear-data execution

Pages consume:
1. read-only selectors from the document session
2. high-level intent methods such as creating a source, opening a source reference, updating structural fields, changing supported policies, building save preview, and committing save

Document-session selectors should include:
1. source-scoped validation issues
2. document-scoped save readiness
3. the current draft or baseline-derived projections each page needs

Pages must not:
1. mutate arbitrary nested draft objects directly
2. maintain shadow document copies that later need to be merged

## Source-List Ownership

The source-list controller owns:
1. structural source creation and editing modals
2. delete confirmation
3. reorder interactions
4. `Draft` marker display
5. main save confirmation
6. manual reload entry
7. refresh-database entry
8. clear-database entry
9. no-cache row warnings and editor-entry gating
10. save-readiness presentation and save-blocked feedback
11. modal-local structural validation before confirm

The source-list page is the only client surface allowed to initiate a `source.json` write, and it does so through the source-list controller.
The source-list controller combines document-session selectors with local-persistence queries about hydration availability and log availability, but those projections remain derived UI state rather than a second durable store.
Transactional structural-modal validation is allowed here because the modal draft is intentionally outside the shared document session until confirm, but it should reuse the same rule set that will later govern the confirmed draft.
The source-list controller is page-scoped and should remain thin; it may coordinate page-local UI state and service calls, but it must not become a second durable document or cache store.

## Source-Editor Ownership

The source-editor controller owns:
1. one source's supported draft editing surface
2. files list search and checkbox interaction
3. rename controls
4. unarchive controls
5. ignore controls
6. statistics rendering
7. preview rendering
8. auxiliary preview-local prompts such as `Sample File Extensions`
9. per-source projections over the shared document session
10. inline presentation of source-scoped validation issues exposed by the document session

The source editor page does not own:
1. document save
2. document reload control
3. app-wide refresh entry
4. clear-database entry

The source-editor controller combines document-session selectors for the active source reference with local-persistence reads or writes keyed by the current content boundary and hydration identity.
It must not become the durable owner of selected-file state, saved `Sample File Extensions`, or hydrated file inventory.
It must not become the owner of supported document-validation rules or save-readiness aggregation.
Leaf UI components under each page should stay mostly presentational and should not coordinate multiple services directly.
The source-editor controller is page-scoped and should remain thin; it may coordinate page-local UI state and service calls, but it must not become a second durable document or cache store.

## Modal Ownership

1. Structural source modals are owned by the source list and are transactional.
2. Save confirmation is owned by the source list.
3. Refresh and clear-database modals are owned by the source list.
4. Cache-miss entry blocking is surfaced by the source list.
5. `Sample File Extensions` prompt is owned by the source editor and download preview surface.

## Session State Ownership

1. Whole-document draft state belongs to the active editable document session.
2. Undo or redo belongs to that same session.
3. Session-scoped source references belong to that same session.
4. Selected-file state and saved `Sample File Extensions` belong to local persistence, keyed by canonical identities.
5. Page-local transient state belongs to the page that uses it.
   Examples:
   - source-list disclosure state
   - files-list search text
   - statistics disclosure state

Transient page state may reset on page entry even when the underlying draft persists.

## Controller Lifetime

1. Page controllers are page-scoped and may be recreated on page entry.
2. They may reset their own transient UI state without affecting the underlying document session or local persistence.
3. Accepted reload tears down the current editable session and any page controllers that depend on it.

## Ownership Invariants

1. Source-list state must not leak into document persistence without going through the main save boundary.
2. Source-list and source-editor layers must not maintain independent copies of the document draft.
3. Source-editor state must not acquire its own `source.json` save path.
4. App-shell concerns must not absorb page-local workflow logic.
5. Page-local transient UI state must not be mistaken for reusable persisted editor state.
6. Page layers must not bypass the document session's intent API by mutating document data ad hoc.
7. The document session must not quietly absorb local-cache or refresh responsibilities that belong to separate services.
8. Leaf UI components must not become the place where document session, persistence, refresh, and local-cache services are orchestrated together.
9. Page controllers must not become long-lived shadow stores for document or local-cache state that already has a canonical owner elsewhere.
10. The source-editor controller must not reimplement durable selected-file or preview-policy storage that already belongs to local persistence.
11. The source-list controller must not treat no-cache warnings or log availability as durable truth separate from the services that own them.
12. Page controllers must not create competing save-readiness or supported-validation models for the draft once the document session already owns them.
13. Transactional modal-local validation is allowed only for preconfirm source-list modal state and must not become a second durable validation authority after confirm.
