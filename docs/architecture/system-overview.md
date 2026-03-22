# System Overview

This document defines the target editor as a standalone system.

## Purpose

The editor owns maintainer workflows for:
1. loading and validating `source.json`
2. editing a whole-document draft
3. working inside one source at a time
4. reading and maintaining local cache-backed source data
5. saving the normalized document back to disk

It does not try to expose every valid Romulus configuration. It exposes the supported convenience-editor subset defined in the behavior docs, starting from [`../behavior/README.md`](../behavior/README.md).

## Top-Level Subsystems

1. App shell
   Owns the shared header, top-level page selection, manual reload entrypoint visibility, app-wide reload-prompt presentation, and blocked-document presentation.
   It renders blocked vs editable shell states from load or reload results supplied by the document persistence layer and, when editable, the active document session.
2. Document session
   Owns the authoritative editable-document session after an editable load result exists, including:
   - the last loaded or saved baseline document
   - the whole-document draft
   - session-scoped source references that preserve same-source continuity inside one live session
   - repairable supported-surface validation
   - aggregate save readiness
   - dirty tracking
   - session undo or redo
   - read-only selectors and the high-level intent API that pages use to request document mutations
3. Source-list workflow
   Is coordinated by a thin source-list controller that owns structural source changes, source ordering, save entry, refresh entry, clear-database entry, log viewing, and row-level gating such as no-cache state by operating on the shared document session and the relevant persistence services
4. Source-editor workflow
   Is coordinated by a thin source-editor controller that owns one-source editing projections over the shared document session and the local persistence read models needed for files, preview, rename, unarchive, ignore, and statistics
5. Document persistence service
   Owns reading `source.json`, validating it, classifying blocked vs editable load results, generating exact save-preview payloads from the normalized draft, and writing the confirmed document back to disk
6. Local persistence service
   Owns hydrated file cache, selected files, `Sample File Extensions`, update logs, and read or write operations keyed by the canonical identities in [`data-model-and-identities.md`](data-model-and-identities.md)
7. Refresh service
   Owns cache hydration and log generation for `Refresh Database`, using the saved on-disk document rather than unsaved draft state
8. Clear-data service
   Owns destructive removal of the approved local-data categories without mutating `source.json`

## System Boundaries

1. The document session is the only authoritative in-memory owner of the editable document state.
2. The source-list page is the only place allowed to initiate persistence of `source.json`.
3. Individual source editors may save auxiliary local state, but must not write `source.json`.
4. The document persistence layer classifies load or reload results as blocked or editable before normal editing continues; the app shell decides only how to present that result.
5. File-cache availability gates entry into the source editor, but does not block structural editing from the source list.
6. Local reusable state is keyed by supported content-boundary identities, not by arbitrary page sessions.
7. The document session does not own local database storage, cache hydration, update logs, or clear-data execution.
8. Same-source continuity inside one live editing session is owned by session-scoped source references, not by durable persistence keys.
9. Source-editor read models may combine document-session selectors with local-persistence selectors, but that composition must not become a second durable store.
10. Repairable supported-surface validation and aggregate save readiness belong to the document session, while blocked-document classification belongs to the document persistence layer.

## Architectural Invariants

1. There are only two top-level pages:
   - source list
   - source editor
2. Blocked-document state is a variant of the source-list page, not a separate page.
3. Both pages read from and write to the same shared document session rather than maintaining independent document copies.
4. `source.json` save is whole-document and atomic from the editor's point of view.
5. Save preview must match the exact normalized document that would be written.
6. Refresh must never silently operate on unsaved draft state.
7. Supported local-state reuse must follow the canonical identities in [`data-model-and-identities.md`](data-model-and-identities.md).
8. Page layers must not mutate arbitrary nested draft fields directly; they act through the document session's explicit intent methods.
9. Document-centric state and local-cache state must remain separate services even when the UI coordinates both.
10. Top-level page controllers may coordinate multiple services, but leaf UI components should not become service-orchestration layers.
11. Source continuity within one live session must survive supported structural edits without becoming a durable identity outside that session.
12. No-cache gating is a derived local-persistence result over the current draft's hydration identity, not a second document-validation state.
13. App shell and page-controller layers may present service outcomes, but they must not silently reclassify document, cache, refresh, or clear-data results.
14. Repairable supported-surface validation must be derived from the current draft by the document session rather than recomputed ad hoc in page controllers.

## Cross-Document Relationship

1. Behavior docs define user-facing outcomes.
2. Architecture docs define ownership and system seams.
3. ExecPlans should reference both before implementation begins.
