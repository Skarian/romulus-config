import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  commitSourceDocumentSavePreview,
  getSourceDocumentPaths,
  loadSourceDocument,
  prepareSourceDocumentSave,
} from "./sourceDocument";
import type { SourceDocument } from "./types";

const FIXTURE_REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("loadSourceDocument blocks unsupported editor features with exact messages", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Nested Files Source",
          subfolder: "nested",
          scope: {
            path: "/ROMs/",
            includeNestedFiles: true,
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
        {
          displayName: "Recursive Source",
          subfolder: "recursive",
          unarchive: {
            recursive: true,
            layout: {
              mode: "flat",
            },
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:BBB",
            },
          ],
        },
      ],
    });

    const result = loadSourceDocument(repoRoot);

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.blocked.groups, [
      {
        family: "unsupported-editor-features",
        heading: "Unsupported editor features",
        issues: [
          {
            family: "unsupported-editor-features",
            heading: "Unsupported editor features",
            code: "unsupported-include-nested-files",
            message:
              'Source "Nested Files Source" uses Include nested files, which this editor does not support yet.',
          },
          {
            family: "unsupported-editor-features",
            heading: "Unsupported editor features",
            code: "unsupported-recursive-unarchive",
            message:
              'Source "Recursive Source" uses Recursive unarchive, which this editor does not support yet.',
          },
        ],
      },
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadSourceDocument blocks duplicate sources using normalized scope identity", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Source One",
          subfolder: "one",
          scope: {
            path: "ROMs/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
            },
          ],
        },
        {
          displayName: "Source Two",
          subfolder: "two",
          scope: {
            path: "/ROMs/",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:SHARED",
              partName: "complete",
            },
          ],
        },
      ],
    });

    const result = loadSourceDocument(repoRoot);

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blocked.groups, [
      {
        family: "duplicate-sources",
        heading: "Duplicate sources",
        issues: [
          {
            family: "duplicate-sources",
            heading: "Duplicate sources",
            code: "duplicate-source",
            message:
              'Sources "Source One" and "Source Two" are duplicates because they share a magnet URL and the same scope.',
          },
        ],
      },
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadSourceDocument keeps repairable validation in editable state", () => {
  const repoRoot = createTempRepo();
  try {
    writeSourceDocument(repoRoot, {
      version: 1,
      entries: [
        {
          displayName: "Editable Source",
          subfolder: "editable",
          ignore: {
            glob: ["["],
          },
          rename: {
            pattern: "(",
            replacement: "$1",
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });

    const result = loadSourceDocument(repoRoot);

    assert.equal(result.status, "editable");
    assert.equal(result.entries.length, 1);
    assert.deepEqual(
      result.editable.validation.issues.map((issue) => issue.code),
      ["invalid-ignore-rule", "invalid-rename-rule"],
    );
    assert.equal(result.editable.validation.saveReadiness.status, "blocked");
    assert.deepEqual(
      result.editable.validation.saveReadiness.blockers.map((blocker) => blocker.code),
      ["repairable-validation", "repairable-validation"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("prepareSourceDocumentSave normalizes the preview and commit writes the exact preview text", () => {
  const repoRoot = createTempRepo();
  try {
    const { configPath, schemaPath } = getSourceDocumentPaths(repoRoot);
    const document: SourceDocument = {
      $schema: "./references/romulus/docs/schema.json",
      version: 1,
      entries: [
        {
          displayName: "Nintendo 64",
          subfolder: "n64",
          scope: {
            path: "ROMs/",
            includeNestedFiles: false,
          },
          unarchive: {
            recursive: false,
            layout: {
              mode: "flat",
              rename: {
                pattern: "^(.+)$",
                replacement: "$1",
              },
            },
          },
          ignore: {
            glob: [" *.txt ", "", "*.txt", " *.zip "],
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    };

    const result = prepareSourceDocumentSave(schemaPath, document);

    assert.equal(result.status, "ready");
    assert.deepEqual(result.preview.document, {
      $schema: "./references/romulus/docs/schema.json",
      version: 1,
      entries: [
        {
          displayName: "Nintendo 64",
          subfolder: "n64",
          scope: {
            path: "/ROMs/",
          },
          unarchive: {
            layout: {
              mode: "flat",
            },
          },
          ignore: {
            glob: ["*.txt", "*.zip"],
          },
          torrents: [
            {
              url: "magnet:?xt=urn:btih:AAA",
            },
          ],
        },
      ],
    });
    assert.match(result.preview.text, /\n$/);

    commitSourceDocumentSavePreview(configPath, result.preview);

    assert.equal(readFileSync(configPath, "utf8"), result.preview.text);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function createTempRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "romulus-source-document-"));
  const schemaTargetDirectory = path.join(repoRoot, "references/romulus/docs");
  mkdirSync(schemaTargetDirectory, { recursive: true });
  writeFileSync(
    path.join(schemaTargetDirectory, "schema.json"),
    readFileSync(
      path.join(FIXTURE_REPO_ROOT, "references/romulus/docs/schema.json"),
      "utf8",
    ),
    "utf8",
  );
  return repoRoot;
}

function writeSourceDocument(repoRoot: string, document: SourceDocument) {
  writeFileSync(
    path.join(repoRoot, "source.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}
