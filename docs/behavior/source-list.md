# Source List Behavior

This draft records source-list behavior for the convenience editor's entry page and draft-management surface.

## Trigger

1. User opens the source list.
2. User opens one source from the list.
3. User creates, deletes, or reorders sources from the list.

## Expected Result

1. The source list is the starting page of the editor, and blocked-document outcomes still render as a blocked variant of the source-list page rather than a separate third page.
2. In editable document state, the source-list page always exposes an `Add source` action through a full-width dashed footer control, including when the list is empty.
3. If the source list currently has zero sources, the page shows a dedicated empty state with a short explanation plus that same dashed `Add source` action rather than rendering as a blank page.
4. In editable document state, the source-list page uses a compact shell made of one muted horizontal toolbar plus a thin status line immediately below it:
   - left toolbar group: `Save Changes`, `Undo`, `Redo`
   - right toolbar group: `Reload source.json`, `Manage database`
   - `Manage database` expands to `Refresh Database`, `View Logs`, and `Clear Database`
   - the thin status line shows source count on the left and unsaved-draft summary on the right
5. The source list is the top-level entrypoint for maintainer-managed sources in this repo, and each source appears as a row with:
   - a dedicated drag-handle icon at the far left
   - `displayName` as the primary visible text
   - no redundant source-type subtitle under the name
   - one combined type-plus-cache pill such as `ZIP · Ready` or `Folder · Needs Cache` visible without opening extra details
   - `Path` and `subfolder` kept inside a dropdown or disclosure rather than always visible in the main row body
   - that dropdown or disclosure collapsed by default
   - a dedicated pencil-icon action for opening the structural edit modal
   - a dedicated trash-icon action for delete
   - a dedicated info action for viewing source details
6. Returning to the source list from an individual source editor resets the list viewport to the top.
7. Clicking the main body of a source row opens an editor session for that source, but only when file cache is already available for the source's current content boundary.
8. The dedicated pencil-icon structural edit action remains available even when row-body entry into the source editor is blocked by missing file cache.
9. The source-list page does not expose a quick search or filtering control in the current editor scope.
10. Creating or editing a source on this page covers the structural fields needed before the workbench page:
   - `displayName`
   - `subfolder`
   - `Path` for `scope.path`
   - `torrents`
11. Each torrent row supports an editable magnet URL and a required `partName`.
12. On this page, `Path` is a required field in the editor UI.
13. The `Path` input writes `scope.path` and accepts either a directory path or an exact `.zip` archive path.
14. `/` is treated as the root-path value in the editor.
15. This first-page structural subset exists so the source can establish cacheable identity before the user continues to the next page.
16. Creating a source starts from a dedicated structural source modal on the source-list page.
17. Editing an existing source's structural fields from the source list uses the same structural source modal pattern and validation behavior as source creation.
18. Structural source modal edits are modal-local and do not mutate the in-memory draft until the primary modal action is confirmed.
19. The structural source modal uses `Create Source` as its primary action in create mode and `Update Source` as its primary action in edit mode.
20. Canceling the structural source modal closes it and discards only the unsaved modal-local changes.
21. Creating a source makes that new source immediately available in the UI as an unsaved editor state.
22. A newly created source does not persist to `source.json` until the user saves it successfully.
23. The structural source modal keeps its primary action disabled until all required fields are valid:
   - `displayName`
   - `subfolder`
   - `Path`
   - every torrent row has both a magnet URL and a `partName`
24. The structural source modal starts with exactly one blank torrent row in create mode.
25. The structural source modal allows adding more torrent rows with an `Add Torrent` action.
26. The structural source modal allows removing torrent rows only when at least one torrent row remains afterward.
27. If the structural source modal would create or update into a duplicate source, the action is blocked, the modal stays open, and the user sees a user-friendly duplicate reason.
28. When a required field in the structural source modal is invalid, the editor shows inline validation directly under that field.
29. After `Create Source` or `Update Source` applies to the in-memory draft, the source row immediately re-evaluates its no-cache warning state against the updated draft values.
30. Deleting a source is only possible from the source-list page.
31. Deleting a source requires a confirmation modal first because it is a destructive action.
32. After delete confirmation, the source is removed from the current UI draft immediately, but the deletion does not persist to `source.json` until the user saves successfully.
33. After delete confirmation, the user remains on the source-list page.
34. Reordering sources uses drag-and-drop.
35. The list exposes a dedicated drag-handle icon for reordering so dragging is an explicit interaction.
36. Reordering sources updates the current UI draft immediately, but the new order does not persist to `source.json` until the user saves successfully.
37. Saving or applying `source.json` changes is only available from the source-list page while the current document is editable.
38. The source-list page always shows `Save Changes`, but keeps it disabled when there are no draft changes to persist.
39. Clicking `Save Changes` opens a confirmation modal before the draft is written into `source.json`.
40. That save confirmation modal includes a read-only collapsible preview showing the exact post-normalization `source.json` content that will be written if the maintainer confirms the save.
41. The `source.json` preview in that confirmation modal is collapsed by default.
42. Canceling the save confirmation modal closes it and leaves the current draft unchanged.
43. Confirming the save writes exactly that previewed current draft document into `source.json` at once.
44. While that save is running, the save confirmation controls are disabled and the save action shows an in-progress state.
45. After a successful save, the app shows a success toast with the message `Changes saved to source.json`.
46. After a successful save, the source-list unsaved-status summary immediately resets to `No unsaved changes` and the user remains on the source-list page.
47. After a successful save, live-session `Undo` and `Redo` remain available.
48. If the main save fails, the app shows an error toast with the message `Could not save changes. Check the console for details.`
49. If the main save fails, the underlying error is logged to the browser console.
50. If the main save fails, the full draft remains intact and the source-list unsaved-status summary remains unchanged.
51. Individual source editors do not expose their own `source.json` save or apply action.
52. The source-list page exposes a manual reload action for reloading `source.json` from disk, including while the blocked-document variant is active.
53. If the maintainer uses that manual reload action while the document still has unsaved draft changes, the app prompts before discarding the current in-memory draft.
54. That manual-reload prompt explicitly warns that confirming reload will discard the current drafts and the current edit history.
55. That manual-reload prompt uses the approved copy:
   - title: `Reload source.json`
   - body: `Reloading from disk will discard your current drafts and edit history. Any unsaved changes in the editor will be lost.`
   - primary action: `Reload from Disk`
   - secondary action: `Cancel`
56. In editable document state, the source-list page exposes app-wide database maintenance through `Manage database`.
57. `Manage database` contains `Refresh Database`, `View Logs`, and `Clear Database`.
58. Triggering `Refresh Database` follows the current simulator pattern: open an `Update Database` modal, then start the update from within that modal.
59. The `Update Database` modal includes two radio options for refresh scope:
   - `Only Load Missing Cache`
   - `Refresh All Cache`
60. `Only Load Missing Cache` uses helper copy `Loads file cache only for sources that do not already have local cache.`
61. `Refresh All Cache` uses helper copy `Rebuilds file cache for every source, even when local cache already exists.`
62. `Only Load Missing Cache` is selected by default when the `Update Database` modal opens.
63. If `Only Load Missing Cache` is selected when no sources are currently missing cache, `Start Update` stays disabled and hover text says `No Missing Cache`.
64. If refresh credentials are missing, `Start Update` stays disabled and the modal shows inline setup instructions naming `REAL_DEBRID_API_KEY` in `simulator/.env.local`.
65. `Refresh All Cache` overwrites cache for every source regardless of whether that source currently has no-cache warnings, stale saved selections, or stale saved preview data.
66. `Refresh All Cache` does not proactively clear saved selections or saved preview data before the run.
67. After `Refresh All Cache`, the app reuses compatible saved selections and saved preview data where possible and falls back to the existing reconciliation rules when refreshed inventory makes some saved state invalid.
68. The `Update Database` modal does not enumerate which specific sources are currently missing cache.
69. When the maintainer starts `Refresh Database`, the `Update Database` modal automatically transitions into `View Logs`.
70. After that transition, the maintainer may close `View Logs` while the refresh continues in the background.
71. While `Refresh Database` is running, the source-list shell remains visible but normal source-list interactions stay locked.
72. While `Refresh Database` is running or after logs exist, the `Manage database` dropdown keeps `View Logs` available.
73. `View Logs` opens the current simulator-style log modal for the database update run.
74. `View Logs` keeps both `Simple` and `Detailed` log filters.
75. Triggering `Clear Database` opens an options modal before any data is removed.
76. That modal uses the approved shell copy:
   - title: `Clear Database`
   - body: `Choose what to remove from the local database. This only affects cached local editor data and does not modify source.json.`
   - primary destructive action: `Clear Selected Data`
77. The modal presents its clear-data choices as a series of checkboxes rather than preselected actions.
78. All clear-data checkboxes start unchecked by default.
79. The modal includes a bottom `Cancel` button as its non-destructive close path.
80. If none of the clear-data checkboxes are selected, `Clear Selected Data` stays disabled.
81. Choosing `Clear Selected Data` opens one final destructive confirmation step before the selected local data is actually removed.
82. That final destructive confirmation uses generic copy rather than explicitly listing the selected clear-data categories.
83. That final destructive confirmation uses the approved copy:
   - title: `Confirm Clear Database`
   - body: `This will permanently remove the selected local database data. This cannot be undone.`
   - destructive action: `Clear Data`
84. That final destructive confirmation also includes a non-destructive `Cancel` button.
85. Once the maintainer confirms `Clear Data`, the clear-database flow closes immediately rather than staying open to await the eventual result.
86. The first clear-data checkbox is labeled `File Cache` with helper copy `Removes cached file lists downloaded for your sources.`
87. The second clear-data checkbox is labeled `Saved Selections` with helper copy `Removes saved file selections for your sources.`
88. The third clear-data checkbox is labeled `Saved Preview Data` with helper copy `Removes saved Sample File Extensions.`
89. The fourth clear-data checkbox is labeled `Update Logs` with helper copy `Removes saved database update logs.`
90. If `File Cache` is cleared, affected sources immediately return to the no-cache warning state and cannot enter the source editor again until `Refresh Database` repopulates their cache.
91. If `Saved Selections` is cleared while file cache remains available, affected sources still open normally and all file checkboxes reset to unselected.
92. If `Saved Preview Data` is cleared while file cache remains available, affected sources still open normally, the saved `Sample File Extensions` policy is removed, and any required `Sample File Extensions` are prompted again when preview needs them.
93. If `Update Logs` is cleared, `View Logs` disappears immediately unless a new `Refresh Database` run is currently in progress.
94. After clear succeeds, the app shows a success toast confirming that local database data was cleared.
95. If clear fails, the app shows an error toast telling the maintainer to check the browser web console for more detail.
96. If clear fails, the underlying error is logged to the browser web console.
97. If clear fails, the selected local database data remains untouched.
98. The source-list page indicates which sources currently have unsaved draft modifications with a `Draft` marker.
99. If the maintainer uses `Refresh Database` while the document still has unsaved draft changes, the app shows a modal explaining that unsaved changes were detected.
100. That modal offers exactly two actions:
   - `Save now`
   - `Use source.json on disk`
101. Choosing `Save now` opens the normal `Save Changes` confirmation flow rather than bypassing it.
102. If that save confirmation is approved and the save succeeds, the app saves the entire current draft document first and then automatically continues `Refresh Database` using the already selected refresh mode; if that save fails, `Refresh Database` does not start and the current draft remains active.
103. If that save confirmation is canceled, `Refresh Database` does not start and the `Update Database` modal remains available with the current refresh-mode choice preserved.
104. Choosing `Use source.json on disk` runs `Refresh Database` against the saved on-disk `source.json` without discarding the current in-memory draft.
105. If the document is not in draft state, `Refresh Database` runs against the saved on-disk `source.json`.
106. If `Refresh Database` fails partway through, existing file cache remains available for sources that were already cached before the run, and sources that completed successfully keep their refreshed results.
107. `Refresh Database` is not all-or-nothing for local cache replacement.
108. If `Refresh Database` ends with both successful and failed source updates, the app shows one mixed-result toast instead of separate success and error toasts.
109. That mixed-result toast includes counts for how many source updates succeeded and how many failed.
110. If `Refresh Database` fully succeeds with no failures, the success toast stays simple and does not include refreshed-source counts.
111. If `Refresh Database` fails, the app shows an error toast telling the maintainer to open `View Logs` for more detail.
112. While `Refresh Database` is running, the source-list page is temporarily locked and does not allow editing or navigation interactions.
113. If a source has no file cache for its current content boundary, the source list shows that no-cache state in the row's combined type-plus-cache pill before the maintainer tries to open it.
114. Hovering that warning icon shows guidance telling the maintainer to refresh the database.
115. That no-cache warning state is advisory only and does not disable clicking the source row.
116. If the maintainer still tries to open a source whose current content boundary has no file cache yet, the app keeps the maintainer on the source-list page and shows a modal explaining that file cache is required before entering the source editor.
117. That cache-miss modal does not expose its own `Refresh Database` action and instead directs the maintainer back to the existing source-list `Refresh Database` control.
118. After the list hands control to the editor, same-source continuity follows [`source-editor.md`](source-editor.md) while changes remain draft-local until the user returns to the source-list page and saves there.

## Failure Behavior

1. The list must not lose the maintainer's place just because the opened source is structurally edited.
2. The source-list page must not hide the `Add source` action, including when no sources currently exist.
3. The source-list page must not render as a blank page when the source list is empty.
4. The structural source modal must not leak unsaved modal-local edits into the in-memory draft before `Create Source` or `Update Source` is confirmed.
5. Canceling the structural source modal must not mutate the current in-memory draft.
6. The source-list pencil edit action must not become unavailable merely because the source currently has no file cache.
7. The app must not write a newly created source into `source.json` before the user commits it with a successful save.
8. The app must not persist a source deletion or reorder into `source.json` before the user commits it with a successful save.
9. Destructive source-list actions must not execute without a confirmation step first.
10. Duplicate detection during source creation must not close the structural source modal or silently add the duplicate source into the current UI draft.
11. The source-list save flow must not write directly to disk without first opening its confirmation modal.
12. The source-list save confirmation modal must not omit the collapsible preview of the exact post-normalization `source.json` content that will be written if confirmed.
13. A failed main save must not discard the current draft or clear the source-list unsaved-status summary.
14. A successful main save must not leave stale unsaved-status text behind on the source list.
15. The app must not expose a second `source.json` save or apply path inside individual source editors.
16. The source-list page must not hide the manual reload path for pulling `source.json` from disk.
17. The manual reload path must not silently discard the current in-memory draft while draft changes exist.
18. The manual reload warning must not hide that confirming reload discards both current drafts and current edit history.
19. The source-list page must not hide the `Manage database` control while the document is editable.
20. `Manage database` must not omit either `Refresh Database` or `Clear Database`.
21. `Manage database` must not hide `View Logs` while a database update is running or after update logs exist.
22. The clear-database action must not execute without its options modal first.
23. The clear-database modal must not preselect any checkbox by default.
24. The clear-database modal must not enable `Clear Selected Data` while no checkbox is selected.
25. The clear-database flow must not remove selected local data without one final destructive confirmation step.
26. The final destructive confirmation must not enumerate the selected clear-data categories.
27. The final destructive confirmation must not remain open after the maintainer confirms `Clear Data`.
28. The clear-database modal must not hide its `Cancel` button.
29. A failed clear must not partially remove any selected local database data.
30. A failed clear must not suppress the underlying browser-console error details.
31. The source-list page must not hide that unsaved draft changes are pending before the user saves.
32. The source-list save flow must not silently switch to partial per-source persistence.
33. The app must not silently run `Refresh Database` against unsaved draft state.
34. Choosing `Save now` inside the refresh flow must not bypass the normal `Save Changes` confirmation modal.
35. Canceling or failing that save confirmation must not silently start `Refresh Database` or discard the currently selected refresh mode.
36. A failed `Refresh Database` run must not discard file cache that existed before the run for unaffected or unfinished sources.
37. A failed `Refresh Database` run must not leave maintainers without the toast guidance to open `View Logs`.
38. A mixed-result `Refresh Database` run must not emit separate success and error toasts for the same run.
39. A mixed-result `Refresh Database` run must not omit the success and failure counts from its toast.
40. A fully successful `Refresh Database` run must not clutter its success toast with refreshed-source counts.
41. The app must not leave the source-list page editable while `Refresh Database` is still running.
42. The app must not let the maintainer enter an individual source editor when that source has no file cache for its current content boundary.
43. The cache-miss modal must not introduce a second `Refresh Database` action separate from the source-list control.
44. The source list must not hide the no-cache state in the combined row badge for sources that cannot currently be opened.
45. The source list must not disable row-open interaction solely because the no-cache warning state is present.
46. The blocked-document variant of the source-list page must not expose normal source-list editing or database-maintenance actions other than manual reload.
