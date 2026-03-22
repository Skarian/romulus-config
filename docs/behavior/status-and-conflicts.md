# Status And Conflicts Behavior

This draft records invalid states, prompts, and conflict handling. Surface docs may refer here instead of restating the same recovery rules.

## Trigger

1. The editor loads or reloads `source.json`.
2. The editor encounters duplicate logical sources.
3. `source.json` changes on disk while a source is open in the editor.
4. The editor attempts to save after on-disk state may have changed.
5. The editor saves per-source auxiliary local state outside the main source-list save flow.
6. The editor saves the whole source-list draft back to `source.json`.

## Expected Result

1. The editor distinguishes two document states when loading or reloading `source.json`:
   - editable document
   - blocked document
2. The editor enters blocked-document state only when loading or reloading `source.json` finds one of these blocker families:
   - `Invalid source.json`
   - `Unsupported editor features`
   - `Duplicate sources`
3. `Invalid source.json` covers:
   - JSON parse failure
   - Romulus schema validation failure
   - unsupported `version`
4. `Unsupported editor features` covers only:
   - `scope.includeNestedFiles: true`
   - `unarchive.recursive: true`
5. `Duplicate sources` covers any pair of sources that share at least one normalized magnet URL and the same normalized scope path, with `/` treated as root.
6. In blocked-document state, the app keeps the normal shell visible but replaces the source-list body with a blocking recovery panel.
7. That blocking recovery panel uses this exact shell copy:
   - title: `Editor Unavailable`
   - body: `This editor cannot open the current source.json until the issues below are fixed. Edit source.json directly, then reload.`
8. The blocking recovery panel groups issues under only these category headings:
   - `Invalid source.json`
   - `Unsupported editor features`
   - `Duplicate sources`
9. The blocking recovery panel uses these item-level messages:
   - `source.json could not be parsed as valid JSON.`
   - `source.json does not match the required Romulus format.`
   - `source.json version "{value}" is not supported.`
   - `Source "{name}" uses Include nested files, which this editor does not support yet.`
   - `Source "{name}" uses Recursive unarchive, which this editor does not support yet.`
   - `Sources "{A}" and "{B}" are duplicates because they share a magnet URL and the same scope.`
10. While blocked-document state is active, the source-list page keeps the manual `Reload source.json` path available as the manual recovery action.
11. Validation problems inside the supported editor surface, such as invalid custom regexes, invalid ignore globs, or invalid supported field values, do not enter blocked-document state; they load into the editor and block save until fixed.
12. Duplicate logical sources are invalid editor state.
13. If `source.json` changes outside the editor while a draft session exists, the editor shows an app-wide prompt before reloading from disk, regardless of whether the maintainer is on the source-list page or inside an individual source editor.
14. That app-wide external-change prompt is distinct from the manual `Reload source.json` control, which remains source-list-only.
15. If the user declines that reload prompt, the current in-memory draft remains active.
16. If the user later saves from the source-list page after declining reload, the editor allows that save to overwrite disk.
17. Duplicate rejection uses a user-friendly explanation rather than a schema-level or internal-validator message.
18. When duplicate detection happens during new-source creation, the editor blocks creation inline and keeps the new-source modal open.
19. Per-source auxiliary local-state saves that do not persist `source.json`, such as `Sample File Extensions`, show a success toast when they complete successfully.
20. If a per-source auxiliary local-state save fails, the app shows an error toast telling the maintainer to check the browser console for more detail.
21. If a per-source auxiliary local-state save fails, the underlying error is logged to the browser console.
22. The main source-list save opens a confirmation modal before writing `source.json`.
23. That main-save confirmation modal includes a collapsible read-only preview of the exact post-normalization `source.json` content that will be written if the maintainer confirms the save.
24. If another flow, such as `Refresh Database`, initiates `Save now`, it still goes through that same main-save confirmation modal rather than bypassing it.
25. If the main source-list save succeeds, the app shows a success toast with the message `Changes saved to source.json`.
26. If the main source-list save fails, the app shows an error toast with the message `Could not save changes. Check the console for details.`
27. If the main source-list save fails, the underlying error is logged to the browser console.
28. If the main source-list save fails, the current in-memory draft remains active instead of being discarded.

## Failure Behavior

1. The editor must not promote every detectable validation problem into blocked-document state.
2. Blocked-document state must not use any category headings other than `Invalid source.json`, `Unsupported editor features`, and `Duplicate sources`.
3. Blocked-document state must not hide the user-friendly issue messages behind raw validator output.
4. The blocked-document recovery panel must not hide the manual `Reload source.json` path on the source-list page.
5. Duplicate logical sources must block continued editor use for that invalid state until the conflict is resolved.
6. The editor must not silently discard a live draft because `source.json` changed on disk.
7. Duplicate detection must not treat `displayName`, `subfolder`, or torrent `partName` differences as enough to bypass the duplicate rejection.
8. Duplicate detection during source creation must not silently close the new-source modal or admit the duplicate into the current UI draft.
9. The editor must not block save merely because disk changed if the user has already declined reload and chosen to keep the current draft active.
10. Per-source auxiliary local-state saves must not fail silently.
11. Per-source auxiliary local-state save failures must not omit logging the underlying error to the browser console.
12. Per-source auxiliary local-state saves must not complete successfully without user-visible success feedback.
13. The main source-list save must not write directly to disk without its confirmation modal.
14. Flows such as `Refresh Database` must not bypass that main save-confirmation modal when they request `Save now`.
15. The main source-list save must not fail silently.
16. The main source-list save failure path must not omit logging the underlying error to the browser console.
17. The main source-list save failure path must not discard the current in-memory draft.
