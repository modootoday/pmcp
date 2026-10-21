import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../../../src/config.js";
import { project } from "../../../src/project/apply.js";
import { readSpec } from "../../../src/project/spec.js";

export interface ProjectionCase {
  readonly runtime: string;
  // [targets] tools; a runtime may need a sibling (grok rides claude when both are listed).
  readonly tools: readonly string[];
  readonly file: string;
  // A peer entry the projection must keep, written before the first projection.
  readonly peer?: { readonly content: string; readonly kept: RegExp };
  readonly owned: RegExp;
}

const HOOKS = (runtime: string) =>
  `[hooks]\ntargets = ["${runtime}"]\n\n[hooks.guards.shell.heredoc]\n`;

function scratch(t: TestContext, c: ProjectionCase) {
  const root = mkdtempSync(join(tmpdir(), `pmcp-${c.runtime}-`));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "pmcp.toml");
  const tools = c.tools.map((id) => `"${id}"`).join(", ");
  const write = (hooks: boolean) =>
    writeFileSync(
      config,
      `[targets]\ntools = [${tools}]\n\n${hooks ? HOOKS(c.runtime) : ""}`,
    );
  const run = (check = false) => {
    const result = project(readSpec(readConfig(config)), { check });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    return result;
  };
  const read = () => readFileSync(join(root, c.file), "utf8");
  return { root, write, run, read };
}

export function projectionCases(c: ProjectionCase): void {
  describe(`${c.runtime}: projection`, () => {
    it("projects the hook, passes --check, and reports drift after a hand edit", (t) => {
      const s = scratch(t, c);
      if (c.peer) {
        mkdirSync(dirname(join(s.root, c.file)), { recursive: true });
        writeFileSync(join(s.root, c.file), c.peer.content);
      }
      s.write(true);
      expect(s.run().code).toBe(0);
      expect(s.read()).toMatch(c.owned);
      if (c.peer) expect(s.read()).toMatch(c.peer.kept);
      expect(s.run(true).code).toBe(0);
      writeFileSync(
        join(s.root, c.file),
        s.read().replace(c.owned, "tampered"),
      );
      // An edited owned entry either reports drift or refuses outright; both stop the run.
      let report: string;
      try {
        const checked = s.run(true);
        expect(checked.code).not.toBe(0);
        report = checked.problems.join("\n");
      } catch (error) {
        report = String(error);
      }
      expect(report).toMatch(/drift|edited/u);
    });

    it("removes its entries when [hooks] goes away and keeps the peer's", (t) => {
      const s = scratch(t, c);
      if (c.peer) {
        mkdirSync(dirname(join(s.root, c.file)), { recursive: true });
        writeFileSync(join(s.root, c.file), c.peer.content);
      }
      s.write(true);
      expect(s.run().code).toBe(0);
      s.write(false);
      expect(s.run().code).toBe(0);
      const left = existsSync(join(s.root, c.file)) ? s.read() : "";
      expect(left).not.toMatch(c.owned);
      if (c.peer) expect(left).toMatch(c.peer.kept);
    });
  });
}
