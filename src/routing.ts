export type RulesetSlug = "ms" | "lynx";

export interface Route {
  setId: string;
  ruleset: RulesetSlug;
  // The level's own number as printed in the HUD (#12), not a list index —
  // numbers are what the player sees and what CC1 passwords are keyed to, so
  // they're stable things to link to. null means "first level of the set".
  levelNumber: number | null;
}

// Route state lives in the URL hash (e.g. "#/CCLP1/ms/12") rather than a real
// path, since this app deploys as a static site on GitHub Pages with no
// server-side rewrite to fall back to index.html on a deep-link reload.
export function parseHash(hash: string): Route | null {
  const trimmed = hash.replace(/^#\/?/, "");
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const [rawSetId, rawRuleset, rawLevel] = parts;
  if (rawRuleset !== "ms" && rawRuleset !== "lynx") return null;
  if (!rawSetId) return null;

  let levelNumber: number | null = null;
  if (rawLevel !== undefined) {
    // Strict: a malformed level segment invalidates the whole route rather
    // than silently dropping the player on level 1 of a set they didn't ask
    // for. Same for a trailing slash or an empty segment.
    if (!/^\d+$/.test(rawLevel)) return null;
    levelNumber = Number(rawLevel);
    if (!Number.isSafeInteger(levelNumber) || levelNumber < 1) return null;
  }

  return { setId: decodeURIComponent(rawSetId), ruleset: rawRuleset, levelNumber };
}

export function buildHash(
  setId: string,
  ruleset: RulesetSlug,
  levelNumber?: number | null,
): string {
  const base = `#/${encodeURIComponent(setId)}/${ruleset}`;
  return levelNumber ? `${base}/${levelNumber}` : base;
}
