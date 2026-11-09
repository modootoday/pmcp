import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseBunLock } from "../../src/git/affected/lockfile/bun.js";
import { memberMatcher } from "../../src/git/affected/members.js";
import { selectAffected } from "../../src/git/affected/select.js";
import { config, lockText, workspace } from "./affected-fixture.js";
import { isolateGit } from "./fixture.js";

beforeAll(isolateGit);

const lockfile = {
  adapter: "bun" as const,
  toolchain: ["typescript", "@types/*"],
  inertRootFields: ["scripts", "description", "version"],
};

describe("member mapping", () => {
  it("maps a changed file to its member and adds consumers only for typecheck", () => {
    const ws = workspace();
    ws.write("packages/a/src/index.ts", "export const a = 2;\n");
    ws.commit("edit a");
    const tests = selectAffected(ws.root, config(), "HEAD~1", "HEAD");
    expect(tests).toMatchObject({
      all: false,
      changed: ["packages/a"],
      members: ["packages/a"],
    });
    const wide = selectAffected(
      ws.root,
      config({ consumers: true }),
      "HEAD~1",
      "HEAD",
    );
    expect(wide.changed).toEqual(["packages/a"]);
    expect(wide.members).toEqual(["packages/a", "packages/b", "tools/c"]);
    const testsOnly = selectAffected(
      ws.root,
      config({ consumers: true }),
      "HEAD~1",
      "HEAD",
      true,
    );
    expect(testsOnly.members).toEqual(["packages/a"]);
  });

  it("does not treat a manifest outside the workspace globs as a member", () => {
    const ws = workspace();
    ws.write("examples/fixture/index.ts", "export {};\n");
    ws.commit("edit fixture");
    const report = selectAffected(
      ws.root,
      config({ unmapped: "report" }),
      "HEAD~1",
      "HEAD",
    );
    expect(report).toMatchObject({
      all: false,
      changed: [],
      unmapped: ["examples/fixture/index.ts"],
    });
  });

  it("widens an unmapped file to ALL by default and only reports it when asked", () => {
    const ws = workspace();
    ws.write("docs/readme.md", "changed\n");
    ws.commit("docs");
    expect(selectAffected(ws.root, config(), "HEAD~1", "HEAD")).toMatchObject({
      all: true,
      unmapped: ["docs/readme.md"],
    });
    expect(
      selectAffected(ws.root, config({ unmapped: "report" }), "HEAD~1", "HEAD"),
    ).toMatchObject({
      all: false,
      changed: [],
      unmapped: ["docs/readme.md"],
    });
  });

  it("skips ignored and not-included paths entirely", () => {
    const ws = workspace();
    ws.write("docs/readme.md", "changed\n");
    ws.write("packages/a/notes.md", "changed\n");
    ws.commit("docs");
    const ignored = selectAffected(
      ws.root,
      config({ ignore: ["docs/**"], include: ["**/*.ts"] }),
      "HEAD~1",
      "HEAD",
    );
    expect(ignored).toMatchObject({ all: false, changed: [], unmapped: [] });
  });

  it("does not map a deleted file unless include_deleted names it", () => {
    const ws = workspace();
    ws.remove("tools/c/index.mjs");
    ws.commit("delete");
    expect(selectAffected(ws.root, config(), "HEAD~1", "HEAD").changed).toEqual(
      [],
    );
    expect(
      selectAffected(
        ws.root,
        config({ includeDeleted: ["**/*.mjs"] }),
        "HEAD~1",
        "HEAD",
      ).changed,
    ).toEqual(["tools/c"]);
  });

  it("maps a path through owners before walking up", () => {
    const ws = workspace();
    ws.write("qualification/suite.ts", "export {};\n");
    ws.commit("suite");
    expect(
      selectAffected(
        ws.root,
        config({ owners: { qualification: "tools/c" } }),
        "HEAD~1",
        "HEAD",
      ),
    ).toMatchObject({
      all: false,
      changed: ["tools/c"],
      unmapped: [],
    });
  });

  it("selects on_member_change members when a manifest arrives", () => {
    const ws = workspace();
    ws.write("packages/d/package.json", '{ "name": "d" }\n');
    ws.commit("add d");
    expect(
      selectAffected(
        ws.root,
        config({ onMemberChange: ["tools/c", "tools/gone"] }),
        "HEAD~1",
        "HEAD",
      ).changed,
    ).toEqual(["packages/d", "tools/c"]);
  });
});

describe("shared inputs and readers", () => {
  it("widens to ALL when a shared input changes", () => {
    const ws = workspace();
    ws.write("tsconfig.base.json", '{ "x": 1 }\n');
    ws.commit("base config");
    expect(
      selectAffected(
        ws.root,
        config({ sharedInputs: ["tsconfig.base.json"] }),
        "HEAD~1",
        "HEAD",
      ),
    ).toMatchObject({
      all: true,
      reason: "shared input tsconfig.base.json changed",
    });
  });

  it("selects configured readers and claims the path, dropping a reader that is no member", () => {
    const ws = workspace();
    ws.write("docs/readme.md", "changed\n");
    ws.commit("docs");
    const selection = selectAffected(
      ws.root,
      config({ readers: { "docs/**": ["tools/c", "tools/retired"] } }),
      "HEAD~1",
      "HEAD",
    );
    expect(selection).toMatchObject({
      all: false,
      changed: ["tools/c"],
      unmapped: [],
    });
  });

  it("derives tsconfig extends readers through relative and package-specifier steps", () => {
    const ws = workspace();
    ws.write(
      "configs/tsconfig.shared.json",
      '{ "compilerOptions": { "strict": true } }\n',
    );
    ws.write(
      "configs/tsconfig.preset-base.json",
      '{ "compilerOptions": { "strict": true } }\n',
    );
    ws.commit("shared configs");
    expect(selectAffected(ws.root, config(), "HEAD~1", "HEAD").all).toBe(true);
    const derived = selectAffected(
      ws.root,
      config({ derive: ["tsconfig"] }),
      "HEAD~1",
      "HEAD",
    );
    expect(derived).toMatchObject({
      all: false,
      changed: ["packages/a", "packages/b", "tools/c"],
      unmapped: [],
    });
  });
});

describe("lockfile", () => {
  it("selects the members whose resolved dependency changed, with their consumers", () => {
    const ws = workspace();
    ws.write(
      "bun.lock",
      lockText({ leftpad: "1.0.1", typescript: "5.0.0" }, { leftpad: "1.0.0" }),
    );
    ws.commit("bump leftpad");
    const selection = selectAffected(
      ws.root,
      config({ lockfile, consumers: true }),
      "HEAD~1",
      "HEAD",
    );
    expect(selection).toMatchObject({
      all: false,
      changed: ["packages/b"],
      members: ["packages/b"],
      unmapped: [],
    });
  });

  it("widens to ALL for a toolchain package", () => {
    const ws = workspace();
    ws.write(
      "bun.lock",
      lockText({ leftpad: "1.0.0", typescript: "5.1.0" }, { leftpad: "1.0.0" }),
    );
    ws.commit("bump typescript");
    expect(
      selectAffected(ws.root, config({ lockfile }), "HEAD~1", "HEAD"),
    ).toMatchObject({
      all: true,
      reason: "toolchain package typescript changed",
    });
  });

  it("widens to ALL for a root field outside the dependency and inert fields", () => {
    const ws = workspace();
    writeFileSync(
      join(ws.root, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*", "tools/*"],
        devDependencies: { typescript: "5.0.0" },
        overrides: { x: "1" },
      }),
    );
    ws.commit("overrides");
    expect(
      selectAffected(ws.root, config({ lockfile }), "HEAD~1", "HEAD").reason,
    ).toBe("root package.json overrides changed");
  });

  it("fails closed to ALL when the lockfile does not parse", () => {
    const ws = workspace();
    ws.write("bun.lock", "{ not json");
    ws.commit("break lock");
    expect(
      selectAffected(ws.root, config({ lockfile }), "HEAD~1", "HEAD"),
    ).toMatchObject({ all: true });
  });
});

describe("root dependencies", () => {
  const rootManifest = (deps: Record<string, string>): string =>
    JSON.stringify({
      name: "root",
      workspaces: ["packages/*", "tools/*"],
      devDependencies: { typescript: "5.0.0", ...deps },
    });

  // A root that already depends on deps at the base commit, then moves to next.
  function bumped(
    deps: Record<string, string>,
    next: Record<string, string>,
  ): ReturnType<typeof workspace> {
    const ws = workspace();
    ws.write("package.json", rootManifest(deps));
    ws.commit("root dependencies");
    ws.write("package.json", rootManifest(next));
    ws.commit("bump");
    return ws;
  }

  const select = (
    ws: ReturnType<typeof workspace>,
    rootDependencies: Record<string, string[]>,
  ) =>
    selectAffected(
      ws.root,
      config({ lockfile, rootDependencies }),
      "HEAD~1",
      "HEAD",
    );

  it("selects the members a mapped root dependency names, and says which key mapped it", () => {
    const ws = bumped(
      { "@modootoday/pmcp": "0.25.0" },
      { "@modootoday/pmcp": "0.26.0" },
    );
    expect(select(ws, { "@modootoday/*": ["tools/c"] })).toMatchObject({
      all: false,
      changed: ["tools/c"],
      rootDependencies: [
        {
          name: "@modootoday/pmcp",
          key: "@modootoday/*",
          members: ["tools/c"],
        },
      ],
    });
  });

  it("keeps ALL when one changed root dependency is not mapped", () => {
    const ws = bumped(
      { "@modootoday/pmcp": "0.25.0", other: "1.0.0" },
      { "@modootoday/pmcp": "0.26.0", other: "1.1.0" },
    );
    expect(select(ws, { "@modootoday/pmcp": ["tools/c"] })).toMatchObject({
      all: true,
      reason:
        "root dependency other changed and [git.affected.root_dependencies] does not map it",
    });
  });

  it("adds the members whose resolution moved in the lockfile to the mapped ones", () => {
    const ws = workspace();
    ws.write("package.json", rootManifest({ leftpad: "1.0.0" }));
    ws.commit("root uses leftpad");
    ws.write("package.json", rootManifest({ leftpad: "1.0.1" }));
    ws.write(
      "bun.lock",
      lockText({ leftpad: "1.0.1", typescript: "5.0.0" }, { leftpad: "1.0.0" }),
    );
    ws.commit("bump leftpad");
    expect(select(ws, { leftpad: ["tools/c"] })).toMatchObject({
      all: false,
      changed: ["packages/b", "tools/c"],
    });
  });

  it("selects nothing for a root dependency mapped to an empty list", () => {
    const ws = bumped(
      { "@modootoday/pmcp": "0.25.0" },
      { "@modootoday/pmcp": "0.26.0" },
    );
    expect(select(ws, { "@modootoday/pmcp": [] })).toMatchObject({
      all: false,
      changed: [],
      members: [],
    });
  });
});

describe("parsers", () => {
  it("reads bun.lock trailing commas and comments outside strings only", () => {
    const lock = parseBunLock(
      '{\n  // note\n  "workspaces": { "": { "name": "a//b", }, },\n  "packages": {},\n}\n',
    );
    expect(lock.workspaces[""]).toEqual({ name: "a//b" });
  });

  it("lets a later ! workspace glob remove a member", () => {
    const matches = memberMatcher(["packages/*", "!packages/private"]);
    expect(matches("packages/a")).toBe(true);
    expect(matches("packages/private")).toBe(false);
    expect(matches("packages/a/nested")).toBe(false);
  });
});

describe("fails closed", () => {
  it("answers ALL for an unresolvable base", () => {
    const ws = workspace();
    expect(
      selectAffected(ws.root, config(), "no-such-ref", "HEAD"),
    ).toMatchObject({ all: true, reason: "base no-such-ref does not resolve" });
  });

  it("answers ALL when base equals head", () => {
    const ws = workspace();
    expect(selectAffected(ws.root, config(), "HEAD", "HEAD")).toMatchObject({
      all: true,
      reason: "base equals head",
    });
  });

  it("answers ALL when the root manifest is unreadable", () => {
    const ws = workspace();
    ws.write("package.json", "{ broken");
    ws.write("packages/a/src/index.ts", "export const a = 3;\n");
    ws.commit("break root");
    expect(selectAffected(ws.root, config(), "HEAD~1", "HEAD").all).toBe(true);
  });
});
