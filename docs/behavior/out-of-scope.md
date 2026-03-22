# Out Of Scope Behavior

This draft records configuration and behavior that the convenience editor intentionally does not expose, even when the underlying `source.json` contract can represent it.

## Trigger

1. A maintainer needs a `source.json` setting that the convenience editor does not expose.
2. The editor encounters a valid source configuration that relies on an out-of-scope setting.

## Expected Result

1. Out-of-scope settings are documented explicitly instead of being left implicit.
2. For now, `scope.includeNestedFiles` is out of scope for the convenience editor.
3. The editor does not expose an `Include nested files` control.
4. Edited sources default `includeNestedFiles` behavior to `false`.
5. For now, `unarchive.recursive` is out of scope for the convenience editor.
6. The editor does not expose a `Recursive` unarchive control.
7. If loading or reloading `source.json` finds either `includeNestedFiles: true` or `unarchive.recursive: true`, the editor enters the blocked-document state defined in [`status-and-conflicts.md`](status-and-conflicts.md) instead of attempting partial editor support.
8. Maintainers who need `includeNestedFiles: true` or `unarchive.recursive: true` should edit `source.json` directly and then reload.

## Failure Behavior

1. The convenience editor must not pretend to support `includeNestedFiles` when it does not expose the setting.
2. The convenience editor must not pretend to support recursive unarchive when it does not expose the setting.
3. Out-of-scope settings must not be undocumented if the omission changes what maintainers can safely do in the editor.
4. The convenience editor must not silently continue in editable-document state when one of these unsupported editor features is present on load or reload.
