# Contracts And Events

This document defines the important cross-layer contracts and event boundaries for the editor.

## Load Contract

The document load contract returns one of two outcomes:
1. editable document
2. blocked document

Blocked-document outcomes carry:
1. one of the approved blocker families
2. user-facing issue messages suitable for the blocked recovery panel

## Main Save Contract

The main save contract is whole-document and source-list-owned.

Required sequence:
1. read current save readiness from the document session
2. if the draft is not save-ready, return the save-blocked outcome and stop
3. receive the current document-session draft
4. normalize deterministically through the document persistence boundary
5. produce the exact save preview
6. await user confirmation
7. write exactly the previewed document
8. advance the document-session baseline only after the write succeeds
9. return success or failure

No caller may skip steps `4-6`.

## Document Session API Contract

The document session is the only client-side owner of editable document state.

Pages interact with it through:
1. read-only selectors
2. high-level intent methods

The API should model user intent rather than raw object mutation.
Selectors should return immutable values or derived projections rather than mutable draft-object references.
Selectors should include source-scoped validation issues and document-scoped save readiness when those are needed for page presentation.

Examples of valid intent methods:
1. create a source
2. open or focus a source reference
3. update source structure
4. reorder sources
5. set supported rename or ignore or unarchive policy
6. build save preview
7. commit save
8. discard or reload document session

The API should not require pages to patch nested document objects directly.
The API also should not become a back door for local-database or refresh-job responsibilities that belong to other services.

## Repairable Validation Contract

The document session owns repairable validation for supported editable state.

Required behavior:
1. reevaluate repairable validation after relevant draft mutations
2. expose source-scoped issues for inline field presentation
3. expose document-scoped save readiness and save-blocked reasons for source-list controls
4. exclude disabled subordinate settings that do not currently participate in supported validation
5. keep repairable validation inside editable-document state rather than escalating it to blocked-document state
6. allow transactional source-list structural modals to perform preconfirm validation locally while the modal draft remains outside the document session, using the same rule set that will govern the confirmed draft

The source-list and source-editor controllers may present these results, but they must not redefine the validation rules independently.
No separate standalone validation event boundary is required; `draft changed` is sufficient to drive validation recomputation.

## Page Controller Contract

Each top-level page should have one thin controller layer that coordinates the services needed by that page.

For MVP:
1. source-list controller
2. source-editor controller

These controllers may:
1. compose document-session selectors and intent methods
2. call local persistence or refresh services when the page workflow requires them
3. adapt service results into page-facing UI state
4. own page-local transient UI state such as search text, disclosure state, and modal visibility

These controllers should not:
1. become alternate persistence owners
2. duplicate document-session state
3. push orchestration complexity down into leaf UI components
4. become long-lived shadow stores for state that already has a canonical owner

## Source Entry Contract

Entering the source editor is a cross-service contract owned by the source-list controller.

Required sequence:
1. derive the source's current hydration identity from the document-session draft
2. query local persistence for file-cache availability for that identity
3. if cache exists:
   - open or reuse the source's session-scoped source reference in the document session
   - navigate to the source editor
4. if cache does not exist:
   - keep the source-list page active
   - show the cache-miss modal

No caller may bypass the cache-availability check and enter the source editor anyway.

## Per-Source Read Model Contract

The source-editor controller combines:
1. document-session selectors for the active session-scoped source reference
2. local-persistence reads or writes keyed by the current content boundary and hydration identity

This contract means:
1. selected-file state stays in local persistence, not in the page controller
2. saved `Sample File Extensions` stays in local persistence, not in the document session
3. files-list search text, disclosure state, and prompt visibility stay page-local
4. recomputing content-boundary or hydration identity changes which local records are consulted, but it does not redefine the session-scoped source reference
5. client-to-server requests for source-editor local state must use the current draft's canonical hydration and content-boundary identities rather than a preview-entry id derived from list order

## Auxiliary Local Save Contract

Auxiliary local saves are allowed only for editor-local data that does not persist `source.json`.

For MVP, this includes:
1. `Sample File Extensions`

Required behavior:
1. success produces visible success feedback
2. failure produces visible error feedback
3. failure logs underlying details to the browser console
4. success or failure must not mutate the document-session baseline or bypass main-save rules

## Refresh Contract

The refresh contract operates on saved on-disk document state.

Inputs:
1. refresh mode
   - `Only Load Missing Cache`
   - `Refresh All Cache`
2. current saved `source.json`

If draft changes exist, the caller must resolve that through the documented decision point before refresh begins.

Outputs:
1. updated cache rows for successful sources
2. retained previous cache for unfinished or unaffected sources
3. update logs
4. aggregate run result for toast and logs

Refresh may continue after `Save now` only once the main save contract has completed successfully.

## Clear-Data Contract

The clear-data contract operates only on local database categories.

It must:
1. remove only the selected categories
2. leave unselected categories untouched
3. leave `source.json` untouched

## Event Boundaries

The editor needs only a small set of high-value events:
1. document loaded
2. document blocked
3. draft changed
4. save confirmed
5. save succeeded
6. save failed
7. external document change detected
8. refresh started
9. refresh completed
10. refresh failed
11. local data cleared
12. source entry blocked by missing cache
13. auxiliary local save succeeded
14. auxiliary local save failed

These event boundaries should be enough to coordinate UI state without inventing page-specific hidden backchannels.

## Contract Invariants

1. Every cross-layer contract must have one owning layer.
2. User-visible blocked-state messaging must come from the load classification contract, not from ad hoc page logic.
3. User-visible save preview must come from the same normalized document that would be written.
4. Refresh and clear-data flows must not become alternate document-write paths.
5. Page layers must not gain a side-door around the document session by mutating raw document objects directly.
6. The document session contract must not expand until it owns unrelated local-persistence concerns.
7. Top-level page orchestration should live in thin page controllers rather than spreading across presentational UI components.
8. Thin page controllers may own transient page-local UI state, but durable document and local-cache state must stay with their canonical services.
9. Session-scoped source references must not be reused as durable local-persistence or disk-write identities.
10. Page controllers may compose cross-service read models, but they must route durable writes back to the service that owns the underlying data.
11. Repairable supported-surface validation and aggregate save readiness must come from document-session selectors rather than controller-local rules.
