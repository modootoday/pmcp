import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AffectedConfig } from "../../src/git/affected/config.js";
import { sh } from "./fixture.js";

export interface Workspace {
  readonly root: string;
  write(path: string, content: string): void;
  remove(path: string): void;
  commit(message: string): string;
}

export function lockText(
  registry: Record<string, string>,
  bDeps: Record<string, string> = {},
): string {
  const packages = Object.entries(registry)
    .map(
      ([name, version]) =>
        `    "${name}": ["${name}@${version}", "", {}, "sha"],`,
    )
    .join("\n");
  return [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "": { "name": "root", },',
    '    "packages/a": { "name": "a", },',
    `    "packages/b": { "name": "b", "dependencies": ${JSON.stringify({ a: "workspace:*", ...bDeps })}, },`,
    '    "tools/c": { "name": "c", },',
    "  },",
    '  "packages": {',
    packages,
    "  },",
    "}",
    "",
  ].join("\n");
}

// Members a, b (depends on a, extends a shared tsconfig) and c, in packages/* and tools/*.
export function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "pmcp-affected-"));
  sh(root, "init", "-q");
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const json = (path: string, value: unknown): void =>
    write(path, JSON.stringify(value, null, 2) + "\n");
  json("package.json", {
    name: "root",
    workspaces: ["packages/*", "tools/*"],
    devDependencies: { typescript: "5.0.0" },
  });
  json("packages/a/package.json", { name: "a" });
  write("packages/a/src/index.ts", "export const a = 1;\n");
  json("packages/b/package.json", {
    name: "b",
    dependencies: { a: "workspace:*", leftpad: "1.0.0" },
  });
  json("packages/b/tsconfig.json", {
    extends: "../../configs/tsconfig.shared.json",
  });
  write(
    "packages/b/src/index.ts",
    'import { a } from "a";\nexport const b = a;\n',
  );
  json("tools/c/package.json", { name: "c" });
  json("tools/c/tsconfig.json", { extends: "a/tsconfig.preset.json" });
  json("packages/a/tsconfig.preset.json", {
    extends: "../../configs/tsconfig.preset-base.json",
  });
  write("tools/c/index.mjs", "export {};\n");
  json("configs/tsconfig.shared.json", { compilerOptions: {} });
  json("configs/tsconfig.preset-base.json", { compilerOptions: {} });
  write("examples/fixture/package.json", "{}\n");
  write("tsconfig.base.json", "{}\n");
  write("docs/readme.md", "docs\n");
  write(
    "bun.lock",
    lockText({ leftpad: "1.0.0", typescript: "5.0.0" }, { leftpad: "1.0.0" }),
  );
  const commit = (message: string): string => {
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "--allow-empty", "-m", message);
    return sh(root, "rev-parse", "HEAD");
  };
  commit("base");
  return { root, write, remove: (path) => rmSync(join(root, path)), commit };
}

export function config(
  overrides: Partial<AffectedConfig> = {},
): AffectedConfig {
  return {
    members: "workspaces",
    sharedInputs: [],
    readers: {},
    owners: {},
    ignore: [],
    include: ["**"],
    includeDeleted: [],
    onMemberChange: [],
    derive: [],
    unmapped: "all",
    consumers: false,
    ...overrides,
  };
}
