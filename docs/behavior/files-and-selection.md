# Files And Selection Behavior

This draft records file-row and selection behavior. Persistence details for the underlying keys live in [`persistence-and-cache.md`](persistence-and-cache.md).

## Trigger

1. User opens file rows for one source.
2. User searches or filters the visible file rows.
3. User selects or clears file checkboxes.
4. User revisits a source or later valid source state that resolves to a previously seen content boundary.
5. User opens a source whose `scope.path` is an exact `.zip` archive.

## Expected Result

1. Selected-file checkbox state is scoped to the supported MVP content boundary defined by:
   - normalized torrent set
   - normalized `scope.path`, with `/` treated as root
2. When the same source or a later valid source state resolves to that same content boundary, the editor reuses the same selected-file checkbox state unless refreshed inventory or current valid ignore rules reconcile some saved selections away.
3. The `Files List` includes a quick search box so maintainers can filter visible file rows without excessive scrolling.
4. That quick search filters by file name only rather than by the full visible path.
5. That quick search matches case-insensitively.
6. That quick search uses the placeholder `Search files` so it does not need a separate title.
7. That quick search resets to empty when the user opens a source.
8. If a source has genuinely zero visible files before any search is entered, the quick search box stays hidden.
9. If the current search text produces zero matches, the quick search box remains visible so the maintainer can change or clear it.
10. File selection stays row-by-row only.
11. The `Files List` does not expose `Select all` or `Select none` controls for the current scope.
12. The `Files List` sorts visible rows alphabetically by file name.
13. That alphabetical file-name ordering is case-insensitive.
14. If two visible rows have the same file name, their relative order falls back to the underlying hydrated order.
15. Each file row shows the original file name only rather than also showing the relative path under it.
16. Each file row includes file size metadata.
17. File size metadata is shown in a human-readable format rather than raw bytes.
18. The `Files List` does not show torrent part labels on file rows.
19. Only the checkbox itself toggles file selection.
20. The `Files List` includes an in-panel retry control when file loading fails.
21. The `Files List` loading state uses the title `Loading files`.
22. The `Files List` loading state uses the body `Checking the local database for this source.`
23. The `Files List` reflects the current draft scope, ignore, and selected-file state while continuing to show original file names.
24. If current valid ignore rules hide previously selected file rows, those hidden rows are removed from the saved selection state rather than preserved off-screen.
25. When the source loaded successfully but scope and ignore rules filtered everything out, the `Files List` empty state keeps the current editor copy:
   - title: `No files matched this source`
   - body: `The source loaded successfully, but your scope and ignore rules filtered everything out.`
26. Because source-list entry is gated on file cache, the `Files List` does not expose a separate in-editor no-cache empty state in the current editor scope.
27. When the `Files List` load fails, the error state uses:
   - title: `Could not load files`
   - body: `The file list could not be loaded for this source. Try again.`
   - retry action: `Retry`
28. The `Files List` does not show draft rename-output hints under file rows.
29. If duplicate visible file names occur, the UI does not add extra disambiguation for those rows.
30. Search only filters which rows are currently visible and does not reset or redefine checkbox state for rows hidden by the current search.
31. File-row resolution may reuse hydrated inventory according to [`persistence-and-cache.md`](persistence-and-cache.md), while visible filtering and selection behavior remain consistent with the current content boundary.
32. If saved selections are explicitly cleared while file cache remains available, affected sources still open normally and all file checkboxes start unselected.
33. If refreshed file inventory no longer contains some previously saved selections, those missing selections are dropped silently.
34. For exact `.zip` scope paths, the editor resolves the specific outer `.zip` archive named by `scope.path`.
35. For exact `.zip` scope paths, the editor enumerates the internal files of that `.zip` and presents those internal files as the selectable file rows.
36. For exact `.zip` scope paths, the outer `.zip` container itself is never shown as a selectable file row.
37. If a structural edit produces a new content boundary, prior selected-file checkbox state does not carry forward into that new boundary.

## Failure Behavior

1. The editor must not silently merge selected-file state into a different content boundary.
2. The `Files List` must not force maintainers to rely only on long scrolling when a quick search filter can narrow the visible rows.
3. The quick search must not unexpectedly broaden into full-path matching for the current scope.
4. The quick search must not become case-sensitive for the current scope.
5. The quick search must not require a separate visible title for the current scope.
6. The quick search must not persist prior search text when a source is newly opened for the current scope.
7. The quick search must not stay visible for a source that has genuinely zero visible files before any search is entered.
8. The quick search must not disappear merely because the current search text produced zero matches.
9. The `Files List` must not introduce bulk `Select all` or `Select none` controls for the current scope.
10. The `Files List` must not fall back to source-file hydration order for the current scope.
11. The alphabetical file-name ordering must not become case-sensitive for the current scope.
12. Duplicate visible file names must not silently switch to path-based secondary sorting for the current scope.
13. File rows must not continue showing the relative path for the current scope.
14. File rows must not drop file size metadata for the current scope.
15. File size metadata must not fall back to raw bytes for the current scope.
16. The `Files List` must not show torrent part labels on file rows for the current scope.
17. File-row clicks outside the checkbox must not toggle selection for the current scope.
18. The `Files List` must not lose its in-panel retry path when file loading fails.
19. The `Files List` loading state must not keep the older `Loading saved file list` wording for the current scope.
20. The `Files List` loading state must not drift from the approved loading body copy for the current scope.
21. The `Files List` must not fall back to saved-disk file visibility or saved-disk selections when the current draft differs.
22. The filtered-empty `Files List` state must not drift from the approved current-editor copy for the current scope.
23. The `Files List` must not introduce a separate in-editor no-cache empty state for the current scope.
24. The `Files List` load-failure state must not drift from the approved copy and retry label for the current scope.
25. The `Files List` must not show draft rename-output hints for the current scope.
26. Duplicate visible file names must not gain extra disambiguation UI for the current scope.
27. The quick search must not redefine or clear checkbox state for file rows that are merely hidden by the current search text.
28. The editor must not preserve an off-screen stash of selected rows that current valid ignore rules have hidden for the current content boundary.
29. The editor must not treat a reused hydrated inventory as permission to reuse file selection across a different content boundary.
30. The editor must not treat cleared saved selections as if hydrated inventory was also unavailable.
31. The editor must not surface a separate warning just because refreshed inventory silently dropped missing saved selections.
32. For exact `.zip` scope paths, the editor must not mix the outer archive container into the selectable internal-file rows.
33. The editor must not partially carry selections forward once the magnet-plus-scope content boundary changes.
