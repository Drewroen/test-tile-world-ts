import { defineConfig } from "vite";

// GitHub Pages serves project sites (as opposed to a user/org root site)
// under a /<repo-name>/ path prefix, so all built asset URLs need that
// prefix baked in. Vite's dev server understands `base` too and will
// redirect "/" to it automatically, so this doesn't hurt local dev.
export default defineConfig({
  base: "/test-tile-world-ts/",
});
