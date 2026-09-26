# Landing Page + First-Run UX Implementation Plan

**Goal:** Make the demo usable by someone who has never heard of Chip's Challenge. The landing page used to be a flat, alphabetical list of all 1,111 sets on the bitbusters.club mirror, with two unexplained buttons per row ("MS" / "Lynx") — no way to just *play*, no way to find a specific set, no memory of what you were doing, and a dependency on a third-party host being up. This work replaces that with a curated + searchable catalogue, a one-click play path, resumable progress, per-level deep links, first-run onboarding, and an in-repo snapshot of the set index.

**Architecture:** Same vanilla TypeScript + Vite static site, same two-page/`hidden`-class structure and hash routing. Three new pure modules — `src/sets.ts` (catalogue snapshot parsing, curated shelf, search/ranking), `src/progress.ts` (completion marks, last-played, how-to flag, all taking an explicit `Storage`) and the existing `src/routing.ts` (extended with a level segment) — keep the new logic testable without a DOM, leaving `main.ts` as the DOM renderer it already is. `scripts/fetch-sets-index.mjs` regenerates `public/sets.json` on demand; the built site no longer scrapes HTML at runtime.

**Tech Stack:** TypeScript, Vite, vitest, `tworld-engine`. No new runtime dependencies.

## Global Constraints

- Only the bundled Intro set may be fetched without the network; every other set is still loaded live from `https://bitbusters.club/gliderbot/sets/cc1/<id>.dat`, because level data is not redistributed in this repo.
- Route shape stays `#/<setId>/<ms|lynx>`, with an optional `/<levelNumber>` (the level's own number, not a list index — it's what the HUD shows and what CC1 passwords/keypad codes key off).
- The set id remains the `.dat` URL for storage keys (a level number can repeat across sets); `progress.ts` therefore parses keys from the right, never the left.
- `npx tsc --noEmit` and `npm test` must pass.

---

### Task 1: Set catalogue snapshot (`scripts/fetch-sets-index.mjs`, `public/sets.json`)

- [x] Scrape the autoindex listing into `{ generatedAt, source, sets: string[] }`, refusing to overwrite the snapshot if the parse yields zero sets.
- [x] Expose it as `npm run refresh-sets`; load it at runtime from `import.meta.env.BASE_URL + "sets.json"` instead of cross-origin HTML scraping.
- [x] Degrade to "Intro only" plus an explanatory status line if the snapshot is missing or malformed (`parseSetsSnapshot` returns `[]` rather than throwing).

### Task 2: Search + curated shelf (`src/sets.ts`)

- [x] `CURATED_SETS`: Intro, CC1, and CCLP1–5 with labels and blurbs — pinned above the catalogue, which is otherwise alphabetical.
- [x] `searchSets(sets, query, limit)`: case/punctuation-insensitive (so "cclp 1" finds CCLP1), curated-first when searching, prefix matches ahead of substring matches, and returns an uncapped `total` so the UI can say "showing 40 of 312".
- [x] `datUrl(id)` builds the mirror URL; `INTRO_SET` stays the offline-first entry.

### Task 3: Level deep links (`src/routing.ts`)

- [x] `parseHash` accepts an optional third segment (`#/CC1/ms/12`) and rejects malformed level segments (`0`, `-3`, `1.5`, trailing slash, extra segments) rather than silently loading level 1 of the wrong set.
- [x] `buildHash(setId, ruleset, levelNumber?)` omits the level when there isn't one.

### Task 4: Progress + resume (`src/progress.ts`)

- [x] `completedLevels`/`markCompleted`: completion is recorded separately from best times, so a win that doesn't improve the best time still counts as progress.
- [x] Pre-existing `tworld-besttime:*` entries still count as completed (a best time is only ever written on a win) — players keep progress from before this change.
- [x] `saveLastPlayed`/`getLastPlayed`: set + ruleset + level number + level name, written on every level start, tolerant of unreadable entries.
- [x] `hasSeenHowTo`/`markHowToSeen` for the one-time overlay.

### Task 5: Landing page (`index.html`, `src/style.css`, `src/main.ts`)

- [x] Hero with a one-click Play button (bundled Intro, MS rules) and a secondary "Play Chip's Challenge 1" link, plus copy explaining what the demo and the two rulesets are.
- [x] "Continue" card, rendered only when there's a last-played entry, that reopens the exact set/ruleset/level.
- [x] Curated cards showing per-set completed-level counts from local storage.
- [x] Searchable catalogue capped at 40 rendered rows with a truthful "showing N of M" line and a result count.
- [x] Footer crediting the level-set mirror.

### Task 6: Game page UX (`index.html`, `src/main.ts`)

- [x] The MS/Lynx readout became a toggle that rebuilds the current level under the other ruleset (the engine takes a ruleset at `Game` construction), so the choice is no longer a gate in front of the first level.
- [x] "Copy level link" + the address bar always name the current level (`history.replaceState`, so level changes don't stack history entries and the back button stays a way back to the set list).
- [x] First-run how-to overlay (goal, controls, and that the clock waits for the first move), shown once.
- [x] WASD as well as arrows, `R` to restart, and keystrokes in the search box no longer reach the game.
- [x] Level names are stripped of the NUL padding that CC1 `.dat` files carry, so the picker and deep links don't carry a control character.

### Task 8: Styling follows the Tile World application

- [x] Take the visual language from the Tile World application itself (`Drewroen/tworld`), which is the program this engine ports, instead of a generic app theme or a third-party site: `oshw-qt/TWMainWnd.ui`'s QPalette (window/button `#285080`, light `#3c78c0`, midlight `#3264a0`, dark `#142840` = AlternateBase, base/shadow `#000000`, highlight `#4080c0`), the diagonal `lighter(125)`→`darker(125)` window gradient from `TWMainWnd.cpp`, `res/rc`'s text colours (`#cccccc` / `#ffffff` bold / `#999999` dim), and the app's own UI font `MS Sans Serif` — no webfont is fetched.
- [x] 2px raised/sunken bevels that invert when pressed, square corners, no drop shadows: level sets are raised buttons, the catalogue is a black base table with `#142840` alternating rows and `#4080c0` selection (its QTableView), the HUD numbers are `QLCDNumber`-style green readouts, and the overlay is dressed as one of its modal dialogs.
- [x] Tokens are named `--tw-*` after those sources, each citing its file, behind the same semantic layer (`--bg`, `--text`, `--link`, `--selection`, …) so the theme can be swapped again without touching rules.
- [x] Two values depart from the sources, each commented where it's defined: the LCD digits keep the app's green `#00ff00` but move off the palette's `#e8e8e8` plate onto Base black (~1.2:1 → 15:1), and the clock bar's red — `TWProgressBar` draws par in `#a02020` — marks the last quarter of the time limit, since `GameSetup` carries no par.
- [x] The clock bar itself is new UI (a `TWProgressBar`-style div under the HUD stats), so it can be dropped without touching anything else.

### Task 9: Tests

- [x] `src/routing.test.ts` — valid/invalid routes, round-tripping, percent-encoded ids.
- [x] `src/sets.test.ts` — snapshot parsing tolerance, ranking, limits, curated exclusion from the browse list.
- [x] `src/progress.test.ts` — completion counting (including the legacy best-time keys), set isolation, malformed entries — against a Map-backed fake `Storage`.

## Verification

- Styling probed on the built site: the body resolves to the `MS Sans Serif` stack at 12px over the `rgb(60,120,192)` → `rgb(20,40,64)` window gradient, panels to black with a sunken `rgb(20,40,64)`/`rgb(60,120,192)` bevel and no border-radius, the primary button to the palette's `rgb(64,128,192)`, the LCD readouts to `rgb(0,255,0)` on black, and `document.fonts` is empty because nothing is fetched. In a level the clock bar's fill fell to 99% as the clock went 201 → 198, and its last-quarter state renders `rgb(160,32,32)` — the red in `TWProgressBar.cpp`. The how-to dialog's paint was confirmed by sampling a capture at the card's centre (`rgb(50,100,160)`, the palette's midlight).
- `npx tsc --noEmit`, `npm test` (31 tests) and `npm run build` all pass.
- Browser smoke test against `npm run preview` (headless Chrome): landing renders 7 curated cards + 1,111-set catalogue capped at 40 rows; search filters (`cclp4` → 40 of 50); quick play starts Intro level 1 with the overlay; `#/CC1/ms/3` deep-links to level 3 of 149; ruleset toggle restarts on Lynx and keeps the level in the URL; unknown set ids report "Unknown set"; `history.back()` returns to the level being played; progress state from storage renders as "N levels beaten" and a Continue card.
- A real win was driven through the UI by replaying an engine-derived solution for Intro level 5 (241 moves, MS rules) as direction runs held long enough that overshoot bumps a wall: the banner shows "You win!", `tworld-completed:…intro.dat:2:5` and a best time are written, and the landing page then shows "1 level beaten" plus a Continue card.
- Mobile (390×844 emulation): hero, CTA and search stay visible, the board fits the viewport, and the toolbar stays sticky — the old media query's `h1, .subtitle { display: none }` is now scoped to the game page so it no longer guts the landing page's copy.
