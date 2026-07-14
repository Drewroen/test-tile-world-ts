function key(setId: string, levelNumber: number, ruleset: number): string {
  return `tworld-besttime:${setId}:${ruleset}:${levelNumber}`;
}

export function getBestTime(setId: string, levelNumber: number, ruleset: number): number | null {
  const raw = localStorage.getItem(key(setId, levelNumber, ruleset));
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// Returns true iff `seconds` is a new best for this level and ruleset, and
// persists it as a side effect. For timed levels `seconds` is the time
// *remaining* on the clock at completion, so a higher value is better
// (mirroring tworld's own convention); for untimed levels it's the elapsed
// time played, so a lower value is better.
export function recordTime(
  setId: string,
  levelNumber: number,
  ruleset: number,
  seconds: number,
  higherIsBetter: boolean,
): boolean {
  const existing = getBestTime(setId, levelNumber, ruleset);
  if (existing !== null && (higherIsBetter ? seconds <= existing : seconds >= existing)) return false;
  localStorage.setItem(key(setId, levelNumber, ruleset), String(seconds));
  return true;
}
