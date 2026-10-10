import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    stdio: "src/stdio.ts",
    cli: "src/cli.ts",
    http: "src/http.ts",
    "mailbox/index": "src/mailbox/index.ts",
    "project/hook-adapter": "src/project/hook-adapter.ts",
    "harness-worker": "src/harness/application/worker.ts",
    "harness-launch-gate": "src/harness/adapters/process/launch-gate.ts",
    "harness-pane-runner": "src/harness/adapters/process/pane-runner.ts",
    "harness-egress-bridge": "src/harness/adapters/egress/bridge-runtime.ts",
    "tui-worker": "src/tui/application/worker.ts",
  },
  format: ["esm"],
  splitting: false,
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
