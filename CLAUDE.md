# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-playable demo of `tworld-engine` (a TypeScript port of Tile World / Chip's Challenge 1 game logic, `github:Drewroen/tworld-engine`). This repo contains only the frontend — rendering, input, sound, HUD, and routing. All game rules/state live in the engine dependency; this app just drives `Game.doTurn()` each tick and paints the result to a `<canvas>`.

No framework: plain TypeScript + direct DOM manipulation, built with Vite.

## Commands

```
npm install       # install deps (tworld-engine is a GitHub dependency, no npm registry)
npm run dev       # start Vite dev server
npm run build     # type-check-free production build to dist/ (vite build)
npm run preview   # serve the built dist/ locally
npm test          # run the vitest unit test suite (vitest run)
npm run refresh-sets  # regenerate public/sets.json from the bitbusters.club mirror
```

There is no lint script. `tsc` is not wired into a script; check types with `npx tsc --noEmit` if needed (config already has `noEmit: true`). Test coverage is intentionally narrow — it covers the pure modules, not the DOM: `src/tileset.test.ts` unit-tests `applyChromaKey` (the pixel-processing core of `loadTileset`, pulled out as a pure function of a raw pixel buffer specifically so it's testable without a DOM/canvas) against a handful of synthetic pixel buffers — most usefully a regression test for a bug where scanning+mutating the same buffer in place made a chroma-keyed sprite's shadow tint cascade across its whole background (see git history on `tileset.ts` for the incident). `src/routing.test.ts`, `src/sets.test.ts` and `src/progress.test.ts` do the same for the route parser, the catalogue search/ranking and the local-storage-backed progress helpers. Everything else (rendering, input, sound, HUD rendering, the page-level wiring in `main.ts`) has no automated coverage; verify those manually via `npm run dev` and play-testing in a browser. CI (below) runs `npm test` on every push to `main`, so this suite is a merge gate, not just a local nicety.

CI (`.github/workflows/deploy.yml`) runs `npm ci && npm run build` and deploys `dist/` to GitHub Pages on every push to `main`.

## Architecture

### Data flow

`main.ts` is the sole entry point and orchestrator — it owns all mutable state (`game`, `levels`, `tileset`, `loadedSetId`, etc.) and wires DOM elements queried once at module load. There's no component framework or state management library; `render()` is called imperatively after every tick and does a full re-paint of the canvas plus a diffed update of the key/boot inventory icons. Where logic can be made pure it lives outside `main.ts` instead: `routing.ts` (hash parsing), `sets.ts` (catalogue + search), `progress.ts` (local-storage-backed completion/resume), `besttime.ts`, `render.ts`, `tileset.ts`.

The tick loop: `setInterval(tick, 1000/20)` (engine runs at a fixed 20 ticks/sec — `gen.h`'s `TICKS_PER_SECOND`) calls `game.doTurn(currentInputCommand())`, then `sound.update(...)`, then `render()`. The loop only starts on the player's first input (`ensureStarted()`), matching original Tile World behavior of not starting the clock on level load.

### Two-page UI, hash-based routing

`index.html` defines two top-level page divs (`#sets-page`, `#game-page`) toggled via a `hidden` class — not real navigation. Route state lives in `location.hash` as `#/<setId>/<ms|lynx>[/<levelNumber>]` (see `routing.ts`'s `parseHash`/`buildHash`) rather than a real path, because this deploys as a static GitHub Pages site with no server-side rewrite for deep-link reloads. The level segment is the level's own number (what the HUD prints), and `main.ts`'s `syncHash()` keeps the URL naming the level being played — via `history.replaceState`, so level changes don't stack history entries and Back stays a way back to the set list.

`main.ts`'s `handleRouteChange()` (on `hashchange` and at startup) resolves the hash to either the catalogue page or a loaded game through `openSet()`, which is idempotent-ish: switching to a set already loaded just swaps the level, and switching the ruleset on the same set rebuilds the level in place (the engine takes its ruleset when `Game` is constructed).

The landing page (`#sets-page`) is a curated shelf (`sets.ts`'s `CURATED_SETS`: Intro, CC1, CCLP1–5), an optional Continue card from `progress.ts`'s `getLastPlayed()`, and a searchable catalogue capped at 40 rendered rows. It used to render all ~1,111 sets as DOM rows with two buttons each, which is the problem this rework exists to fix — keep any future list rendering capped and search-driven.

Level sets (`.dat` files) come from `public/sets.json`, a build-time snapshot of the directory listing at `https://bitbusters.club/gliderbot/sets/cc1/` (regenerate with `npm run refresh-sets`), plus one bundled set (`public/intro.dat`). The snapshot exists so the landing page can't be degraded by that host being slow, down or CORS-hostile; only the `.dat` a player actually picks is fetched live. `setUrlFor()` builds the URL from the set id alone, so a deep link resolves even before the snapshot arrives.

### Rendering (`render.ts` + `tileset.ts`)

- `tileset.ts` loads `public/tiles.bmp` (a 7×16 grid of 48px sprites, transcribed from the original C renderer's `tile.c:tileidmap[]`) and chroma-keys out magenta as transparency.
- `render.ts`'s `computeViewport()` reproduces the original engine's sub-tile-accurate scrolling: it works directly in eighths-of-a-tile units (`state.xviewpos`/`yviewpos`) rather than snapping to whole tiles, so the traditional 9×9 window scrolls smoothly. `drawBoard()` draws each cell's floor (`bot`) then composites `top` over it (skipping creature ids, which `drawCreatureOverlay()` draws separately so they can be positioned mid-tile during movement via `moving`).
- MS and Lynx rulesets diverge in how Chip's death is represented (MS bakes it into the map cell; Lynx uses the creature-animation system) — `main.ts`'s `render()` has ruleset-specific logic to avoid drawing Chip's sprite twice on death under MS. See the inline comments there and in `render.ts` before changing death/animation rendering.
- When porting new visual behavior from the original C source, the relevant files are `tworld/generic/tile.c` and `tworld/oshw-sdl/sdlout.c` — see `docs/superpowers/specs/2026-07-13-tworld-frontend-parity-design.md` for a worked example of this kind of port.

### Sound (`sound.ts`)

`SoundManager` decodes all WAV files (`public/sounds/`) up front into `AudioBuffer`s via Web Audio (avoids `HTMLAudioElement`'s playback latency). Each engine tick, `update(mask, ruleset)` reads the `SND_*` bitmask the engine returns and either fires a one-shot sound (rising edge only) or starts/stops a loop, per `ONESHOT_COUNT = 18` (mirrors the engine's internal `SND_ONESHOT_COUNT`). Sound file names and the MS/Lynx-specific mappings are transcribed from tworld's `res/rc` config — see the `SHARED`/`MS`/`LYNX` tables.

### Best times and progress (`besttime.ts`, `progress.ts`)

Per-(set, level, ruleset) best times are persisted to `localStorage`, keyed by the set's URL as `setId` (not just level number, since the same level number can appear in different sets). Timed levels store seconds *remaining* (higher is better); untimed levels store elapsed seconds (lower is better) — `recordTime()`'s `higherIsBetter` flag controls the comparison.

`progress.ts` holds the rest of the player's durable state, and every function takes an explicit `Storage` so it can be tested against a Map-backed fake: `markCompleted()`/`completedLevels()` (completion is tracked separately from best times, so a win that doesn't improve the best time still counts, and legacy `tworld-besttime:*` keys still count too — parsing keys from the right, since set ids are URLs and contain colons), `saveLastPlayed()`/`getLastPlayed()` for the Continue card, and the one-time how-to flag. The landing page reads completion counts to show "N levels beaten" per curated set.

### Deployment

`vite.config.ts` sets `base: "/test-tile-world-ts/"` for GitHub Pages project-site hosting; this affects both the production build and (harmlessly) the dev server. Static assets referenced at runtime (tileset, sounds, bundled `intro.dat`, the `sets.json` catalogue snapshot) are always built via `import.meta.env.BASE_URL` rather than hardcoded absolute paths, so they resolve correctly under that base path. `public/sets.json` is committed, so the deployed catalogue is whatever was snapshotted at commit time — run `npm run refresh-sets` and commit the result to pick up new sets from the mirror.

## Conventions

- Comments explain *why*, especially when a value/algorithm is transcribed from or must stay bit-for-bit compatible with the original C engine or its reference frontend (`tworld/generic/`, `tworld/oshw-sdl/`, `lxlogic.c`, etc.) — cite the source file when porting behavior, since the "why" often isn't derivable from the TS alone.
- TypeScript is `strict`; prefer `type`-only imports for types re-exported from `tworld-engine` (e.g. `import { type GameSetup } from "tworld-engine"`).
- `docs/superpowers/` contains spec/plan documents from past feature work (frontend parity, sets-page routing, landing-page UX). Consult them for design rationale on those features rather than re-deriving it; add new ones there if doing similarly-scoped design work.
