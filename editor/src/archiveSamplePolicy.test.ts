import assert from "node:assert/strict";
import test from "node:test";

import { validateArchiveSampleExtensionsInput } from "./archiveSamplePolicy";

test("validateArchiveSampleExtensionsInput normalizes valid entries without reordering them", () => {
  const result = validateArchiveSampleExtensionsInput(" .CUE, .bin , .Iso ");

  assert.deepEqual(result, {
    canSave: true,
    error: null,
    fileExtensions: [".cue", ".bin", ".iso"],
  });
});

test("validateArchiveSampleExtensionsInput disables save for an empty value", () => {
  const result = validateArchiveSampleExtensionsInput("   ");

  assert.deepEqual(result, {
    canSave: false,
    error: null,
    fileExtensions: [],
  });
});

test("validateArchiveSampleExtensionsInput rejects entries without a leading dot", () => {
  const result = validateArchiveSampleExtensionsInput(".cue, bin");

  assert.deepEqual(result, {
    canSave: false,
    error: "Each file extension must start with a .",
    fileExtensions: [".cue", "bin"],
  });
});

test("validateArchiveSampleExtensionsInput rejects duplicate entries", () => {
  const result = validateArchiveSampleExtensionsInput(".cue, .bin, .cue");

  assert.deepEqual(result, {
    canSave: false,
    error: "Duplicate file extensions are not allowed.",
    fileExtensions: [".cue", ".bin", ".cue"],
  });
});
