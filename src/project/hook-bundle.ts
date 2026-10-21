import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HOOK_BODY_FILE, HOOK_FILE, POLICY_FILE } from "../hooks/compiled.js";
import { NATIVE_HOOK_FILES } from "../hooks/runtimes/index.js";
import type { FileEdit } from "../hooks/runtimes/types.js";
import type { Output } from "./outputs.js";
import { ProjectError } from "./package-rules.js";
import type { ProjectSpec } from "./spec.js";

export const BUNDLE_NATIVE_FILES = [
  ...new Set(NATIVE_HOOK_FILES.map((native) => native.file)),
];

// An entry is the bundle's only under the key its runtime's projection writes.
export function bundleOwns(file: string, key: readonly string[]): boolean {
  return NATIVE_HOOK_FILES.some(
    (native) =>
      native.file === file && key.length === 2 && key[0] === native.root,
  );
}

// hook.mjs is a small loader that enables the compile cache and imports hook-body.mjs.
function bundleSource(name: string): string {
  const published = fileURLToPath(new URL(`./${name}`, import.meta.url));
  const sourceBuild = fileURLToPath(
    new URL(`../../dist/${name}`, import.meta.url),
  );
  const file = existsSync(published) ? published : sourceBuild;
  if (!existsSync(file)) {
    throw new ProjectError("Build pmcp before projecting the hook bundle");
  }
  return readFileSync(file, "utf8");
}

export function bundleFiles(spec: ProjectSpec): Output[] {
  if (!spec.hookBundle?.policy) return [];
  return [
    { kind: "file", path: HOOK_FILE, content: bundleSource("hook.js") },
    {
      kind: "file",
      path: HOOK_BODY_FILE,
      content: bundleSource("hook-body.js"),
    },
    {
      kind: "file",
      path: POLICY_FILE,
      content: `${JSON.stringify(spec.hookBundle.policy, null, 2)}\n`,
    },
    ...(spec.hookBundle.files ?? []).map((file): Output => ({
      kind: "file",
      path: file.path,
      content: file.content,
    })),
  ];
}

export function bundleEdits(spec: ProjectSpec): readonly FileEdit[] {
  return spec.hookBundle?.edits ?? [];
}
