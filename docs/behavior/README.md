# Behavior Docs

This folder captures repo-local behavior specs for the config editor and simulator.

These docs are intended to stabilize product behavior before the active ExecPlan is revised or executed.

## How To Read These Files

Each spec is written as:
1. Trigger
2. Expected result
3. Failure behavior

While behavior is still being defined, specs may also include `Open Questions`.

Keep user-surface behavior in the surface docs and shared rules in the cross-cutting docs. Do not let one file accumulate both the full UI workflow and all persistence or conflict rules.

## Specs

1. [`app-shell.md`](app-shell.md)
   Responsibilities: top-level app structure, shared header behavior, and global controls that are not owned by one page.
2. [`source-list.md`](source-list.md)
   Responsibilities: source-list entrypoint, open or create or delete or reorder actions, and how the list hands off into the editor workflow.
3. [`source-editor.md`](source-editor.md)
   Responsibilities: whole-source draft editing, save flow, undo or redo semantics, external reload prompt entrypoint, and raw custom regex editing.
4. [`files-and-selection.md`](files-and-selection.md)
   Responsibilities: hydrated file rows, search and filtering behavior, checkbox state, and how file selection follows equivalent content boundaries.
5. [`download-preview.md`](download-preview.md)
   Responsibilities: download-folder preview behavior, `Sample File Extensions`, and preview reuse across equivalent content boundaries.
6. [`source-contract.md`](source-contract.md)
   Responsibilities: the editor-facing `source.json` contract, supported shapes, and source-level invalid states that are about the document itself rather than one screen.
7. [`persistence-and-cache.md`](persistence-and-cache.md)
   Responsibilities: DB-backed cache identity, hydrated inventory reuse, content-boundary keys, and what local state is shared or persisted.
8. [`status-and-conflicts.md`](status-and-conflicts.md)
   Responsibilities: validation states, duplicate-source handling, stale-write rules, external-disk-change conflict handling, shared save-feedback patterns, and recovery prompts or blocked states.
9. [`out-of-scope.md`](out-of-scope.md)
   Responsibilities: valid or potentially useful configuration/settings that the convenience editor intentionally does not expose, plus the required fallback guidance to edit `source.json` directly and the rejection behavior for existing sources that rely on those settings.
