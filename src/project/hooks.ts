import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { jsonOutput, splitKeyed, type Output } from "./outputs.js";
import { ProjectError } from "./package-rules.js";
import { guardPath } from "./hook-adapter.js";
import type { ProjectSpec } from "./spec.js";

export const HOOK_DIRECTORY = ".agents/pmcp-hooks";
const ADAPTER = `${HOOK_DIRECTORY}/adapter.mjs`;
const native = {
  codex: {
    file: ".codex/hooks.json",
    key: ["hooks", "PreToolUse"],
    matcher: "Bash",
  },
  gemini: {
    file: ".gemini/settings.json",
    key: ["hooks", "BeforeTool"],
    matcher: "run_shell_command",
  },
  antigravity: {
    file: ".agents/hooks.json",
    key: ["pmcp-shell", "PreToolUse"],
    matcher: "run_command",
  },
} as const;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectError(
      "Native hook configuration must be an object; contents are redacted",
    );
  }
  return value as Record<string, unknown>;
}

function groups(root: string, file: string, key: readonly string[]): unknown[] {
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    throw new ProjectError(
      "Cannot parse native hook configuration; contents are redacted",
    );
  }
  for (const part of key) {
    value = object(value)[part];
    if (value === undefined) {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    throw new ProjectError("Native shell hook entries must be an array");
  }
  return value;
}

function adapterSource(): string {
  const published = fileURLToPath(
    new URL("./project/hook-adapter.js", import.meta.url),
  );
  const sourceBuild = fileURLToPath(
    new URL("../../dist/project/hook-adapter.js", import.meta.url),
  );
  const file = existsSync(published) ? published : sourceBuild;
  if (!existsSync(file)) {
    throw new ProjectError("Build pmcp before projecting shell hook adapters");
  }
  return readFileSync(file, "utf8");
}

export function hookOutputs(spec: ProjectSpec): Output[] {
  const lockFile = join(spec.root, "pmcp.lock");
  const lock = existsSync(lockFile)
    ? (JSON.parse(readFileSync(lockFile, "utf8")) as {
        outputs?: { path: string; managed?: unknown[] }[];
      })
    : {};
  const previous = new Map(
    (lock.outputs ?? [])
      .filter((entry) => entry.managed !== undefined)
      .map((entry) => [entry.path, entry.managed!]),
  );
  const selected = (spec.hooks ?? []).filter((hook) =>
    hook.targets.some((tool) => spec.tools.has(tool)),
  );
  if (selected.length === 0 && previous.size === 0) {
    return [];
  }
  const outputs: Output[] = [];
  const desired = new Map<
    string,
    { file: string; key: readonly string[]; managed: unknown[] }
  >();
  if (selected.length > 0) {
    const adapter = adapterSource();
    outputs.push({ kind: "file", path: ADAPTER, content: adapter });
    for (const hook of selected) {
      const policyFile = `${HOOK_DIRECTORY}/${hook.name}.json`;
      const guardSha256 = createHash("sha256")
        .update(readFileSync(guardPath(spec.root, hook.command)))
        .digest("hex");
      const policy = `${JSON.stringify({ ...hook, contractVersion: 1, guardSha256 }, null, 2)}\n`;
      outputs.push({ kind: "file", path: policyFile, content: policy });
      const integrity = createHash("sha256")
        .update(adapter)
        .update(policy)
        .digest("hex");
      for (const tool of hook.targets) {
        if (!spec.tools.has(tool)) {
          continue;
        }
        const target = native[tool];
        const command =
          'd="$PWD"; while [ ! -f "$d/pmcp.toml" ]; do [ "$d" = / ] && exit 1; d=$(dirname "$d"); done; ' +
          `exec node "$d/${ADAPTER}" --pmcp-shell-hook ${tool} "$d/${policyFile}" ${integrity}`;
        const timeout =
          tool === "gemini"
            ? hook.timeoutMs + 2000
            : Math.ceil(hook.timeoutMs / 1000) + 2;
        const value = {
          matcher: target.matcher,
          hooks: [{ type: "command", command, timeout }],
        };
        const path = `${target.file}#${target.key.join(".")}`;
        const entry = desired.get(path) ?? {
          file: target.file,
          key: target.key,
          managed: [],
        };
        entry.managed.push(value);
        desired.set(path, entry);
      }
    }
  }
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);
  for (const path of new Set([...desired.keys(), ...previous.keys()])) {
    const parts = splitKeyed(path);
    if (
      !parts ||
      !Object.values(native).some(
        (entry) =>
          entry.file === parts.file &&
          entry.key.join(".") === parts.key.join("."),
      )
    ) {
      throw new ProjectError("Unknown managed hook path in pmcp.lock");
    }
    const current = groups(spec.root, parts.file, parts.key);
    const owned = previous.get(path) ?? [];
    const planned = desired.get(path)?.managed ?? [];
    const missingOwned = owned.some(
      (entry) => !current.some((value) => same(value, entry)),
    );
    const reconciled =
      owned.length === planned.length &&
      planned.every((entry) => current.some((value) => same(value, entry)));
    if (current.length > 0 && missingOwned && !reconciled) {
      throw new ProjectError(
        "Owned shell hook entries were edited or removed; review native configuration before projecting",
      );
    }
    const unowned = current.filter(
      (value) =>
        !owned.some((entry) => same(value, entry)) &&
        !planned.some((entry) => same(value, entry)),
    );
    if (
      unowned.some((value) => JSON.stringify(value).includes(HOOK_DIRECTORY))
    ) {
      throw new ProjectError(
        "Refusing an unowned PMCP shell hook adapter conflict",
      );
    }
    outputs.push({
      ...jsonOutput(parts.file, parts.key, [...unowned, ...planned]),
      managed: planned,
    } as Extract<Output, { kind: "json" }>);
  }
  return outputs;
}
