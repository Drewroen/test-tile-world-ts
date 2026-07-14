function key(levelNumber: number, ruleset: number): string {
  return `tworld-besttime:${ruleset}:${levelNumber}`;
}

export function getBestTime(levelNumber: number, ruleset: number): number | null {
  const raw = localStorage.getItem(key(levelNumber, ruleset));
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
  levelNumber: number,
  ruleset: number,
  seconds: number,
  higherIsBetter: boolean,
): boolean {
  const existing = getBestTime(levelNumber, ruleset);
  if (existing !== null && (higherIsBetter ? seconds <= existing : seconds >= existing)) return false;
  localStorage.setItem(key(levelNumber, ruleset), String(seconds));
  return true;
}
