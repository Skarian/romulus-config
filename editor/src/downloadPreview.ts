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
  pathKey: string;
  kind: "folder" | "file";
  children: PreviewTreeNode[];
};

type MutablePreviewTreeNode = PreviewTreeNode & {
  rawName: string;
  renameEffects: Array<(nextName: string) => void>;
  children: MutablePreviewTreeNode[];
};

export type ArchiveFixtureSampleDescriptor = PreviewFixtureSample & {
  generated: boolean;
  outputName: string;
  outputPathKey: string | null;
};

export type ArchiveFixtureDescriptor = {
  fixtureKey: string;
  sourceFileId: string | null;
  archiveDisplayName: string;
  archiveBaseName: string;
  baseSegments: string[];
  outerFolderName: string | null;
  outerFolderPathKey: string | null;
  customSamples: PreviewFixtureSample[];
  samples: ArchiveFixtureSampleDescriptor[];
};

export function buildDownloadPreview(
  entry: PreviewEntry,
  sourceFiles: SourceFilesState | null,
  selectedRows: SourceFileRow[],
): {
  tree: PreviewTreeNode;
  archiveFixtures: ArchiveFixtureDescriptor[];
} {
  const root = createTreeNode("", "/", "/", "folder");
  const archiveFixtures: ArchiveFixtureDescriptor[] = [];
  const fixtureMap = new Map(
    (sourceFiles?.previewFixtures ?? []).map((fixture) => [fixture.fixtureKey, fixture]),
  );
  const archiveSampleExtensions = sourceFiles?.archiveSampleExtensions ?? [];

  if (!sourceFiles) {
    return {
      tree: root,
      archiveFixtures,
    };
  }

  const baseNode = getOrCreateSharedFolderPath(root, normalizeSegments(entry.subfolder));
  const baseSegments = baseNode.pathKey.length === 0 ? [] : baseNode.pathKey.split("/");

  for (const row of selectedRows) {
    if (row.isArchiveCandidate && entry.unarchive) {
      appendArchiveFixtureToTree({
        entry,
        fixtureMap,
        archiveSampleExtensions,
        archiveFixtures,
        descriptor:
          resolveRootArchiveFixtureDescriptor(
            entry,
            fixtureMap,
            archiveSampleExtensions,
            row,
            baseSegments,
          ),
        baseNode,
      });
      continue;
    }

    insertUniqueChild(
      baseNode,
      finalOutputName(entry, row.originalName, null),
      "file",
    );
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
    samples: [],
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

function createTreeNode(
  pathKey: string,
  displayName: string,
  rawName: string,
  kind: "folder" | "file",
): MutablePreviewTreeNode {
  return {
    name: displayName,
    rawName,
    pathKey,
    kind,
    renameEffects: [],
    children: [],
  };
}

function describeFixture(
  entry: PreviewEntry,
  fixture: PreviewFixture,
  baseSegments: string[],
  archiveSampleExtensions: string[],
): ArchiveFixtureDescriptor {
  const generatedSamples = archiveSampleExtensions.map((extension) => ({
    id: `generated:${extension}`,
    originalName: `${fixture.archiveBaseName}${extension}`,
    relativeDirectory: "",
    outputNameOverride: null,
    generated: true,
  }));
  const customSamples = fixture.samples.map((sample) => ({
    ...sample,
    generated: false,
  }));
  const fixtureSamples = [...generatedSamples, ...customSamples];

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
    outerFolderPathKey: null,
    customSamples: [...fixture.samples],
    samples: fixtureSamples.map((sample) => ({
      ...sample,
      outputName: finalOutputName(
        entry,
        sample.originalName,
        sample.outputNameOverride,
        !isSupportedArchiveName(sample.originalName),
      ),
      outputPathKey: null,
    })),
  };
}

function resolveRootArchiveFixtureDescriptor(
  entry: PreviewEntry,
  fixtureMap: Map<string, PreviewFixture>,
  archiveSampleExtensions: string[],
  row: SourceFileRow,
  baseSegments: string[],
) {
  const fixtureKey = previewFixtureKey(entry.hydrationKey, row.id);
  const fixture =
    fixtureMap.get(fixtureKey) ??
    defaultArchiveFixture(entry, fixtureKey, row.id, row.originalName);
  return describeFixture(entry, fixture, baseSegments, archiveSampleExtensions);
}

function appendArchiveFixtureToTree({
  entry,
  fixtureMap,
  archiveSampleExtensions,
  archiveFixtures,
  descriptor,
  baseNode,
}: {
  entry: PreviewEntry;
  fixtureMap: Map<string, PreviewFixture>;
  archiveSampleExtensions: string[];
  archiveFixtures: ArchiveFixtureDescriptor[];
  descriptor: ArchiveFixtureDescriptor;
  baseNode: MutablePreviewTreeNode;
}) {
  archiveFixtures.push(descriptor);
  const outputBaseNode = descriptor.outerFolderName
    ? insertUniqueChild(baseNode, descriptor.outerFolderName, "folder", (nextName) => {
        descriptor.outerFolderName = nextName;
      })
    : baseNode;
  descriptor.outerFolderPathKey =
    outputBaseNode.kind === "folder" && descriptor.outerFolderName
      ? outputBaseNode.pathKey
      : null;
  descriptor.baseSegments = baseNode.pathKey.length === 0 ? [] : baseNode.pathKey.split("/");

  for (const sample of descriptor.samples) {
    sample.outputPathKey = null;

    if (entry.unarchive?.recursive && isArchiveCandidateName(sample.originalName)) {
      const nestedFixtureKey = nestedPreviewFixtureKey(descriptor.fixtureKey, sample.id);
      const nestedFixture =
        fixtureMap.get(nestedFixtureKey) ??
        defaultArchiveFixture(entry, nestedFixtureKey, null, sample.originalName);
      appendArchiveFixtureToTree({
        entry,
        fixtureMap,
        archiveSampleExtensions,
        archiveFixtures,
        descriptor: describeFixture(
          entry,
          nestedFixture,
          outputBaseNode.pathKey.length === 0 ? [] : outputBaseNode.pathKey.split("/"),
          archiveSampleExtensions,
        ),
        baseNode: outputBaseNode,
      });
      continue;
    }

    const sampleNode = insertUniqueChild(
      outputBaseNode,
      sample.outputName,
      "file",
      (nextName) => {
        sample.outputName = nextName;
      },
    );
    sample.outputPathKey = sampleNode.pathKey;
  }
}

function nestedPreviewFixtureKey(parentFixtureKey: string, sampleId: string) {
  return `${parentFixtureKey}::sample:${sampleId}`;
}

function getOrCreateSharedFolderPath(root: MutablePreviewTreeNode, segments: string[]) {
  let pointer = root;
  for (const segment of segments) {
    const pointerChildren = pointer.children as MutablePreviewTreeNode[];
    let child = pointerChildren.find(
      (candidate) => candidate.rawName === segment && candidate.kind === "folder",
    );
    if (!child) {
      child = createTreeNode(
        buildPathKey(pointer.pathKey, segment),
        segment,
        segment,
        "folder",
      );
      pointerChildren.push(child);
    }
    pointer = child;
  }
  return pointer;
}

function insertUniqueChild(
  parent: MutablePreviewTreeNode,
  rawName: string,
  kind: "folder" | "file",
  onRename?: (nextName: string) => void,
) {
  const parentChildren = parent.children as MutablePreviewTreeNode[];
  const siblings = parentChildren.filter(
    (candidate) => candidate.kind === kind && candidate.rawName === rawName,
  );
  if (siblings.length === 0) {
    const child = createTreeNode(
      buildPathKey(parent.pathKey, rawName),
      rawName,
      rawName,
      kind,
    );
    if (onRename) {
      child.renameEffects.push(onRename);
    }
    parentChildren.push(child);
    return child;
  }

  if (siblings.length === 1 && siblings[0].name === rawName) {
    renameTreeNode(siblings[0], formatDuplicateName(rawName, 1));
  }

  const duplicateIndex = siblings.length + 1;
  const displayName = formatDuplicateName(rawName, duplicateIndex);
  const child = createTreeNode(
    buildPathKey(parent.pathKey, displayName),
    displayName,
    rawName,
    kind,
  );
  if (onRename) {
    child.renameEffects.push(onRename);
  }
  parentChildren.push(child);
  return child;
}

function renameTreeNode(node: MutablePreviewTreeNode, nextName: string) {
  node.name = nextName;
  node.renameEffects.forEach((effect) => effect(nextName));
}

function formatDuplicateName(rawName: string, duplicateIndex: number) {
  const extensionMatch = rawName.match(/(\.[^.]+)$/);
  if (!extensionMatch || rawName.startsWith(".")) {
    return `${rawName} (${duplicateIndex})`;
  }
  const extension = extensionMatch[0];
  const stem = rawName.slice(0, -extension.length);
  return `${stem} (${duplicateIndex})${extension}`;
}

function buildPathKey(parentPathKey: string, segment: string) {
  return parentPathKey.length === 0 ? segment : `${parentPathKey}/${segment}`;
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
