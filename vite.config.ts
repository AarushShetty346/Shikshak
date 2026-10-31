import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The default CSS minifier shortens the fonts' "unicode-range: U+0000-00FF" to "U+??", which
    // Safari (and so every browser on iPad and iPhone) ignores: the chalk font then never loads for
    // ordinary letters and iOS shows its fancy script fallback instead. esbuild keeps the full range.
    cssMinify: "esbuild",
  },
});
