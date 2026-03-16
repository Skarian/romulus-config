import type {
  PreviewEntry,
  PreviewFixture,
  PreviewFixtureSample,
  SourceFileRow,
  SourceFilesState,
} from "./types";
import { archiveBaseName, isSupportedArchiveName } from "./archiveSupport";

export type PreviewTreeNode = {
  name: string;
  kind: "folder" | "file";
  children: PreviewTreeNode[];
};

export type ArchiveFixtureDescriptor = {
  fixtureKey: string;
  sourceFileId: string | null;
  archiveDisplayName: string;
  archiveBaseName: string;
  baseSegments: string[];
  outerFolderName: string | null;
  samples: Array<PreviewFixtureSample & { outputName: string }>;
};

export function buildDownloadPreview(
  entry: PreviewEntry,
  sourceFiles: SourceFilesState | null,
  selectedRows: SourceFileRow[],
): {
  tree: PreviewTreeNode;
  archiveFixtures: ArchiveFixtureDescriptor[];
} {
  const root: PreviewTreeNode = {
    name: "/",
    kind: "folder",
    children: [],
  };
  const archiveFixtures: ArchiveFixtureDescriptor[] = [];
  const fixtureMap = new Map(
    (sourceFiles?.previewFixtures ?? []).map((fixture) => [fixture.fixtureKey, fixture]),
  );

  if (!sourceFiles) {
    return {
      tree: root,
      archiveFixtures,
    };
  }

  for (const row of selectedRows) {
    if (row.isArchiveCandidate && entry.unarchive) {
      appendArchiveFixtureToTree({
        root,
        entry,
        fixtureMap,
        archiveFixtures,
        descriptor:
          resolveRootArchiveFixtureDescriptor(entry, sourceFiles, fixtureMap, row),
        baseSegments: archiveBaseSegments(entry, sourceFiles, row),
      });
      continue;
    }

    if (row.kind === "archive") {
      insertPath(root, [...normalizeSegments(entry.subfolder), finalOutputName(entry, row.originalName, null)]);
      continue;
    }

    insertPath(root, [
      ...normalizeSegments(entry.subfolder),
      finalOutputName(entry, row.originalName, null),
    ]);
  }

  sortTree(root);
  return {
    tree: root,
    archiveFixtures,
  };
}

export function defaultStandardArchiveFixture(
  entry: PreviewEntry,
  row: SourceFileRow,
): PreviewFixture {
  return defaultArchiveFixture(
    entry,
    previewFixtureKey(entry.hydrationKey, row.id),
    row.id,
    row.originalName,
  );
}

export function defaultArchiveFixture(
  entry: PreviewEntry,
  fixtureKey: string,
  sourceFileId: string | null,
  archiveDisplayName: string,
): PreviewFixture {
  return {
    fixtureKey,
    sourceFileId,
    archiveDisplayName,
    archiveBaseName: archiveBaseName(archiveDisplayName),
    samples:
      entry.unarchive?.layout.mode === "flat"
        ? [
            {
              id: "default",
              originalName: `[${archiveBaseName(archiveDisplayName)}]`,
              relativeDirectory: "",
              outputNameOverride: null,
            },
          ]
        : [],
    updatedAt: "",
  };
}

export function previewFixtureKey(
  hydrationKey: string,
  sourceFileId: string | null,
) {
  return sourceFileId === null
    ? `${hydrationKey}::archive-scope`
    : `${hydrationKey}::${sourceFileId}`;
}

export function finalOutputName(
  entry: PreviewEntry,
  originalName: string,
  _outputNameOverride: string | null,
  renameEligible = true,
) {
  return renameEligible
    ? applyRenameRule(entry.renameRule, originalName)
    : originalName;
}

export function applyRenameRule(
  rule: PreviewEntry["renameRule"],
  originalName: string,
) {
  if (!rule) {
    return originalName;
  }

  try {
    return originalName.replace(new RegExp(rule.pattern, "g"), rule.replacement);
  } catch {
    return originalName;
  }
}

function describeFixture(
  entry: PreviewEntry,
  fixture: PreviewFixture,
  baseSegments: string[],
): ArchiveFixtureDescriptor {
  const fixtureSamples =
    entry.unarchive?.layout.mode === "flat" && fixture.samples.length === 0
      ? [
          {
            id: "default",
            originalName: `[${fixture.archiveBaseName}]`,
            relativeDirectory: "",
            outputNameOverride: null,
          },
        ]
      : fixture.samples;

  return {
    fixtureKey: fixture.fixtureKey,
    sourceFileId: fixture.sourceFileId,
    archiveDisplayName: fixture.archiveDisplayName,
    archiveBaseName: fixture.archiveBaseName,
    baseSegments,
    outerFolderName:
      entry.unarchive?.layout.mode === "dedicatedFolder"
        ? applyRenameRule(
            entry.unarchive.layout.rename ?? null,
            fixture.archiveBaseName,
          )
        : null,
    samples: fixtureSamples.map((sample) => ({
      ...sample,
      outputName: finalOutputName(
        entry,
        sample.originalName,
        sample.outputNameOverride,
        !isSupportedArchiveName(sample.originalName),
      ),
    })),
  };
}

function insertPath(root: PreviewTreeNode, segments: string[]) {
  let pointer = root;
  for (const [index, segment] of segments.entries()) {
    const kind = index === segments.length - 1 ? "file" : "folder";
    let child = pointer.children.find(
      (candidate) => candidate.name === segment && candidate.kind === kind,
    );
    if (!child) {
      child = {
        name: segment,
        kind,
        children: [],
      };
      pointer.children.push(child);
    }
    pointer = child;
  }
}

function resolveRootArchiveFixtureDescriptor(
  entry: PreviewEntry,
  sourceFiles: SourceFilesState,
  fixtureMap: Map<string, PreviewFixture>,
  row: SourceFileRow,
) {
  const baseSegments = archiveBaseSegments(entry, sourceFiles, row);
  const fixtureKey = previewFixtureKey(entry.hydrationKey, row.id);
  const fixture =
    fixtureMap.get(fixtureKey) ??
    defaultArchiveFixture(entry, fixtureKey, row.id, row.originalName);
  return describeFixture(entry, fixture, baseSegments);
}

function appendArchiveFixtureToTree({
  root,
  entry,
  fixtureMap,
  archiveFixtures,
  descriptor,
  baseSegments,
}: {
  root: PreviewTreeNode;
  entry: PreviewEntry;
  fixtureMap: Map<string, PreviewFixture>;
  archiveFixtures: ArchiveFixtureDescriptor[];
  descriptor: ArchiveFixtureDescriptor;
  baseSegments: string[];
}) {
  archiveFixtures.push(descriptor);
  const outputBaseSegments = descriptor.outerFolderName
    ? [...baseSegments, descriptor.outerFolderName]
    : baseSegments;

  if (descriptor.outerFolderName) {
    ensureFolderPath(root, outputBaseSegments);
  }

  for (const sample of descriptor.samples) {
    const sampleBaseSegments = outputBaseSegments;

    if (entry.unarchive?.recursive && isArchiveCandidateName(sample.originalName)) {
      const nestedFixtureKey = nestedPreviewFixtureKey(descriptor.fixtureKey, sample.id);
      const nestedFixture =
        fixtureMap.get(nestedFixtureKey) ??
        defaultArchiveFixture(entry, nestedFixtureKey, null, sample.originalName);
      appendArchiveFixtureToTree({
        root,
        entry,
        fixtureMap,
        archiveFixtures,
        descriptor: describeFixture(entry, nestedFixture, sampleBaseSegments),
        baseSegments: sampleBaseSegments,
      });
      continue;
    }

    insertPath(root, [...sampleBaseSegments, sample.outputName]);
  }
}

function archiveBaseSegments(
  entry: PreviewEntry,
  _sourceFiles: SourceFilesState,
  _row: SourceFileRow,
) {
  return normalizeSegments(entry.subfolder);
}

function nestedPreviewFixtureKey(parentFixtureKey: string, sampleId: string) {
  return `${parentFixtureKey}::sample:${sampleId}`;
}

function ensureFolderPath(root: PreviewTreeNode, segments: string[]) {
  let pointer = root;
  for (const segment of segments) {
    let child = pointer.children.find(
      (candidate) => candidate.name === segment && candidate.kind === "folder",
    );
    if (!child) {
      child = {
        name: segment,
        kind: "folder",
        children: [],
      };
      pointer.children.push(child);
    }
    pointer = child;
  }
}

function normalizeSegments(input: string) {
  return input
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isArchiveCandidateName(pathValue: string) {
  return isSupportedArchiveName(pathValue);
}

function sortTree(node: PreviewTreeNode) {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortTree);
}
