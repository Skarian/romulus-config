import type { RenameRule } from "./types";

export type ParentheticalPhraseStat = {
  phrase: string;
  count: number;
};

export type ParentheticalAnalysis = {
  totalFiles: number;
  withParenthesesCount: number;
  multiParenthesesCount: number;
  trueMiddleTextCount: number;
  trailingDotTitleCount: number;
  parentheticalPhrases: ParentheticalPhraseStat[];
  warnings: string[];
};

export type ManagedRenamePolicy =
  | {
      mode: "none";
      phrases: string[];
      isCustom: false;
    }
  | {
      mode: "all";
      phrases: string[];
      isCustom: false;
    }
  | {
      mode: "phrases";
      phrases: string[];
      isCustom: false;
    }
  | {
      mode: "custom";
      phrases: string[];
      isCustom: true;
    };

const ALL_SUFFIX_PATTERN = "^(.+?)[\\s.]*?(?:\\([^)]*\\)[\\s.]*)*(\\.[^.]+)$";
const ALL_SUFFIX_REPLACEMENT = "$1$2";
const SELECTIVE_PREFIX = "(?:[\\s.]*(?:";
const SELECTIVE_REPEAT_PREFIX = ")(?:\\s*(?:";
const SELECTIVE_AFTER_REPEAT = "))*(?:([\\s]+)";
const SELECTIVE_LOOKAHEAD_PREFIX = "(?=";
const SELECTIVE_END = "|(?:[\\s.]*(?=\\.[^.]+$))))";
const SELECTIVE_REPLACEMENT = "$1";
const SELECTIVE_IMPOSSIBLE_LOOKAHEAD = "\\b\\B";
const MANAGED_GROUP_PATTERN = "(?:\\([^)]*\\)|\\[[^\\]]*\\])";
const MANAGED_GROUP_SUFFIX_PATTERN = `(?:\\s*${MANAGED_GROUP_PATTERN})*`;
const SUPPORTED_SELECTED_PHRASE_PATTERN = /^(?:\([^)]*\)|\[[^\]]*\])$/;

export function analyzeParentheticalSuffixes(
  fileNames: string[],
): ParentheticalAnalysis {
  const phraseCounts = new Map<string, number>();
  let withParenthesesCount = 0;
  let multiParenthesesCount = 0;
  let trueMiddleTextCount = 0;
  let trailingDotTitleCount = 0;

  for (const fileName of fileNames) {
    const stem = stripExtension(fileName);
    const trailingMatches = trailingManagedGroupMatches(stem);
    if (trailingMatches.length > 0) {
      for (const phrase of trailingMatches) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
    const trailingParentheses = trailingParentheticalMatches(stem);
    if (trailingParentheses.length > 0) {
      withParenthesesCount += 1;
    }
    if (trailingParentheses.length > 1) {
      multiParenthesesCount += 1;
    }

    const firstMatch = stem.match(new RegExp(MANAGED_GROUP_PATTERN));
    if (firstMatch) {
      const firstMatchIndex = firstMatch.index ?? 0;
      const prefixBeforeFirstParenthetical = stem.slice(0, firstMatchIndex).trimEnd();
      const after = stem.slice(firstMatchIndex + firstMatch[0].length);
      const remainder = after.replace(new RegExp(`\\s*${MANAGED_GROUP_PATTERN}\\s*`, "g"), "");
      if (remainder.trim().length > 0) {
        trueMiddleTextCount += 1;
      }
      if (prefixBeforeFirstParenthetical.endsWith(".")) {
        trailingDotTitleCount += 1;
      }
    }
  }

  const parentheticalPhrases = [...phraseCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phrase, count]) => ({ phrase, count }));

  const warnings: string[] = [];
  if (fileNames.length === 0) {
    warnings.push("No files are available to analyze yet.");
  }
  if (parentheticalPhrases.length === 0 && fileNames.length > 0) {
    warnings.push("No removable trailing metadata phrases were observed in this source.");
  }
  if (trueMiddleTextCount > 0) {
    warnings.push(
      `${trueMiddleTextCount} file name(s) contain real text after the first removable metadata group. Exact phrase stripping is safer than All phrases here.`,
    );
  }
  if (trailingDotTitleCount > 0) {
    warnings.push(
      `${trailingDotTitleCount} file name(s) would lose a trailing title period in All phrases mode.`,
    );
  }

  return {
    totalFiles: fileNames.length,
    withParenthesesCount,
    multiParenthesesCount,
    trueMiddleTextCount,
    trailingDotTitleCount,
    parentheticalPhrases,
    warnings,
  };
}

export function buildManagedRenameRule(
  mode: ManagedRenamePolicy["mode"],
  phrases: string[],
  _availablePhrases: string[] = phrases,
): RenameRule | null {
  if (mode === "none" || mode === "custom") {
    return null;
  }

  if (mode === "all") {
    return {
      pattern: ALL_SUFFIX_PATTERN,
      replacement: ALL_SUFFIX_REPLACEMENT,
    };
  }

  const normalizedPhrases = normalizeSelectedPhrases(phrases);
  if (normalizedPhrases.length === 0) {
    return null;
  }
  const escapedSelectedPhrases = normalizedPhrases
    .map((phrase) => escapeRegex(phrase))
    .join("|");
  const normalizedAvailablePhrases = normalizeSelectedPhrases(_availablePhrases);
  const escapedUnselectedPhrases = normalizedAvailablePhrases
    .filter((phrase) => !normalizedPhrases.includes(phrase))
    .map((phrase) => escapeRegex(phrase))
    .join("|");
  const lookaheadBody =
    escapedUnselectedPhrases.length > 0
      ? `(?:${escapedUnselectedPhrases})${MANAGED_GROUP_SUFFIX_PATTERN}\\.[^.]+$`
      : SELECTIVE_IMPOSSIBLE_LOOKAHEAD;

  return {
    pattern: `${SELECTIVE_PREFIX}${escapedSelectedPhrases}${SELECTIVE_REPEAT_PREFIX}${escapedSelectedPhrases}${SELECTIVE_AFTER_REPEAT}${SELECTIVE_LOOKAHEAD_PREFIX}${lookaheadBody})${SELECTIVE_END}`,
    replacement: SELECTIVE_REPLACEMENT,
  };
}

export function detectManagedRenamePolicy(
  renameRule: RenameRule | null,
  availablePhrases: string[],
): ManagedRenamePolicy {
  if (!renameRule) {
    return {
      mode: "none",
      phrases: [],
      isCustom: false,
    };
  }

  if (
    renameRule.pattern === ALL_SUFFIX_PATTERN &&
    renameRule.replacement === ALL_SUFFIX_REPLACEMENT
  ) {
    return {
      mode: "all",
      phrases: normalizeSelectedPhrases(availablePhrases),
      isCustom: false,
    };
  }

  const parsedPhrases = parseSelectiveRenamePhrases(renameRule);
  if (parsedPhrases) {
    return {
      mode: "phrases",
      phrases: parsedPhrases,
      isCustom: false,
    };
  }

  return {
    mode: "custom",
    phrases: [],
    isCustom: true,
  };
}

export function applyManagedRenameRule(
  policy: Pick<ManagedRenamePolicy, "mode" | "phrases">,
  originalName: string,
  availablePhrases: string[] = policy.phrases,
): string {
  const rule = buildManagedRenameRule(policy.mode, policy.phrases, availablePhrases);
  if (!rule) {
    return originalName;
  }

  try {
    return originalName.replace(new RegExp(rule.pattern, "g"), rule.replacement);
  } catch {
    return originalName;
  }
}

function parseSelectiveRenamePhrases(renameRule: RenameRule) {
  if (renameRule.replacement !== SELECTIVE_REPLACEMENT) {
    return null;
  }
  if (
    !renameRule.pattern.startsWith(SELECTIVE_PREFIX) ||
    !renameRule.pattern.endsWith(SELECTIVE_END)
  ) {
    return null;
  }

  const innerPattern = renameRule.pattern.slice(
    SELECTIVE_PREFIX.length,
    renameRule.pattern.length - SELECTIVE_END.length,
  );
  const repeatIndex = innerPattern.indexOf(SELECTIVE_REPEAT_PREFIX);
  if (repeatIndex < 0) {
    return null;
  }
  const selectedPattern = innerPattern.slice(0, repeatIndex);
  const tail = innerPattern.slice(repeatIndex + SELECTIVE_REPEAT_PREFIX.length);
  const tailPrefix = `${selectedPattern}${SELECTIVE_AFTER_REPEAT}${SELECTIVE_LOOKAHEAD_PREFIX}`;
  if (!selectedPattern.trim().length || !tail.startsWith(tailPrefix)) {
    return null;
  }
  const lookaheadBody = tail.slice(tailPrefix.length);

  const parsedPhrases: string[] = [];

  for (const token of splitOnUnescapedPipe(selectedPattern)) {
    const phrase = unescapeRegex(token);
    if (!SUPPORTED_SELECTED_PHRASE_PATTERN.test(phrase)) {
      return null;
    }
    parsedPhrases.push(phrase);
  }

  if (!lookaheadBody.endsWith(")")) {
    return null;
  }

  const parsedSelectedPhrases = normalizeSelectedPhrases(parsedPhrases);
  const parsedUnselectedPhrases = parseSelectiveLookaheadPhrases(
    lookaheadBody.slice(0, -1),
  );
  if (parsedUnselectedPhrases === null) {
    return null;
  }
  if (parsedUnselectedPhrases.some((phrase) => parsedSelectedPhrases.includes(phrase))) {
    return null;
  }

  return parsedSelectedPhrases;
}

function splitOnUnescapedPipe(value: string) {
  const parts: string[] = [];
  let buffer = "";
  let escaping = false;

  for (const character of value) {
    if (escaping) {
      buffer += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      buffer += character;
      escaping = true;
      continue;
    }

    if (character === "|") {
      parts.push(buffer);
      buffer = "";
      continue;
    }

    buffer += character;
  }

  parts.push(buffer);
  return parts.filter((part) => part.length > 0);
}

function normalizeSelectedPhrases(phrases: string[]) {
  return [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))].sort();
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function trailingParentheticalMatches(stem: string) {
  const trailingSuffix = stem.match(/(?:\s*\([^)]*\)\s*)+$/)?.[0] ?? "";
  return trailingSuffix.match(/\([^)]*\)/g) ?? [];
}

function trailingManagedGroupMatches(stem: string) {
  const trailingSuffix = stem.match(new RegExp(`(?:\\s*${MANAGED_GROUP_PATTERN}\\s*)+$`))?.[0] ?? "";
  return trailingSuffix.match(new RegExp(MANAGED_GROUP_PATTERN, "g")) ?? [];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeRegex(value: string) {
  return value.replace(/\\([.*+?^${}()|[\]\\])/g, "$1");
}

function parseSelectiveLookaheadPhrases(value: string) {
  if (value === SELECTIVE_IMPOSSIBLE_LOOKAHEAD) {
    return [];
  }

  const suffix = `${MANAGED_GROUP_SUFFIX_PATTERN}\\.[^.]+$`;
  if (!value.startsWith("(?:") || !value.endsWith(suffix)) {
    return null;
  }

  const groupedPhrases = value.slice(3, value.length - suffix.length);
  if (!groupedPhrases.endsWith(")")) {
    return null;
  }
  const inner = groupedPhrases.slice(0, -1);
  if (!inner.trim().length) {
    return null;
  }

  const phrases: string[] = [];
  for (const token of splitOnUnescapedPipe(inner)) {
    const phrase = unescapeRegex(token);
    if (!SUPPORTED_SELECTED_PHRASE_PATTERN.test(phrase)) {
      return null;
    }
    phrases.push(phrase);
  }

  return normalizeSelectedPhrases(phrases);
}
