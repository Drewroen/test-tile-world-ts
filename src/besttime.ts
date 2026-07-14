function key(levelNumber: number, ruleset: number): string {
  return `tworld-besttime:${ruleset}:${levelNumber}`;
}

export function getBestTime(levelNumber: number, ruleset: number): number | null {
  const raw = localStorage.getItem(key(levelNumber, ruleset));
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// Returns true iff `seconds` is a new (strictly lower) best for this level
// and ruleset, and persists it as a side effect.
export function recordTime(levelNumber: number, ruleset: number, seconds: number): boolean {
  const existing = getBestTime(levelNumber, ruleset);
  if (existing !== null && existing <= seconds) return false;
  localStorage.setItem(key(levelNumber, ruleset), String(seconds));
  return true;
}
