import { fileURLToPath } from "node:url";

const sources = {
  worker: "../../application/worker.ts",
  "pane-runner": "./pane-runner.ts",
  "launch-gate": "./launch-gate.ts",
  "egress-bridge": "../egress/bridge-runtime.ts",
};

export function artifact(name: keyof typeof sources): string {
  if (import.meta.url.endsWith(".ts"))
    return fileURLToPath(new URL(sources[name], import.meta.url));
  return fileURLToPath(new URL(`./harness-${name}.js`, import.meta.url));
}
