import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { selectAffected } from "../../src/git/affected/select.js";
import { config, workspace } from "./affected-fixture.js";
import { commit, isolateGit, remote, sh } from "./fixture.js";

beforeAll(isolateGit);

describe("an answer read from the objects at head", () => {
  it("stays the same when the working tree moves after the commit", () => {
    const ws = workspace();
    ws.write("packages/a/src/index.ts", "export const a = 2;\n");
    ws.write(
      "configs/tsconfig.shared.json",
      '{ "compilerOptions": { "strict": true } }\n',
    );
    ws.commit("edit a and the shared config");
    const settings = config({ consumers: true, derive: ["tsconfig"] });
    const before = selectAffected(ws.root, settings, "HEAD~1", "HEAD");
    expect(before).toMatchObject({
      all: false,
      changed: ["packages/a", "packages/b"],
      members: ["packages/a", "packages/b", "tools/c"],
      unmapped: [],
    });

    ws.write("package.json", "{ broken");
    ws.remove("packages/b/package.json");
    ws.remove("packages/b/tsconfig.json");
    ws.write("tools/c/tsconfig.json", "{}\n");
    ws.write(
      "packages/d/package.json",
      JSON.stringify({ name: "d", dependencies: { a: "*" } }),
    );
    rmSync(join(ws.root, "packages/a"), { recursive: true });
    expect(selectAffected(ws.root, settings, "HEAD~1", "HEAD")).toEqual(before);
  });

  it("reads a member inside a submodule at the commit the parent pins", () => {
    const lib = remote();
    commit(
      lib.main,
      "package.json",
      JSON.stringify({ name: "sub", dependencies: { a: "workspace:*" } }),
      "sub depends on a",
    );
    sh(lib.main, "push", "-q", "origin", "HEAD:main");
    const ws = workspace();
    sh(ws.root, "submodule", "add", "-q", lib.bare, "packages/sub");
    ws.commit("pin sub");
    ws.write("packages/a/src/index.ts", "export const a = 2;\n");
    ws.commit("edit a");
    const settings = config({ consumers: true });
    const before = selectAffected(ws.root, settings, "HEAD~1", "HEAD");
    expect(before.members).toEqual([
      "packages/a",
      "packages/b",
      "packages/sub",
      "tools/c",
    ]);

    const sub = join(ws.root, "packages/sub");
    commit(sub, "package.json", JSON.stringify({ name: "sub" }), "drop a");
    expect(selectAffected(ws.root, settings, "HEAD~1", "HEAD")).toEqual(before);
  });
});
