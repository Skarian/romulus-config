# Data Model And Identities

This document defines the canonical identities used by the editor.

## Core Entities

1. Document
   The loaded `source.json` file as a whole
2. Source definition
   One supported source entry inside the document
3. Draft document
   The current in-memory editable form of the whole document
4. Content boundary
   The supported identity used for reusable local state
5. Hydration identity
   The identity used to determine whether cached file inventory can be reused
6. Repairable validation snapshot
   The current editable-session view of source-scoped issues and aggregate save readiness

## Editable Document Session

For editable-document state, the architecture distinguishes:
1. baseline document
   - the last loaded or last successfully saved normalized document
2. draft document
   - the in-memory mutable document derived from that baseline
3. session-scoped source reference
   - the session-only identity that preserves same-source continuity across supported structural edits
4. repairable validation snapshot
   - the current derived validation state for the editable draft

These are in-memory session records, not persisted data models.

## Source Definition Identity

At the UX level, the maintainer can think of a source as "the same source" across structural edits within a session.

At the architecture level, that does not create a reusable persistence key by itself.

Reusable and invalidity-sensitive behavior is driven by the more explicit identities below.

## Session Source Reference

The document session may expose an opaque source reference for page-to-page editing continuity.

This reference:
1. survives supported edits to `displayName`, `subfolder`, `scope`, torrent magnets, and list order while the source still exists in the live draft
2. is discarded when the source is deleted, the session is reloaded, or the app session ends
3. is not persisted
4. is not reused as a duplicate-detection key
5. is not reused as a content-boundary or hydration key

## Repairable Validation Snapshot

The repairable validation snapshot is a derived view owned by the document session.

It:
1. is recalculated from the current draft after relevant mutations
2. includes source-scoped field issues and document-scoped save readiness
3. is not persisted
4. stays within editable-document operation rather than becoming blocked-document state
5. excludes disabled subordinate settings that do not currently participate in supported validation

## Duplicate Identity

Two sources are duplicates when:
1. they share at least one normalized magnet URL
2. they share the same normalized `scope.path`

`/` is normalized to root.

The following do not affect duplicate identity:
1. `displayName`
2. `subfolder`
3. torrent `partName`

## Supported Content-Boundary Identity

For MVP, reusable local state is keyed by:
1. normalized torrent set
2. normalized `scope.path`

`/` is normalized to root.

`includeNestedFiles` is intentionally excluded because it is out of scope for the supported editor surface.

State keyed to this content boundary includes:
1. selected-file checkbox state
2. saved `Sample File Extensions`

## Hydration Identities

Hydrated file inventory uses a broader or narrower identity depending on source kind:

1. Standard non-archive source hydration is keyed by normalized torrent set only.
   This allows one hydrated inventory to be reused and re-filtered as supported scope changes.
2. Exact ZIP archive-selection hydration is keyed by normalized torrent set plus exact normalized `scope.path`.
   This keeps archive-selection inventory tied to the exact named outer ZIP.

## Hydration Availability

A source is editor-enterable only when its current draft resolves to a hydration identity that exists in local persistence.

This derived availability:
1. powers the source-list no-cache warning
2. powers the cache-miss modal shown on failed editor-entry attempts
3. is not itself a persisted document field
4. must be recalculated from the current draft, not cached as a separate page-owned truth

## Supported Scope Shapes

The supported convenience-editor scope surface is:
1. root scope, represented as `/`
2. directory scope
3. exact `.zip` archive scope

Out-of-scope scope settings do not form part of supported identity behavior.

## Identity Invariants

1. Duplicate detection and blocked-document detection must use the same duplicate identity rule.
2. Local-state reuse must not invent a different content-boundary rule from the one documented here.
3. Hydration identity must remain distinct from content-boundary identity where broader cache reuse is intentional.
4. Unsupported settings must not silently become part of supported identity math.
5. Session-scoped source references must not leak into disk writes or local-database keys.
6. Editor-entry gating must derive from hydration availability rather than from a second page-owned source-validity model.
7. Recomputing content-boundary or hydration identities must use the current draft source definition, not a remembered session reference.
8. Aggregate save readiness must derive from the document session's repairable validation snapshot rather than from controller-local state.
9. Cross-service route contracts for source-editor local state must not use preview-entry ids when canonical hydration or content-boundary identities already exist.
