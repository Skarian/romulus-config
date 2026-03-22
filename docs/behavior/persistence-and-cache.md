# Persistence And Cache Behavior

This draft records DB-backed cache and persistence identity. Surface-specific behavior that consumes these identities lives in the sibling behavior docs.

## Trigger

1. The editor resolves hydrated inventory for a source.
2. The editor stores or reads selection or preview-backed state.
3. A source resolves to a previously seen or different underlying content boundary over time.

## Expected Result

1. The supported MVP content boundary for reusable editor state is defined by:
   - normalized torrent set
   - normalized `scope.path`, with `/` treated as root
2. State scoped to that content boundary includes:
   - selected-file checkbox state
   - saved `Sample File Extensions` policy
3. When the same source or a later valid source state resolves to a previously seen content boundary, the editor reuses that content-boundary-scoped state.
4. Saved selected-file checkbox state is still reconciled within that content boundary against refreshed inventory and current valid ignore rules; rows hidden by ignore are removed from the saved selection state.
5. If a source edit changes that content boundary, those content-boundary-scoped states do not carry forward into the new boundary.
6. Standard non-archive hydrated inventory is cached by normalized torrent set only.
7. When a standard source changes only normalized `scope.path` while keeping the same normalized torrent set, the editor re-filters the cached full torrent inventory locally instead of treating it as a new hydration identity.
8. Exact ZIP archive-selection hydrated inventory is cached by normalized torrent set plus exact normalized `scope.path`.
9. If hydrated inventory is explicitly cleared from the local database, affected sources immediately lose file-cache availability and must be refreshed before they can re-enter the source editor.
10. If saved selections are explicitly cleared while hydrated inventory remains present, file-cache availability is unchanged and only the saved checkbox state is removed.
11. If saved preview data is explicitly cleared while hydrated inventory remains present, file-cache availability is unchanged, the saved `Sample File Extensions` policy is removed, and any required `Sample File Extensions` must be re-entered when preview needs them.
12. If a database refresh fails partway through, cache that existed before the run remains available for unfinished or unaffected sources, while successfully refreshed sources keep their updated cache.
13. A full cache refresh does not proactively clear saved selections or saved preview data; those derived states remain eligible for reuse and are reconciled only if refreshed inventory or current valid ignore rules prove some saved state invalid.
14. No additional persisted or reusable state is attached to the maintainer's notion of the same source beyond the active draft session and live-session undo or redo state described in [`source-editor.md`](source-editor.md).

## Failure Behavior

1. The editor must not silently attribute content-boundary-scoped state to a different content boundary.
2. The editor must not preserve off-screen saved file selections for rows that current valid ignore rules hide within the same content boundary.
3. The editor must not treat archive-selection hydrated inventory as reusable across different exact ZIP paths.
4. The editor must not treat a source with cleared hydrated inventory as still having valid file-cache availability.
5. The editor must not treat cleared saved selections as implying hydrated inventory was also cleared.
6. The editor must not treat cleared saved preview data as implying hydrated inventory was also cleared.
7. The editor must not treat a failed refresh as permission to wipe previously valid cache for unfinished or unaffected sources.
8. The editor must not proactively wipe reusable saved selections or saved preview data just because a full cache refresh was requested.
9. The editor must not invent extra per-source persisted state once draft and undo/redo semantics are already defined at the session layer.
