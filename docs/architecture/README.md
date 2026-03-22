# Architecture Docs

This folder captures the target architecture for the convenience editor as a standalone system.

These docs are meant to stay useful even after the current simulator implementation is replaced or removed.

## How These Docs Differ

1. `docs/behavior/` defines what the maintainer experiences.
2. `docs/architecture/` defines which layer owns that behavior, which invariants must hold, and how data moves.
3. ExecPlans define how a specific implementation effort will move the codebase toward this architecture.

Architecture docs should not become UX copy specs, implementation tickets, or simulator-history notes.

## Writing Style

1. Use the behavior docs as the source of truth for user-visible outcomes:
   - start from [`../behavior/README.md`](../behavior/README.md)
   - pull in the specific behavior file that owns the rule you are documenting
2. Make the authority for each durable concern explicit.
3. Name explicit non-responsibilities when a boundary could otherwise blur.
4. Prefer stable contracts, identities, and invariants over temporary implementation detail.
5. When behavior and architecture drift, update architecture to match the settled behavior rather than inventing a third interpretation.
6. Do not leave a known ownership seam as an open question when the settled behavior docs and active decisions already imply the answer.

## Reading Order

1. [`system-overview.md`](system-overview.md)
   What the editor system is, its major subsystems, and the top-level ownership boundaries
2. [`document-lifecycle.md`](document-lifecycle.md)
   How `source.json` moves through load, blocked or editable state, draft editing, save, reload, and undo lifecycle
3. [`data-model-and-identities.md`](data-model-and-identities.md)
   Canonical identities for sources, content boundaries, hydration, duplicates, and local reusable state
4. [`client-state-and-ui-ownership.md`](client-state-and-ui-ownership.md)
   Which page or UI layer owns which slice of state and which actions are allowed where
5. [`server-and-persistence.md`](server-and-persistence.md)
   Responsibilities for `source.json`, the local database, refresh jobs, logs, and clear-data behavior
6. [`contracts-and-events.md`](contracts-and-events.md)
   Cross-layer contracts, event boundaries, and the invariants each interaction must preserve

## Rules For Future Updates

1. If a change affects user experience first, update `docs/behavior/` before or alongside `docs/architecture/`.
2. If a change affects ownership, boundaries, or identities, update `docs/architecture/`.
3. If a change is just an implementation detail inside an already-approved boundary, keep it out of these docs.
