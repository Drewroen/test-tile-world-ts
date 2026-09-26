// Persistent per-player state that the landing page surfaces: which levels of
// a set have been beaten, where the player left off, and whether they've seen
// the how-to overlay yet.
//
// Every function takes an explicit Storage so it can be unit-tested against a
// Map-backed fake instead of a DOM. main.ts passes window.localStorage.
//
// Note on set identity: a set is identified by its .dat *URL* (matching
// besttime.ts, where the same level number can appear in different sets), so
// keys contain colons of their own — parse from the right, never the left.
import type { RulesetSlug } from "./routing";

const BESTTIME_PREFIX = "tworld-besttime:";
const COMPLETED_PREFIX = "tworld-completed:";
const LAST_PLAYED_KEY = "tworld-last-played";
const HOWTO_KEY = "tworld-howto-seen";

export interface LastPlayed {
  setId: string;
  ruleset: RulesetSlug;
  levelNumber: number;
  levelName: string;
}

// Splits "<prefix><setId>:<ruleset>:<levelNumber>" from the right, since setId
// is a URL ("https://host/a.dat") and therefore contains colons itself.
function parseKey(key: string, prefix: string): { setId: string; level: number } | null {
  if (!key.startsWith(prefix)) return null;
  const parts = key.slice(prefix.length).split(":");
  if (parts.length < 3) return null;
  const level = Number(parts[parts.length - 1]);
  const ruleset = parts[parts.length - 2];
  if (!Number.isSafeInteger(level) || level < 1) return null;
  if (!/^\d+$/.test(ruleset ?? "")) return null;
  const setId = parts.slice(0, -2).join(":");
  if (!setId) return null;
  return { setId, level };
}

// Levels beaten under either ruleset. A best time only ever gets written on a
// win (besttime.ts), so its presence implies completion — which is why the old
// best-time keys still count. Explicit completion marks (written on every win,
// including ones that don't improve the best time) are the other half.
export function completedLevels(storage: Storage, setId: string): Set<number> {
  const levels = new Set<number>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null) continue;
    for (const prefix of [BESTTIME_PREFIX, COMPLETED_PREFIX]) {
      const parsed = parseKey(key, prefix);
      if (parsed && parsed.setId === setId) levels.add(parsed.level);
    }
  }
  return levels;
}

export function markCompleted(
  storage: Storage,
  setId: string,
  levelNumber: number,
  ruleset: number,
): void {
  storage.setItem(`${COMPLETED_PREFIX}${setId}:${ruleset}:${levelNumber}`, "1");
}

export function saveLastPlayed(storage: Storage, entry: LastPlayed): void {
  storage.setItem(LAST_PLAYED_KEY, JSON.stringify(entry));
}

// Returns null for anything unreadable — a hand-edited or older entry
// shouldn't break the landing page, it should just hide the Continue card.
export function getLastPlayed(storage: Storage): LastPlayed | null {
  const raw = storage.getItem(LAST_PLAYED_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const entry = parsed as Partial<LastPlayed> | null;
  if (!entry || typeof entry.setId !== "string") return null;
  if (entry.ruleset !== "ms" && entry.ruleset !== "lynx") return null;
  if (!Number.isSafeInteger(entry.levelNumber) || (entry.levelNumber as number) < 1) return null;
  return {
    setId: entry.setId,
    ruleset: entry.ruleset,
    levelNumber: entry.levelNumber as number,
    levelName: typeof entry.levelName === "string" ? entry.levelName : "",
  };
}

export function clearLastPlayed(storage: Storage): void {
  storage.removeItem(LAST_PLAYED_KEY);
}

export function hasSeenHowTo(storage: Storage): boolean {
  return storage.getItem(HOWTO_KEY) === "1";
}

export function markHowToSeen(storage: Storage): void {
  storage.setItem(HOWTO_KEY, "1");
}
