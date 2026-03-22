# Source Editor Behavior

This draft records editor-session behavior. Shared persistence and conflict rules live in sibling docs so this file can stay focused on the editing workflow itself.

## Trigger

1. User opens one source in the editor.
2. User edits source-definition or policy fields.
3. User returns to the source-list page after editing one source.
4. `source.json` changes outside the current editor session while a source is open.

## Expected Result

1. The editor session follows the maintainer's notion of the same source even if display name, subfolder, scope, torrent magnets, or list order change.
2. Source-definition and policy changes that persist to `source.json` remain draft-local in the UI until the user explicitly saves them successfully from the source-list page.
3. Individual source editors do not expose their own `source.json` save or apply action; persisting draft changes into `source.json` happens only from the source-list page.
4. Individual source editors may still expose auxiliary local-state save flows, such as `Sample File Extensions`, when those flows do not write `source.json`.
5. While an individual source editor is open, its `source.json` draft state remains local until the user leaves that editor and saves from the source-list page.
6. The individual source editor page keeps the current simulator-style section order:
   - `Source Info` at the top
   - a two-column row with `Files List` and `Download Folder Preview`
   - `Unarchive` below that when relevant
   - a two-column row with `Rename` and `Ignore`
   - `Statistics` at the bottom
7. `Source Info` remains read-only inside the individual source editor and is collapsed by default when the editor opens.
8. `Statistics` is split into two labeled groups: `File Cache` and `Current Draft`.
9. `File Cache` reflects cached source data before current draft policy effects and does not change based on scope, ignore, rename, unarchive layout, or file checkbox selection.
10. `Current Draft` reflects the current draft when that helps the maintainer judge policy decisions.
11. Draft-sensitive statistics, such as rename-impact and ignore-impact counts, update from the current draft state.
12. `Current Draft` statistics do not change based on file checkbox selection; they use the current draft-visible file set after scope and ignore effects.
13. The statistics grid uses the approved MVP stat set, and the top summary statistic in `Current Draft` is based on the current draft-visible file count:
   - `File Cache`: `Files`, `Total Size`, `Files with Parentheses`, `Files with Multiple Parenthetical Groups`
   - `Current Draft`: `Files`, `Total Size`, `Files with Parentheses`, `Files with Multiple Parenthetical Groups`, `Files Renamed`, `Excluded by Scope`, `Ignored by Rules`
   - `Files with Parentheses` and `Files with Multiple Parenthetical Groups` use original names rather than post-rename output
   - `Excluded by Scope` counts cached files outside the current scope
   - `Ignored by Rules` counts in-scope files filtered by ignore globs
14. The `Statistics` section is collapsed by default when the source editor opens.
15. The `Statistics` section resets to collapsed each time the source editor is opened.
16. The `Statistics` section is read-only and purely informational.
17. The `Statistics` section does not duplicate the detailed observed phrase-frequency table; that actionable phrase list stays in the relevant rename controls.
18. The `Statistics` section includes a small warnings summary for derived draft-relevant risks such as mixed naming patterns or aggressive rename risk.
19. If the current draft produces no statistics warnings, that warnings summary is hidden instead of showing a `No warnings` message.
20. The `Unarchive` section is hidden entirely when the current source is not an archive-extraction case.
21. When the `Unarchive` section is shown, its primary enable or disable control is a two-state toggle.
22. The `Flat` versus `Dedicated Folder` controls are shown only when unarchive is enabled.
23. When shown, `Flat` and `Dedicated Folder` are presented as radio-style choices.
24. The `Flat` versus `Dedicated Folder` choices include explanatory helper text and render as distinct option cards.
25. Dedicated-folder rename controls are shown only when `Dedicated Folder` is the selected unarchive layout.
26. Switching between `Flat` and `Dedicated Folder` updates the current live draft immediately and does not require a separate apply step inside `Unarchive`.
27. Toggling `Unarchive` off hides its subordinate controls but preserves their current values for the rest of the live draft session.
28. Toggling `Unarchive` back on during the same live draft session restores the previously hidden unarchive layout and dedicated-folder rename values.
29. If the user saves while `Unarchive` is off, the saved document persists unarchive as disabled.
30. While `Unarchive` is off, its hidden subordinate settings do not participate in validation.
31. When the user first turns `Unarchive` on for a source draft that does not already have an unarchive layout, the default layout is `Flat`.
32. When `Dedicated Folder` is first selected and no dedicated-folder rename mode is already set, the default dedicated-folder rename mode is `No rename`.
33. Switching from `Dedicated Folder` to `Flat` hides the dedicated-folder rename settings but preserves them for the rest of the live draft session.
34. Switching back to `Dedicated Folder` during the same live draft session restores the previously hidden dedicated-folder rename settings.
35. The editor preserves as much state as possible while the same source draft stays active, with specific persistence rules defined in [`persistence-and-cache.md`](persistence-and-cache.md), [`files-and-selection.md`](files-and-selection.md), and [`download-preview.md`](download-preview.md).
36. The editor exposes managed rename controls for `No rename`, `All phrases`, and `Selected phrases`, plus a `Custom` mode for raw regex editing.
37. The top-level `Rename` section analyzes the current draft-visible file set after scope and ignore effects, and it does not change based on file checkbox selection.
38. The top-level `Rename` section uses original file names before top-level rename is applied.
39. When unarchive uses `dedicatedFolder`, the dedicated-folder rename section analyzes the current draft-visible dedicated-folder candidates produced by the current unarchive draft, before file checkbox selection is applied.
40. The dedicated-folder rename section uses pre-rename folder names before dedicated-folder rename is applied.
41. When `Selected phrases` is active, the observed phrase list is shown in descending order by frequency.
42. Each observed phrase in that list shows its frequency count alongside the phrase text.
43. If two observed phrases have the same frequency, their tie-break order is alphabetical.
44. If `Selected phrases` is active and no parenthetical phrases are detected, the observed phrase list stays visible and simply shows none.
45. If `All phrases` is selected and no parenthetical phrases are detected, that mode remains selected as a no-op.
46. Checking or unchecking phrases in `Selected phrases` updates the current live draft rename behavior immediately.
47. When the user switches into `Selected phrases`, all detected phrases start unchecked by default.
48. Switching from `All phrases` to `Selected phrases` must not precheck all detected phrases just because `All phrases` was active.
49. If the user leaves `Selected phrases` and returns during the same live draft session, the previously checked phrases remain checked as part of the current draft state.
50. If the detected phrase list changes during the live draft session, any previously checked phrases that are no longer present in the current detected list are dropped from the checked selection.
51. If the detected phrase list changes during the live draft session and new phrases appear, those newly appeared phrases start unchecked.
52. Raw rename `pattern` and `replacement` inputs are visible only when `Custom` is selected for the relevant rename control.
53. Switching from `Custom` to a managed rename mode hides the current custom `pattern` and `replacement` values but preserves them in the current live draft session.
54. Switching back to `Custom` during the same live draft session restores the last in-session custom `pattern` and `replacement` values.
55. If the maintainer enters an invalid custom regex `pattern`, the editor shows warning text below the input box.
56. A source with an invalid custom regex keeps the current draft invalid until the regex is fixed.
57. If the source-list page tries to save while any source draft contains an invalid custom regex, `Save Changes` is blocked and the app shows a user-friendly toast explaining why.
58. That save-blocking toast includes all user-facing guidance needed to understand the problem and also tells the maintainer to check the browser console for more detail.
59. If a source opens with an already-invalid custom regex from disk, the editor still loads that source, opens the relevant rename control in `Custom`, and shows the warning state immediately.
60. If the user saves while a managed rename mode is active, that managed mode is what persists.
61. Preserved hidden custom rename values are live-session draft state only and are cleared by app close, reload, or draft discard.
62. When unarchive uses `dedicatedFolder`, dedicated-folder rename exposes the same four modes and semantics as top-level file rename:
   - `No rename`
   - `All phrases`
   - `Selected phrases`
   - `Custom`
63. The `Ignore` section keeps the current simulator pattern of a simple list of glob-pattern input rows with add and remove controls.
64. The editor supports raw ignore-glob editing as long as each glob is schema/runtime-valid.
65. The first ignore-glob input shows example placeholder text so maintainers can quickly see the expected glob shape.
66. Blank ignore-glob rows are allowed temporarily while the maintainer is editing the current draft.
67. Before the source-list save confirmation preview is generated, blank ignore-glob rows are stripped automatically instead of being written into `source.json`.
68. Duplicate ignore-glob rows are allowed temporarily while the maintainer is editing the current draft.
69. Before the source-list save confirmation preview is generated, duplicate ignore-glob rows are deduped automatically instead of being written repeatedly into `source.json`.
70. Clicking `Add` in the `Ignore` section inserts the new row at the end of the current ignore-glob list.
71. Removing an ignore-glob row updates the current live draft immediately and does not require confirmation.
72. If an ignore glob is invalid, the editor shows warning text below that specific input row.
73. A source with an invalid ignore glob keeps the current draft invalid until the glob is fixed or removed.
74. If the source-list page tries to save while any source draft contains an invalid ignore glob, `Save Changes` is blocked and the app shows a user-friendly toast explaining why.
75. That save-blocking toast includes all user-facing guidance needed to understand the problem and also tells the maintainer to check the browser console for more detail.
76. The underlying invalid-ignore-glob save-blocking details are also logged to the browser console.
77. Exact `.zip` scope sources remain supported in the editor conversion rather than being pushed out to JSON-only editing.
78. Live-session `Undo` and `Redo` remain available while the draft session stays open, including immediately after the user returns from the source-list page save flow.
79. Live-session `Undo` and `Redo` do not persist across app close, full page reload, confirmed manual reload from disk, or reopen. After reload, disk state is the source of truth.
80. External-disk-change prompts are app-wide rather than limited to the currently visible page.
81. If the user declines an external-disk-change reload prompt, the current draft stays active.
82. Individual source editors expose a dedicated back button for returning to the source-list page.
83. Using that dedicated back button returns to the source-list page without a confirmation prompt, even when draft changes exist.
84. Returning to the source-list page from an individual source editor resets the list viewport to the top rather than restoring prior scroll position.
85. External-disk-change prompts and duplicate-source invalid-state handling follow [`status-and-conflicts.md`](status-and-conflicts.md).

## Failure Behavior

1. Closing the app, reloading the app, or confirming a manual reload from disk clears live-session undo history instead of attempting to restore saved history from disk.
2. Unsaved editor changes must not silently persist into `source.json` before the source-list save action succeeds.
3. Individual source editors must not expose their own `source.json` save or apply action.
4. Individual source editors must not drift from the confirmed simulator-style section order for the current scope.
5. `Source Info` must not become editable inside the individual source editor for the current scope.
6. The `Unarchive` section must not be shown for sources where archive extraction is not relevant.
7. Dedicated-folder rename controls must not be shown unless `Dedicated Folder` is the selected unarchive layout.
8. Toggling `Unarchive` off during a live draft session must not discard the hidden subordinate unarchive settings unless the whole draft session is discarded.
9. Hidden unarchive subordinate settings must not continue blocking validation while `Unarchive` is off.
10. Switching from `Dedicated Folder` to `Flat` during a live draft session must not discard the hidden dedicated-folder rename settings unless the whole draft session is discarded.
11. Individual source editors must not expose either the app-wide database-refresh action or a source-specific refresh override.
12. Individual source editors must not replace the dedicated back button with a different navigation pattern for the current scope.
13. Individual source editors must not interrupt the back-to-list action with a draft-confirmation prompt.
14. Individual source editors must not preserve or restore the previous source-list scroll position on return.
15. Managed rename modes must not expose raw `pattern` and `replacement` inputs in the source editor.
16. Switching away from `Custom` during a live draft session must not discard the current custom `pattern` and `replacement` values unless the whole draft session is discarded.
17. `Selected phrases` must not hide its phrase list entirely just because no parenthetical phrases were detected for the current draft.
18. Leaving and returning to `Selected phrases` during the same live draft session must not clear the currently checked phrases.
19. `Selected phrases` must not preserve checked phrases that are no longer present in the current detected phrase list.
20. Newly appeared detected phrases must not start prechecked when the current detected phrase list changes during a live draft session.
21. `Statistics` must not change solely because file checkbox selection changed.
22. Rename phrase analysis must not change solely because file checkbox selection changed.
23. Invalid custom regex `pattern` input must not fail without warning text below the input box.
24. The source-list save flow must not persist a draft containing an invalid custom regex.
25. Invalid ignore-glob input must not fail without warning text below the specific input row.
26. The source-list save flow must not persist a draft containing an invalid ignore glob.
