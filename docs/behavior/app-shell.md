# App Shell Behavior

This draft records the top-level app structure and shared shell behavior around the editor surfaces.

## Trigger

1. The app loads or reloads `source.json`.
2. The maintainer moves between the source-list page and an individual source editor.
3. The maintainer uses app-level controls that are not specific to one source.

## Expected Result

1. For now, the app has only two top-level pages:
   - the source-list page
   - an individual source editor
2. If loading or reloading `source.json` produces a blocked-document state, the app stays on the source-list page and renders a blocked variant of that page instead of introducing a third top-level page.
3. The app keeps a shared top header consistent with the current simulator.
4. That top header keeps the small-caps label plus the `Romulus Config Simulator` title.
5. The top-right side of that header shows a compact inline config-validity indicator using `Config valid` or `Config invalid`.
6. In blocked-document state, the shared header remains visible while the source-list body is replaced by the blocking recovery panel defined in [`status-and-conflicts.md`](status-and-conflicts.md).
7. The manual `Reload source.json` control is available only on the source-list page, including the blocked-document variant of that page.
8. App-wide database refresh and clear-database actions are available only on the source-list page while the current document is editable, and they are grouped under `Manage database`.
9. If `source.json` changes on disk externally while the app is open, the app-wide reload prompt may appear over either the source-list page or an individual source editor.
10. Individual source editors provide a dedicated back button for returning to the source-list page, matching the current simulator pattern.

## Failure Behavior

1. The app must not introduce extra top-level pages for the current editor scope.
2. The app must not treat blocked-document state as a third top-level page.
3. The app must not hide the shared app title, small-caps label, or inline config-validity indicator.
4. The app must not reintroduce a separate top-level config-validation card in place of the header indicator.
5. The app must not expose the manual `Reload source.json` control from inside an individual source editor.
6. The app must not expose either app-wide database refresh or clear-database actions from inside an individual source editor.
7. The app must not expose normal source-list editing or database-maintenance actions other than manual reload while blocked-document state is active.
8. Individual source editors must not replace the dedicated back button with a different navigation pattern for the current scope.
