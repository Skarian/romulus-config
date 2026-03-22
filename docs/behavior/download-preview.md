# Download Preview Behavior

This draft records download-folder preview behavior. Persistence details for preview-backed state live in [`persistence-and-cache.md`](persistence-and-cache.md).

## Trigger

1. User opens the download-folder preview for one source.
2. User edits the saved `Sample File Extensions` policy.
3. User revisits a source or later valid source state that resolves to a previously seen content boundary.

## Expected Result

1. The saved `Sample File Extensions` policy is scoped to the supported MVP content boundary defined by:
   - normalized torrent set
   - normalized `scope.path`, with `/` treated as root
2. When the same source or a later valid source state resolves to that same content boundary, the editor reuses that same saved `Sample File Extensions` policy.
3. If the current content boundary needs `Sample File Extensions` for preview and no saved policy exists yet, the editor prompts the user for that policy immediately on entering the source editor.
4. The `Sample File Extensions` prompt uses helper text: `This source is configured to extract files from an archive. Enter the expected file extensions to populate the download preview.`
5. The `Sample File Extensions` input accepts a comma-separated list.
6. Each `Sample File Extensions` entry must start with a `.`.
7. Duplicate `Sample File Extensions` entries are validation errors.
8. Whitespace around comma-separated `Sample File Extensions` entries is trimmed automatically.
9. `Sample File Extensions` entries are normalized to lowercase automatically.
10. Saved `Sample File Extensions` preserve the user's entered order.
11. The `Sample File Extensions` input includes example placeholder text such as `.cue, .bin`.
12. An empty `Sample File Extensions` value keeps `Save` disabled.
13. Invalid non-empty `Sample File Extensions` input blocks save with inline validation and keeps the prompt open.
14. The `Sample File Extensions` prompt uses `Sample File Extensions` as its title.
15. The `Sample File Extensions` prompt uses `Save` as its primary action label.
16. The `Sample File Extensions` prompt uses `Cancel` as its secondary action label.
17. If the `Sample File Extensions` prompt was opened automatically on source-editor entry because the current content boundary requires it and no saved value exists yet, canceling the prompt returns the user to the source list.
18. If the `Sample File Extensions` prompt was opened from `Edit Sample File Extensions`, canceling the prompt closes it and keeps the user on the same source editor page.
19. Canceling the `Sample File Extensions` prompt preserves the rest of the current draft changes for that source.
20. Saving `Sample File Extensions` is an auxiliary local-state save and does not persist `source.json`.
21. A successful `Sample File Extensions` save closes the prompt immediately and keeps the user on the same source editor page.
22. A successful `Sample File Extensions` save shows a success toast with the message `Sample File Extensions saved`.
23. If saving `Sample File Extensions` fails because of an app or backend error, the app shows an error toast with the message `Could not save Sample File Extensions. Check the console for details.`
24. If saving `Sample File Extensions` fails, the underlying error is logged to the browser console.
25. If saving `Sample File Extensions` fails, the prompt stays open and preserves the user's current input so they can retry.
26. When archive extraction makes `Sample File Extensions` relevant, the `Download Folder Preview` section exposes an enabled button labeled `Edit Sample File Extensions`.
27. `Edit Sample File Extensions` opens the same prompt whether or not a value is already saved.
28. If a saved `Sample File Extensions` value exists, the prompt opens prefilled with that value.
29. If no saved `Sample File Extensions` value exists, the prompt opens with a blank input.
30. The preview remains usable by showing inferred default sample entries derived from the current `Sample File Extensions` policy.
31. The `Download Folder Preview` shows the current draft output names rather than the original source-file names.
32. The `Download Folder Preview` keeps the current simulator tree-style folder preview layout.
33. Search and filtering controls stay limited to the `Files List` and do not extend into the `Download Folder Preview`.
34. The `Download Folder Preview` updates live from the current draft rename, ignore, unarchive, and selection state.
35. If saved preview data is explicitly cleared while file cache remains available, affected sources still open normally, the saved `Sample File Extensions` policy is removed, and any required `Sample File Extensions` are prompted again when preview needs them.

## Failure Behavior

1. The editor must not silently merge the saved `Sample File Extensions` policy into a different content boundary.
2. The editor must not leave a preview that requires `Sample File Extensions` in a silent incomplete state when no saved policy exists.
3. The `Sample File Extensions` prompt must not be deferred until the user scrolls to or interacts with the `Download Folder Preview` section for the current scope.
4. The `Sample File Extensions` input must not switch to a different input style for the current scope.
5. The `Sample File Extensions` input must not accept entries that omit the leading `.` for the current scope.
6. The `Sample File Extensions` input must not silently dedupe duplicate entries for the current scope.
7. Whitespace-only differences between `Sample File Extensions` entries must not cause avoidable validation failures for the current scope.
8. `Sample File Extensions` entries must not preserve mixed-case values for the current scope.
9. Saved `Sample File Extensions` must not be reordered automatically for the current scope.
10. The `Sample File Extensions` prompt must not omit example placeholder text for the current scope.
11. An empty `Sample File Extensions` value must not leave `Save` enabled for the current scope.
12. Invalid non-empty `Sample File Extensions` input must not be accepted silently or close the prompt for the current scope.
13. The `Sample File Extensions` prompt must not use a different title for the current scope.
14. The `Sample File Extensions` prompt must not use an overlong primary action label for the current scope.
15. The `Sample File Extensions` prompt must not use a different secondary action label for the current scope.
16. The auto-open `Sample File Extensions` prompt must not trap the user inside the source editor when they choose to cancel for the current scope.
17. Canceling a prompt opened from `Edit Sample File Extensions` must not navigate away from the current source editor.
18. Canceling the `Sample File Extensions` prompt must not discard the source's other draft changes for the current scope.
19. A successful `Sample File Extensions` save must not leave the prompt open for the current scope.
20. A successful `Sample File Extensions` save must not complete silently or use different success-toast copy for the current scope.
21. A failed `Sample File Extensions` save must not complete silently or use different error-toast copy for the current scope.
22. A failed `Sample File Extensions` save must not omit logging the underlying error to the browser console for the current scope.
23. A failed `Sample File Extensions` save must not close the prompt or discard the user's current input for the current scope.
24. The `Download Folder Preview` section must not hide or disable the explicit `Edit Sample File Extensions` control when archive extraction makes it relevant in the current scope.
25. The `Download Folder Preview` section must not show `Edit Sample File Extensions` when archive extraction does not make it relevant in the current scope.
26. `Edit Sample File Extensions` must not open a different prompt flow depending on whether a value is already saved.
27. `Edit Sample File Extensions` must not fail to prefill the saved value when one exists.
28. `Edit Sample File Extensions` must not inject a synthetic default value when none is saved.
29. The `Download Folder Preview` must not fall back to showing original file names when the current draft output names differ.
30. The `Download Folder Preview` must not drift from the current simulator tree-style layout for the current scope.
31. The `Download Folder Preview` must not introduce its own search or filtering control for the current scope.
32. The `Download Folder Preview` must not lag behind or ignore the current draft rename, ignore, unarchive, or selection state.
33. The editor must not treat cleared preview data as if file-cache availability was also lost.
