// Regenerates public/sets.json — the build-time snapshot of the CC1 set
// index the app ships with.
//
// The app used to scrape https://bitbusters.club/gliderbot/sets/cc1/ live on
// every page load, which made the landing page a single point of failure: if
// that host was slow, down, or blocked cross-origin, a visitor saw only the
// bundled Intro set. Snapshotting the directory listing into the repo at
// build time keeps the shipped site deterministic and offline-capable; the
// only live fetch left is the .dat a player actually chooses.
//
// Run with: npm run refresh-sets
import { writeFile } from "node:fs/promises";

const INDEX_URL = "https://bitbusters.club/gliderbot/sets/cc1/";
const OUT = new URL("../public/sets.json", import.meta.url);

// Plain Apache/nginx autoindex: pull every <a href> that points at a .dat
// rather than depending on any particular page layout.
const res = await fetch(INDEX_URL);
if (!res.ok) throw new Error(`Failed to fetch set index (HTTP ${res.status})`);
const html = await res.text();

const ids = new Set();
for (const match of html.matchAll(/href="([^"]+\.dat)"/gi)) {
  const href = match[1];
  const file = decodeURIComponent(href).split("/").pop();
  if (!file) continue;
  ids.add(file.replace(/\.dat$/i, ""));
}

if (ids.size === 0) throw new Error("Set index parsed to zero sets — refusing to overwrite snapshot");

const sets = [...ids].sort((a, b) => a.localeCompare(b));
const payload = {
  generatedAt: new Date().toISOString(),
  source: INDEX_URL,
  sets,
};

await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${sets.length} sets to public/sets.json`);
