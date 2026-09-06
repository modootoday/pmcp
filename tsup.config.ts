import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stdio.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  // Runtime builtins, not resolvable by the bundler. Both are listed because
  // the cache opens whichever the running binary has.
  external: ["bun:sqlite", "node:sqlite", "@huggingface/transformers"],
  dts: true,
  clean: true,
  // The published tarball excludes maps; this keeps them for local debugging.
  sourcemap: true,
});
