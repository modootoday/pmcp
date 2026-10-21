import { resolve } from "node:path";

import { build, type Plugin } from "esbuild";
import { defineConfig } from "tsup";

// Copied out of dist and run elsewhere, so each must stay one file. Splitting
// would move code they share with the CLI into chunks they cannot reach.
const ARTIFACTS = {
  "project/hook-adapter": "src/project/hook-adapter.ts",
  hook: "src/hooks/loader.ts",
  "harness-egress-bridge": "src/harness/adapters/egress/bridge-runtime.ts",
};

// The hook body runs on every tool call; these builtins load only when an event uses them.
const LAZY: Record<string, string> = {
  "node:child_process": "src/hooks/lazy/child-process.ts",
  "node:crypto": "src/hooks/lazy/crypto.ts",
};

// An ESM import of node:fs builds a facade over every export, and its ReadStream getter loads
// the whole streams stack (about 10 ms). Taking fs from getBuiltinModule skips the facade.
function fsModule(): string {
  const fs = process.getBuiltinModule("node:fs");
  const names = Object.entries(Object.getOwnPropertyDescriptors(fs))
    .filter(([name, d]) => "value" in d && /^[A-Za-z_]\w*$/u.test(name))
    .map(([name]) => name);
  return [
    'const fs = process.getBuiltinModule("node:fs");',
    "export default fs;",
    ...names.map((name) => `export const ${name} = fs.${name};`),
  ].join("\n");
}

const lazyBuiltins: Plugin = {
  name: "lazy-builtins",
  setup(on) {
    // esbuild filters are Go regular expressions, which take no u flag.
    // oxlint-disable-next-line require-unicode-regexp
    on.onResolve({ filter: /^node:(child_process|crypto)$/ }, (args) => ({
      path: resolve(LAZY[args.path]!),
    }));
    // oxlint-disable-next-line require-unicode-regexp
    on.onResolve({ filter: /^node:fs$/ }, () => ({
      path: "node:fs",
      namespace: "builtin-fs",
    }));
    // oxlint-disable-next-line require-unicode-regexp
    on.onLoad({ filter: /.*/, namespace: "builtin-fs" }, () => ({
      contents: fsModule(),
      loader: "js",
    }));
  },
};

const SPLIT = {
  index: "src/index.ts",
  stdio: "src/stdio.ts",
  cli: "src/cli.ts",
  http: "src/http.ts",
  "mailbox/index": "src/mailbox/index.ts",
  "harness-worker": "src/harness/application/worker.ts",
  "harness-launch-gate": "src/harness/adapters/process/launch-gate.ts",
  "harness-pane-runner": "src/harness/adapters/process/pane-runner.ts",
};

// Runtime builtins, not resolvable by the bundler. Both are listed because
// the cache opens whichever the running binary has.
const EXTERNAL = ["bun:sqlite", "node:sqlite", "@huggingface/transformers"];

export default defineConfig({
  entry: SPLIT,
  format: ["esm"],
  // Each command is a dynamic import, so its dependencies load only when it runs.
  splitting: true,
  target: "node22",
  platform: "node",
  external: EXTERNAL,
  dts: { entry: { ...SPLIT, ...ARTIFACTS } },
  clean: true,
  // The published tarball excludes maps; this keeps them for local debugging.
  sourcemap: true,
  // Runs after clean, so the single-file artifacts cannot be removed by it.
  async onSuccess() {
    await build({
      entryPoints: ARTIFACTS,
      outdir: "dist",
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      external: EXTERNAL,
      sourcemap: true,
      logLevel: "warning",
    });
    await build({
      entryPoints: { "hook-body": "src/hooks/entry.ts" },
      outdir: "dist",
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      external: EXTERNAL,
      plugins: [lazyBuiltins],
      sourcemap: true,
      logLevel: "warning",
    });
  },
});
