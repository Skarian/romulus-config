import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeParentheticalSuffixes,
  applyManagedRenameRule,
  buildManagedRenameRule,
  detectManagedRenamePolicy,
} from "./policyAnalysis";

test("analyzeParentheticalSuffixes reports phrase frequencies and warnings", () => {
  const analysis = analyzeParentheticalSuffixes([
    "Lucky Luke (Europe) (En,Fr,De,Es).zip",
    "Out of Gas (USA).zip",
    "Super Mario Bros. (World).zip",
  ]);

  assert.equal(analysis.totalFiles, 3);
  assert.equal(analysis.withParenthesesCount, 3);
  assert.equal(analysis.multiParenthesesCount, 1);
  assert.equal(analysis.trueMiddleTextCount, 0);
  assert.equal(analysis.trailingDotTitleCount, 1);
  assert.deepEqual(
    analysis.parentheticalPhrases,
    [
      { phrase: "(En,Fr,De,Es)", count: 1 },
      { phrase: "(Europe)", count: 1 },
      { phrase: "(USA)", count: 1 },
      { phrase: "(World)", count: 1 },
    ],
  );
  assert.match(
    analysis.warnings[0] ?? "",
    /trailing title period/i,
  );
});

test("buildManagedRenameRule returns the canonical all-phrases rule", () => {
  const rule = buildManagedRenameRule("all", []);

  assert.deepEqual(rule, {
    pattern: "^(.+?)[\\s.]*?(?:\\([^)]*\\)[\\s.]*)*(\\.[^.]+)$",
    replacement: "$1$2",
  });
  assert.equal(
    applyManagedRenameRule(
      {
        mode: "all",
        phrases: [],
      },
      "Picross NP Vol. 6 (Japan) (Rev 1) (NP).sfc",
    ),
    "Picross NP Vol. 6.sfc",
  );
});

test("detectManagedRenamePolicy parses a generated phrase-specific rename rule", () => {
  const availablePhrases = ["(Rev 1)", "(USA)", "(World)"];
  const generatedRule = buildManagedRenameRule(
    "phrases",
    ["(USA)", "(Rev 1)"],
    availablePhrases,
  );
  assert.ok(generatedRule);
  assert.deepEqual(generatedRule, {
    pattern:
      "(?:[\\s.]*(?:\\(Rev 1\\)|\\(USA\\))(?:\\s*(?:\\(Rev 1\\)|\\(USA\\)))*(?:([\\s]+)(?=(?:\\(World\\))(?:\\s*(?:\\([^)]*\\)|\\[[^\\]]*\\]))*\\.[^.]+$)|(?:[\\s.]*(?=\\.[^.]+$))))",
    replacement: "$1",
  });

  const detected = detectManagedRenamePolicy(generatedRule, availablePhrases);

  assert.deepEqual(detected, {
    mode: "phrases",
    phrases: ["(Rev 1)", "(USA)"],
    isCustom: false,
  });
  assert.equal(
    applyManagedRenameRule(
      detected,
      "Chessmaster, The (USA) (Rev 1).zip",
      availablePhrases,
    ),
    "Chessmaster, The.zip",
  );
  assert.equal(
    applyManagedRenameRule(detected, "Side Pocket (World).zip", availablePhrases),
    "Side Pocket (World).zip",
  );
});

test("phrase-specific rename does not inject replacement tokens when all trailing phrases are selected", () => {
  const availablePhrases = ["(World)"];

  assert.equal(
    applyManagedRenameRule(
      { mode: "phrases", phrases: ["(World)"] },
      "Super Mario Bros. (World).zip",
      availablePhrases,
    ),
    "Super Mario Bros.zip",
  );
});

test("detectManagedRenamePolicy still recognizes generated phrase rules when observed phrases change", () => {
  const rule = buildManagedRenameRule("phrases", ["(USA)", "(World)"], [
    "(Acclaim)",
    "(USA)",
    "(World)",
  ]);
  assert.ok(rule);

  const detected = detectManagedRenamePolicy(rule, ["(Acclaim)", "(World)"]);

  assert.deepEqual(detected, {
    mode: "phrases",
    phrases: ["(USA)", "(World)"],
    isCustom: false,
  });
});

test("detectManagedRenamePolicy treats unknown regexes as custom", () => {
  const detected = detectManagedRenamePolicy(
    {
      pattern: "\\s*\\(USA\\)",
      replacement: "",
    },
    ["(USA)", "(World)"],
  );

  assert.deepEqual(detected, {
    mode: "custom",
    phrases: [],
    isCustom: true,
  });
});

test("detectManagedRenamePolicy treats near-canonical custom regexes as custom", () => {
  const detected = detectManagedRenamePolicy(
    {
      pattern:
        "(?:[\\s.]*(?:\\(Rev 1\\)|\\(USA\\))(?:\\s*(?:\\(Rev 1\\)|\\(USA\\)))*(?:([\\s]+)(?=(?:USA)(?:\\s*\\([^)]*\\))*\\.[^.]+$)|(?:[\\s.]*(?=\\.[^.]+$))))",
      replacement: "$1",
    },
    ["(Rev 1)", "(USA)", "(World)"],
  );

  assert.deepEqual(detected, {
    mode: "custom",
    phrases: [],
    isCustom: true,
  });
});

test("selected phrases supports trailing bracket groups without changing all phrases", () => {
  const analysis = analyzeParentheticalSuffixes([
    "Game Title [b].zip",
    "Another Game (USA) [T+Spa].zip",
    "Third Game [b] [v1.1].zip",
  ]);
  const availablePhrases = analysis.parentheticalPhrases.map((phrase) => phrase.phrase);
  const generatedRule = buildManagedRenameRule("phrases", ["[b]"], availablePhrases);

  assert.deepEqual(analysis.parentheticalPhrases, [
    { phrase: "[b]", count: 2 },
    { phrase: "(USA)", count: 1 },
    { phrase: "[T+Spa]", count: 1 },
    { phrase: "[v1.1]", count: 1 },
  ]);
  assert.ok(generatedRule);
  assert.equal(
    applyManagedRenameRule(
      {
        mode: "phrases",
        phrases: ["[b]"],
      },
      "Game Title [b].zip",
      availablePhrases,
    ),
    "Game Title.zip",
  );
  assert.equal(
    applyManagedRenameRule(
      {
        mode: "phrases",
        phrases: ["[b]"],
      },
      "Another Game (USA) [T+Spa].zip",
      availablePhrases,
    ),
    "Another Game (USA) [T+Spa].zip",
  );
  assert.deepEqual(detectManagedRenamePolicy(generatedRule, availablePhrases), {
    mode: "phrases",
    phrases: ["[b]"],
    isCustom: false,
  });
  assert.equal(
    applyManagedRenameRule(
      {
        mode: "all",
        phrases: availablePhrases,
      },
      "Game Title [b].zip",
      availablePhrases,
    ),
    "Game Title [b].zip",
  );
});

test("analyzeParentheticalSuffixes only counts trailing managed phrases", () => {
  const analysis = analyzeParentheticalSuffixes([
    "Title (Prototype) Update (USA).zip",
    "Another Game (Beta).zip",
  ]);

  assert.deepEqual(analysis.parentheticalPhrases, [
    { phrase: "(Beta)", count: 1 },
    { phrase: "(USA)", count: 1 },
  ]);
  assert.equal(analysis.withParenthesesCount, 2);
  assert.equal(analysis.trueMiddleTextCount, 1);
});
