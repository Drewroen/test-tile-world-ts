export type RulesetSlug = "ms" | "lynx";

export interface Route {
  setId: string;
  ruleset: RulesetSlug;
}

// Route state lives in the URL hash (e.g. "#/CCLP1/ms") rather than a real
// path, since this app deploys as a static site on GitHub Pages with no
// server-side rewrite to fall back to index.html on a deep-link reload.
export function parseHash(hash: string): Route | null {
  const trimmed = hash.replace(/^#\/?/, "");
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length !== 2) return null;

  const [rawSetId, rawRuleset] = parts;
  if (rawRuleset !== "ms" && rawRuleset !== "lynx") return null;
  if (!rawSetId) return null;

  return { setId: decodeURIComponent(rawSetId), ruleset: rawRuleset };
}

export function buildHash(setId: string, ruleset: RulesetSlug): string {
  return `#/${encodeURIComponent(setId)}/${ruleset}`;
}
