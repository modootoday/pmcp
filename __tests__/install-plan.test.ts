import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readInstalledDependencies } from "../src/installed.js";
import {
  applyInstallPlan,
  type PackageManagerRunner,
} from "../src/install/apply.js";
import {
  installContext,
  matchingSkills,
  planInstall,
} from "../src/install/plan.js";
import type { RemoteCatalog } from "../src/remote/catalog.js";
import { dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function json(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
const integrity = `sha512-${"A".repeat(86)}==`;
function catalog(): RemoteCatalog {
  return {
    revision: "r1",
    publishedAt: "2026-09-06T00:00:00.000Z",
    entries: [
      {
        productId: "example-skill",
        title: "Example",
        summary: "Example skill",
        delivery: { packageName: "@pmcp/example", version: "1.0.0", integrity },
        skillRevision: 1,
        contentDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        targets: [
          {
            packageName: "example",
            range: "^2.0.0",
            verifiedVersions: ["2.1.0"],
          },
        ],
      },
    ],
  };
}
function project(manager = "npm") {
  const root = mkdtempSync(join(tmpdir(), "pmcp-plan-"));
  roots.push(root);
  json(join(root, "package.json"), {
    packageManager: `${manager}@1.0.0`,
    dependencies: { example: "^2.0.0" },
  });
  json(join(root, "node_modules/example/package.json"), {
    name: "example",
    version: "2.1.0",
  });
  return root;
}
function plan(root: string, sync = false) {
  return planInstall({
    context: installContext(root),
    catalog: catalog(),
    inventory: readInstalledDependencies(root),
    selected: [],
    all: !sync,
    sync,
  });
}

it("plans an exact npm install without scripts or direct filesystem writes", () => {
  const root = project();
  const before = readFileSync(join(root, "package.json"), "utf8");
  const result = plan(root);
  expect(result.command.args).toEqual([
    "install",
    "--save-dev",
    "--save-exact",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "@pmcp/example@1.0.0",
  ]);
  expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);
});

it("uses Bun's own add command for a Bun project", () => {
  const result = plan(project("bun"));
  expect(result.command.executable).toBe("bun");
  expect(result.command.args).toEqual([
    "add",
    "--dev",
    "--exact",
    "--ignore-scripts",
    "@pmcp/example@1.0.0",
  ]);
});

it("rejects disagreeing lockfiles instead of guessing the manager", () => {
  const root = project();
  writeFileSync(join(root, "bun.lock"), "{}");
  expect(() => installContext(root)).toThrow("disagree");
  writeFileSync(join(root, "package-lock.json"), "{}");
  expect(() => installContext(root)).toThrow("conflicting");
});

it("sync updates only already declared skill packages", () => {
  const root = project();
  expect(plan(root, true).changes).toEqual([]);
  json(join(root, "package.json"), {
    packageManager: "npm@1.0.0",
    dependencies: { example: "^2.0.0" },
    devDependencies: { "@pmcp/example": "0.9.0" },
  });
  json(join(root, "node_modules/@pmcp/example/package.json"), {
    name: "@pmcp/example",
    version: "0.9.0",
  });
  expect(plan(root, true).changes).toHaveLength(1);
});

it("does not silently downgrade or move a production dependency", () => {
  const root = project();
  json(join(root, "package.json"), {
    packageManager: "npm@1.0.0",
    dependencies: { example: "^2.0.0" },
    devDependencies: { "@pmcp/example": "2.0.0" },
  });
  json(join(root, "node_modules/@pmcp/example/package.json"), {
    name: "@pmcp/example",
    version: "2.0.0",
  });
  expect(() => plan(root)).toThrow("downgrade");
  json(join(root, "package.json"), {
    packageManager: "npm@1.0.0",
    dependencies: { example: "^2.0.0", "@pmcp/example": "2.0.0" },
  });
  expect(() => plan(root)).toThrow("outside devDependencies");
});

it("distinguishes compatible versions from verified ones", () => {
  const root = project();
  json(join(root, "node_modules/example/package.json"), {
    name: "example",
    version: "2.2.0",
  });
  expect(
    matchingSkills(catalog(), readInstalledDependencies(root))[0]?.verified,
  ).toBe(false);
});

it("stops before installation on catalog/registry integrity mismatch", () => {
  let called = false;
  const result = plan(project());
  expect(() =>
    applyInstallPlan(result, {
      integrity: () => "different",
      install: () => {
        called = true;
        return 0;
      },
    }),
  ).toThrow("integrity differs");
  expect(called).toBe(false);
});

it("detects project changes while waiting for registry metadata", () => {
  const root = project();
  const result = plan(root);
  expect(() =>
    applyInstallPlan(result, {
      integrity: () => {
        writeFileSync(join(root, "package-lock.json"), "changed");
        return integrity;
      },
      install: () => {
        throw new Error("must not run");
      },
    }),
  ).toThrow("changed during");
});

it("propagates package manager failure and refuses a no-op success", () => {
  const result = plan(project());
  expect(
    applyInstallPlan(result, { integrity: () => integrity, install: () => 7 }),
  ).toBe(7);
  expect(() =>
    applyInstallPlan(result, { integrity: () => integrity, install: () => 0 }),
  ).toThrow("not installed");
});

it("verifies the installed version after package manager success", () => {
  const root = project();
  const result = plan(root);
  const runner: PackageManagerRunner = {
    integrity: () => integrity,
    install: () => {
      json(join(root, "package.json"), {
        packageManager: "npm@1.0.0",
        dependencies: { example: "^2.0.0" },
        devDependencies: { "@pmcp/example": "1.0.0" },
      });
      json(join(root, "node_modules/@pmcp/example/package.json"), {
        name: "@pmcp/example",
        version: "1.0.0",
      });
      return 0;
    },
  };
  expect(applyInstallPlan(result, runner)).toBe(0);
});

it("dispatches available and dry-run install against an offline catalog", async () => {
  const root = project();
  const file = join(root, "catalog.json");
  json(file, { schemaVersion: 1, requestId: "test", catalog: catalog() });
  let out = "";
  let err = "";
  const ui = new Ui({
    stdout: {
      write: (value) => {
        out += value;
      },
    },
    stderr: {
      write: (value) => {
        err += value;
      },
    },
    color: false,
  });
  const before = readFileSync(join(root, "package.json"), "utf8");
  expect(
    await dispatch(["available", "--catalog", file, "--json"], {
      cwd: root,
      ui,
    }),
  ).toBe(0);
  expect(JSON.parse(out).matches).toHaveLength(1);
  out = "";
  expect(
    await dispatch(
      ["install", "--all", "--catalog", file, "--dry-run", "--json"],
      { cwd: root, ui },
    ),
  ).toBe(0);
  expect(JSON.parse(out).status).toBe("planned");
  expect(err).toBe("");
  expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);
});
