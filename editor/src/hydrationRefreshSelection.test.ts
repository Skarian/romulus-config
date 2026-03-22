import assert from "node:assert/strict";
import test from "node:test";

import { getPendingHydrationEntryIds } from "./hydrationRefreshSelection";

test("missing-cache refresh includes all non-ready source states", () => {
  assert.deepEqual(
    getPendingHydrationEntryIds([
      { entryId: "missing", status: "missing" },
      { entryId: "preparing", status: "preparing" },
      { entryId: "error", status: "error" },
      { entryId: "ready", status: "ready" },
    ]),
    ["missing", "preparing", "error"],
  );
});

test("missing-cache refresh treats absent hydration state as missing", () => {
  assert.deepEqual(
    getPendingHydrationEntryIds([
      { entryId: "unknown", status: null },
      { entryId: "ready", status: "ready" },
    ]),
    ["unknown"],
  );
});
