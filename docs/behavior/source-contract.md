# Source Contract Behavior

This draft records the editor-facing `source.json` contract for the convenience editor's supported subset of the real Romulus source model.

## Trigger

1. User opens or saves `source.json` through the editor.
2. The editor reads a source whose rename rules are managed or custom.
3. The editor encounters source definitions that conflict at the logical-source level.

## Expected Result

1. The editor targets the real `source.json` contract rather than a editor-only document shape.
2. When loading or reloading `source.json`, the editor treats the document as either editable or blocked according to [`status-and-conflicts.md`](status-and-conflicts.md).
3. Blocked-document state is reserved for only three blocker families:
   - `Invalid source.json`
   - `Unsupported editor features`
   - `Duplicate sources`
4. `Invalid source.json` covers JSON parse failure, Romulus schema validation failure, and unsupported `version`.
5. `Unsupported editor features` covers only `scope.includeNestedFiles: true` and `unarchive.recursive: true`.
6. Duplicate logical sources are invalid source state.
7. Two sources are duplicates when they share at least one normalized magnet URL and also share the same normalized scope path, with `/` treated as root.
8. `displayName`, `subfolder`, and torrent `partName` do not contribute to duplicate-source identity.
9. Validation problems inside the supported editor surface, such as invalid custom regexes, invalid ignore globs, or invalid supported field values, do not become blocked-document reasons; they load into the editor and remain unsavable until fixed.
10. Raw custom rename regex values are first-class editor data. The editor must show them and allow direct editing through the `Custom` rename mode.
11. Managed rename modes do not expose their raw regex `pattern` and `replacement` values in the UI.
12. The editor's source-list page supports editing the structural fields that define a source before the workbench page:
   - `displayName`
   - `subfolder`
   - `Path` for `scope.path`
   - `torrents`
13. Within `torrents`, the editor supports editable magnet URL values plus required `partName`.
14. In the editor UI, `Path` is the required field for `scope.path`.
15. The editor treats `/` as the root-path value.
16. The editor's `Path` input is a simple text field that accepts either a directory path or an exact `.zip` archive path.
17. The editor does not currently expose `includeNestedFiles`; edited scope behavior defaults to `false`.
18. For the supported MVP editor surface, local-state reuse keys are defined by normalized torrent set plus normalized scope path, with `/` treated as root.
19. Top-level file rename supports four editor modes:
    - `No rename`
    - `All phrases`
    - `Selected phrases`
    - `Custom`
20. `No rename` means the managed editor path applies no top-level `entry.rename` rule.
21. `All phrases` analyzes observed parenthetical groups across the full file name and generates one canonical managed regex or replacement pair that strips parenthetical groups throughout the file name, not just trailing suffix groups.
22. `Selected phrases` analyzes observed parenthetical groups across the full file name, shows the observed phrase list in descending order by frequency, and generates one canonical managed regex or replacement pair that strips only the selected phrases throughout the file name.
23. `Custom` accepts any schema-valid `pattern` plus `replacement` pair.
24. If `source.json` contains an invalid custom regex on initial load, that source still opens in the convenience editor instead of blocking the entire document.
25. An initially loaded invalid custom regex opens in `Custom` mode with warning treatment and remains unsavable until fixed.
26. Ignore rules support raw arbitrary glob editing as long as each glob is schema/runtime-valid.
27. Unarchive supports editor controls for:
    - enable or disable
    - `flat` versus `dedicatedFolder`
    - dedicated-folder rename
28. Unarchive `recursive` is out of scope for the convenience editor for now.
29. Dedicated-folder rename mirrors top-level file rename exactly:
    - `No rename`
    - `All phrases`
    - `Selected phrases`
    - `Custom`
30. Dedicated-folder rename uses the same full-name parenthetical-group stripping semantics, descending-frequency selected phrase ordering, and `Custom` schema-valid pattern plus replacement allowance as top-level file rename.
31. Exact `.zip` scope paths and their archive-selection behavior remain in scope for the editor conversion.
32. Detailed file-row behavior for exact `.zip` scope archive-selection sources lives in [`files-and-selection.md`](files-and-selection.md).
33. Managed rename detection recognizes only the canonical `All phrases` rule and canonical `Selected phrases` rules; any other valid rename rule is treated as `Custom`.
34. That first-page structural subset is intentionally supported so the source can establish cacheable identity before the user reaches the next page.

## Failure Behavior

1. The editor must not hide or discard an existing raw custom rename regex just because it does not match a managed rename mode.
2. Duplicate logical sources must not be treated as valid document state.
3. Settings intentionally excluded from the convenience editor should be documented in [`out-of-scope.md`](out-of-scope.md) instead of being silently ignored.
4. Blocked-document state must not be triggered by supported-surface validation problems that the editor can show and repair.
5. Managed rename modes must not expose raw `pattern` and `replacement` fields in the UI.
6. An initially loaded invalid custom regex must not be treated as a reason to block the entire convenience editor.
