import { makeRe, minimatch } from "minimatch";

const MATCH_OPTIONS = {
  dot: true,
  nocomment: true,
  noext: true,
  nonegate: true,
};

export function compileIgnoreMatcher(ignoreGlobs: string[]) {
  const patterns = ignoreGlobs.map((pattern) => normalizeIgnorePattern(pattern));
  return (filename: string) => {
    const normalizedFilename = normalizeIgnoreCandidate(filename);
    return patterns.some((pattern) =>
      minimatch(normalizedFilename, pattern, MATCH_OPTIONS),
    );
  };
}

export function isValidIgnoreRule(pattern: string) {
  const normalizedPattern = normalizeIgnorePattern(pattern);
  if (normalizedPattern.length === 0) {
    return false;
  }
  if (!hasBalancedCharacterClasses(normalizedPattern)) {
    return false;
  }

  try {
    return makeRe(normalizedPattern, MATCH_OPTIONS) !== false;
  } catch {
    return false;
  }
}

function normalizeIgnorePattern(pattern: string) {
  return pattern.trim().toLowerCase();
}

function normalizeIgnoreCandidate(filename: string) {
  return filename.toLowerCase();
}

function hasBalancedCharacterClasses(pattern: string) {
  let insideCharacterClass = false;

  for (const character of pattern) {
    if (character === "[") {
      if (insideCharacterClass) {
        return false;
      }
      insideCharacterClass = true;
      continue;
    }
    if (character === "]") {
      if (!insideCharacterClass) {
        return false;
      }
      insideCharacterClass = false;
    }
  }

  return !insideCharacterClass;
}
