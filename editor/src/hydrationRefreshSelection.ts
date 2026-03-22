import type { HydrationSourceStatus } from "./types";

export function getPendingHydrationEntryIds(
  entries: ReadonlyArray<{
    entryId: string;
    status: HydrationSourceStatus | null | undefined;
  }>,
) {
  return entries
    .filter((entry) => (entry.status ?? "missing") !== "ready")
    .map((entry) => entry.entryId);
}
