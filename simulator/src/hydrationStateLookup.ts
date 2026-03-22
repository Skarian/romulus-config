import type { HydrationSourceState, PreviewEntry } from "./types";

export function buildHydrationStateByHydrationKey(
  snapshotEntries: PreviewEntry[],
  sourceStates: Record<string, HydrationSourceState>,
) {
  const hydrationStatesByHydrationKey = new Map<string, HydrationSourceState>();

  for (const entry of snapshotEntries) {
    const hydrationState = sourceStates[entry.id];
    if (!hydrationState || hydrationStatesByHydrationKey.has(entry.hydrationKey)) {
      continue;
    }
    hydrationStatesByHydrationKey.set(entry.hydrationKey, hydrationState);
  }

  return hydrationStatesByHydrationKey;
}

export function getHydrationStateForEntry(
  entry: Pick<PreviewEntry, "hydrationKey"> | null | undefined,
  hydrationStatesByHydrationKey: ReadonlyMap<string, HydrationSourceState>,
) {
  if (!entry) {
    return null;
  }

  return hydrationStatesByHydrationKey.get(entry.hydrationKey) ?? null;
}
